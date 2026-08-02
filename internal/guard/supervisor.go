package guard

import (
	"cmp"
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"slices"
	"sync"
	"sync/atomic"
	"time"
)

type SMARTAttribute struct {
	ID         int    `json:"id"`
	Name       string `json:"name"`
	Current    int64  `json:"current,omitempty"`
	Worst      int64  `json:"worst,omitempty"`
	Threshold  int64  `json:"threshold,omitempty"`
	RawValue   int64  `json:"rawValue"`
	RawString  string `json:"rawString,omitempty"`
	WhenFailed string `json:"whenFailed,omitempty"`
}

type ProbeData struct {
	ID              string           `json:"id"`
	Path            string           `json:"path"`
	Model           string           `json:"model,omitempty"`
	Serial          string           `json:"serial,omitempty"`
	Firmware        string           `json:"firmware,omitempty"`
	Protocol        string           `json:"protocol,omitempty"`
	Capacity        int64            `json:"capacityBytes,omitempty"`
	SMARTAvailable  bool             `json:"smartAvailable"`
	SMARTPassed     bool             `json:"smartPassed"`
	TemperatureC    int64            `json:"temperatureC,omitempty"`
	PowerOnHours    int64            `json:"powerOnHours,omitempty"`
	Reallocated     int64            `json:"reallocatedSectors,omitempty"`
	Pending         int64            `json:"pendingSectors,omitempty"`
	Uncorrectable   int64            `json:"uncorrectableSectors,omitempty"`
	SMARTAttributes []SMARTAttribute `json:"smartAttributes,omitempty"`
	FARMAvailable   bool             `json:"farmAvailable"`
	FARM            any              `json:"farm,omitempty"`
	CollectedUTC    time.Time        `json:"collectedAt"`
}

type DeviceState struct {
	ID                string     `json:"id"`
	Path              string     `json:"path"`
	Name              string     `json:"name"`
	Status            string     `json:"status"`
	Reason            string     `json:"reason,omitempty"`
	Probe             *ProbeData `json:"probe,omitempty"`
	LastAttempt       *time.Time `json:"lastAttempt,omitempty"`
	QuarantinedAt     *time.Time `json:"quarantinedAt,omitempty"`
	WorkerPID         int        `json:"workerPid,omitempty"`
	ManualRetryOnly   bool       `json:"manualRetryOnly"`
	ConsecutiveFaults int        `json:"consecutiveFaults"`
}

type discoveredDevice struct {
	ID   string `json:"id"`
	Path string `json:"path"`
	Name string `json:"name"`
}

type Supervisor struct {
	mu           sync.RWMutex
	runner       Runner
	executable   string
	timeout      time.Duration
	maxWorkers   int
	logger       *slog.Logger
	devices      map[string]*DeviceState
	refreshing   atomic.Bool
	retry        chan string
	discoveryErr string
}

func NewSupervisor(runner Runner, executable string, timeout time.Duration, maxWorkers int, logger *slog.Logger) *Supervisor {
	if maxWorkers < 1 {
		maxWorkers = 1
	}
	return &Supervisor{
		runner:     runner,
		executable: executable,
		timeout:    timeout,
		maxWorkers: maxWorkers,
		logger:     logger,
		devices:    make(map[string]*DeviceState),
		retry:      make(chan string, 32),
	}
}

func (s *Supervisor) Run(ctx context.Context, interval time.Duration) {
	s.Refresh(ctx)
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			s.Refresh(ctx)
		case id := <-s.retry:
			go s.probeKnown(ctx, id, true)
		}
	}
}

func (s *Supervisor) Refresh(parent context.Context) bool {
	if !s.refreshing.CompareAndSwap(false, true) {
		return false
	}
	go func() {
		defer s.refreshing.Store(false)
		ctx, cancel := context.WithTimeout(parent, 3*time.Second)
		defer cancel()
		result := s.runner.Run(ctx, s.executable, "internal-worker", "discover")
		if result.Err != nil {
			s.mu.Lock()
			s.discoveryErr = result.Err.Error()
			s.mu.Unlock()
			s.logger.Error("isolated device discovery failed", "error", result.Err)
			return
		}
		var found []discoveredDevice
		if err := json.Unmarshal(result.Output, &found); err != nil {
			s.logger.Error("decode isolated discovery", "error", err)
			return
		}
		s.mu.Lock()
		s.discoveryErr = ""
		normalized := make([]discoveredDevice, 0, len(found))
		seenPaths := make(map[string]bool, len(found))
		for _, device := range found {
			seenPaths[device.Path] = true
			existingID := ""
			for id, current := range s.devices {
				if current.Path == device.Path {
					existingID = id
					current.Name = device.Name
					break
				}
			}
			if existingID == "" {
				s.devices[device.ID] = &DeviceState{
					ID: device.ID, Path: device.Path, Name: device.Name, Status: "discovered",
				}
				existingID = device.ID
			}
			device.ID = existingID
			normalized = append(normalized, device)
		}
		for _, current := range s.devices {
			if !seenPaths[current.Path] && current.Status != "probing" {
				current.Status = "unavailable"
				current.Reason = "Drive is no longer present at its discovered path."
			}
		}
		s.mu.Unlock()
		s.probeBatch(parent, normalized)
	}()
	return true
}

