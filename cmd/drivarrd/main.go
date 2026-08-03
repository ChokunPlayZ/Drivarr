package main

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/x509"
	"crypto/x509/pkix"
	_ "embed"
	"encoding/hex"
	"encoding/json"
	"encoding/pem"
	"errors"
	"flag"
	"fmt"
	"io"
	"log/slog"
	"math/big"
	"net"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"time"

	"drivarr/internal/core"
	"drivarr/internal/drives"
	"drivarr/internal/guard"
	"drivarr/internal/jobs"
)

// Individual string assets avoid a runtime filesystem dependency while keeping
// the daemon a single deployable binary.
//
//go:embed web/index.html
var indexHTML string

//go:embed web/styles.css
var stylesCSS string

//go:embed web/app.js
var appJS string

//go:embed web/openapi.yaml
var openapiYAML string

var version = "dev"

type smartctlEnvelope struct {
	Device struct {
		Name     string `json:"name"`
		Type     string `json:"type"`
		Protocol string `json:"protocol"`
	} `json:"device"`
	ModelName    string `json:"model_name"`
	SerialNumber string `json:"serial_number"`
	Firmware     string `json:"firmware_version"`
	WWN          struct {
		NAA int   `json:"naa"`
		OUI int   `json:"oui"`
		ID  int64 `json:"id"`
	} `json:"wwn"`
	UserCapacity struct {
		Bytes int64 `json:"bytes"`
	} `json:"user_capacity"`
	SMARTStatus *struct {
		Passed bool `json:"passed"`
	} `json:"smart_status"`
	Temperature struct {
		Current int64 `json:"current"`
	} `json:"temperature"`
	PowerOnTime struct {
		Hours int64 `json:"hours"`
	} `json:"power_on_time"`
	ATASMARTAttributes struct {
		Table []struct {
			ID         int    `json:"id"`
			Name       string `json:"name"`
			Value      int64  `json:"value"`
			Worst      int64  `json:"worst"`
			Threshold  int64  `json:"thresh"`
			WhenFailed string `json:"when_failed"`
			Raw        struct {
				Value  int64  `json:"value"`
				String string `json:"string"`
			} `json:"raw"`
		} `json:"table"`
	} `json:"ata_smart_attributes"`
}

