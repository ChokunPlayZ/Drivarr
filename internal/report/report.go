package report

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"time"

	"drivarr/internal/core"
	"drivarr/internal/guard"
)

type Manifest struct {
	ReportID     string            `json:"reportId"`
	GeneratedAt  time.Time         `json:"generatedAt"`
	GeneratedBy  string            `json:"generatedBy"`
	Organization string            `json:"organization"`
	Job          core.Job          `json:"job"`
	Device       guard.DeviceState `json:"device"`
}

type DriveManifest struct {
	ReportID     string            `json:"reportId"`
	GeneratedAt  time.Time         `json:"generatedAt"`
	GeneratedBy  string            `json:"generatedBy"`
	Organization string            `json:"organization"`
	Jobs         []core.Job        `json:"jobs"`
	Device       guard.DeviceState `json:"device"`
}

func Generate(dataDir string, store *core.Store, job core.Job, device guard.DeviceState, user core.User) (core.Report, error) {
	reportID := core.NewID("report")
	manifest := Manifest{
		ReportID: reportID, GeneratedAt: time.Now().UTC(), GeneratedBy: user.Username,
		Organization: store.Settings().Organization, Job: job, Device: device,
	}
	canonical, err := json.Marshal(manifest)
	if err != nil {
		return core.Report{}, err
	}
	dataHash := sha256.Sum256(canonical)
	dataHex := hex.EncodeToString(dataHash[:])
	lines := reportLines(manifest, dataHex)
	pdf := makePDF(lines)
	pdfHash := sha256.Sum256(pdf)
	pdfHex := hex.EncodeToString(pdfHash[:])

	dir := filepath.Join(dataDir, "reports")
	if err := os.MkdirAll(dir, 0o750); err != nil {
		return core.Report{}, err
	}
	path := filepath.Join(dir, reportID+".pdf")
	if err := os.WriteFile(path, pdf, 0o640); err != nil {
		return core.Report{}, err
	}
	if err := os.WriteFile(path+".sha256", []byte(pdfHex+"  "+filepath.Base(path)+"\n"), 0o640); err != nil {
		return core.Report{}, err
	}
	if err := os.WriteFile(filepath.Join(dir, reportID+".json"), canonical, 0o640); err != nil {
		return core.Report{}, err
	}
	result := core.Report{
		ID: reportID, JobID: job.ID, CreatedBy: user.ID, CreatedAt: manifest.GeneratedAt,
		DeviceID: job.DeviceID, Scope: "job", TestCount: 1,
		Path: path, DataSHA256: dataHex, PDFSHA256: pdfHex, Verdict: job.Verdict,
	}
	if err := store.SaveReport(result); err != nil {
		return core.Report{}, err
	}
	return result, nil
}

// GenerateDrive creates an immutable snapshot covering every retained job for
// one physical drive. The canonical JSON contains the complete job records;
// the PDF is a readable, paginated summary of the same evidence.
func GenerateDrive(dataDir string, store *core.Store, device guard.DeviceState, jobs []core.Job, user core.User) (core.Report, error) {
	if len(jobs) == 0 {
		return core.Report{}, fmt.Errorf("drive has no retained tests")
	}
	jobs = slices.Clone(jobs)
	slices.SortFunc(jobs, func(a, b core.Job) int {
		return a.CreatedAt.Compare(b.CreatedAt)
	})
	reportID := core.NewID("report")
	manifest := DriveManifest{
		ReportID: reportID, GeneratedAt: time.Now().UTC(), GeneratedBy: user.Username,
		Organization: store.Settings().Organization, Jobs: jobs, Device: device,
	}
	canonical, err := json.Marshal(manifest)
	if err != nil {
		return core.Report{}, err
	}
	dataHash := sha256.Sum256(canonical)
	dataHex := hex.EncodeToString(dataHash[:])
	pdf := makePDF(driveReportLines(manifest, dataHex))
	pdfHash := sha256.Sum256(pdf)
	pdfHex := hex.EncodeToString(pdfHash[:])

	dir := filepath.Join(dataDir, "reports")
	if err := os.MkdirAll(dir, 0o750); err != nil {
		return core.Report{}, err
	}
	path := filepath.Join(dir, reportID+".pdf")
	if err := os.WriteFile(path, pdf, 0o640); err != nil {
		return core.Report{}, err
	}
	if err := os.WriteFile(path+".sha256", []byte(pdfHex+"  "+filepath.Base(path)+"\n"), 0o640); err != nil {
		return core.Report{}, err
	}
	if err := os.WriteFile(filepath.Join(dir, reportID+".json"), canonical, 0o640); err != nil {
		return core.Report{}, err
	}
	result := core.Report{
		ID: reportID, DeviceID: device.ID, Scope: "drive", TestCount: len(jobs),
		CreatedBy: user.ID, CreatedAt: manifest.GeneratedAt, Path: path,
		DataSHA256: dataHex, PDFSHA256: pdfHex, Verdict: aggregateVerdict(jobs),
	}
	if err := store.SaveReport(result); err != nil {
		return core.Report{}, err
	}
	return result, nil
}

