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
	pdf := makeStyledJobPDF(manifest, dataHex)
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
	pdf := makeStyledDrivePDF(manifest, dataHex)
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

type pdfCanvas struct {
	stream strings.Builder
}

var (
	pdfPurple = [3]float64{0.31, 0.22, 0.55}
	pdfInk    = [3]float64{0.12, 0.11, 0.14}
	pdfMuted  = [3]float64{0.37, 0.35, 0.40}
	pdfPaper  = [3]float64{0.97, 0.95, 0.98}
	pdfWhite  = [3]float64{1, 1, 1}
	pdfGreen  = [3]float64{0.08, 0.42, 0.18}
	pdfRed    = [3]float64{0.70, 0.12, 0.10}
	pdfAmber  = [3]float64{0.78, 0.48, 0.02}
	pdfGray   = [3]float64{0.72, 0.70, 0.75}
)

func (c *pdfCanvas) rect(x, y, width, height float64, color [3]float64) {
	fmt.Fprintf(&c.stream, "%.3f %.3f %.3f rg %.1f %.1f %.1f %.1f re f\n", color[0], color[1], color[2], x, y, width, height)
}

func (c *pdfCanvas) line(x1, y1, x2, y2 float64) {
	fmt.Fprintf(&c.stream, "0.850 0.830 0.870 RG 0.7 w %.1f %.1f m %.1f %.1f l S\n", x1, y1, x2, y2)
}

func (c *pdfCanvas) text(x, y, size float64, value string, bold bool, color [3]float64) {
	font := "F1"
	if bold {
		font = "F2"
	}
	fmt.Fprintf(&c.stream, "%.3f %.3f %.3f rg BT /%s %.1f Tf %.1f %.1f Td (%s) Tj ET\n",
		color[0], color[1], color[2], font, size, x, y, pdfEscape(ascii(value)))
}

func (c *pdfCanvas) wrappedText(x, y, size float64, value string, maxChars int, leading float64, bold bool, color [3]float64) float64 {
	for _, row := range wrapPDFText(value, maxChars) {
		c.text(x, y, size, row, bold, color)
		y -= leading
	}
	return y
}

func wrapPDFText(value string, maxChars int) []string {
	words := strings.Fields(ascii(value))
	if len(words) == 0 {
		return nil
	}
	rows := make([]string, 0, 2)
	row := words[0]
	for _, word := range words[1:] {
		if len(row)+1+len(word) > maxChars {
			rows = append(rows, row)
			row = word
			continue
		}
		row += " " + word
	}
	return append(rows, row)
}

func truncatePDF(value string, max int) string {
	value = ascii(value)
	if len(value) <= max {
		return value
	}
	if max <= 3 {
		return value[:max]
	}
	return value[:max-3] + "..."
}

func reportHeader(c *pdfCanvas, organization, title, reportID, dataHash string, page, pageCount int) {
	if organization == "" {
		organization = "DRIVARR"
	}
	brand := "DRIVARR"
	if normalized := strings.ToUpper(organization); normalized != "DRIVARR" {
		brand += " / " + normalized
	}
	c.rect(0, 732, 612, 110, pdfPurple)
	c.text(42, 801, 10, truncatePDF(brand, 62), true, pdfWhite)
	c.text(42, 767, 24, title, true, pdfWhite)
	c.text(520, 801, 8, fmt.Sprintf("PAGE %d / %d", page, pageCount), true, pdfWhite)
	c.text(42, 26, 7, "Report "+reportID+"  |  Data SHA-256 "+truncatePDF(dataHash, 24)+"...", false, pdfMuted)
	c.text(522, 26, 7, "DRIVARR", true, pdfMuted)
}

func verdictColor(verdict core.Verdict) [3]float64 {
	switch verdict {
	case core.VerdictPass:
		return pdfGreen
	case core.VerdictFail:
		return pdfRed
	default:
		return pdfAmber
	}
}