func (s *Supervisor) probeBatch(ctx context.Context, devices []discoveredDevice) {
	sem := make(chan struct{}, s.maxWorkers)
	var wg sync.WaitGroup
	for _, device := range devices {
		s.mu.RLock()
		state := s.devices[device.ID]
		skip := state != nil && (state.Status == "probing" || state.Status == "quarantined")
		s.mu.RUnlock()
		if skip {
			continue
		}
		wg.Add(1)
		go func(id string) {
			defer wg.Done()
			select {
			case sem <- struct{}{}:
				defer func() { <-sem }()
				s.probeKnown(ctx, id, false)
			case <-ctx.Done():
			}
		}(device.ID)
	}
	wg.Wait()
}

func (s *Supervisor) probeKnown(parent context.Context, id string, manual bool) {
	s.mu.Lock()
	device, ok := s.devices[id]
	if !ok || (device.Status == "quarantined" && !manual) || device.Status == "probing" {
		s.mu.Unlock()
		return
	}
	if s.runner.BlockedProcesses() >= int64(s.maxWorkers) ||
		(manual && device.WorkerPID != 0 && s.runner.BlockedProcesses() > 0) {
		device.Status = "quarantined"
		device.ManualRetryOnly = true
		device.Reason = "A previous hardware worker is still blocked in the kernel. Retry is suppressed to protect the host."
		s.mu.Unlock()
		return
	}
	now := time.Now().UTC()
	device.Status = "probing"
	device.Reason = ""
	device.LastAttempt = &now
	device.ManualRetryOnly = false
	path := device.Path
	s.mu.Unlock()

	ctx, cancel := context.WithTimeout(parent, s.timeout)
	result := s.runner.Run(ctx, s.executable, "internal-worker", "probe", "--device", path)
	cancel()

	s.mu.Lock()
	defer s.mu.Unlock()
	device = s.devices[id]
	if result.Err != nil {
		device.ConsecutiveFaults++
		device.WorkerPID = result.ProcessID
		if result.TimedOut {
			at := time.Now().UTC()
			device.Status = "quarantined"
			device.QuarantinedAt = &at
			device.ManualRetryOnly = true
			if result.StillBlocked {
				device.Reason = "The hardware command ignored termination and may be blocked in the kernel. Automatic probes are disabled."
			} else {
				device.Reason = fmt.Sprintf("The hardware probe exceeded its %s deadline. Automatic probes are disabled.", s.timeout)
			}
		} else {
			device.Status = "unavailable"
			device.Reason = result.Err.Error()
		}
		return
	}

	var probe ProbeData
	if err := json.Unmarshal(result.Output, &probe); err != nil {
		device.Status = "unavailable"
		device.Reason = "Hardware worker returned invalid data"
		device.ConsecutiveFaults++
		return
	}
	device.Status = "ready"
	device.Reason = ""
	device.Probe = &probe
	device.ConsecutiveFaults = 0
	device.QuarantinedAt = nil
	device.WorkerPID = 0
	if probe.ID != "" && probe.ID != id {
		delete(s.devices, id)
		device.ID = probe.ID
		s.devices[probe.ID] = device
	}
}

func (s *Supervisor) Retry(id string) bool {
	s.mu.RLock()
	_, ok := s.devices[id]
	s.mu.RUnlock()
	if !ok {
		return false
	}
	select {
	case s.retry <- id:
	default:
		s.logger.Warn("manual retry queue full", "device", id)
	}
	return true
}

func (s *Supervisor) Device(id string) (DeviceState, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	value, ok := s.devices[id]
	if !ok {
		return DeviceState{}, false
	}
	copy := *value
	return copy, true
}

func (s *Supervisor) Quarantine(id, reason string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	value, ok := s.devices[id]
	if !ok {
		return
	}
	now := time.Now().UTC()
	value.Status = "quarantined"
	value.Reason = reason
	value.QuarantinedAt = &now
	value.ManualRetryOnly = true
	value.ConsecutiveFaults++
}

func (s *Supervisor) Snapshot() []DeviceState {
	s.mu.RLock()
	defer s.mu.RUnlock()
	result := make([]DeviceState, 0, len(s.devices))
	for _, state := range s.devices {
		copy := *state
		result = append(result, copy)
	}
	slices.SortFunc(result, func(a, b DeviceState) int {
		if order := cmp.Compare(a.Path, b.Path); order != 0 {
			return order
		}
		return cmp.Compare(a.ID, b.ID)
	})
	return result
}
