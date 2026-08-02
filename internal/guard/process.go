package guard

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"log/slog"
	"os/exec"
	"strings"
	"sync"
	"sync/atomic"
	"syscall"
	"time"
)

var ErrDeadline = errors.New("hardware operation exceeded deadline")

type RunResult struct {
	Output       []byte
	Err          error
	TimedOut     bool
	StillBlocked bool
	ProcessID    int
	Elapsed      time.Duration
}

type Runner interface {
	Run(ctx context.Context, executable string, args ...string) RunResult
	BlockedProcesses() int64
}

type ProcessRunner struct {
	logger  *slog.Logger
	blocked atomic.Int64
}

func NewProcessRunner(logger *slog.Logger) *ProcessRunner {
	return &ProcessRunner{logger: logger}
}

func (r *ProcessRunner) BlockedProcesses() int64 {
	return r.blocked.Load()
}

func (r *ProcessRunner) Run(ctx context.Context, executable string, args ...string) RunResult {
	started := time.Now()
	var output, stderr limitedBuffer
	command := exec.Command(executable, args...)
	command.Stdout = &output
	// Worker operations return machine-readable JSON on stdout. Keep stderr
	// separate so diagnostics emitted by fio/smartctl cannot corrupt that JSON.
	command.Stderr = &stderr
	command.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	if err := command.Start(); err != nil {
		return RunResult{Err: err, Elapsed: time.Since(started)}
	}

	pid := command.Process.Pid
	done := make(chan error, 1)
	go func() { done <- command.Wait() }()

	select {
	case err := <-done:
		if err != nil {
			if detail := strings.TrimSpace(string(stderr.Bytes())); detail != "" {
				err = fmt.Errorf("%w: %s", err, detail)
			}
		}
		return RunResult{Output: output.Bytes(), Err: err, ProcessID: pid, Elapsed: time.Since(started)}
	case <-ctx.Done():
		// Negative PID targets every subprocess in the disposable worker's group.
		_ = syscall.Kill(-pid, syscall.SIGKILL)
		result := RunResult{
			Output:    output.Bytes(),
			Err:       fmt.Errorf("%w: %v", ErrDeadline, ctx.Err()),
			TimedOut:  true,
			ProcessID: pid,
			Elapsed:   time.Since(started),
		}
		select {
		case <-done:
			return result
		case <-time.After(250 * time.Millisecond):
			// A process in uninterruptible kernel I/O cannot be killed yet. Never
			// wait for it on a request or discovery goroutine. The reaper below
			// keeps ownership of Wait and decrements the diagnostic count later.
			result.StillBlocked = true
			r.blocked.Add(1)
			r.logger.Error("hardware worker remains blocked after SIGKILL",
				"pid", pid, "blocked_workers", r.blocked.Load())
			go func() {
				<-done
				r.blocked.Add(-1)
				r.logger.Info("previously blocked hardware worker exited", "pid", pid)
			}()
			return result
		}
	}
}

type limitedBuffer struct {
	mu   sync.Mutex
	data bytes.Buffer
}

const maxWorkerOutput = 2 << 20

func (b *limitedBuffer) Write(p []byte) (int, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	remaining := maxWorkerOutput - b.data.Len()
	if remaining > 0 {
		if len(p) > remaining {
			_, _ = b.data.Write(p[:remaining])
		} else {
			_, _ = b.data.Write(p)
		}
	}
	// Report the full write so a noisy worker cannot block on a full pipe.
	return len(p), nil
}

func (b *limitedBuffer) Bytes() []byte {
	b.mu.Lock()
	defer b.mu.Unlock()
	result := make([]byte, b.data.Len())
	copy(result, b.data.Bytes())
	return result
}