func main() {
	if len(os.Args) > 1 && os.Args[1] == "internal-worker" {
		if err := runWorker(os.Args[2:]); err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
		return
	}
	if len(os.Args) > 1 && os.Args[1] == "account-reset" {
		if err := runAccountReset(os.Args[2:]); err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
		return
	}

	listen := flag.String("listen", "127.0.0.1:8787", "HTTPS listen address")
	cert := flag.String("tls-cert", "", "TLS certificate path")
	key := flag.String("tls-key", "", "TLS private key path")
	probeTimeout := flag.Duration("probe-timeout", 8*time.Second, "per-device hardware probe deadline")
	dataDir := flag.String("data-dir", "./drivarr-data", "persistent data directory")
	bootstrapPassword := flag.String("bootstrap-admin-password", "", "initial admin password (or DRIVARR_BOOTSTRAP_PASSWORD)")
	flag.Parse()

	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	executable, err := os.Executable()
	if err != nil {
		logger.Error("resolve executable", "error", err)
		os.Exit(1)
	}

	runner := guard.NewProcessRunner(logger)
	supervisor := guard.NewSupervisor(runner, executable, *probeTimeout, 4, logger)
	store, err := core.OpenStore(*dataDir)
	if err != nil {
		logger.Error("open durable state", "error", err)
		os.Exit(1)
	}
	password := *bootstrapPassword
	if password == "" {
		password = os.Getenv("DRIVARR_BOOTSTRAP_PASSWORD")
	}
	if password == "" {
		password, err = secureBootstrapPassword()
		if err != nil {
			logger.Error("generate bootstrap password", "error", err)
			os.Exit(1)
		}
	}
	_, created, err := store.EnsureAdmin(password)
	if err != nil {
		logger.Error("bootstrap administrator", "error", err)
		os.Exit(1)
	}
	if created {
		logger.Warn("initial administrator created", "username", "admin", "temporary_password", password,
			"action", "sign in and create a replacement administrator password")
	}
	if err := store.RecoverJobs(); err != nil {
		logger.Error("recover interrupted jobs", "error", err)
	}
	engine := jobs.NewEngine(store, runner, executable, supervisor, logger)
	app := newAPI(supervisor, store, engine, *dataDir, logger)

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	go supervisor.Run(ctx, 30*time.Second)
	go engine.Run(ctx)
	go func() {
		_, _ = store.ApplyRetention(*dataDir)
		ticker := time.NewTicker(24 * time.Hour)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				if removed, retentionErr := store.ApplyRetention(*dataDir); retentionErr != nil {
					logger.Error("apply retention", "error", retentionErr)
				} else if removed > 0 {
					logger.Info("retention removed reports", "count", removed)
				}
			}
		}
	}()

	server := &http.Server{
		Addr:              *listen,
		Handler:           app.routes(),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       15 * time.Second,
		WriteTimeout:      30 * time.Second,
		IdleTimeout:       60 * time.Second,
	}
	go func() {
		<-ctx.Done()
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = server.Shutdown(shutdownCtx)
	}()

	logger.Info("drivarr listening", "address", *listen)
	if *cert == "" && *key == "" && !strings.HasPrefix(*listen, "127.0.0.1:") {
		generatedCert, generatedKey, certErr := ensureDevelopmentCertificate(*dataDir)
		if certErr != nil {
			logger.Error("generate TLS certificate", "error", certErr)
			os.Exit(1)
		}
		*cert, *key = generatedCert, generatedKey
	}
	if *cert != "" && *key != "" {
		err = server.ListenAndServeTLS(*cert, *key)
	} else {
		logger.Warn("TLS is not configured; bind only to localhost during development")
		err = server.ListenAndServe()
	}
	if err != nil && !errors.Is(err, http.ErrServerClosed) {
		logger.Error("server stopped", "error", err)
		os.Exit(1)
	}
}

func runAccountReset(args []string) error {
	flags := flag.NewFlagSet("account-reset", flag.ContinueOnError)
	dataDir := flags.String("data-dir", "/var/lib/drivarr", "persistent data directory")
	username := flags.String("username", "admin", "local username")
	password := flags.String("password", "", "new password")
	if err := flags.Parse(args); err != nil {
		return err
	}
	if *password == "" {
		return errors.New("--password is required")
	}
	store, err := core.OpenStore(*dataDir)
	if err != nil {
		return err
	}
	return store.ResetPassword(*username, *password)
}

type api struct {
	supervisor *guard.Supervisor
	store      *core.Store
	jobs       *jobs.Engine
	dataDir    string
	logger     *slog.Logger
}

func newAPI(supervisor *guard.Supervisor, store *core.Store, engine *jobs.Engine, dataDir string, logger *slog.Logger) *api {
	return &api{supervisor: supervisor, store: store, jobs: engine, dataDir: dataDir, logger: logger}
}

func (a *api) routes() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/v1/health", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, map[string]any{
			"status":  "ok",
			"time":    time.Now().UTC(),
			"version": version,
		})
	})
	mux.Handle("GET /api/v1/devices", a.require(func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, map[string]any{"devices": a.supervisor.Snapshot()})
	}, core.RoleViewer, core.RoleOperator, core.RoleAdmin))
	mux.Handle("POST /api/v1/discovery/refresh", a.require(func(w http.ResponseWriter, r *http.Request) {
		if !a.supervisor.Refresh(r.Context()) {
			writeJSON(w, http.StatusTooManyRequests, map[string]string{"error": "discovery already running"})
			return
		}
		writeJSON(w, http.StatusAccepted, map[string]string{"status": "refresh started"})
	}, core.RoleOperator, core.RoleAdmin))
	mux.Handle("POST /api/v1/devices/{id}/retry", a.require(func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		if !a.supervisor.Retry(id) {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "device not found"})
			return
		}
		writeJSON(w, http.StatusAccepted, map[string]string{"status": "retry scheduled"})
	}, core.RoleOperator, core.RoleAdmin))
	a.registerApplicationRoutes(mux)
	mux.HandleFunc("/", a.web)
	return recoveryHeaders(mux, a.logger)
}

