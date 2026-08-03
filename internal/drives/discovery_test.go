package drives

import (
	"os"
	"path/filepath"
	"testing"
)

func TestDiscoverAtReturnsSortedWholePhysicalDevices(t *testing.T) {
	sysBlockDir := t.TempDir()
	for _, name := range []string{"sdb", "loop0", "sda", "nvme0n1", "nvme0n1p1", "dm-0", "md0", "ram0", "mmcblk0", "mmcblk0boot0"} {
		if err := os.Mkdir(filepath.Join(sysBlockDir, name), 0o755); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.WriteFile(filepath.Join(sysBlockDir, "nvme0n1p1", "partition"), []byte("1\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	got, err := discoverAt(sysBlockDir, "/dev")
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 3 {
		t.Fatalf("devices = %#v, want three physical devices", got)
	}
	for index, want := range []string{"nvme0n1", "sda", "sdb"} {
		if got[index].Name != want || got[index].Path != filepath.Join("/dev", want) {
			t.Errorf("device %d = %#v, want name %q", index, got[index], want)
		}
	}
}
