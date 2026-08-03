package main

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"drivarr/internal/jobs"
)

func TestWorkerBadblocksReportsReadSpeed(t *testing.T) {
	binDir := t.TempDir()
	badblocks := filepath.Join(binDir, "badblocks")
	if err := os.WriteFile(badblocks, []byte("#!/bin/sh\n/bin/sleep 0.01\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", binDir)

	var output bytes.Buffer
	if err := workerBadblocks([]string{
		"--device", "/dev/test", "--offset", "0", "--size", "1048576",
	}, &output); err != nil {
		t.Fatal(err)
	}

	var result jobs.ChunkResult
	if err := json.Unmarshal(output.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	if result.ReadBPS <= 0 {
		t.Fatalf("read speed = %d, want a positive value", result.ReadBPS)
	}
}