func (a *api) web(w http.ResponseWriter, r *http.Request) {
	path := strings.TrimPrefix(filepath.Clean(r.URL.Path), "/")
	var data string
	switch path {
	case "styles.css":
		data = stylesCSS
		w.Header().Set("Content-Type", "text/css; charset=utf-8")
	case "app.js":
		data = appJS
		w.Header().Set("Content-Type", "application/javascript; charset=utf-8")
	case "openapi.yaml":
		data = openapiYAML
		w.Header().Set("Content-Type", "application/yaml; charset=utf-8")
	default:
		data = indexHTML
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
	}
	w.Header().Set("Cache-Control", "no-cache")
	_, _ = io.WriteString(w, data)
}

func recoveryHeaders(next http.Handler, logger *slog.Logger) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if recovered := recover(); recovered != nil {
				logger.Error("request panic", "panic", recovered)
				http.Error(w, "internal server error", http.StatusInternalServerError)
			}
		}()
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Referrer-Policy", "same-origin")
		w.Header().Set("Content-Security-Policy", "default-src 'self'; style-src 'self'; script-src 'self'; connect-src 'self'")
		next.ServeHTTP(w, r)
	})
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

func runWorker(args []string) error {
	if len(args) == 0 {
		return errors.New("worker operation required")
	}
	switch args[0] {
	case "discover":
		return workerDiscover(os.Stdout)
	case "probe":
		flags := flag.NewFlagSet("probe", flag.ContinueOnError)
		device := flags.String("device", "", "device path")
		if err := flags.Parse(args[1:]); err != nil {
			return err
		}
		if *device == "" || !strings.HasPrefix(*device, "/dev/") {
			return errors.New("valid /dev device path required")
		}
		return workerProbe(*device, os.Stdout)
	case "fio-chunk":
		return workerFIO(args[1:], os.Stdout)
	case "badblocks-chunk":
		return workerBadblocks(args[1:], os.Stdout)
	case "safety-check":
		return workerSafety(args[1:], os.Stdout)
	case "smart-test":
		return workerSMARTTest(args[1:], os.Stdout)
	case "smart-abort":
		return workerSMARTAbort(args[1:], os.Stdout)
	default:
		return fmt.Errorf("unsupported worker operation %q", args[0])
	}
}

func workerDiscover(output io.Writer) error {
	devices, err := drives.Discover()
	if err != nil {
		return err
	}
	return json.NewEncoder(output).Encode(devices)
}

