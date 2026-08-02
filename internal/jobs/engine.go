package jobs

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"strconv"
	"sync"
	"time"

	"drivarr/internal/core"
	"drivarr/internal/guard"
)

type ChunkResult struct {
	ReadBPS   int64              `json:"readBps"`
	WriteBPS  int64              `json:"writeBps"`
	ReadIOPS  float64            `json:"readIops"`
	WriteIOPS float64            `json:"writeIops"`
	Errors    []core.SectorError `json:"errors,omitempty"`
}

type SafetyResult struct {
	Safe    bool     `json:"safe"`
	Reasons []string `json:"reasons,omitempty"`
}

type DeviceRegistry interface {
	Device(id string) (guard.DeviceState, bool)
	Quarantine(id, reason string)
}

type Engine struct {
	store       *core.Store
	runner      guard.Runner
	executable  string
	devices     DeviceRegistry
	logger      *slog.Logger
	queue       chan string
	destructive chan struct{}
	deviceMu    sync.Mutex
	deviceLocks map[string]*sync.Mutex
	mu          sync.Mutex
	running     map[string]context.CancelFunc
	ctx         context.Context
}

func NewEngine(store *core.Store, runner guard.Runner, executable string, devices DeviceRegistry, logger *slog.Logger) *Engine {
	settings := store.Settings()
	return &Engine{
		store: store, runner: runner, executable: executable, devices: devices,
		logger: logger, queue: make(chan string, 256),
		destructive: make(chan struct{}, max(1, settings.MaxDestructiveJobs)),
		deviceLocks: make(map[string]*sync.Mutex), running: make(map[string]context.CancelFunc),
	}
}

func (e *Engine) Run(ctx context.Context) {
	e.ctx = ctx
	settings := e.store.Settings()
	for range max(1, settings.MaxConcurrentJobs) {
		go e.worker(ctx)
	}
	for _, job := range e.store.Jobs() {
		if job.Status == core.JobQueued {
			e.enqueue(job.ID)
		}
	}
	<-ctx.Done()
}

func (e *Engine) worker(ctx context.Context) {
	for {
		select {
		case <-ctx.Done():
			return
		case id := <-e.queue:
			e.execute(ctx, id)
		}
	}
}

func (e *Engine) enqueue(id string) {
	select {
	case e.queue <- id:
	default:
		e.logger.Error("job queue is full", "job", id)
	}
}

func (e *Engine) Create(user core.User, device guard.DeviceState, kind core.TestKind, profileID, policyID, serialConfirmation string) (core.Job, error) {
	if device.Status != "ready" || device.Probe == nil {
		return core.Job{}, errors.New("drive is not ready")
	}
	var profile core.TestProfile
	if profileID != "" {
		var ok bool
		profile, ok = e.store.Profile(profileID)
		if !ok || !profile.Enabled {
			return core.Job{}, errors.New("test profile is unavailable")
		}
		kind = profile.Kind
	} else {
		for _, candidate := range e.store.Profiles() {
			if candidate.Kind == kind && candidate.BuiltIn {
				profile = candidate
				break
			}
		}
	}
	if kind != core.TestSMARTShort && kind != core.TestSMARTLong && kind != core.TestSMARTConvey &&
		kind != core.TestSpeed && kind != core.TestSurfaceRead && kind != core.TestDestructive {
		return core.Job{}, errors.New("unsupported test kind")
	}
	settings := e.store.Settings()
	destructive := kind == core.TestDestructive
	if destructive {
		if !settings.DestructiveEnabled {
			return core.Job{}, errors.New("destructive testing is disabled by an administrator")
		}
		if serialConfirmation == "" || serialConfirmation != device.Probe.Serial {
			return core.Job{}, errors.New("serial-number confirmation does not match")
		}
	}
	policy, ok := e.store.Policy(policyID)
	if !ok {
		policy, _ = e.store.Policy("conservative")
	}
	chunk := settings.JobChunkMiB * 1024 * 1024
	job := core.Job{
		ID: core.NewID("job"), DeviceID: device.ID, DevicePath: device.Path,
		DeviceFingerprint: device.Probe.ID, Kind: kind, Status: core.JobQueued,
		CreatedBy: user.ID, CreatedAt: time.Now().UTC(), TotalBytes: device.Probe.Capacity,
		ChunkBytes: chunk, Verdict: core.VerdictIncomplete, PolicyID: policy.ID,
		PolicyVersion: policy.Version, PolicySnapshot: policy, Destructive: destructive,
		ProfileID: profile.ID, ProfileName: profile.Name, BlockSizeKiB: profile.BlockSizeKiB,
		QueueDepth: profile.QueueDepth, DurationSeconds: profile.DurationSeconds, RateMiB: profile.RateMiB,
	}
	if err := e.store.SaveJob(job); err != nil {
		return core.Job{}, err
	}
	e.store.Audit(user.ID, "job.create", job.ID, "", map[string]any{"kind": kind, "device": device.ID})
	e.enqueue(job.ID)
	return job, nil
}

