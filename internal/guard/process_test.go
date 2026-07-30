package guard

import (
	"context"
	"io"
	"log/slog"
	"testing"
	"time"
)

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
