package jobs

import (
	"context"
	"io"
	"log/slog"
	"testing"

	"drivarr/internal/core"
	"drivarr/internal/guard"
)

type fakeRunner struct{}

func (fakeRunner) Run(context.Context, string, ...string) guard.RunResult {
	return guard.RunResult{Output: []byte(`{"safe":true}`)}
}
func (fakeRunner) BlockedProcesses() int64 { return 0 }

type fakeDevices struct{ value guard.DeviceState }

func (f fakeDevices) Device(string) (guard.DeviceState, bool) { return f.value, true }
func (f fakeDevices) Quarantine(string, string)               {}

func TestCreateDestructiveJobRequiresGatesAndSnapshotsProfile(t *testing.T) {
	store, err := core.OpenStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	settings := store.Settings()
	settings.DestructiveEnabled = true
	if err := store.UpdateSettings(settings); err != nil {
		t.Fatal(err)
	}
	device := guard.DeviceState{
		ID: "dev_test", Path: "/dev/test", Status: "ready",
		Probe: &guard.ProbeData{ID: "fingerprint", Serial: "SERIAL", Capacity: 1 << 30},
	}
	engine := NewEngine(store, fakeRunner{}, "drivarrd", fakeDevices{value: device},
		slog.New(slog.NewTextHandler(io.Discard, nil)))
	user := core.User{ID: "operator", Role: core.RoleOperator}

	if _, err := engine.Create(user, device, core.TestDestructive, "destructive-verify", "conservative", "wrong"); err == nil {
		t.Fatal("destructive job accepted an incorrect serial")
	}
	job, err := engine.Create(user, device, core.TestDestructive, "destructive-verify", "conservative", "SERIAL")
	if err != nil {
		t.Fatal(err)
	}
	if !job.Destructive || job.ProfileID != "destructive-verify" || job.PolicySnapshot.ID != "conservative" {
		t.Fatalf("job did not preserve its safety/profile/policy snapshot: %+v", job)
	}
}
