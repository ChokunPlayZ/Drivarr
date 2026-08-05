package main

import (
	"context"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
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

func TestPartitionRequestValidation(t *testing.T) {
	valid := []struct{ device, table, filesystem, label string }{
		{"/dev/sdb", "gpt", "ext4", "Archive 1"},
		{"/dev/nvme0n1", "mbr", "none", ""},
	}
	for _, test := range valid {
		if err := validatePartitionRequest(test.device, test.table, test.filesystem, test.label); err != nil {
			t.Fatalf("valid request rejected: %v", err)
		}
	}
	invalid := []struct{ device, table, filesystem, label string }{
		{"/tmp/sdb", "gpt", "ext4", ""},
		{"/dev/disk/by-id/x", "gpt", "ext4", ""},
		{"/dev/sdb", "apm", "ext4", ""},
		{"/dev/sdb", "gpt", "xfs", ""},
		{"/dev/sdb", "gpt", "none", "label"},
		{"/dev/sdb", "gpt", "ext4", strings.Repeat("x", 17)},
		{"/dev/sdb", "gpt", "ext4", "bad/label"},
	}
	for _, test := range invalid {
		if err := validatePartitionRequest(test.device, test.table, test.filesystem, test.label); err == nil {
			t.Fatalf("invalid request accepted: %+v", test)
		}
	}
}

func TestFirstPartitionPath(t *testing.T) {
	for device, want := range map[string]string{
		"/dev/sdb": "/dev/sdb1", "/dev/nvme0n1": "/dev/nvme0n1p1", "/dev/loop0": "/dev/loop0p1",
	} {
		if got := firstPartitionPath(device); got != want {
			t.Errorf("firstPartitionPath(%q) = %q, want %q", device, got, want)
		}
	}
}

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

func TestFarmStringReadsDriveInformation(t *testing.T) {
	farm := map[string]any{
		"page_1_drive_information": map[string]any{
			"device_interface":     " SATA ",
			"drive_recording_type": "CMR",
		},
	}

	if got := farmString(farm, "page_1_drive_information", "device_interface"); got != "SATA" {
		t.Fatalf("device interface = %q, want SATA", got)
	}
	if got := farmString(farm, "page_1_drive_information", "drive_recording_type"); got != "CMR" {
		t.Fatalf("recording type = %q, want CMR", got)
	}
	if got := farmString(farm, "page_1_drive_information", "missing"); got != "" {
		t.Fatalf("missing FARM field = %q, want empty", got)
	}
}

func TestKernelCapacityBoundsSMARTCapacity(t *testing.T) {
	sysBlockDir := t.TempDir()
	deviceDir := filepath.Join(sysBlockDir, "sda")
	if err := os.Mkdir(deviceDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(deviceDir, "size"), []byte("19532873727\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	kernelCapacity, err := kernelDeviceCapacityAt("/dev/sda", sysBlockDir)
	if err != nil {
		t.Fatal(err)
	}
	const want = int64(10_000_831_348_224)
	if kernelCapacity != want {
		t.Fatalf("kernel capacity = %d, want %d", kernelCapacity, want)
	}
	if got := boundedDeviceCapacity(10_000_831_348_736, kernelCapacity); got != want {
		t.Fatalf("bounded capacity = %d, want %d", got, want)
	}
}