func (e *Engine) execute(parent context.Context, id string) {
	job, ok := e.store.Job(id)
	if !ok || (job.Status != core.JobQueued && job.Status != core.JobInterrupted) {
		return
	}
	unlockDevice := e.lockDevice(job.DeviceID)
	defer unlockDevice()
	// A worker may have waited behind another test for this drive. Reload the
	// job so cancellation or another state change made while queued is honored.
	job, ok = e.store.Job(id)
	if !ok || (job.Status != core.JobQueued && job.Status != core.JobInterrupted) {
		return
	}
	ctx, cancel := context.WithCancel(parent)
	e.mu.Lock()
	if _, exists := e.running[id]; exists {
		e.mu.Unlock()
		cancel()
		return
	}
	e.running[id] = cancel
	e.mu.Unlock()
	defer func() {
		cancel()
		e.mu.Lock()
		delete(e.running, id)
		e.mu.Unlock()
	}()

	now := time.Now().UTC()
	job.Status, job.StartedAt, job.Error = core.JobValidating, &now, ""
	_ = e.store.SaveJob(job)
	if current, ok := e.devices.Device(job.DeviceID); !ok || current.Probe == nil ||
		current.Probe.ID != job.DeviceFingerprint {
		e.finish(&job, core.JobInterrupted, "Drive identity changed or the drive is unavailable")
		return
	} else if current.Path != job.DevicePath {
		job.DevicePath = current.Path
		_ = e.store.SaveJob(job)
	}

	if job.Destructive {
		select {
		case e.destructive <- struct{}{}:
			defer func() { <-e.destructive }()
		case <-ctx.Done():
			e.finish(&job, core.JobInterrupted, ctx.Err().Error())
			return
		}
		result := e.runIsolated(ctx, 15*time.Second, "safety-check", "--device", job.DevicePath)
		var safety SafetyResult
		if result.Err != nil || json.Unmarshal(result.Output, &safety) != nil || !safety.Safe {
			reason := "Destructive safety validation failed"
			if len(safety.Reasons) > 0 {
				reason += ": " + safety.Reasons[0]
			}
			e.finish(&job, core.JobFailed, reason)
			return
		}
	}

	job.Status, job.CurrentPhase = core.JobRunning, "starting"
	_ = e.store.SaveJob(job)
	switch job.Kind {
	case core.TestSurfaceRead, core.TestDestructive:
		e.runChunked(ctx, &job)
	case core.TestSpeed:
		e.runSpeed(ctx, &job)
	case core.TestSMARTShort, core.TestSMARTLong, core.TestSMARTConvey:
		e.runSMART(ctx, &job)
	}
}

func (e *Engine) lockDevice(id string) func() {
	e.deviceMu.Lock()
	lock := e.deviceLocks[id]
	if lock == nil {
		lock = &sync.Mutex{}
		e.deviceLocks[id] = lock
	}
	e.deviceMu.Unlock()
	lock.Lock()
	return lock.Unlock
}