func drawVerdict(c *pdfCanvas, verdict core.Verdict) {
	label := strings.ToUpper(string(verdict))
	if label == "" {
		label = "INCOMPLETE"
	}
	c.rect(455, 675, 115, 31, verdictColor(verdict))
	c.text(468, 687, 10, label, true, pdfWhite)
}

func labelValue(c *pdfCanvas, x, y float64, label, value string, max int) {
	c.text(x, y, 7, strings.ToUpper(label), true, pdfMuted)
	c.text(x, y-15, 10, truncatePDF(value, max), true, pdfInk)
}

func drawDriveSummary(c *pdfCanvas, device guard.DeviceState, verdict core.Verdict) {
	probe := device.Probe
	model, serial, protocol, capacity, smart, temperature, hours := device.Name, "Unavailable", "Unknown", "Unknown", "Unavailable", "Unavailable", "Unavailable"
	if probe != nil {
		model, serial, protocol = probe.Model, probe.Serial, probe.Protocol
		capacity = formatPDFBytes(probe.Capacity)
		if probe.SMARTAvailable {
			smart = "Passed"
			if !probe.SMARTPassed {
				smart = "Failed"
			}
		}
		if probe.TemperatureC != 0 {
			temperature = fmt.Sprintf("%d C", probe.TemperatureC)
		}
		if probe.PowerOnHours != 0 {
			hours = fmt.Sprintf("%s h", formatPDFInt(probe.PowerOnHours))
		}
	}
	if model == "" {
		model = device.ID
	}
	drawVerdict(c, verdict)
	c.text(42, 705, 8, "DRIVE", true, pdfMuted)
	c.text(42, 680, 17, truncatePDF(model, 48), true, pdfInk)
	c.text(42, 659, 9, truncatePDF(device.Path+"  /  "+protocol+"  /  "+capacity, 86), false, pdfMuted)
	c.line(42, 642, 570, 642)
	labelValue(c, 42, 617, "Serial number", serial, 22)
	labelValue(c, 190, 617, "SMART health", smart, 18)
	labelValue(c, 338, 617, "Temperature", temperature, 16)
	labelValue(c, 470, 617, "Power-on time", hours, 16)
}

func drawHealthCounters(c *pdfCanvas, probe *guard.ProbeData, y float64) {
	c.text(42, y, 12, "Media health counters", true, pdfInk)
	values := []struct{ label, value string }{
		{"Reallocated sectors", "Unavailable"}, {"Pending sectors", "Unavailable"}, {"Uncorrectable", "Unavailable"}, {"FARM log", "Unavailable"},
	}
	if probe != nil {
		values[0].value = formatPDFInt(probe.Reallocated)
		values[1].value = formatPDFInt(probe.Pending)
		values[2].value = formatPDFInt(probe.Uncorrectable)
		if probe.FARMAvailable {
			values[3].value = "Available"
		}
	}
	for index, value := range values {
		x := 42.0 + float64(index)*132
		c.rect(x, y-58, 120, 43, pdfPaper)
		c.text(x+10, y-32, 7, strings.ToUpper(value.label), true, pdfMuted)
		c.text(x+10, y-49, 11, value.value, true, pdfInk)
	}
}

func drawSMARTTable(c *pdfCanvas, probe *guard.ProbeData, y float64) {
	c.text(42, y, 12, "SMART attributes", true, pdfInk)
	c.rect(42, y-31, 528, 22, pdfPurple)
	headings := []string{"ID", "Attribute", "Current", "Worst", "Threshold", "Raw value"}
	xs := []float64{49, 78, 290, 354, 414, 478}
	for index, heading := range headings {
		c.text(xs[index], y-23, 7, strings.ToUpper(heading), true, pdfWhite)
	}
	if probe == nil || len(probe.SMARTAttributes) == 0 {
		c.text(52, y-55, 9, "SMART attributes unavailable through this transport.", false, pdfMuted)
		return
	}
	rowY := y - 50
	for index, attribute := range probe.SMARTAttributes {
		if index >= 9 {
			break
		}
		if index%2 == 0 {
			c.rect(42, rowY-7, 528, 22, pdfPaper)
		}
		raw := attribute.RawString
		if raw == "" {
			raw = formatPDFInt(attribute.RawValue)
		}
		values := []string{strconv.Itoa(attribute.ID), truncatePDF(attribute.Name, 32), formatPDFInt(attribute.Current), formatPDFInt(attribute.Worst), formatPDFInt(attribute.Threshold), truncatePDF(raw, 15)}
		for column, value := range values {
			c.text(xs[column], rowY, 8, value, column == 1, pdfInk)
		}
		rowY -= 24
	}
}