func workerProbe(device string, output io.Writer) error {
	smartctl, err := exec.LookPath("smartctl")
	if err != nil {
		return fmt.Errorf("smartctl unavailable: %w", err)
	}
	// This worker is disposable. The supervising daemon owns the deadline and kills
	// the entire process group if smartctl or the kernel stops responding.
	command := exec.Command(smartctl, "--json=o", "--xall", device)
	command.Stderr = os.Stderr
	raw, err := command.Output()
	if err != nil && len(raw) == 0 {
		return fmt.Errorf("smartctl probe failed: %w", err)
	}
	var report smartctlEnvelope
	if err := json.Unmarshal(raw, &report); err != nil {
		return fmt.Errorf("invalid smartctl JSON: %w", err)
	}
	var rawReport map[string]any
	if err := json.Unmarshal(raw, &rawReport); err != nil {
		return fmt.Errorf("invalid smartctl JSON object: %w", err)
	}
	fingerprint := fmt.Sprintf("%s|%s|%d|%d:%d:%d", report.ModelName, report.SerialNumber,
		report.UserCapacity.Bytes, report.WWN.NAA, report.WWN.OUI, report.WWN.ID)
	fingerprintHash := sha256.Sum256([]byte(fingerprint))
	id := "dev_" + hex.EncodeToString(fingerprintHash[:8])
	var reallocated, pending, uncorrectable int64
	attributes := make([]guard.SMARTAttribute, 0, len(report.ATASMARTAttributes.Table))
	for _, attribute := range report.ATASMARTAttributes.Table {
		attributes = append(attributes, guard.SMARTAttribute{
			ID: attribute.ID, Name: attribute.Name, Current: attribute.Value,
			Worst: attribute.Worst, Threshold: attribute.Threshold,
			RawValue: attribute.Raw.Value, RawString: attribute.Raw.String,
			WhenFailed: attribute.WhenFailed,
		})
		switch attribute.ID {
		case 5:
			reallocated = attribute.Raw.Value
		case 197:
			pending = attribute.Raw.Value
		case 198:
			uncorrectable = attribute.Raw.Value
		}
	}
	var farm any
	farmAvailable := false
	var deviceInterface, recordingType string
	farmCommand := exec.Command(smartctl, "--json=o", "--log", "farm", device)
	if farmRaw, _ := farmCommand.Output(); len(farmRaw) > 0 {
		var farmEnvelope map[string]any
		if json.Unmarshal(farmRaw, &farmEnvelope) == nil {
			if value, exists := farmEnvelope["seagate_farm_log"]; exists {
				farm, farmAvailable = value, true
				deviceInterface = farmString(value, "page_1_drive_information", "device_interface")
				recordingType = farmString(value, "page_1_drive_information", "drive_recording_type")
			}
		}
	}
	return json.NewEncoder(output).Encode(guard.ProbeData{
		ID:              id,
		Path:            device,
		Model:           report.ModelName,
		Serial:          report.SerialNumber,
		Firmware:        report.Firmware,
		Protocol:        report.Device.Protocol,
		Capacity:        report.UserCapacity.Bytes,
		SMARTAvailable:  report.SMARTStatus != nil,
		SMARTPassed:     report.SMARTStatus != nil && report.SMARTStatus.Passed,
		SMARTSelfTest:   detectSMARTSelfTest(rawReport),
		TemperatureC:    report.Temperature.Current,
		PowerOnHours:    report.PowerOnTime.Hours,
		Reallocated:     reallocated,
		Pending:         pending,
		Uncorrectable:   uncorrectable,
		SMARTAttributes: attributes,
		FARMAvailable:   farmAvailable,
		FARM:            farm,
		DeviceInterface: deviceInterface,
		RecordingType:   recordingType,
		CollectedUTC:    time.Now().UTC(),
	})
}

func detectSMARTSelfTest(report map[string]any) *guard.SMARTSelfTest {
	// ATA exposes the live execution byte separately from its test log. A high
	// nibble of 0xf means a test is running; the low nibble is the percentage
	// remaining in ten-percent increments.
	if status := objectAt(report, "ata_smart_data", "self_test", "status"); status != nil {
		value, hasValue := numberAt(status, "value")
		remaining, hasRemaining := numberAt(status, "remaining_percent")
		if (hasValue && int(value)>>4 == 0xf) || hasRemaining {
			progress := clampPercent(100 - int(remaining))
			kind := activeATASelfTestKind(report)
			if kind == "" {
				kind = "SMART self-test"
			}
			return &guard.SMARTSelfTest{
				Kind: kind, Status: stringAt(status, "string"), ProgressPercent: &progress,
			}
		}
	}

	// NVMe reports both the operation and completed percentage in its device
	// self-test log. Operation zero explicitly means that no test is active.
	if log := objectAt(report, "nvme_self_test_log"); log != nil {
		operation := objectAt(log, "current_self_test_operation")
		value, ok := numberAt(operation, "value")
		if ok && int(value) != 0 {
			kind := stringAt(operation, "string")
			if kind == "" {
				kind = nvmeSelfTestKind(int(value))
			}
			result := &guard.SMARTSelfTest{Kind: kind, Status: kind}
			if completed, exists := numberAt(log, "current_self_test_completion_percent"); exists {
				progress := clampPercent(int(completed))
				result.ProgressPercent = &progress
			}
			return result
		}
	}

	// SCSI/SAS records the currently running test as a live entry in the
	// self-test log. smartctl currently does not put REQUEST SENSE progress in
	// JSON, so progress remains unknown while the type is still displayed.
	for key, value := range report {
		if !strings.HasPrefix(key, "scsi_self_test_") {
			continue
		}
		entry, ok := value.(map[string]any)
		if !ok || !boolAt(entry, "self_test_in_progress") {
			continue
		}
		kind := stringAt(objectAt(entry, "code"), "string")
		if kind == "" {
			kind = "SCSI self-test"
		}
		return &guard.SMARTSelfTest{Kind: kind, Status: "Self-test in progress"}
	}
	return nil
}

