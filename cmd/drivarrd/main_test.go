package main

import (
	"context"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"drivarr/internal/core"
	"drivarr/internal/guard"
	"drivarr/internal/jobs"
)

type idleRunner struct{}

func (idleRunner) Run(context.Context, string, ...string) guard.RunResult {
	return guard.RunResult{Output: []byte("[]")}
}

func (idleRunner) BlockedProcesses() int64 { return 0 }

func TestStylesheetIsEmbeddedAndServed(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	supervisor := guard.NewSupervisor(idleRunner{}, "drivarrd", time.Second, 1, logger)
	store, err := core.OpenStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	engine := jobs.NewEngine(store, idleRunner{}, "drivarrd", supervisor, logger)
	handler := newAPI(supervisor, store, engine, t.TempDir(), logger).routes()

	request := httptest.NewRequest(http.MethodGet, "/styles.css", nil)
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("expected stylesheet status 200, got %d", response.Code)
	}
	if contentType := response.Header().Get("Content-Type"); !strings.HasPrefix(contentType, "text/css") {
		t.Fatalf("expected CSS content type, got %q", contentType)
	}
	if !strings.Contains(response.Body.String(), "--primary") {
		t.Fatal("served stylesheet does not contain the Material theme")
	}
}