func makeStyledJobPDF(value Manifest, dataHash string) []byte {
	pages := []*pdfCanvas{{}, {}}
	evidenceTitle := "Test Evidence"
	if value.Job.Kind == core.TestSurfaceRead || value.Job.Kind == core.TestDestructive {
		evidenceTitle = "Test Evidence and Surface Map"
	}
	for index, page := range pages {
		reportHeader(page, value.Organization, []string{"Drive Diagnostic Report", evidenceTitle}[index], value.ReportID, dataHash, index+1, len(pages))
	}
	drawDriveSummary(pages[0], value.Device, value.Job.Verdict)
	drawHealthCounters(pages[0], value.Device.Probe, 555)
	drawSMARTTable(pages[0], value.Device.Probe, 455)
	pages[0].text(42, 117, 8, "ASSESSMENT NOTE", true, pdfMuted)
	pages[0].wrappedText(42, 100, 8, "Generated "+formatPDFTime(value.GeneratedAt)+" by "+value.GeneratedBy+". Drive health is based on the captured SMART snapshot, media counters, test results, and the grading policy recorded in the immutable manifest.", 100, 11, false, pdfMuted)

	hasSurfaceMap := drawJobEvidence(pages[1], value.Job)
	integrityY := 260.0
	if hasSurfaceMap {
		integrityY = 132
	}
	drawIntegrityBlock(pages[1], value.ReportID, dataHash, integrityY)
	return buildStyledPDF(pages)
}

func drawJobEvidence(c *pdfCanvas, job core.Job) bool {
	drawVerdict(c, job.Verdict)
	c.text(42, 704, 12, "Test summary", true, pdfInk)
	profile := job.ProfileName
	if profile == "" {
		profile = string(job.Kind)
	}
	c.text(42, 678, 16, truncatePDF(profile, 52), true, pdfInk)
	c.text(42, 658, 9, truncatePDF("Job "+job.ID+"  /  "+string(job.Status)+"  /  "+formatPDFTime(job.CreatedAt), 88), false, pdfMuted)
	metrics := jobPDFMetrics(job)
	for index, metric := range metrics {
		x := 42.0 + float64(index)*132
		c.rect(x, 583, 120, 49, pdfPaper)
		c.text(x+10, 612, 7, strings.ToUpper(metric.label), true, pdfMuted)
		c.text(x+10, 594, 10, truncatePDF(metric.value, 18), true, pdfInk)
	}
	c.text(42, 548, 12, "Execution details", true, pdfInk)
	details := jobPDFDetails(job)
	for index, detail := range details {
		c.text(52, 522-float64(index)*20, 9, truncatePDF(detail, 94), index == 0, pdfInk)
	}
	hasSurface := job.Kind == core.TestSurfaceRead || job.Kind == core.TestDestructive
	if hasSurface {
		c.text(42, 442, 12, "Recorded I/O errors", true, pdfInk)
		if len(job.Errors) == 0 {
			c.rect(42, 395, 528, 31, pdfPaper)
			c.text(54, 407, 9, "No unreadable ranges were recorded.", true, pdfGreen)
		} else {
			rowY := 414.0
			for index, item := range job.Errors {
				if index >= 5 {
					break
				}
				c.text(52, rowY, 8, fmt.Sprintf("Offset %d, length %d", item.Offset, item.Length), true, pdfInk)
				c.text(270, rowY, 8, truncatePDF(item.Message, 48), false, pdfRed)
				c.line(42, rowY-9, 570, rowY-9)
				rowY -= 25
			}
		}
		drawSurfaceMap(c, []core.Job{job}, 337)
	}
	return hasSurface
}

