package report

import (
	"os"
	"path/filepath"
	"testing"
	"time"

	"drivarr/internal/core"
	"drivarr/internal/guard"
)

func TestWriteVisualQASample(t *testing.T) {
	if os.Getenv("DRIVARR_RENDER_PDF") == "" {
		t.Skip("visual QA only")
	}
	dir, err := filepath.Abs("../../tmp/pdfs/sample-data")
	if err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(dir, 0o750); err != nil {
		t.Fatal(err)
	}
	store, err := core.OpenStore(dir)
	if err != nil {
		t.Fatal(err)
	}
	now := time.Date(2026, 8, 3, 11, 30, 0, 0, time.UTC)
	probe := &guard.ProbeData{
		Model: "Seagate Exos X18 Enterprise Capacity Drive", Serial: "ZRS1A2BC", Firmware: "SN04", Protocol: "ATA",
		Capacity: 18_000_000_000_000, SMARTAvailable: true, SMARTPassed: true, TemperatureC: 34, PowerOnHours: 18421,
		FARMAvailable: true, Reallocated: 0, Pending: 0, Uncorrectable: 0,
		SMARTAttributes: []guard.SMARTAttribute{
			{ID: 1, Name: "Raw Read Error Rate", Current: 100, Worst: 100, Threshold: 44, RawString: "0"},
			{ID: 5, Name: "Reallocated Sector Count", Current: 100, Worst: 100, Threshold: 10, RawString: "0"},
			{ID: 7, Name: "Seek Error Rate", Current: 87, Worst: 60, Threshold: 45, RawString: "388,201,994"},
			{ID: 9, Name: "Power-On Hours", Current: 79, Worst: 79, RawString: "18,421"},
			{ID: 187, Name: "Reported Uncorrectable", Current: 100, Worst: 100, RawString: "0"},
			{ID: 197, Name: "Current Pending Sector", Current: 100, Worst: 100, RawString: "0"},
			{ID: 198, Name: "Offline Uncorrectable", Current: 100, Worst: 100, RawString: "0"},
		},
	}
	device := guard.DeviceState{ID: "sda", Path: "/dev/sda", Name: "sda", Status: "ready", Probe: probe}
	jobs := []core.Job{
		{ID: "job_smart", DeviceID: "sda", Kind: core.TestSMARTLong, Status: core.JobWarning, Verdict: core.VerdictWarning, Progress: 1, CreatedAt: now.Add(-2 * time.Hour), ProfileName: "SMART extended self-test", CurrentPhase: "Completed with policy warning"},
		{ID: "job_speed", DeviceID: "sda", Kind: core.TestSpeed, Status: core.JobCompleted, Verdict: core.VerdictPass, Progress: 1, CreatedAt: now.Add(-time.Hour), ProfileName: "Read speed and random IOPS", ReadBPS: 243_000_000, ReadIOPS: 182.45},
		{ID: "job_surface", DeviceID: "sda", Kind: core.TestSurfaceRead, Status: core.JobWarning, Verdict: core.VerdictWarning, Progress: 0.647, CreatedAt: now, ProfileName: "Full non-destructive surface read", TotalBytes: 18_000_000_000_000, CompletedBytes: 11_646_000_000_000, ReadBPS: 238_000_000, Errors: []core.SectorError{{Offset: 8_000_000_000_000, Length: 4096, Message: "uncorrectable read error"}}},
	}
	value, err := GenerateDrive(dir, store, device, jobs, core.User{ID: "usr", Username: "burnin-operator"})
	if err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile(value.Path)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(filepath.Dir(dir), "styled-drive-report.pdf"), raw, 0o640); err != nil {
		t.Fatal(err)
	}
}