func activeATASelfTestKind(report map[string]any) string {
	root := objectAt(report, "ata_smart_self_test_log")
	var visit func(any) string
	visit = func(value any) string {
		switch item := value.(type) {
		case map[string]any:
			if status := objectAt(item, "status"); status != nil {
				if raw, ok := numberAt(status, "value"); ok && int(raw)>>4 == 0xf {
					if kind := stringAt(objectAt(item, "type"), "string"); kind != "" {
						return kind
					}
				}
			}
			for _, child := range item {
				if kind := visit(child); kind != "" {
					return kind
				}
			}
		case []any:
			for _, child := range item {
				if kind := visit(child); kind != "" {
					return kind
				}
			}
		}
		return ""
	}
	return visit(root)
}

func objectAt(value map[string]any, path ...string) map[string]any {
	current := value
	for _, key := range path {
		next, ok := current[key].(map[string]any)
		if !ok {
			return nil
		}
		current = next
	}
	return current
}

func numberAt(value map[string]any, key string) (float64, bool) {
	if value == nil {
		return 0, false
	}
	number, ok := value[key].(float64)
	return number, ok
}

func stringAt(value map[string]any, key string) string {
	if value == nil {
		return ""
	}
	result, _ := value[key].(string)
	return result
}

func boolAt(value map[string]any, key string) bool {
	if value == nil {
		return false
	}
	result, _ := value[key].(bool)
	return result
}

func clampPercent(value int) int {
	return max(0, min(100, value))
}

func nvmeSelfTestKind(operation int) string {
	switch operation {
	case 1:
		return "Short self-test"
	case 2:
		return "Extended self-test"
	case 14:
		return "Vendor-specific self-test"
	default:
		return "NVMe self-test"
	}
}

func farmString(value any, path ...string) string {
	current := value
	for _, key := range path {
		object, ok := current.(map[string]any)
		if !ok {
			return ""
		}
		current, ok = object[key]
		if !ok {
			return ""
		}
	}
	result, ok := current.(string)
	if !ok {
		return ""
	}
	return strings.TrimSpace(result)
}

