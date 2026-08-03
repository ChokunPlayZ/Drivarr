package report

import (
	"encoding/json"
	"os"
	"path/filepath"
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

func TestGenerateDriveIncludesEveryRetainedTest(t *testing.T) {
	dir := t.TempDir()
	store, err := core.OpenStore(dir)
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC()
	jobs := []core.Job{
		{
			ID: "job_surface", DeviceID: "sda", Kind: core.TestSurfaceRead,
			Status: core.JobCompleted, Verdict: core.VerdictPass, Progress: 1,
			CreatedAt: now.Add(time.Minute), ProfileName: "Surface read",
		},
		{
			ID: "job_smart", DeviceID: "sda", Kind: core.TestSMARTLong,
			Status: core.JobWarning, Verdict: core.VerdictWarning, Progress: 1,
			CreatedAt: now, ProfileName: "SMART extended",
		},
	}
	device := guard.DeviceState{
		ID: "sda", Path: "/dev/sda", Status: "ready",
		Probe: &guard.ProbeData{Model: "Test Drive", Serial: "SERIAL", SMARTAvailable: true, SMARTPassed: true},
	}
	value, err := GenerateDrive(dir, store, device, jobs, core.User{ID: "usr", Username: "operator"})
	if err != nil {
		t.Fatal(err)
	}
	if value.Scope != "drive" || value.DeviceID != "sda" || value.TestCount != 2 {
		t.Fatalf("unexpected drive report metadata: %+v", value)
	}
	if value.Verdict != core.VerdictWarning {
		t.Fatalf("verdict = %q, want warning", value.Verdict)
	}

	rawPDF, err := os.ReadFile(value.Path)
	if err != nil {
		t.Fatal(err)
	}
	for _, expected := range []string{"Full Drive Diagnostic Report", "job_smart", "job_surface", "/Count 2"} {
		if !strings.Contains(string(rawPDF), expected) {
			t.Fatalf("PDF does not contain %q", expected)
		}
	}

	rawManifest, err := os.ReadFile(filepath.Join(dir, "reports", value.ID+".json"))
	if err != nil {
		t.Fatal(err)
	}
	var manifest DriveManifest
	if err := json.Unmarshal(rawManifest, &manifest); err != nil {
		t.Fatal(err)
	}
	if len(manifest.Jobs) != 2 || manifest.Jobs[0].ID != "job_smart" || manifest.Jobs[1].ID != "job_surface" {
		t.Fatalf("manifest jobs = %+v, want complete chronological history", manifest.Jobs)
	}
	valid, err := Verify(value)
	if err != nil || !valid {
		t.Fatalf("expected valid report: valid=%v err=%v", valid, err)
	}
}

func TestGenerateDriveRejectsEmptyHistory(t *testing.T) {
	dir := t.TempDir()
	store, err := core.OpenStore(dir)
	if err != nil {
		t.Fatal(err)
	}
	_, err = GenerateDrive(dir, store, guard.DeviceState{ID: "sda"}, nil, core.User{})
	if err == nil {
		t.Fatal("expected an empty drive history to be rejected")
	}
}
