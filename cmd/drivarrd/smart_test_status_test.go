package main

import (
	"encoding/json"
	"testing"
)

func decodeSMARTReport(t *testing.T, raw string) map[string]any {
	t.Helper()
	var report map[string]any
	if err := json.Unmarshal([]byte(raw), &report); err != nil {
		t.Fatal(err)
	}
	return report
}

func TestDetectSMARTSelfTestATA(t *testing.T) {
	report := decodeSMARTReport(t, `{
		"ata_smart_data":{"self_test":{"status":{"value":249,"string":"in progress, 90% remaining","remaining_percent":90}}},
		"ata_smart_self_test_log":{"standard":{"table":[{"type":{"string":"Extended offline"},"status":{"value":249}}]}}
	}`)

	test := detectSMARTSelfTest(report)
	if test == nil {
		t.Fatal("expected an active ATA self-test")
	}
	if test.Kind != "Extended offline" {
		t.Fatalf("kind = %q", test.Kind)
	}
	if test.ProgressPercent == nil || *test.ProgressPercent != 10 {
		t.Fatalf("progress = %v, want 10", test.ProgressPercent)
	}
}

func TestDetectSMARTSelfTestNVMe(t *testing.T) {
	report := decodeSMARTReport(t, `{
		"nvme_self_test_log":{
			"current_self_test_operation":{"value":1,"string":"Short self-test in progress"},
			"current_self_test_completion_percent":28
		}
	}`)

	test := detectSMARTSelfTest(report)
	if test == nil || test.Kind != "Short self-test in progress" {
		t.Fatalf("test = %#v", test)
	}
	if test.ProgressPercent == nil || *test.ProgressPercent != 28 {
		t.Fatalf("progress = %v, want 28", test.ProgressPercent)
	}
}

func TestDetectSMARTSelfTestSCSI(t *testing.T) {
	report := decodeSMARTReport(t, `{
		"scsi_self_test_0":{"code":{"value":2,"string":"Background long"},"self_test_in_progress":true}
	}`)

	test := detectSMARTSelfTest(report)
	if test == nil || test.Kind != "Background long" {
		t.Fatalf("test = %#v", test)
	}
	if test.ProgressPercent != nil {
		t.Fatalf("SCSI progress should be unavailable, got %v", *test.ProgressPercent)
	}
}

func TestDetectSMARTSelfTestIdle(t *testing.T) {
	cases := []string{
		`{"ata_smart_data":{"self_test":{"status":{"value":0,"string":"completed without error"}}}}`,
		`{"nvme_self_test_log":{"current_self_test_operation":{"value":0,"string":"No self-test in progress"}}}`,
		`{"scsi_self_test_0":{"code":{"string":"Background short"}}}`,
	}
	for _, raw := range cases {
		if test := detectSMARTSelfTest(decodeSMARTReport(t, raw)); test != nil {
			t.Errorf("unexpected active test: %#v", test)
		}
	}
}
