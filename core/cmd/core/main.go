// Command core starts ansa's backend service: it reads the settings, prepares
// encryption and the brain client, and serves the routes. See
// docs/backend/architecture.md for what core does.
package main

import (
	"context"
	"errors"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"ansa/core/internal/config"
	"ansa/core/internal/database"
	"ansa/core/internal/httpserver"
	"ansa/core/internal/logging"
	"ansa/core/internal/secure"
)

func main() {
	log := logging.New(os.Stdout)
	cfg, err := config.Load(os.Getenv)
	if err != nil {
		// The message names the settings, never their values.
		os.Stderr.WriteString(err.Error() + "\n")
		os.Exit(1)
	}
	if _, err := secure.NewBox(cfg.DataEncryptionKey); err != nil {
		os.Stderr.WriteString("settings: DATA_ENCRYPTION_KEY can't be used\n")
		os.Exit(1)
	}

	pool, err := database.Open(context.Background(), cfg.DatabaseURL)
	if err != nil {
		os.Stderr.WriteString(err.Error() + "\n")
		os.Exit(1)
	}
	defer pool.Close()

	routes := http.NewServeMux()
	routes.HandleFunc("GET /health", healthCheck(pool))
	server := httpserver.New(cfg.ListenAddr, routes, log)

	go func() {
		log.Info("core started")
		if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Error("core stopped", logging.ErrorType(err))
			os.Exit(1)
		}
	}()
	waitForStop(server, log)
}

// healthCheck answers 200 when the database answers, 503 when it doesn't:
// the uptime monitor's check. Never a body.
func healthCheck(pool *database.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if err := database.Ping(r.Context(), pool); err != nil {
			w.WriteHeader(http.StatusServiceUnavailable)
			return
		}
		httpserver.Health(w, r)
	}
}

// waitForStop finishes requests in progress (up to 20 seconds) when the
// process is asked to stop, so a deploy never cuts a webhook in half.
func waitForStop(server *http.Server, log *logging.Logger) {
	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)
	<-stop
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	if err := server.Shutdown(ctx); err != nil {
		log.Error("core shutdown", logging.ErrorType(err))
	}
	log.Info("core stopped")
}