type pdfMetric struct{ label, value string }

func jobPDFMetrics(job core.Job) []pdfMetric {
	switch job.Kind {
	case core.TestSpeed:
		return []pdfMetric{
			{"Sequential read", formatPDFRate(job.ReadBPS)},
			{"Random read", fmt.Sprintf("%.2f IOPS", job.ReadIOPS)},
			{"Test duration", fmt.Sprintf("%d seconds", job.DurationSeconds)},
			{"Queue depth", strconv.Itoa(max(job.QueueDepth, 1))},
		}
	case core.TestSMARTShort, core.TestSMARTLong, core.TestSMARTConvey:
		return []pdfMetric{
			{"Progress", fmt.Sprintf("%.1f%%", job.Progress*100)},
			{"Firmware test", smartTestPDFLabel(job.Kind)},
			{"Started", formatPDFOptionalTime(job.StartedAt)},
			{"Finished", formatPDFOptionalTime(job.FinishedAt)},
		}
	case core.TestDestructive:
		return []pdfMetric{
			{"Progress", fmt.Sprintf("%.1f%%", job.Progress*100)},
			{"Bytes verified", formatPDFBytes(job.CompletedBytes)},
			{"Read speed", formatPDFRate(job.ReadBPS)},
			{"Write speed", formatPDFRate(job.WriteBPS)},
		}
	default:
		return []pdfMetric{
			{"Progress", fmt.Sprintf("%.1f%%", job.Progress*100)},
			{"Bytes scanned", formatPDFBytes(job.CompletedBytes)},
			{"Read speed", formatPDFRate(job.ReadBPS)},
			{"I/O errors", strconv.Itoa(len(job.Errors))},
		}
	}
}

func jobPDFDetails(job core.Job) []string {
	details := []string{"Policy: " + job.PolicyID + " v" + strconv.Itoa(job.PolicyVersion)}
	switch job.Kind {
	case core.TestSpeed:
		details = append(details,
			fmt.Sprintf("Block size: %d KiB  /  Queue depth: %d", job.BlockSizeKiB, job.QueueDepth),
			"Benchmark phases: sequential read and random read IOPS",
		)
	case core.TestSMARTShort, core.TestSMARTLong, core.TestSMARTConvey:
		details = append(details,
			"Command: drive firmware "+smartTestPDFLabel(job.Kind),
			"Last phase: "+fallbackPDF(job.CurrentPhase, "Drive self-test completed"),
		)
	default:
		details = append(details,
			fmt.Sprintf("Block size: %d KiB  /  Queue depth: %d", job.BlockSizeKiB, job.QueueDepth),
			"Last phase: "+fallbackPDF(job.CurrentPhase, "Completed"),
		)
	}
	return details
}

func smartTestPDFLabel(kind core.TestKind) string {
	switch kind {
	case core.TestSMARTShort:
		return "Short offline"
	case core.TestSMARTConvey:
		return "Conveyance offline"
	default:
		return "Extended offline"
	}
}

func makeStyledDrivePDF(value DriveManifest, dataHash string) []byte {
	const jobsPerPage = 8
	pageCount := 1 + (len(value.Jobs)+jobsPerPage-1)/jobsPerPage
	if pageCount < 2 {
		pageCount = 2
	}
	pages := make([]*pdfCanvas, pageCount)
	for index := range pages {
		pages[index] = &pdfCanvas{}
		title := "Full Drive Diagnostic Report"
		if index > 0 {
			title = "Retained Test Evidence"
		}
		reportHeader(pages[index], value.Organization, title, value.ReportID, dataHash, index+1, pageCount)
	}
	verdict := aggregateVerdict(value.Jobs)
	drawDriveSummary(pages[0], value.Device, verdict)
	drawHealthCounters(pages[0], value.Device.Probe, 555)
	drawSMARTTable(pages[0], value.Device.Probe, 455)
	pages[0].text(42, 117, 8, "REPORT COVERAGE", true, pdfMuted)
	pages[0].wrappedText(42, 100, 8, fmt.Sprintf("Generated %s by %s. This full-drive report includes %d retained tests in chronological order. The JSON manifest is the canonical evidence record.", formatPDFTime(value.GeneratedAt), value.GeneratedBy, len(value.Jobs)), 100, 11, false, pdfMuted)
	for pageIndex := 1; pageIndex < pageCount; pageIndex++ {
		start := (pageIndex - 1) * jobsPerPage
		end := min(start+jobsPerPage, len(value.Jobs))
		drawDriveJobs(pages[pageIndex], value.Jobs[start:end], start, len(value.Jobs), verdict)
		if pageIndex == pageCount-1 {
			mapY := 430.0 - float64(max(0, len(value.Jobs[start:end])-3))*28
			drawSurfaceMap(pages[pageIndex], value.Jobs, mapY)
			drawIntegrityBlock(pages[pageIndex], value.ReportID, dataHash, mapY-200)
		}
	}
	return buildStyledPDF(pages)
}

