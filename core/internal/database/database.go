// Package database is core's only door to PostgreSQL: the connection pool,
// transactions, and the list of tables that belong to a company.
//
// Every query lives in a module's store.go, takes a tenant.CompanyID first,
// and names company_id in every WHERE and INSERT (docs/backend/security.md,
// rule 1). tenant_test.go reads every store.go and fails when one doesn't.
package database

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Pool is the shared connection pool.
type Pool = pgxpool.Pool

// Tx is one transaction.
type Tx = pgx.Tx

// Open connects with safe limits: at most 10 connections per process, and a
// query waits at most 10 seconds for one (then fails instead of hanging).
func Open(ctx context.Context, url string) (*Pool, error) {
	cfg, err := pgxpool.ParseConfig(url)
	if err != nil {
		// Never the error's text: it can hold the address with its password.
		return nil, errors.New("database: DATABASE_URL can't be read")
	}
	cfg.MaxConns = 10
	cfg.ConnConfig.ConnectTimeout = 10 * time.Second
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return nil, fmt.Errorf("database: connecting: %T", err)
	}
	return pool, nil
}

// Ping is /health's check: one round trip, within 3 seconds.
func Ping(ctx context.Context, pool *Pool) error {
	ctx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	var one int
	return pool.QueryRow(ctx, "SELECT 1").Scan(&one)
}

// InTx runs work in one transaction: committed when work returns nil, rolled
// back otherwise (also on a panic).
func InTx(ctx context.Context, pool *Pool, work func(tx Tx) error) (err error) {
	tx, err := pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("database: begin: %w", err)
	}
	defer func() {
		if recovered := recover(); recovered != nil {
			_ = tx.Rollback(ctx)
			panic(recovered)
		}
		if err != nil {
			_ = tx.Rollback(ctx)
		}
	}()
	if err = work(tx); err != nil {
		return err
	}
	return tx.Commit(ctx)
}