func workerFIO(args []string, output io.Writer) error {
	flags := flag.NewFlagSet("fio-chunk", flag.ContinueOnError)
	device := flags.String("device", "", "device path")
	mode := flags.String("mode", "read", "workload mode")
	offset := flags.Int64("offset", 0, "byte offset")
	size := flags.Int64("size", 0, "byte size")
	blockSizeKiB := flags.Int("bs-kib", 1024, "block size in KiB")
	queueDepth := flags.Int("queue-depth", 1, "I/O queue depth")
	duration := flags.Int("duration", 15, "benchmark duration")
	rateMiB := flags.Int("rate-mib", 0, "optional MiB/s rate limit")
	if err := flags.Parse(args); err != nil {
		return err
	}
	if *device == "" || !strings.HasPrefix(*device, "/dev/") {
		return errors.New("valid device required")
	}
	if *blockSizeKiB < 4 || *blockSizeKiB > 16*1024 || *queueDepth < 1 || *queueDepth > 128 ||
		*duration < 1 || *duration > 24*60*60 || *rateMiB < 0 || *rateMiB > 100_000 {
		return errors.New("fio parameters are outside safe limits")
	}
	fio, err := exec.LookPath("fio")
	if err != nil {
		return fmt.Errorf("fio unavailable: %w", err)
	}
	options := []string{
		"--name=drivarr", "--filename=" + *device, "--direct=1", "--eta=never", "--output-format=json",
		"--bs=" + strconv.Itoa(*blockSizeKiB) + "k", "--iodepth=" + strconv.Itoa(*queueDepth),
	}
	if *queueDepth > 1 {
		options = append(options, "--ioengine=libaio")
	} else {
		options = append(options, "--ioengine=sync")
	}
	if *rateMiB > 0 {
		options = append(options, "--rate="+strconv.Itoa(*rateMiB)+"m")
	}
	switch *mode {
	case "read":
		options = append(options, "--rw=read",
			"--offset="+strconv.FormatInt(*offset, 10), "--size="+strconv.FormatInt(*size, 10))
	case "write-verify":
		options = append(options, "--rw=write", "--verify=crc32c",
			"--do_verify=1", "--verify_fatal=0", "--offset="+strconv.FormatInt(*offset, 10),
			"--size="+strconv.FormatInt(*size, 10))
	case "speed-sequential":
		options = append(options, "--rw=read", "--time_based=1", "--runtime="+strconv.Itoa(*duration))
	case "speed-random":
		options = append(options, "--rw=randread", "--time_based=1", "--runtime="+strconv.Itoa(*duration))
	default:
		return errors.New("unsupported fio mode")
	}
	command := exec.Command(fio, options...)
	command.Stderr = os.Stderr
	raw, runErr := command.Output()
	var envelope struct {
		Jobs []struct {
			Error int `json:"error"`
			Read  struct {
				BWBytes int64   `json:"bw_bytes"`
				IOPS    float64 `json:"iops"`
			} `json:"read"`
			Write struct {
				BWBytes int64   `json:"bw_bytes"`
				IOPS    float64 `json:"iops"`
			} `json:"write"`
		} `json:"jobs"`
	}
	if err := json.Unmarshal(raw, &envelope); err != nil {
		if runErr != nil {
			return fmt.Errorf("fio failed: %w", runErr)
		}
		return fmt.Errorf("decode fio output: %w", err)
	}
	if len(envelope.Jobs) == 0 {
		return errors.New("fio returned no jobs")
	}
	item := envelope.Jobs[0]
	result := jobs.ChunkResult{
		ReadBPS: item.Read.BWBytes, WriteBPS: item.Write.BWBytes,
		ReadIOPS: item.Read.IOPS, WriteIOPS: item.Write.IOPS,
	}
	if item.Error != 0 || runErr != nil {
		result.Errors = append(result.Errors, core.SectorError{
			Offset: *offset, Length: *size, Message: fmt.Sprintf("fio error %d", item.Error),
		})
	}
	return json.NewEncoder(output).Encode(result)
}

func workerBadblocks(args []string, output io.Writer) error {
	flags := flag.NewFlagSet("badblocks-chunk", flag.ContinueOnError)
	device := flags.String("device", "", "device path")
	offset := flags.Int64("offset", 0, "byte offset")
	size := flags.Int64("size", 0, "byte size")
	_ = flags.String("mode", "read", "compatibility mode")
	_ = flags.Int("bs-kib", 1024, "profile block size")
	_ = flags.Int("queue-depth", 1, "profile queue depth")
	_ = flags.Int("rate-mib", 0, "profile rate")
	if err := flags.Parse(args); err != nil {
		return err
	}
	if *device == "" || !strings.HasPrefix(*device, "/dev/") || *offset < 0 || *size <= 0 {
		return errors.New("valid device range required")
	}
	badblocks, err := exec.LookPath("badblocks")
	if err != nil {
		return fmt.Errorf("badblocks unavailable: %w", err)
	}
	const blockSize = int64(4096)
	first := *offset / blockSize
	last := (*offset+*size)/blockSize - 1
	command := exec.Command(badblocks, "-b", strconv.FormatInt(blockSize, 10), "-s", "-v",
		*device, strconv.FormatInt(last, 10), strconv.FormatInt(first, 10))
	command.Stderr = os.Stderr
	raw, runErr := command.Output()
	result := jobs.ChunkResult{}
	for _, line := range strings.Fields(string(raw)) {
		block, parseErr := strconv.ParseInt(line, 10, 64)
		if parseErr == nil {
			result.Errors = append(result.Errors, core.SectorError{
				Offset: block * blockSize, Length: blockSize, Message: "unreadable block",
			})
		}
	}
	if runErr != nil && len(result.Errors) == 0 {
		return fmt.Errorf("badblocks failed: %w", runErr)
	}
	return json.NewEncoder(output).Encode(result)
}