func drawDriveJobs(c *pdfCanvas, jobs []core.Job, offset, total int, verdict core.Verdict) {
	drawVerdict(c, verdict)
	c.text(42, 704, 12, "Complete retained test history", true, pdfInk)
	c.text(42, 684, 9, fmt.Sprintf("Tests %d-%d of %d", offset+1, offset+len(jobs), total), false, pdfMuted)
	c.rect(42, 646, 528, 22, pdfPurple)
	headings := []string{"Test", "Profile / kind", "Status", "Progress", "Key result"}
	xs := []float64{49, 130, 350, 430, 490}
	for index, heading := range headings {
		c.text(xs[index], 654, 7, strings.ToUpper(heading), true, pdfWhite)
	}
	rowY := 625.0
	for index, job := range jobs {
		if index%2 == 0 {
			c.rect(42, rowY-11, 528, 31, pdfPaper)
		}
		profile := fallbackPDF(job.ProfileName, string(job.Kind))
		c.text(49, rowY, 8, truncatePDF(job.ID, 13), true, pdfInk)
		c.text(130, rowY, 8, truncatePDF(profile, 31), true, pdfInk)
		c.text(350, rowY, 8, truncatePDF(string(job.Status), 16), false, pdfInk)
		c.text(430, rowY, 8, fmt.Sprintf("%.1f%%", job.Progress*100), false, pdfInk)
		c.text(490, rowY, 8, truncatePDF(jobPDFSummaryResult(job), 18), false, pdfInk)
		c.line(42, rowY-13, 570, rowY-13)
		rowY -= 39
	}
}

func jobPDFSummaryResult(job core.Job) string {
	switch job.Kind {
	case core.TestSpeed:
		return fmt.Sprintf("%s, %.0f IOPS", formatPDFCompactRate(job.ReadBPS), job.ReadIOPS)
	case core.TestSMARTShort, core.TestSMARTLong, core.TestSMARTConvey:
		return smartTestPDFLabel(job.Kind)
	case core.TestDestructive:
		return formatPDFCompactRate(job.ReadBPS) + " R/W verify"
	default:
		return fmt.Sprintf("%d err, %s", len(job.Errors), formatPDFCompactRate(job.ReadBPS))
	}
}

