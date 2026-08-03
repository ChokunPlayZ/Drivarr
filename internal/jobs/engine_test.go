package jobs

import (
	"context"
	"io"
	"log/slog"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"drivarr/internal/core"
	"drivarr/internal/guard"
)

type fakeRunner struct{}

func (fakeRunner) Run(context.Context, string, ...string) guard.RunResult {
	return guard.RunResult{Output: []byte(`{"safe":true}`)}
}
func (fakeRunner) BlockedProcesses() int64 { return 0 }

type trackingRunner struct {
	active int64
	max    int64
}

func (r *trackingRunner) Run(context.Context, string, ...string) guard.RunResult {
	active := atomic.AddInt64(&r.active, 1)
	for {
		maximum := atomic.LoadInt64(&r.max)
		if active <= maximum || atomic.CompareAndSwapInt64(&r.max, maximum, active) {
			break
		}
	}
	time.Sleep(20 * time.Millisecond)
	atomic.AddInt64(&r.active, -1)
	return guard.RunResult{Output: []byte(`{"readBps":1,"readIops":1}`)}
}

func (r *trackingRunner) BlockedProcesses() int64 { return 0 }

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

func TestCreateQueuesAnotherTestForActiveDrive(t *testing.T) {
	store, err := core.OpenStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	device := guard.DeviceState{
		ID: "dev_test", Path: "/dev/test", Status: "ready",
		Probe: &guard.ProbeData{ID: "fingerprint", Serial: "SERIAL", Capacity: 1 << 30},
	}
	engine := NewEngine(store, fakeRunner{}, "drivarrd", fakeDevices{value: device},
		slog.New(slog.NewTextHandler(io.Discard, nil)))
	user := core.User{ID: "operator", Role: core.RoleOperator}

	if _, err := engine.Create(user, device, core.TestSMARTShort, "", "conservative", ""); err != nil {
		t.Fatal(err)
	}
	if _, err := engine.Create(user, device, core.TestSMARTLong, "", "conservative", ""); err != nil {
		t.Fatalf("queueing a second test: %v", err)
	}
	if got := len(store.Jobs()); got != 2 {
		t.Fatalf("queued %d tests, want 2", got)
	}
}

func TestCompleteDrivePresetQueuesOrderedSuite(t *testing.T) {
	store, err := core.OpenStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	device := guard.DeviceState{
		ID: "dev_test", Path: "/dev/test", Status: "ready",
		Probe: &guard.ProbeData{ID: "fingerprint", Serial: "SERIAL", Capacity: 1 << 30},
	}
	engine := NewEngine(store, fakeRunner{}, "drivarrd", fakeDevices{value: device},
		slog.New(slog.NewTextHandler(io.Discard, nil)))
	jobs, err := engine.CreatePreset(core.User{ID: "operator"}, device, PresetCompleteDriveCheck, "conservative")
	if err != nil {
		t.Fatal(err)
	}
	if len(jobs) != 3 || len(engine.queue) != 1 {
		t.Fatalf("preset created %d jobs and queued %d, want 3 jobs with only step 1 released", len(jobs), len(engine.queue))
	}
	wantProfiles := []string{"speed-read", "surface-read", "smart-long"}
	for index, job := range jobs {
		if job.ProfileID != wantProfiles[index] || job.SuiteID == "" || job.PresetID != PresetCompleteDriveCheck ||
			job.SuiteStep != index+1 || job.SuiteTotal != 3 {
			t.Fatalf("step %d = %+v", index+1, job)
		}
	}
	<-engine.queue
	first := jobs[0]
	engine.finish(&first, core.JobCompleted, "")
	if len(engine.queue) != 1 {
		t.Fatalf("finishing step 1 released %d jobs, want step 2 only", len(engine.queue))
	}
	if next := <-engine.queue; next != jobs[1].ID {
		t.Fatalf("released %q, want %q", next, jobs[1].ID)
	}
}

func TestQueuedTestsForSameDriveRunSerially(t *testing.T) {
	store, err := core.OpenStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	device := guard.DeviceState{
		ID: "dev_test", Path: "/dev/test", Status: "ready",
		Probe: &guard.ProbeData{ID: "fingerprint", Serial: "SERIAL", Capacity: 1 << 30},
	}
	runner := &trackingRunner{}
	engine := NewEngine(store, runner, "drivarrd", fakeDevices{value: device},
		slog.New(slog.NewTextHandler(io.Discard, nil)))
	user := core.User{ID: "operator", Role: core.RoleOperator}
	first, err := engine.Create(user, device, core.TestSpeed, "", "conservative", "")
	if err != nil {
		t.Fatal(err)
	}
	second, err := engine.Create(user, device, core.TestSpeed, "", "conservative", "")
	if err != nil {
		t.Fatal(err)
	}

	var wg sync.WaitGroup
	for _, id := range []string{first.ID, second.ID} {
		wg.Add(1)
		go func() {
			defer wg.Done()
			engine.execute(context.Background(), id)
		}()
	}
	wg.Wait()

	if got := atomic.LoadInt64(&runner.max); got != 1 {
		t.Fatalf("%d tests ran on the same drive at once, want 1", got)
	}
}

func TestDeleteOnlyRemovesIncompleteOrFailedJobs(t *testing.T) {
	store, err := core.OpenStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	engine := NewEngine(store, fakeRunner{}, "drivarrd", fakeDevices{},
		slog.New(slog.NewTextHandler(io.Discard, nil)))
	for _, status := range []core.JobStatus{core.JobFailed, core.JobCancelled, core.JobInterrupted} {
		job := core.Job{ID: "job_" + string(status), Status: status, CreatedAt: time.Now().UTC()}
		if err := store.SaveJob(job); err != nil {
			t.Fatal(err)
		}
		if err := engine.Delete(job.ID); err != nil {
			t.Fatalf("delete %s job: %v", status, err)
		}
		if _, exists := store.Job(job.ID); exists {
			t.Fatalf("%s job still exists after deletion", status)
		}
	}

	completed := core.Job{ID: "job_completed", Status: core.JobCompleted, CreatedAt: time.Now().UTC()}
	if err := store.SaveJob(completed); err != nil {
		t.Fatal(err)
	}
	if err := engine.Delete(completed.ID); err == nil {
		t.Fatal("completed job was deletable")
	}
	if _, exists := store.Job(completed.ID); !exists {
		t.Fatal("completed job was removed")
	}
}
