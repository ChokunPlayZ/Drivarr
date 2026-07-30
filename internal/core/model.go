package core

import "time"

type Role string

const (
	RoleAdmin    Role = "admin"
	RoleOperator Role = "operator"
	RoleViewer   Role = "viewer"
)

type User struct {
	ID           string    `json:"id"`
	Username     string    `json:"username"`
	Role         Role      `json:"role"`
	PasswordHash string    `json:"passwordHash"`
	Salt         string    `json:"salt"`
	Disabled     bool      `json:"disabled"`
	CreatedAt    time.Time `json:"createdAt"`
}

type Session struct {
	TokenHash string    `json:"tokenHash"`
	UserID    string    `json:"userId"`
	ExpiresAt time.Time `json:"expiresAt"`
}

type AuditEvent struct {
	ID       string         `json:"id"`
	At       time.Time      `json:"at"`
	UserID   string         `json:"userId,omitempty"`
	Action   string         `json:"action"`
	Target   string         `json:"target,omitempty"`
	RemoteIP string         `json:"remoteIp,omitempty"`
	Details  map[string]any `json:"details,omitempty"`
}

type Verdict string

const (
	VerdictPass       Verdict = "pass"
	VerdictWarning    Verdict = "warning"
	VerdictFail       Verdict = "fail"
	VerdictIncomplete Verdict = "incomplete"
)

type Policy struct {
	ID                     string    `json:"id"`
	Name                   string    `json:"name"`
	Version                int       `json:"version"`
	FailOnSMART            bool      `json:"failOnSmart"`
	FailOnIOError          bool      `json:"failOnIoError"`
	WarnPendingAbove       int64     `json:"warnPendingAbove"`
	WarnReallocatedAbove   int64     `json:"warnReallocatedAbove"`
	WarnUncorrectableAbove int64     `json:"warnUncorrectableAbove"`
	CreatedAt              time.Time `json:"createdAt"`
}

type TestKind string

const (
	TestSMARTShort  TestKind = "smart_short"
	TestSMARTLong   TestKind = "smart_long"
	TestSMARTConvey TestKind = "smart_conveyance"
	TestSpeed       TestKind = "speed"
	TestSurfaceRead TestKind = "surface_read"
	TestDestructive TestKind = "destructive_verify"
)

type TestProfile struct {
	ID              string    `json:"id"`
	Name            string    `json:"name"`
	Kind            TestKind  `json:"kind"`
	BlockSizeKiB    int       `json:"blockSizeKiB"`
	QueueDepth      int       `json:"queueDepth"`
	DurationSeconds int       `json:"durationSeconds"`
	RateMiB         int       `json:"rateMiB"`
	BuiltIn         bool      `json:"builtIn"`
	Enabled         bool      `json:"enabled"`
	CreatedAt       time.Time `json:"createdAt"`
}

type JobStatus string

const (
	JobQueued          JobStatus = "queued"
	JobValidating      JobStatus = "validating"
	JobRunning         JobStatus = "running"
	JobPauseRequested  JobStatus = "pause_requested"
	JobPaused          JobStatus = "paused"
	JobCancelRequested JobStatus = "cancel_requested"
	JobCancelled       JobStatus = "cancelled"
	JobInterrupted     JobStatus = "interrupted"
	JobCompleted       JobStatus = "completed"
	JobWarning         JobStatus = "completed_with_warnings"
	JobFailed          JobStatus = "failed"
)

type SectorError struct {
	Offset  int64  `json:"offset"`
	Length  int64  `json:"length"`
	Message string `json:"message"`
}

type Job struct {
	ID                string        `json:"id"`
	DeviceID          string        `json:"deviceId"`
	DevicePath        string        `json:"devicePath"`
	DeviceFingerprint string        `json:"deviceFingerprint"`
	Kind              TestKind      `json:"kind"`
	Status            JobStatus     `json:"status"`
	CreatedBy         string        `json:"createdBy"`
	CreatedAt         time.Time     `json:"createdAt"`
	StartedAt         *time.Time    `json:"startedAt,omitempty"`
	FinishedAt        *time.Time    `json:"finishedAt,omitempty"`
	TotalBytes        int64         `json:"totalBytes"`
	CompletedBytes    int64         `json:"completedBytes"`
	ChunkBytes        int64         `json:"chunkBytes"`
	Progress          float64       `json:"progress"`
	CurrentPhase      string        `json:"currentPhase,omitempty"`
	ReadBPS           int64         `json:"readBps,omitempty"`
	WriteBPS          int64         `json:"writeBps,omitempty"`
	ReadIOPS          float64       `json:"readIops,omitempty"`
	WriteIOPS         float64       `json:"writeIops,omitempty"`
	Errors            []SectorError `json:"errors,omitempty"`
	Error             string        `json:"error,omitempty"`
	Verdict           Verdict       `json:"verdict"`
	PolicyID          string        `json:"policyId"`
	PolicyVersion     int           `json:"policyVersion"`
	PolicySnapshot    Policy        `json:"policySnapshot"`
	ProfileID         string        `json:"profileId"`
	ProfileName       string        `json:"profileName"`
	BlockSizeKiB      int           `json:"blockSizeKiB"`
	QueueDepth        int           `json:"queueDepth"`
	DurationSeconds   int           `json:"durationSeconds"`
	RateMiB           int           `json:"rateMiB"`
	Destructive       bool          `json:"destructive"`
}

type Report struct {
	ID         string    `json:"id"`
	JobID      string    `json:"jobId"`
	CreatedBy  string    `json:"createdBy"`
	CreatedAt  time.Time `json:"createdAt"`
	Path       string    `json:"path"`
	DataSHA256 string    `json:"dataSha256"`
	PDFSHA256  string    `json:"pdfSha256"`
	Verdict    Verdict   `json:"verdict"`
}

type Settings struct {
	Organization        string `json:"organization"`
	MaxConcurrentJobs   int    `json:"maxConcurrentJobs"`
	MaxDestructiveJobs  int    `json:"maxDestructiveJobs"`
	DestructiveEnabled  bool   `json:"destructiveEnabled"`
	ProbeTimeoutSeconds int    `json:"probeTimeoutSeconds"`
	JobChunkMiB         int64  `json:"jobChunkMiB"`
	RetentionDays       int    `json:"retentionDays"`
	RetentionMaxBytes   int64  `json:"retentionMaxBytes"`
}

type State struct {
	SchemaVersion int                    `json:"schemaVersion"`
	Users         map[string]User        `json:"users"`
	Sessions      map[string]Session     `json:"sessions"`
	Audit         []AuditEvent           `json:"audit"`
	Policies      map[string]Policy      `json:"policies"`
	Profiles      map[string]TestProfile `json:"profiles"`
	Jobs          map[string]Job         `json:"jobs"`
	Reports       map[string]Report      `json:"reports"`
	Settings      Settings               `json:"settings"`
}
