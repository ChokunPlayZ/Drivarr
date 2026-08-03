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

func TestPlanBadblocksReadHandlesPartialFinalBlock(t *testing.T) {
	const capacity = int64(10_000_831_348_224)
	const chunk = int64(256 * 1024 * 1024)
	offset := ((capacity - 1) / chunk) * chunk

	plan, err := planBadblocksRead(offset, capacity-offset)
	if err != nil {
		t.Fatal(err)
	}
	if !plan.HasFullBlocks || plan.LastBlock != 2_441_609_214 {
		t.Fatalf("last full block = %d, want 2441609214", plan.LastBlock)
	}
	if plan.TailOffset != 10_000_831_344_640 || plan.TailLength != 3584 {
		t.Fatalf("tail = offset %d length %d", plan.TailOffset, plan.TailLength)
	}
}

func TestReadExactRangeCoversPartialFinalBlock(t *testing.T) {
	path := filepath.Join(t.TempDir(), "device")
	data := bytes.Repeat([]byte{0xa5}, 4096+3584)
	if err := os.WriteFile(path, data, 0o600); err != nil {
		t.Fatal(err)
	}
	if err := readExactRange(path, 4096, 3584); err != nil {
		t.Fatalf("read trailing range: %v", err)
	}
	if err := readExactRange(path, 4096, 3584+1); err == nil {
		t.Fatal("read beyond device boundary succeeded")
	}
}
