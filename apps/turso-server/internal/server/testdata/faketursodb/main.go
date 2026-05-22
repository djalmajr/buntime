// Command faketursodb is a no-op stand-in for the real `tursodb` binary
// used by Supervisor tests. The real binary accepts a positional DB path
// followed by `--sync-server <addr>`; Go's stdlib `flag` would reject
// flags after positionals, so we parse args by hand.
//
// Tests build this binary at the start of a run and point
// `Config.TursodbBin` at the resulting executable. We avoid pulling the
// real tursodb into the test suite because (1) it would tie CI to a
// release download and a specific arch and (2) tursodb's CDC/MVCC
// behavior is not what we are testing — the supervisor cares about
// process lifecycle, port allocation, and graceful shutdown, all of
// which a tiny stub covers faithfully.
package main

import (
	"context"
	"fmt"
	"net"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"
)

func main() {
	addr := ""
	for i := 1; i < len(os.Args); i++ {
		a := os.Args[i]
		if a == "--sync-server" && i+1 < len(os.Args) {
			addr = os.Args[i+1]
			i++
			continue
		}
		// any other arg (including the positional DB path) is ignored —
		// this stub does not touch the filesystem.
	}
	if addr == "" {
		fmt.Fprintln(os.Stderr, "--sync-server <addr> is required")
		os.Exit(2)
	}

	// Honor an optional CRASH env var so we can simulate a misbehaving
	// process. Set CRASH=1 to exit non-zero immediately, CRASH=panic to
	// die via a real go panic.
	switch os.Getenv("CRASH") {
	case "1":
		fmt.Fprintln(os.Stderr, "stub: crashing on demand")
		os.Exit(7)
	case "panic":
		panic("stub: panicking on demand")
	}

	ln, err := net.Listen("tcp", addr)
	if err != nil {
		fmt.Fprintf(os.Stderr, "listen %s: %v\n", addr, err)
		os.Exit(1)
	}
	srv := &http.Server{Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"results":[{"type":"ok","response":{"type":"execute","result":{}}}]}`))
	})}

	go func() {
		_ = srv.Serve(ln)
	}()

	sig := make(chan os.Signal, 1)
	signal.Notify(sig, syscall.SIGINT, syscall.SIGTERM)
	<-sig

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	_ = srv.Shutdown(ctx)
}
