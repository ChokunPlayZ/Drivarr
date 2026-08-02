package guard

import (
	"context"
	"io"
	"log/slog"
	"strings"
	"testing"
	"time"
)

func TestProcessRunnerKeepsWorkerDiagnosticsOutOfOutput(t *testing.T) {
	runner := NewProcessRunner(slog.New(slog.NewTextHandler(io.Discard, nil)))
	result := runner.Run(context.Background(), "/bin/sh", "-c", `printf 'Command diagnostic\n' >&2; printf '{"readBps":123}'`)
	if result.Err != nil {
		t.Fatal(result.Err)
	}
	if got, want := string(result.Output), `{"readBps":123}`; got != want {
		t.Fatalf("worker output = %q, want %q", got, want)
	}
}

func TestProcessRunnerIncludesWorkerDiagnosticsInFailure(t *testing.T) {
	runner := NewProcessRunner(slog.New(slog.NewTextHandler(io.Discard, nil)))
	result := runner.Run(context.Background(), "/bin/sh", "-c", `printf 'fio refused the request\n' >&2; exit 1`)
	if result.Err == nil || !strings.Contains(result.Err.Error(), "fio refused the request") {
		t.Fatalf("worker error did not include stderr: %v", result.Err)
	}
}

func TestProcessRunnerReturnsWhenWorkerHangs(t *testing.T) {
	runner := NewProcessRunner(slog.New(slog.NewTextHandler(io.Discard, nil)))
	ctx, cancel := context.WithTimeout(context.Background(), 80*time.Millisecond)
	defer cancel()

	started := time.Now()
	result := runner.Run(ctx, "/bin/sh", "-c", "sleep 30")
	if !result.TimedOut {
		t.Fatalf("expected timeout, got %+v", result)
	}
	if elapsed := time.Since(started); elapsed > time.Second {
		t.Fatalf("daemon waited too long for hanging worker: %s", elapsed)
	}
}