func (e *Engine) runChunked(ctx context.Context, job *core.Job) {
	for offset := job.CompletedBytes; offset < job.TotalBytes; {
		current, _ := e.store.Job(job.ID)
		switch current.Status {
		case core.JobPauseRequested:
			current.Status, current.CurrentPhase = core.JobPaused, "paused at checkpoint"
			_ = e.store.SaveJob(current)
			return
		case core.JobCancelRequested:
			e.finish(&current, core.JobCancelled, "")
			return
		}
		size := min(job.ChunkBytes, job.TotalBytes-offset)
		mode := "read"
		operation := "badblocks-chunk"
		if job.Destructive {
			mode = "write-verify"
			operation = "fio-chunk"
		}
		current.CurrentPhase = mode
		_ = e.store.SaveJob(current)
		result := e.runIsolated(ctx, 20*time.Minute, operation, "--device", job.DevicePath,
			"--mode", mode, "--offset", strconv.FormatInt(offset, 10), "--size", strconv.FormatInt(size, 10),
			"--bs-kib", strconv.Itoa(max(4, job.BlockSizeKiB)), "--queue-depth", strconv.Itoa(max(1, job.QueueDepth)),
			"--rate-mib", strconv.Itoa(job.RateMiB))
		if result.Err != nil {
			latest, _ := e.store.Job(job.ID)
			if latest.Status == core.JobPauseRequested {
				latest.Status, latest.CurrentPhase, latest.Error = core.JobPaused, "paused at checkpoint", ""
				_ = e.store.SaveJob(latest)
				return
			}
			if latest.Status == core.JobCancelRequested {
				e.finish(&latest, core.JobCancelled, "")
				return
			}
			if result.TimedOut {
				e.devices.Quarantine(job.DeviceID, "A test command exceeded its deadline and the drive was quarantined.")
			}
			e.finish(&current, core.JobInterrupted, result.Err.Error())
			return
		}
		var metrics ChunkResult
		if err := json.Unmarshal(result.Output, &metrics); err != nil {
			e.finish(&current, core.JobFailed, "Invalid fio result: "+err.Error())
			return
		}
		current.CompletedBytes = offset + size
		current.Progress = float64(current.CompletedBytes) / float64(max(1, current.TotalBytes))
		current.ReadBPS, current.WriteBPS = metrics.ReadBPS, metrics.WriteBPS
		current.Errors = append(current.Errors, metrics.Errors...)
		if err := e.store.SaveJob(current); err != nil {
			e.finish(&current, core.JobInterrupted, "Could not persist checkpoint: "+err.Error())
			return
		}
		*job, offset = current, current.CompletedBytes
	}
	e.gradeAndFinish(job)
}

func (e *Engine) runSpeed(ctx context.Context, job *core.Job) {
	var combined ChunkResult
	modes := []string{"speed-sequential", "speed-random"}
	for index, mode := range modes {
		job.CurrentPhase = mode
		job.Progress = float64(index) / float64(len(modes))
		_ = e.store.SaveJob(*job)
		result := e.runIsolated(ctx, 2*time.Minute, "fio-chunk", "--device", job.DevicePath, "--mode", mode,
			"--duration", strconv.Itoa(max(1, job.DurationSeconds)), "--bs-kib", strconv.Itoa(max(4, job.BlockSizeKiB)),
			"--queue-depth", strconv.Itoa(max(1, job.QueueDepth)), "--rate-mib", strconv.Itoa(job.RateMiB))
		if result.Err != nil {
			e.finish(job, core.JobInterrupted, result.Err.Error())
			return
		}
		var metrics ChunkResult
		if err := json.Unmarshal(result.Output, &metrics); err != nil {
			e.finish(job, core.JobFailed, err.Error())
			return
		}
		if mode == "speed-sequential" {
			combined.ReadBPS = metrics.ReadBPS
		} else {
			combined.ReadIOPS = metrics.ReadIOPS
		}
	}
	job.ReadBPS, job.ReadIOPS, job.Progress = combined.ReadBPS, combined.ReadIOPS, 1
	e.gradeAndFinish(job)
}

func (e *Engine) runSMART(ctx context.Context, job *core.Job) {
	kind := map[core.TestKind]string{
		core.TestSMARTShort: "short", core.TestSMARTLong: "long", core.TestSMARTConvey: "conveyance",
	}[job.Kind]
	result := e.runIsolated(ctx, 30*time.Second, "smart-test", "--device", job.DevicePath, "--kind", kind)
	if result.Err != nil {
		e.finish(job, core.JobFailed, result.Err.Error())
		return
	}
	var response struct {
		PollSeconds int `json:"pollSeconds"`
	}
	if err := json.Unmarshal(result.Output, &response); err != nil {
		e.finish(job, core.JobFailed, err.Error())
		return
	}
	if response.PollSeconds < 10 {
		response.PollSeconds = 10
	}
	start := time.Now()
	ticker := time.NewTicker(10 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			current, _ := e.store.Job(job.ID)
			if current.Status == core.JobCancelRequested {
				_ = e.runIsolated(context.Background(), 20*time.Second, "smart-abort", "--device", job.DevicePath)
				e.finish(&current, core.JobCancelled, "")
			} else {
				e.finish(job, core.JobInterrupted, ctx.Err().Error())
			}
			return
		case <-ticker.C:
			current, _ := e.store.Job(job.ID)
			if current.Status == core.JobCancelRequested {
				_ = e.runIsolated(context.Background(), 20*time.Second, "smart-abort", "--device", job.DevicePath)
				e.finish(&current, core.JobCancelled, "")
				return
			}
			elapsed := time.Since(start)
			current.Progress = min(.99, elapsed.Seconds()/float64(response.PollSeconds))
			current.CurrentPhase = "drive self-test"
			_ = e.store.SaveJob(current)
			*job = current
			if elapsed >= time.Duration(response.PollSeconds)*time.Second {
				job.Progress = 1
				e.gradeAndFinish(job)
				return
			}
		}
	}
}

