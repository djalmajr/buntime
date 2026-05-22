// Command turso-server is a multi-tenant wrapper around `tursodb --sync-server`.
//
// It exposes two HTTP listeners:
//
//   - Data port (default :8080): a namespace-aware reverse proxy. Clients
//     connect using `libsql://host:8080/<namespace>` (or
//     `http://host:8080/<namespace>/...`) and the wrapper strips the prefix
//     before forwarding to the tursodb process that owns that database.
//   - Admin port (default :8081): REST API for namespace lifecycle (create,
//     delete, list, lock, ttl). Requires `TURSO_ADMIN_TOKEN`.
//
// Namespaces are persisted in `<data-dir>/_state/namespaces.json` and the
// matching `<data-dir>/<name>.db*` files. On restart, every namespace is
// respawned.
//
// See `wiki/ops/turso-server.md` for the canonical configuration reference.
package main

import (
	"context"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/zommehq/buntime/apps/turso-server/internal/server"
)

const shutdownTimeout = 10 * time.Second

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{
		Level: slog.LevelInfo,
	}))
	slog.SetDefault(logger)

	cfg, err := server.Load()
	if err != nil {
		logger.Error("config load failed", slog.String("err", err.Error()))
		os.Exit(1)
	}
	logger.Info("turso-server starting",
		slog.String("dataAddr", cfg.DataAddr),
		slog.String("adminAddr", cfg.AdminAddr),
		slog.String("dataDir", cfg.DataDir),
		slog.String("tursodbBin", cfg.TursodbBin),
		slog.Bool("authData", cfg.DataToken != ""),
		slog.Bool("authAdmin", cfg.AdminToken != ""),
		slog.Bool("allowAutoProvision", cfg.AllowAutoProvision))

	store, err := server.NewStore(cfg.DataDir)
	if err != nil {
		logger.Error("state load failed", slog.String("err", err.Error()))
		os.Exit(1)
	}
	defer func() { _ = store.Close() }()

	supervisor := server.NewSupervisor(cfg, store, logger)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// Restore previously-known namespaces.
	supervisor.Restore(ctx)

	gc := server.NewGC(cfg, supervisor, store, logger)
	gc.Start()
	defer gc.Stop()

	dataSrv := &http.Server{
		Addr:              cfg.DataAddr,
		Handler:           server.DataHandler(cfg, supervisor, store, logger),
		ReadHeaderTimeout: 10 * time.Second,
	}
	adminSrv := &http.Server{
		Addr:              cfg.AdminAddr,
		Handler:           server.AdminHandler(cfg, supervisor, store, logger),
		ReadHeaderTimeout: 10 * time.Second,
	}

	go func() {
		logger.Info("data listener", slog.String("addr", cfg.DataAddr))
		if err := dataSrv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			logger.Error("data listener crashed", slog.String("err", err.Error()))
			cancel()
		}
	}()
	go func() {
		logger.Info("admin listener", slog.String("addr", cfg.AdminAddr))
		if err := adminSrv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			logger.Error("admin listener crashed", slog.String("err", err.Error()))
			cancel()
		}
	}()

	// Signal handling: SIGINT/SIGTERM trigger graceful shutdown. We then
	// stop accepting new connections, give in-flight requests a moment to
	// finish, and finally kill backend tursodb processes.
	sig := make(chan os.Signal, 2)
	signal.Notify(sig, syscall.SIGINT, syscall.SIGTERM)

	select {
	case <-ctx.Done():
		logger.Warn("internal cancel triggered shutdown")
	case s := <-sig:
		logger.Info("shutdown signal received", slog.String("signal", s.String()))
	}

	shutCtx, shutCancel := context.WithTimeout(context.Background(), shutdownTimeout)
	defer shutCancel()
	_ = dataSrv.Shutdown(shutCtx)
	_ = adminSrv.Shutdown(shutCtx)
	supervisor.Stop(5 * time.Second)
	logger.Info("turso-server stopped")
}
