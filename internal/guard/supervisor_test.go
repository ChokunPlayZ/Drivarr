package guard

import (
	"context"
	"io"
	"log/slog"
	"sync/atomic"
	"testing"
	"time"
)

type hangingRunner struct {
	calls atomic.Int64
}

func (r *hangingRunner) Run(ctx context.Context, executable string, args ...string) RunResult {
	r.calls.Add(1)
	<-ctx.Done()
	return RunResult{Err: ErrDeadline, TimedOut: true, StillBlocked: true, ProcessID: 42}
}

func (r *hangingRunner) BlockedProcesses() int64 { return 1 }

func TestTimedOutDriveIsQuarantinedAndNotAutomaticallyRetried(t *testing.T) {
	runner := &hangingRunner{}
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	supervisor := NewSupervisor(runner, "drivarrd", 20*time.Millisecond, 1, logger)
	supervisor.devices["sda"] = &DeviceState{ID: "sda", Path: "/dev/sda", Name: "sda", Status: "discovered"}

	supervisor.probeKnown(context.Background(), "sda", false)
	state := supervisor.Snapshot()[0]
	if state.Status != "quarantined" || !state.ManualRetryOnly {
		t.Fatalf("expected manual quarantine, got %+v", state)
	}
	firstCalls := runner.calls.Load()
	supervisor.probeKnown(context.Background(), "sda", false)
	if runner.calls.Load() != firstCalls {
		t.Fatal("automatic probe retried a quarantined drive")
	}
}