func drawSurfaceMap(c *pdfCanvas, jobs []core.Job, y float64) {
	var surface *core.Job
	for index := range jobs {
		if jobs[index].Kind == core.TestSurfaceRead || jobs[index].Kind == core.TestDestructive {
			surface = &jobs[index]
		}
	}
	if surface == nil {
		return
	}
	c.text(42, y, 12, "Bad-block surface map", true, pdfInk)
	c.text(42, y-20, 8, fmt.Sprintf("%.1f%% scanned  /  %d unreadable ranges", surface.Progress*100, len(surface.Errors)), false, pdfMuted)
	const cells = 144
	total := max(surface.TotalBytes, 1)
	bad := make(map[int]bool)
	for _, item := range surface.Errors {
		first := int(float64(item.Offset) / float64(total) * cells)
		last := int(float64(item.Offset+max(item.Length, 1)) / float64(total) * cells)
		for cell := max(first, 0); cell <= min(last, cells-1); cell++ {
			bad[cell] = true
		}
	}
	scanned := min(cells-1, max(0, int(surface.Progress*cells)))
	for index := 0; index < cells; index++ {
		color := pdfGray
		if index <= scanned {
			color = pdfGreen
			if bad[index] {
				color = pdfRed
			} else if index == scanned && surface.Progress < 1 {
				color = pdfPurple
			}
		}
		column, row := index%24, index/24
		c.rect(42+float64(column)*22, y-49-float64(row)*17, 18, 12, color)
	}
	c.text(42, y-164, 7, "GREEN  READ OK", true, pdfGreen)
	c.text(170, y-164, 7, "PURPLE  CURRENT", true, pdfPurple)
	c.text(310, y-164, 7, "RED  UNREADABLE", true, pdfRed)
	c.text(446, y-164, 7, "GRAY  NOT SCANNED", true, pdfMuted)
}

func drawIntegrityBlock(c *pdfCanvas, reportID, dataHash string, y float64) {
	c.text(42, y, 11, "Integrity manifest", true, pdfInk)
	c.text(42, y-19, 8, dataHash, false, pdfMuted)
	c.text(42, y-43, 8, "Report "+reportID+" is paired with an immutable canonical JSON manifest and PDF checksum.", false, pdfMuted)
}

func buildStyledPDF(pages []*pdfCanvas) []byte {
	pageCount := len(pages)
	regularFontObject := 3 + pageCount
	boldFontObject := regularFontObject + 1
	contentStart := boldFontObject + 1
	kids := make([]string, pageCount)
	objects := []string{"<< /Type /Catalog /Pages 2 0 R >>"}
	for index := range pages {
		kids[index] = strconv.Itoa(3+index) + " 0 R"
	}
	objects = append(objects, fmt.Sprintf("<< /Type /Pages /Kids [%s] /Count %d >>", strings.Join(kids, " "), pageCount))
	for index := range pages {
		objects = append(objects, fmt.Sprintf("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 842] /Resources << /Font << /F1 %d 0 R /F2 %d 0 R >> >> /Contents %d 0 R >>", regularFontObject, boldFontObject, contentStart+index))
	}
	objects = append(objects,
		"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
		"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>",
	)
	for _, page := range pages {
		content := page.stream.String()
		objects = append(objects, fmt.Sprintf("<< /Length %d >>\nstream\n%sendstream", len(content), content))
	}
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

func formatPDFBytes(value int64) string {
	if value <= 0 {
		return "0 B"
	}
	units := []string{"B", "KB", "MB", "GB", "TB", "PB"}
	amount, unit := float64(value), 0
	for amount >= 1000 && unit < len(units)-1 {
		amount /= 1000
		unit++
	}
	if unit < 3 {
		return fmt.Sprintf("%.0f %s", amount, units[unit])
	}
	return fmt.Sprintf("%.2f %s", amount, units[unit])
}

func formatPDFRate(value int64) string {
	if value <= 0 {
		return "Unavailable"
	}
	return formatPDFBytes(value) + "/s"
}

func formatPDFCompactRate(value int64) string {
	if value <= 0 {
		return "No rate"
	}
	return strings.ReplaceAll(formatPDFBytes(value), " ", "") + "/s"
}

func formatPDFInt(value int64) string {
	raw := strconv.FormatInt(value, 10)
	for index := len(raw) - 3; index > 0; index -= 3 {
		raw = raw[:index] + "," + raw[index:]
	}
	return raw
}

func formatPDFTime(value time.Time) string {
	if value.IsZero() {
		return "Unknown time"
	}
	return value.UTC().Format("2006-01-02 15:04 UTC")
}

func formatPDFOptionalTime(value *time.Time) string {
	if value == nil {
		return "Not recorded"
	}
	return value.UTC().Format("2006-01-02 15:04")
}

func fallbackPDF(value, fallback string) string {
	if value == "" {
		return fallback
	}
	return value
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
