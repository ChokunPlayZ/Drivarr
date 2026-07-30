package core

import (
	"os"
	"path/filepath"
	"testing"
)

func TestAuthenticationPersistsAndPasswordChangeRevokesSession(t *testing.T) {
	dir := t.TempDir()
	store, err := OpenStore(dir)
	if err != nil {
		t.Fatal(err)
	}
	admin, created, err := store.EnsureAdmin("initial-password-123")
	if err != nil || !created {
		t.Fatalf("bootstrap failed: created=%v err=%v", created, err)
	}
	_, token, err := store.Authenticate("admin", "initial-password-123")
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := store.Session(token); !ok {
		t.Fatal("session was not created")
	}
	if err := store.ChangePassword(admin.ID, "initial-password-123", "replacement-password-456"); err != nil {
		t.Fatal(err)
	}
	if _, ok := store.Session(token); ok {
		t.Fatal("password change did not revoke existing sessions")
	}
	reopened, err := OpenStore(dir)
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err := reopened.Authenticate("admin", "replacement-password-456"); err != nil {
		t.Fatal("new password did not persist:", err)
	}
}

func TestReportRetentionNeverDeletesOutsideDataDirectory(t *testing.T) {
	dir := t.TempDir()
	store, err := OpenStore(dir)
	if err != nil {
		t.Fatal(err)
	}
	settings := store.Settings()
	settings.RetentionMaxBytes = 1
	if err := store.UpdateSettings(settings); err != nil {
		t.Fatal(err)
	}
	outside := filepath.Join(t.TempDir(), "outside.pdf")
	if err := os.WriteFile(outside, []byte("evidence"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := store.SaveReport(Report{ID: "outside", Path: outside}); err != nil {
		t.Fatal(err)
	}
	if _, err := store.ApplyRetention(dir); err == nil {
		t.Fatal("expected retention to reject an out-of-scope report path")
	}
	if _, err := os.Stat(outside); err != nil {
		t.Fatal("retention removed an out-of-scope file")
	}
}
