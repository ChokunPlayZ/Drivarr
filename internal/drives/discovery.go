package drives

import (
	"os"
	"path/filepath"
	"runtime"
	"slices"
	"strings"
)

// Device identifies a physical block device discovered through Linux sysfs.
type Device struct {
	ID   string `json:"id"`
	Path string `json:"path"`
	Name string `json:"name"`
}

// Discover returns whole physical block devices without opening or probing them.
func Discover() ([]Device, error) {
	if runtime.GOOS != "linux" {
		return []Device{}, nil
	}
	return discoverAt("/sys/class/block", "/dev")
}

func discoverAt(sysBlockDir, devDir string) ([]Device, error) {
	entries, err := os.ReadDir(sysBlockDir)
	if err != nil {
		return nil, err
	}
	devices := make([]Device, 0, len(entries))
	for _, entry := range entries {
		name := entry.Name()
		if strings.HasPrefix(name, "loop") || strings.HasPrefix(name, "ram") ||
			strings.HasPrefix(name, "dm-") || strings.HasPrefix(name, "md") {
			continue
		}
		if _, err := os.Stat(filepath.Join(sysBlockDir, name, "partition")); err == nil {
			continue
		}
		devices = append(devices, Device{
			ID:   name,
			Path: filepath.Join(devDir, name),
			Name: name,
		})
	}
	slices.SortFunc(devices, func(a, b Device) int { return strings.Compare(a.Name, b.Name) })
	return devices, nil
}