func workerSafety(args []string, output io.Writer) error {
	flags := flag.NewFlagSet("safety-check", flag.ContinueOnError)
	device := flags.String("device", "", "device path")
	if err := flags.Parse(args); err != nil {
		return err
	}
	if *device == "" || !strings.HasPrefix(*device, "/dev/") {
		return errors.New("valid device required")
	}
	result := jobs.SafetyResult{Safe: true}
	lsblk, err := exec.LookPath("lsblk")
	if err != nil {
		result.Safe = false
		result.Reasons = append(result.Reasons, "lsblk is unavailable")
		return json.NewEncoder(output).Encode(result)
	}
	command := exec.Command(lsblk, "--json", "--paths", "--output", "PATH,TYPE,MOUNTPOINTS", *device)
	raw, err := command.Output()
	if err != nil {
		result.Safe = false
		result.Reasons = append(result.Reasons, "could not inspect mounts")
		return json.NewEncoder(output).Encode(result)
	}
	var tree struct {
		Blockdevices []struct {
			Path        string            `json:"path"`
			Type        string            `json:"type"`
			Mountpoints []any             `json:"mountpoints"`
			Children    []json.RawMessage `json:"children"`
		} `json:"blockdevices"`
	}
	var generic map[string]any
	if json.Unmarshal(raw, &tree) != nil || json.Unmarshal(raw, &generic) != nil {
		result.Safe = false
		result.Reasons = append(result.Reasons, "invalid lsblk data")
		return json.NewEncoder(output).Encode(result)
	}
	var walk func(any)
	walk = func(value any) {
		node, ok := value.(map[string]any)
		if !ok {
			return
		}
		if mountpoints, ok := node["mountpoints"].([]any); ok {
			for _, point := range mountpoints {
				if text, ok := point.(string); ok && text != "" {
					result.Safe = false
					result.Reasons = append(result.Reasons, "mounted at "+text)
				}
			}
		}
		if children, ok := node["children"].([]any); ok {
			for _, child := range children {
				walk(child)
			}
		}
	}
	if nodes, ok := generic["blockdevices"].([]any); ok {
		for _, node := range nodes {
			walk(node)
		}
	}
	swapRaw, _ := os.ReadFile("/proc/swaps")
	if strings.Contains(string(swapRaw), *device) {
		result.Safe = false
		result.Reasons = append(result.Reasons, "drive is used for swap")
	}
	base := filepath.Base(*device)
	if holders, holderErr := os.ReadDir(filepath.Join("/sys/class/block", base, "holders")); holderErr == nil && len(holders) > 0 {
		result.Safe = false
		result.Reasons = append(result.Reasons, "drive has active device-mapper or RAID holders")
	}
	return json.NewEncoder(output).Encode(result)
}

func workerSMARTTest(args []string, output io.Writer) error {
	flags := flag.NewFlagSet("smart-test", flag.ContinueOnError)
	device := flags.String("device", "", "device path")
	kind := flags.String("kind", "short", "self-test type")
	if err := flags.Parse(args); err != nil {
		return err
	}
	if *kind != "short" && *kind != "long" && *kind != "conveyance" {
		return errors.New("invalid SMART test kind")
	}
	smartctl, err := exec.LookPath("smartctl")
	if err != nil {
		return err
	}
	command := exec.Command(smartctl, "--json=o", "--test="+*kind, *device)
	raw, err := command.Output()
	if err != nil {
		return fmt.Errorf("start SMART test: %w", err)
	}
	var value any
	_ = json.Unmarshal(raw, &value)
	minutes := findNumber(value, "polling_minutes")
	if minutes < 1 {
		switch *kind {
		case "short":
			minutes = 2
		case "conveyance":
			minutes = 5
		default:
			minutes = 120
		}
	}
	return json.NewEncoder(output).Encode(map[string]int64{"pollSeconds": minutes * 60})
}