func Verify(report core.Report) (bool, error) {
	raw, err := os.ReadFile(report.Path)
	if err != nil {
		return false, err
	}
	sum := sha256.Sum256(raw)
	return hex.EncodeToString(sum[:]) == report.PDFSHA256, nil
}

func reportLines(value Manifest, dataHash string) []string {
	probe := value.Device.Probe
	lines := []string{
		value.Organization + " - Drive Diagnostic Report",
		"",
		"Report ID: " + value.ReportID,
		"Generated: " + value.GeneratedAt.Format(time.RFC3339),
		"Operator: " + value.GeneratedBy,
		"Verification data SHA-256:",
		dataHash,
		"",
		"Drive",
		"Path: " + value.Device.Path,
	}
	if probe != nil {
		lines = append(lines,
			"Model: "+probe.Model,
			"Serial: "+probe.Serial,
			"Firmware: "+probe.Firmware,
			"Protocol: "+probe.Protocol,
			"Capacity: "+strconv.FormatInt(probe.Capacity, 10)+" bytes",
			"SMART available / passed: "+strconv.FormatBool(probe.SMARTAvailable)+" / "+strconv.FormatBool(probe.SMARTPassed),
			"Temperature: "+strconv.FormatInt(probe.TemperatureC, 10)+" C",
			"Power-on hours: "+strconv.FormatInt(probe.PowerOnHours, 10),
			"Reallocated / pending / uncorrectable: "+
				fmt.Sprintf("%d / %d / %d", probe.Reallocated, probe.Pending, probe.Uncorrectable),
			"Seagate FARM available: "+strconv.FormatBool(probe.FARMAvailable),
		)
	}
	lines = append(lines,
		"",
		"Test",
		"Job ID: "+value.Job.ID,
		"Kind: "+string(value.Job.Kind),
		"Status: "+string(value.Job.Status),
		"Verdict: "+string(value.Job.Verdict),
		"Progress: "+fmt.Sprintf("%.1f%%", value.Job.Progress*100),
		"Bytes checked: "+strconv.FormatInt(value.Job.CompletedBytes, 10),
		"Read speed: "+strconv.FormatInt(value.Job.ReadBPS, 10)+" bytes/s",
		"Random read: "+fmt.Sprintf("%.2f IOPS", value.Job.ReadIOPS),
		"Policy: "+value.Job.PolicyID+" v"+strconv.Itoa(value.Job.PolicyVersion),
	)
	if value.Job.Error != "" {
		lines = append(lines, "Error: "+value.Job.Error)
	}
	lines = append(lines, "Recorded I/O errors: "+strconv.Itoa(len(value.Job.Errors)))
	for index, item := range value.Job.Errors {
		if index >= 12 {
			lines = append(lines, "Additional errors omitted from summary; retained in manifest.")
			break
		}
		lines = append(lines, fmt.Sprintf("Offset %d, length %d: %s", item.Offset, item.Length, item.Message))
	}
	lines = append(lines, "", "The JSON manifest stored with this report is the canonical evidence record.")
	return lines
}

func driveReportLines(value DriveManifest, dataHash string) []string {
	lines := []string{
		value.Organization + " - Full Drive Diagnostic Report",
		"",
		"Report ID: " + value.ReportID,
		"Generated: " + value.GeneratedAt.Format(time.RFC3339),
		"Operator: " + value.GeneratedBy,
		"Verification data SHA-256:",
		dataHash,
		"",
		"Drive",
		"Device ID: " + value.Device.ID,
		"Path: " + value.Device.Path,
	}
	if probe := value.Device.Probe; probe != nil {
		lines = append(lines,
			"Model: "+probe.Model,
			"Serial: "+probe.Serial,
			"Firmware: "+probe.Firmware,
			"Protocol: "+probe.Protocol,
			"Capacity: "+strconv.FormatInt(probe.Capacity, 10)+" bytes",
			"SMART available / passed: "+strconv.FormatBool(probe.SMARTAvailable)+" / "+strconv.FormatBool(probe.SMARTPassed),
			"Temperature: "+strconv.FormatInt(probe.TemperatureC, 10)+" C",
			"Power-on hours: "+strconv.FormatInt(probe.PowerOnHours, 10),
			"Reallocated / pending / uncorrectable: "+fmt.Sprintf("%d / %d / %d", probe.Reallocated, probe.Pending, probe.Uncorrectable),
			"Seagate FARM available: "+strconv.FormatBool(probe.FARMAvailable),
		)
	}
	lines = append(lines,
		"",
		"Complete retained test history",
		"Tests included: "+strconv.Itoa(len(value.Jobs)),
		"Overall verdict: "+string(aggregateVerdict(value.Jobs)),
	)
	for index, job := range value.Jobs {
		lines = append(lines,
			"",
			fmt.Sprintf("Test %d of %d", index+1, len(value.Jobs)),
			"Job ID: "+job.ID,
			"Profile: "+job.ProfileName,
			"Kind: "+string(job.Kind),
			"Status: "+string(job.Status),
			"Verdict: "+string(job.Verdict),
			"Created: "+job.CreatedAt.Format(time.RFC3339),
			"Progress: "+fmt.Sprintf("%.1f%%", job.Progress*100),
			fmt.Sprintf("Bytes checked: %d / %d", job.CompletedBytes, job.TotalBytes),
			fmt.Sprintf("Read / write speed: %d / %d bytes/s", job.ReadBPS, job.WriteBPS),
			fmt.Sprintf("Read / write random IOPS: %.2f / %.2f", job.ReadIOPS, job.WriteIOPS),
			"Policy: "+job.PolicyID+" v"+strconv.Itoa(job.PolicyVersion),
			"Recorded I/O errors: "+strconv.Itoa(len(job.Errors)),
		)
		if job.StartedAt != nil {
			lines = append(lines, "Started: "+job.StartedAt.Format(time.RFC3339))
		}
		if job.FinishedAt != nil {
			lines = append(lines, "Finished: "+job.FinishedAt.Format(time.RFC3339))
		}
		if job.CurrentPhase != "" {
			lines = append(lines, "Last phase: "+job.CurrentPhase)
		}
		if job.Error != "" {
			lines = append(lines, "Error: "+job.Error)
		}
		for errorIndex, item := range job.Errors {
			if errorIndex >= 12 {
				lines = append(lines, "Additional errors omitted from PDF summary; retained in manifest.")
				break
			}
			lines = append(lines, fmt.Sprintf("Offset %d, length %d: %s", item.Offset, item.Length, item.Message))
		}
	}
	return append(lines, "", "The JSON manifest stored with this report is the canonical evidence record.")
}

