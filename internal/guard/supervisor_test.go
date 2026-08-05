package guard

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"slices"
	"sync/atomic"
	"testing"
	"time"
)

type successfulRunner struct {
	args []string
	err  error
}

func (r *successfulRunner) Run(_ context.Context, _ string, args ...string) RunResult {
	r.args = append([]string(nil), args...)
	return RunResult{Err: r.err}
}

func (r *successfulRunner) BlockedProcesses() int64 { return 0 }

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

func TestSnapshotSortsDevicesByPath(t *testing.T) {
	supervisor := NewSupervisor(&hangingRunner{}, "drivarrd", time.Second, 1,
		slog.New(slog.NewTextHandler(io.Discard, nil)))
	supervisor.devices["third"] = &DeviceState{ID: "third", Path: "/dev/sdc"}
	supervisor.devices["first"] = &DeviceState{ID: "first", Path: "/dev/sda"}
	supervisor.devices["second"] = &DeviceState{ID: "second", Path: "/dev/sdb"}

	devices := supervisor.Snapshot()
	for index, path := range []string{"/dev/sda", "/dev/sdb", "/dev/sdc"} {
		if devices[index].Path != path {
			t.Fatalf("device %d has path %q, want %q", index, devices[index].Path, path)
		}
	}
}

func TestEjectRunsIsolatedWorkerAndRemovesDrive(t *testing.T) {
	runner := &successfulRunner{}
	supervisor := NewSupervisor(runner, "drivarrd", time.Second, 1,
		slog.New(slog.NewTextHandler(io.Discard, nil)))
	supervisor.devices["sdb"] = &DeviceState{ID: "sdb", Path: "/dev/sdb", Name: "sdb", Status: "ready"}

	if err := supervisor.Eject(context.Background(), "sdb"); err != nil {
		t.Fatal(err)
	}
	want := []string{"internal-worker", "eject", "--device", "/dev/sdb"}
	if !slices.Equal(runner.args, want) {
		t.Fatalf("worker args = %q, want %q", runner.args, want)
	}
	if _, ok := supervisor.Device("sdb"); ok {
		t.Fatal("ejected drive is still present in the supervisor")
	}
}

func TestFailedEjectKeepsDriveAvailable(t *testing.T) {
	runner := &successfulRunner{err: errors.New("drive is in use")}
	supervisor := NewSupervisor(runner, "drivarrd", time.Second, 1,
		slog.New(slog.NewTextHandler(io.Discard, nil)))
	supervisor.devices["sdb"] = &DeviceState{ID: "sdb", Path: "/dev/sdb", Name: "sdb", Status: "ready"}

	if err := supervisor.Eject(context.Background(), "sdb"); err == nil {
		t.Fatal("expected eject failure")
	}
	device, ok := supervisor.Device("sdb")
	if !ok || device.Status != "ready" {
		t.Fatalf("failed eject should restore the drive, got %+v", device)
	}
}