func workerSMARTAbort(args []string, output io.Writer) error {
	flags := flag.NewFlagSet("smart-abort", flag.ContinueOnError)
	device := flags.String("device", "", "device path")
	if err := flags.Parse(args); err != nil {
		return err
	}
	smartctl, err := exec.LookPath("smartctl")
	if err != nil {
		return err
	}
	if raw, err := exec.Command(smartctl, "--json=o", "--abort", *device).Output(); err != nil {
		return err
	} else {
		_, _ = output.Write(raw)
	}
	return nil
}

func findNumber(value any, key string) int64 {
	switch item := value.(type) {
	case map[string]any:
		for name, child := range item {
			if name == key {
				if number, ok := child.(float64); ok {
					return int64(number)
				}
			}
			if found := findNumber(child, key); found != 0 {
				return found
			}
		}
	case []any:
		for _, child := range item {
			if found := findNumber(child, key); found != 0 {
				return found
			}
		}
	}
	return 0
}

func secureBootstrapPassword() (string, error) {
	const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789"
	raw := make([]byte, 20)
	if _, err := rand.Read(raw); err != nil {
		return "", err
	}
	for index := range raw {
		raw[index] = alphabet[int(raw[index])%len(alphabet)]
	}
	return string(raw), nil
}

func ensureDevelopmentCertificate(dataDir string) (string, string, error) {
	certPath, keyPath := filepath.Join(dataDir, "tls.crt"), filepath.Join(dataDir, "tls.key")
	if _, err := os.Stat(certPath); err == nil {
		return certPath, keyPath, nil
	}
	key, err := rsa.GenerateKey(rand.Reader, 3072)
	if err != nil {
		return "", "", err
	}
	serial, err := rand.Int(rand.Reader, new(big.Int).Lsh(big.NewInt(1), 128))
	if err != nil {
		return "", "", err
	}
	now := time.Now()
	template := x509.Certificate{
		SerialNumber: serial, Subject: pkix.Name{CommonName: "Drivarr local"},
		NotBefore: now.Add(-time.Hour), NotAfter: now.AddDate(2, 0, 0),
		KeyUsage:    x509.KeyUsageDigitalSignature | x509.KeyUsageKeyEncipherment,
		ExtKeyUsage: []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
		DNSNames:    []string{"localhost"},
	}
	if hostname, hostnameErr := os.Hostname(); hostnameErr == nil && hostname != "" {
		template.DNSNames = append(template.DNSNames, hostname)
	}
	template.IPAddresses = append(template.IPAddresses, net.ParseIP("127.0.0.1"), net.ParseIP("::1"))
	if addresses, addressErr := net.InterfaceAddrs(); addressErr == nil {
		for _, address := range addresses {
			if network, ok := address.(*net.IPNet); ok && !network.IP.IsLoopback() {
				template.IPAddresses = append(template.IPAddresses, network.IP)
			}
		}
	}
	der, err := x509.CreateCertificate(rand.Reader, &template, &template, &key.PublicKey, key)
	if err != nil {
		return "", "", err
	}
	if err := os.MkdirAll(dataDir, 0o750); err != nil {
		return "", "", err
	}
	certFile, err := os.OpenFile(certPath, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o644)
	if err != nil {
		return "", "", err
	}
	if err := pem.Encode(certFile, &pem.Block{Type: "CERTIFICATE", Bytes: der}); err != nil {
		certFile.Close()
		return "", "", err
	}
	_ = certFile.Close()
	keyFile, err := os.OpenFile(keyPath, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o600)
	if err != nil {
		return "", "", err
	}
	if err := pem.Encode(keyFile, &pem.Block{Type: "RSA PRIVATE KEY", Bytes: x509.MarshalPKCS1PrivateKey(key)}); err != nil {
		keyFile.Close()
		return "", "", err
	}
	_ = keyFile.Close()
	return certPath, keyPath, nil
}