func aggregateVerdict(jobs []core.Job) core.Verdict {
	result := core.VerdictPass
	for _, job := range jobs {
		switch job.Verdict {
		case core.VerdictFail:
			return core.VerdictFail
		case core.VerdictWarning:
			if result != core.VerdictIncomplete {
				result = core.VerdictWarning
			}
		case core.VerdictIncomplete, "":
			result = core.VerdictIncomplete
		}
	}
	return result
}

func makePDF(lines []string) []byte {
	const linesPerPage = 50
	pageCount := (len(lines) + linesPerPage - 1) / linesPerPage
	if pageCount == 0 {
		pageCount = 1
	}
	fontObject := 3 + pageCount
	contentStart := fontObject + 1
	pageObjects := make([]string, 0, pageCount)
	contentObjects := make([]string, 0, pageCount)
	kids := make([]string, 0, pageCount)
	for page := 0; page < pageCount; page++ {
		pageObject := 3 + page
		contentObject := contentStart + page
		kids = append(kids, strconv.Itoa(pageObject)+" 0 R")
		pageObjects = append(pageObjects, fmt.Sprintf("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 842] /Resources << /Font << /F1 %d 0 R >> >> /Contents %d 0 R >>", fontObject, contentObject))
		start := page * linesPerPage
		end := min(start+linesPerPage, len(lines))
		var stream strings.Builder
		stream.WriteString("BT\n/F1 11 Tf\n48 790 Td\n14 TL\n")
		for index, line := range lines[start:end] {
			if index > 0 {
				stream.WriteString("T*\n")
			}
			stream.WriteString("(" + pdfEscape(ascii(line)) + ") Tj\n")
		}
		stream.WriteString("ET\n")
		content := stream.String()
		contentObjects = append(contentObjects, fmt.Sprintf("<< /Length %d >>\nstream\n%sendstream", len(content), content))
	}
	objects := []string{
		"<< /Type /Catalog /Pages 2 0 R >>",
		fmt.Sprintf("<< /Type /Pages /Kids [%s] /Count %d >>", strings.Join(kids, " "), pageCount),
	}
	objects = append(objects, pageObjects...)
	objects = append(objects, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")
	objects = append(objects, contentObjects...)
	var result bytes.Buffer
	result.WriteString("%PDF-1.4\n")
	offsets := make([]int, len(objects)+1)
	for index, object := range objects {
		offsets[index+1] = result.Len()
		fmt.Fprintf(&result, "%d 0 obj\n%s\nendobj\n", index+1, object)
	}
	xref := result.Len()
	fmt.Fprintf(&result, "xref\n0 %d\n0000000000 65535 f \n", len(objects)+1)
	for index := 1; index < len(offsets); index++ {
		fmt.Fprintf(&result, "%010d 00000 n \n", offsets[index])
	}
	fmt.Fprintf(&result, "trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n", len(objects)+1, xref)
	return result.Bytes()
}

func pdfEscape(value string) string {
	value = strings.ReplaceAll(value, "\\", "\\\\")
	value = strings.ReplaceAll(value, "(", "\\(")
	return strings.ReplaceAll(value, ")", "\\)")
}

func ascii(value string) string {
	return strings.Map(func(r rune) rune {
		if r >= 32 && r <= 126 {
			return r
		}
		return '?'
	}, value)
}