func (e *Engine) runIsolated(ctx context.Context, timeout time.Duration, operation string, args ...string) guard.RunResult {
	limited, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	workerArgs := append([]string{"internal-worker", operation}, args...)
	return e.runner.Run(limited, e.executable, workerArgs...)
}

func (e *Engine) gradeAndFinish(job *core.Job) {
	policy := job.PolicySnapshot
	if policy.ID == "" {
		policy, _ = e.store.Policy(job.PolicyID)
	}
	status, verdict := core.JobCompleted, core.VerdictPass
	if len(job.Errors) > 0 && policy.FailOnIOError {
		status, verdict = core.JobFailed, core.VerdictFail
	} else if len(job.Errors) > 0 {
		status, verdict = core.JobWarning, core.VerdictWarning
	}
	if device, ok := e.devices.Device(job.DeviceID); ok && device.Probe != nil {
		probe := device.Probe
		if policy.FailOnSMART && probe.SMARTAvailable && !probe.SMARTPassed {
			status, verdict = core.JobFailed, core.VerdictFail
		} else if probe.Pending > policy.WarnPendingAbove ||
			probe.Reallocated > policy.WarnReallocatedAbove ||
			probe.Uncorrectable > policy.WarnUncorrectableAbove {
			if verdict != core.VerdictFail {
				status, verdict = core.JobWarning, core.VerdictWarning
			}
		}
	}
	job.Verdict = verdict
	e.finish(job, status, "")
}

func (e *Engine) finish(job *core.Job, status core.JobStatus, message string) {
	now := time.Now().UTC()
	job.Status, job.Error, job.FinishedAt = status, message, &now
	if status == core.JobFailed {
		job.Verdict = core.VerdictFail
	}
	if status == core.JobInterrupted || status == core.JobCancelled {
		job.Verdict = core.VerdictIncomplete
	}
	_ = e.store.SaveJob(*job)
}

func (e *Engine) Pause(id string) error {
	job, ok := e.store.Job(id)
	if !ok {
		return core.ErrNotFound
	}
	if job.Kind != core.TestSurfaceRead && job.Kind != core.TestDestructive {
		return errors.New("this test cannot be paused")
	}
	if job.Status != core.JobRunning {
		return errors.New("job is not running")
	}
	job.Status = core.JobPauseRequested
	if err := e.store.SaveJob(job); err != nil {
		return err
	}
	e.cancelActive(id)
	return nil
}

func (e *Engine) Resume(id string) error {
	job, ok := e.store.Job(id)
	if !ok {
		return core.ErrNotFound
	}
	if job.Status != core.JobPaused && job.Status != core.JobInterrupted {
		return errors.New("job is not resumable")
	}
	current, ok := e.devices.Device(job.DeviceID)
	if !ok || current.Probe == nil || current.Probe.ID != job.DeviceFingerprint {
		return errors.New("the original drive is not available")
	}
	job.Status, job.Error, job.DevicePath = core.JobQueued, "", current.Path
	if err := e.store.SaveJob(job); err != nil {
		return err
	}
	e.enqueue(id)
	return nil
}

func (e *Engine) Cancel(id string) error {
	job, ok := e.store.Job(id)
	if !ok {
		return core.ErrNotFound
	}
	if !isActive(job.Status) {
		return errors.New("job is not active")
	}
	job.Status = core.JobCancelRequested
	if err := e.store.SaveJob(job); err != nil {
		return err
	}
	e.cancelActive(id)
	return nil
}

func (e *Engine) cancelActive(id string) {
	e.mu.Lock()
	cancel := e.running[id]
	e.mu.Unlock()
	if cancel != nil {
		cancel()
	}
}

func isActive(status core.JobStatus) bool {
	return status == core.JobQueued || status == core.JobValidating || status == core.JobRunning ||
		status == core.JobPauseRequested || status == core.JobPaused || status == core.JobInterrupted
}

func (e *Engine) Debug() string {
	e.mu.Lock()
	defer e.mu.Unlock()
	return fmt.Sprintf("%d jobs running", len(e.running))
}
