package main

import (
	"bytes"
	"encoding/json"
	"strings"
	"testing"

	"drivarr/internal/core"
	"drivarr/internal/drives"
)

func TestDrivesSupportsTableAndJSONOutput(t *testing.T) {
	previous := discoverDrives
	discoverDrives = func() ([]drives.Device, error) {
		return []drives.Device{{ID: "sda", Name: "sda", Path: "/dev/sda"}}, nil
	}
	t.Cleanup(func() { discoverDrives = previous })

	var table bytes.Buffer
	if err := run([]string{"drives"}, strings.NewReader(""), &table, &table); err != nil {
		t.Fatal(err)
	}
	if got := table.String(); !strings.Contains(got, "NAME") || !strings.Contains(got, "/dev/sda") {
		t.Fatalf("table output = %q", got)
	}

	var encoded bytes.Buffer
	if err := run([]string{"drives", "--json"}, strings.NewReader(""), &encoded, &encoded); err != nil {
		t.Fatal(err)
	}
	var got []drives.Device
	if err := json.Unmarshal(encoded.Bytes(), &got); err != nil || len(got) != 1 || got[0].ID != "sda" {
		t.Fatalf("JSON output = %q, decoded=%#v err=%v", encoded.String(), got, err)
	}
}

func TestUsersCreateAndResetPassword(t *testing.T) {
	dataDir := t.TempDir()
	var output bytes.Buffer
	if err := run([]string{
		"users", "create", "--data-dir", dataDir, "--username", "Operator", "--role", "operator",
		"--password-stdin",
	}, strings.NewReader("initial-password-123\n"), &output, &output); err != nil {
		t.Fatal(err)
	}

	store, err := core.OpenStore(dataDir)
	if err != nil {
		t.Fatal(err)
	}
	_, token, err := store.Authenticate("operator", "initial-password-123")
	if err != nil {
		t.Fatal("created user could not authenticate:", err)
	}

	output.Reset()
	if err := run([]string{
		"users", "reset-password", "--data-dir", dataDir, "--username", "operator",
		"--password", "replacement-password-456",
	}, strings.NewReader(""), &output, &output); err != nil {
		t.Fatal(err)
	}
	reopened, err := core.OpenStore(dataDir)
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := reopened.Session(token); ok {
		t.Fatal("password reset did not revoke the existing session")
	}
	if _, _, err := reopened.Authenticate("operator", "replacement-password-456"); err != nil {
		t.Fatal("reset password could not authenticate:", err)
	}
}

func TestUserCommandRequiresExactlyOnePasswordSource(t *testing.T) {
	err := run([]string{
		"users", "create", "--data-dir", t.TempDir(), "--username", "viewer",
	}, strings.NewReader(""), &bytes.Buffer{}, &bytes.Buffer{})
	if err == nil || !strings.Contains(err.Error(), "exactly one password option") {
		t.Fatalf("error = %v", err)
	}
}
