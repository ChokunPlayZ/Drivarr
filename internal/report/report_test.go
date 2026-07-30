package report

import (
	"os"
	"strings"
	"testing"
	"time"

	"drivarr/internal/core"
	"drivarr/internal/guard"
)

func TestGenerateAndVerifyPDF(t *testing.T) {
	dir := t.TempDir()
	store, err := core.OpenStore(dir)
	if err != nil {
		t.Fatal(err)
	}
	job := core.Job{
		ID: "job_test", Kind: core.TestSurfaceRead, Status: core.JobCompleted,
		Verdict: core.VerdictPass, Progress: 1, CreatedAt: time.Now().UTC(),
	}
	device := guard.DeviceState{
		ID: "sda", Path: "/dev/sda", Status: "ready",
		Probe: &guard.ProbeData{Model: "Test Drive", Serial: "SERIAL", SMARTAvailable: true, SMARTPassed: true},
	}
	value, err := Generate(dir, store, job, device, core.User{ID: "usr", Username: "operator"})
	if err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile(value.Path)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(string(raw), "%PDF-1.4") {
		t.Fatal("generated file is not a PDF")
	}
	valid, err := Verify(value)
	if err != nil || !valid {
		t.Fatalf("expected valid report: valid=%v err=%v", valid, err)
	}
	if err := os.WriteFile(value.Path, append(raw, 'x'), 0o600); err != nil {
		t.Fatal(err)
	}
	valid, err = Verify(value)
	if err != nil || valid {
		t.Fatalf("modified report passed verification: valid=%v err=%v", valid, err)
	}
}
