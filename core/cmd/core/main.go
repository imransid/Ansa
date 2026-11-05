// Command core starts ansa's backend service: it reads the settings, opens
// the database, starts the job workers and serves the routes. See
// docs/backend/architecture.md for what core does.
package main

import (
	"context"
	"errors"
	"net/http"
	"os"
	"sync"

	"ansa/core/internal/config"
	"ansa/core/internal/database"
	"ansa/core/internal/httpserver"
	"ansa/core/internal/logging"
	"ansa/core/internal/schedule"
	"ansa/core/internal/secure"
)

// How many jobs run at once in one core process. The database pool has 10
// connections; this leaves room for the webhooks.
const workerCount = 4

func main() {
	log := logging.New(os.Stdout)
	cfg, err := config.Load(os.Getenv)
	if err != nil {
		// The message names the settings, never their values.
		os.Stderr.WriteString(err.Error() + "\n")
		os.Exit(1)
	}
	box, err := secure.NewBox(cfg.DataEncryptionKey)
	if err != nil {
		os.Stderr.WriteString("settings: DATA_ENCRYPTION_KEY can't be used\n")
		os.Exit(1)
	}
	pool, err := database.Open(context.Background(), cfg.DatabaseURL)
	if err != nil {
		os.Stderr.WriteString(err.Error() + "\n")
		os.Exit(1)
	}
	defer pool.Close()

	core := assemble(cfg, pool, box, log)
	server := httpserver.New(cfg.ListenAddr, core.routes, log)
	workCtx, stopWork := context.WithCancel(context.Background())
	var working sync.WaitGroup
	for range workerCount {
		working.Add(1)
		go func() {
			defer working.Done()
			core.worker.Run(workCtx)
		}()
	}
	if !cfg.SchedulerOff {
		go schedule.Run(workCtx, log, core.tasks)
	}
	go func() {
		// Says which mode it runs in, so a production core missing its
		// ANSA_ENV (or a laptop's set to production) shows at once.
		log.Info("core started", logging.Code(cfg.Environment))
		if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Error("core stopped", logging.ErrorType(err))
			os.Exit(1)
		}
	}()
	servers := []*http.Server{server}
	if cfg.DeviceListenAddr != "" {
		servers = append(servers, startPhoneListener(cfg.DeviceListenAddr, core.deviceRoutes, log))
	}
	waitForStop(servers, stopWork, &working, log)
}

// startPhoneListener is the development LAN listener (DEVICE_LISTEN_ADDR,
// refused in production by config): the ansa phone app's routes only, so a
// real phone on the Wi-Fi reaches the laptop while everything else stays
// on CORE_LISTEN_ADDR (127.0.0.1).
func startPhoneListener(addr string, routes http.Handler, log *logging.Logger) *http.Server {
	server := httpserver.New(addr, routes, log)
	go func() {
		log.Info("core: phone app listener started")
		if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Error("core: phone app listener stopped", logging.ErrorType(err))
			os.Exit(1)
		}
	}()
	return server
}
