package core

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"sync"
	"time"
)

var (
	ErrNotFound     = errors.New("not found")
	ErrUnauthorized = errors.New("unauthorized")
	ErrConflict     = errors.New("conflict")
)

type Store struct {
	mu    sync.RWMutex
	path  string
	state State
}

func OpenStore(dataDir string) (*Store, error) {
	if err := os.MkdirAll(dataDir, 0o750); err != nil {
		return nil, err
	}
	store := &Store{path: filepath.Join(dataDir, "state.json"), state: defaultState()}
	raw, err := os.ReadFile(store.path)
	if err == nil {
		if err := json.Unmarshal(raw, &store.state); err != nil {
			return nil, fmt.Errorf("decode state: %w", err)
		}
		store.normalize()
	} else if !errors.Is(err, os.ErrNotExist) {
		return nil, err
	}
	return store, nil
}

func defaultState() State {
	now := time.Now().UTC()
	policy := Policy{
		ID: "conservative", Name: "Conservative", Version: 1,
		FailOnSMART: true, FailOnIOError: true,
		WarnPendingAbove: 0, WarnReallocatedAbove: 0, WarnUncorrectableAbove: 0,
		CreatedAt: now,
	}
	profiles := make(map[string]TestProfile)
	for _, item := range []TestProfile{
		{ID: "smart-short", Name: "SMART short self-test", Kind: TestSMARTShort, BlockSizeKiB: 1024, QueueDepth: 1},
		{ID: "smart-long", Name: "SMART extended self-test", Kind: TestSMARTLong, BlockSizeKiB: 1024, QueueDepth: 1},
		{ID: "smart-conveyance", Name: "SMART conveyance self-test", Kind: TestSMARTConvey, BlockSizeKiB: 1024, QueueDepth: 1},
		{ID: "speed-read", Name: "Read speed and random IOPS", Kind: TestSpeed, BlockSizeKiB: 1024, QueueDepth: 1, DurationSeconds: 15},
		{ID: "surface-read", Name: "Full non-destructive surface read", Kind: TestSurfaceRead, BlockSizeKiB: 1024, QueueDepth: 1},
		{ID: "destructive-verify", Name: "Destructive write/read verification", Kind: TestDestructive, BlockSizeKiB: 1024, QueueDepth: 1},
	} {
		item.BuiltIn, item.Enabled, item.CreatedAt = true, true, now
		profiles[item.ID] = item
	}
	return State{
		SchemaVersion: 1,
		Users:         make(map[string]User), Sessions: make(map[string]Session),
		Policies: map[string]Policy{policy.ID: policy},
		Profiles: profiles,
		Jobs:     make(map[string]Job), Reports: make(map[string]Report),
		Settings: Settings{
			Organization: "Drivarr", MaxConcurrentJobs: 2, MaxDestructiveJobs: 1,
			ProbeTimeoutSeconds: 8, JobChunkMiB: 256,
		},
	}
}

func (s *Store) normalize() {
	if s.state.Users == nil {
		s.state.Users = make(map[string]User)
	}
	if s.state.Sessions == nil {
		s.state.Sessions = make(map[string]Session)
	}
	if s.state.Policies == nil {
		s.state.Policies = make(map[string]Policy)
	}
	if len(s.state.Profiles) == 0 {
		s.state.Profiles = defaultState().Profiles
	}
	if s.state.Jobs == nil {
		s.state.Jobs = make(map[string]Job)
	}
	if s.state.Reports == nil {
		s.state.Reports = make(map[string]Report)
	}
	if s.state.Settings.MaxConcurrentJobs < 1 {
		s.state.Settings.MaxConcurrentJobs = 2
	}
	if s.state.Settings.MaxDestructiveJobs < 1 {
		s.state.Settings.MaxDestructiveJobs = 1
	}
	if s.state.Settings.JobChunkMiB < 1 {
		s.state.Settings.JobChunkMiB = 256
	}
}

func (s *Store) persistLocked() error {
	raw, err := json.MarshalIndent(s.state, "", "  ")
	if err != nil {
		return err
	}
	temp := s.path + ".tmp"
	if err := os.WriteFile(temp, raw, 0o640); err != nil {
		return err
	}
	return os.Rename(temp, s.path)
}

func NewID(prefix string) string {
	var data [12]byte
	_, _ = rand.Read(data[:])
	return prefix + "_" + hex.EncodeToString(data[:])
}

func randomToken(bytes int) (string, error) {
	data := make([]byte, bytes)
	if _, err := rand.Read(data); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(data), nil
}

func derivePassword(password string, salt []byte) []byte {
	// PBKDF2-HMAC-SHA256 implemented locally to keep the daemon dependency-free.
	const iterations = 310_000
	mac := hmac.New(sha256.New, []byte(password))
	mac.Write(salt)
	mac.Write([]byte{0, 0, 0, 1})
	u := mac.Sum(nil)
	result := append([]byte(nil), u...)
	for i := 1; i < iterations; i++ {
		mac.Reset()
		mac.Write(u)
		u = mac.Sum(nil)
		for j := range result {
			result[j] ^= u[j]
		}
	}
	return result
}

func (s *Store) EnsureAdmin(password string) (User, bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, user := range s.state.Users {
		if user.Role == RoleAdmin {
			return user, false, nil
		}
	}
	if len(password) < 12 {
		return User{}, false, errors.New("bootstrap password must contain at least 12 characters")
	}
	user, err := makeUser("admin", password, RoleAdmin)
	if err != nil {
		return User{}, false, err
	}
	s.state.Users[user.ID] = user
	s.state.Audit = append(s.state.Audit, AuditEvent{
		ID: NewID("audit"), At: time.Now().UTC(), UserID: user.ID, Action: "user.bootstrap", Target: user.ID,
	})
	return user, true, s.persistLocked()
}

func makeUser(username, password string, role Role) (User, error) {
	username = strings.TrimSpace(strings.ToLower(username))
	if len(username) < 3 {
		return User{}, errors.New("username must contain at least 3 characters")
	}
	if len(password) < 12 {
		return User{}, errors.New("password must contain at least 12 characters")
	}
	if role != RoleAdmin && role != RoleOperator && role != RoleViewer {
		return User{}, errors.New("invalid role")
	}
	salt := make([]byte, 16)
	if _, err := rand.Read(salt); err != nil {
		return User{}, err
	}
	return User{
		ID: NewID("usr"), Username: username, Role: role,
		Salt:         base64.RawStdEncoding.EncodeToString(salt),
		PasswordHash: base64.RawStdEncoding.EncodeToString(derivePassword(password, salt)),
		CreatedAt:    time.Now().UTC(),
	}, nil
}

func (s *Store) CreateUser(username, password string, role Role) (User, error) {
	user, err := makeUser(username, password, role)
	if err != nil {
		return User{}, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, current := range s.state.Users {
		if current.Username == user.Username {
			return User{}, ErrConflict
		}
	}
	s.state.Users[user.ID] = user
	return user, s.persistLocked()
}

func (s *Store) ChangePassword(userID, currentPassword, newPassword string) error {
	if len(newPassword) < 12 {
		return errors.New("new password must contain at least 12 characters")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	user, ok := s.state.Users[userID]
	if !ok {
		return ErrNotFound
	}
	salt, err := base64.RawStdEncoding.DecodeString(user.Salt)
	if err != nil {
		return ErrUnauthorized
	}
	expected, err := base64.RawStdEncoding.DecodeString(user.PasswordHash)
	if err != nil || subtle.ConstantTimeCompare(derivePassword(currentPassword, salt), expected) != 1 {
		return ErrUnauthorized
	}
	return s.setPasswordLocked(user, newPassword)
}

func (s *Store) ResetPassword(username, newPassword string) error {
	if len(newPassword) < 12 {
		return errors.New("new password must contain at least 12 characters")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, user := range s.state.Users {
		if user.Username == strings.ToLower(strings.TrimSpace(username)) {
			if err := s.setPasswordLocked(user, newPassword); err != nil {
				return err
			}
			s.state.Audit = append(s.state.Audit, AuditEvent{
				ID: NewID("audit"), At: time.Now().UTC(), UserID: user.ID,
				Action: "user.password_reset_cli", Target: user.ID,
			})
			return s.persistLocked()
		}
	}
	return ErrNotFound
}

func (s *Store) setPasswordLocked(user User, password string) error {
	salt := make([]byte, 16)
	if _, err := rand.Read(salt); err != nil {
		return err
	}
	user.Salt = base64.RawStdEncoding.EncodeToString(salt)
	user.PasswordHash = base64.RawStdEncoding.EncodeToString(derivePassword(password, salt))
	s.state.Users[user.ID] = user
	for key, session := range s.state.Sessions {
		if session.UserID == user.ID {
			delete(s.state.Sessions, key)
		}
	}
	return s.persistLocked()
}

func (s *Store) ListUsers() []User {
	s.mu.RLock()
	defer s.mu.RUnlock()
	result := make([]User, 0, len(s.state.Users))
	for _, user := range s.state.Users {
		user.PasswordHash, user.Salt = "", ""
		result = append(result, user)
	}
	slices.SortFunc(result, func(a, b User) int { return strings.Compare(a.Username, b.Username) })
	return result
}

func (s *Store) Authenticate(username, password string) (User, string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	var matched User
	for _, user := range s.state.Users {
		if subtle.ConstantTimeCompare([]byte(user.Username), []byte(strings.ToLower(strings.TrimSpace(username)))) == 1 {
			matched = user
			break
		}
	}
	salt, err := base64.RawStdEncoding.DecodeString(matched.Salt)
	if err != nil || matched.ID == "" || matched.Disabled {
		// Perform equivalent work to reduce username enumeration timing.
		_ = derivePassword(password, make([]byte, 16))
		return User{}, "", ErrUnauthorized
	}
	expected, err := base64.RawStdEncoding.DecodeString(matched.PasswordHash)
	if err != nil || subtle.ConstantTimeCompare(derivePassword(password, salt), expected) != 1 {
		return User{}, "", ErrUnauthorized
	}
	token, err := randomToken(32)
	if err != nil {
		return User{}, "", err
	}
	hash := sha256.Sum256([]byte(token))
	s.state.Sessions[hex.EncodeToString(hash[:])] = Session{
		TokenHash: hex.EncodeToString(hash[:]), UserID: matched.ID, ExpiresAt: time.Now().UTC().Add(12 * time.Hour),
	}
	if err := s.persistLocked(); err != nil {
		return User{}, "", err
	}
	matched.PasswordHash, matched.Salt = "", ""
	return matched, token, nil
}

func (s *Store) Session(token string) (User, bool) {
	hash := sha256.Sum256([]byte(token))
	key := hex.EncodeToString(hash[:])
	s.mu.RLock()
	defer s.mu.RUnlock()
	session, ok := s.state.Sessions[key]
	if !ok || time.Now().After(session.ExpiresAt) {
		return User{}, false
	}
	user, ok := s.state.Users[session.UserID]
	if !ok || user.Disabled {
		return User{}, false
	}
	user.PasswordHash, user.Salt = "", ""
	return user, true
}

func (s *Store) VerifyPassword(userID, password string) bool {
	s.mu.RLock()
	user, ok := s.state.Users[userID]
	s.mu.RUnlock()
	if !ok || user.Disabled {
		return false
	}
	salt, err := base64.RawStdEncoding.DecodeString(user.Salt)
	if err != nil {
		return false
	}
	expected, err := base64.RawStdEncoding.DecodeString(user.PasswordHash)
	return err == nil && subtle.ConstantTimeCompare(derivePassword(password, salt), expected) == 1
}

func (s *Store) Logout(token string) error {
	hash := sha256.Sum256([]byte(token))
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.state.Sessions, hex.EncodeToString(hash[:]))
	return s.persistLocked()
}

func (s *Store) Audit(userID, action, target, remote string, details map[string]any) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.state.Audit = append(s.state.Audit, AuditEvent{
		ID: NewID("audit"), At: time.Now().UTC(), UserID: userID, Action: action,
		Target: target, RemoteIP: remote, Details: details,
	})
	_ = s.persistLocked()
}

func (s *Store) AuditEvents(limit int) []AuditEvent {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if limit < 1 || limit > 1000 {
		limit = 200
	}
	start := max(0, len(s.state.Audit)-limit)
	result := append([]AuditEvent(nil), s.state.Audit[start:]...)
	slices.Reverse(result)
	return result
}

func (s *Store) Settings() Settings {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.state.Settings
}

func (s *Store) UpdateSettings(value Settings) error {
	if value.MaxConcurrentJobs < 1 || value.MaxConcurrentJobs > 32 {
		return errors.New("max concurrent jobs must be 1-32")
	}
	if value.MaxDestructiveJobs < 1 || value.MaxDestructiveJobs > value.MaxConcurrentJobs {
		return errors.New("invalid destructive concurrency")
	}
	if value.JobChunkMiB < 16 || value.JobChunkMiB > 4096 {
		return errors.New("chunk size must be 16-4096 MiB")
	}
	if value.RetentionDays < 0 || value.RetentionMaxBytes < 0 {
		return errors.New("retention limits cannot be negative")
	}
	if value.ProbeTimeoutSeconds < 0 || value.ProbeTimeoutSeconds > 300 {
		return errors.New("probe timeout must be 0-300 seconds")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.state.Settings = value
	return s.persistLocked()
}

func (s *Store) Policies() []Policy {
	s.mu.RLock()
	defer s.mu.RUnlock()
	result := make([]Policy, 0, len(s.state.Policies))
	for _, value := range s.state.Policies {
		result = append(result, value)
	}
	slices.SortFunc(result, func(a, b Policy) int {
		if compared := strings.Compare(a.Name, b.Name); compared != 0 {
			return compared
		}
		return b.Version - a.Version
	})
	return result
}

func (s *Store) Policy(id string) (Policy, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	value, ok := s.state.Policies[id]
	return value, ok
}

func (s *Store) SavePolicy(value Policy) error {
	if strings.TrimSpace(value.Name) == "" {
		return errors.New("policy name required")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if current, ok := s.state.Policies[value.ID]; ok {
		value.Version = current.Version + 1
	} else {
		value.ID, value.Version = NewID("policy"), 1
	}
	value.CreatedAt = time.Now().UTC()
	s.state.Policies[value.ID] = value
	return s.persistLocked()
}

func (s *Store) Profiles() []TestProfile {
	s.mu.RLock()
	defer s.mu.RUnlock()
	result := make([]TestProfile, 0, len(s.state.Profiles))
	for _, value := range s.state.Profiles {
		result = append(result, value)
	}
	slices.SortFunc(result, func(a, b TestProfile) int {
		if a.BuiltIn != b.BuiltIn {
			if a.BuiltIn {
				return -1
			}
			return 1
		}
		return strings.Compare(a.Name, b.Name)
	})
	return result
}

func (s *Store) Profile(id string) (TestProfile, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	value, ok := s.state.Profiles[id]
	return value, ok
}

func (s *Store) SaveProfile(value TestProfile) (TestProfile, error) {
	if strings.TrimSpace(value.Name) == "" {
		return TestProfile{}, errors.New("profile name required")
	}
	switch value.Kind {
	case TestSMARTShort, TestSMARTLong, TestSMARTConvey, TestSpeed, TestSurfaceRead, TestDestructive:
	default:
		return TestProfile{}, errors.New("invalid test kind")
	}
	if value.BlockSizeKiB < 4 || value.BlockSizeKiB > 16*1024 ||
		value.QueueDepth < 1 || value.QueueDepth > 128 {
		return TestProfile{}, errors.New("block size or queue depth is outside safe limits")
	}
	if value.DurationSeconds < 0 || value.DurationSeconds > 24*60*60 ||
		value.RateMiB < 0 || value.RateMiB > 100_000 {
		return TestProfile{}, errors.New("duration or rate limit is outside safe limits")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if current, ok := s.state.Profiles[value.ID]; ok && current.BuiltIn {
		return TestProfile{}, errors.New("built-in profiles cannot be overwritten")
	}
	if value.ID == "" {
		value.ID = NewID("profile")
	}
	value.BuiltIn, value.Enabled, value.CreatedAt = false, true, time.Now().UTC()
	s.state.Profiles[value.ID] = value
	return value, s.persistLocked()
}

func (s *Store) SaveJob(job Job) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.state.Jobs[job.ID] = job
	return s.persistLocked()
}

func (s *Store) DeleteIncompleteJob(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	job, ok := s.state.Jobs[id]
	if !ok {
		return ErrNotFound
	}
	if job.Status != JobFailed && job.Status != JobCancelled && job.Status != JobInterrupted {
		return errors.New("only failed, cancelled, or interrupted jobs can be deleted")
	}
	delete(s.state.Jobs, id)
	return s.persistLocked()
}

func (s *Store) Job(id string) (Job, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	value, ok := s.state.Jobs[id]
	return value, ok
}

func (s *Store) Jobs() []Job {
	s.mu.RLock()
	defer s.mu.RUnlock()
	result := make([]Job, 0, len(s.state.Jobs))
	for _, value := range s.state.Jobs {
		result = append(result, value)
	}
	slices.SortFunc(result, func(a, b Job) int {
		if a.CreatedAt.After(b.CreatedAt) {
			return -1
		}
		return 1
	})
	return result
}

func (s *Store) RecoverJobs() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	changed := false
	for id, job := range s.state.Jobs {
		if job.Status == JobRunning || job.Status == JobValidating || job.Status == JobPauseRequested {
			job.Status, job.Error = JobInterrupted, "Daemon restarted while the test was active"
			s.state.Jobs[id], changed = job, true
		}
	}
	if changed {
		return s.persistLocked()
	}
	return nil
}

func (s *Store) SaveReport(report Report) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.state.Reports[report.ID] = report
	return s.persistLocked()
}

func (s *Store) Report(id string) (Report, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	value, ok := s.state.Reports[id]
	return value, ok
}

func (s *Store) Reports() []Report {
	s.mu.RLock()
	defer s.mu.RUnlock()
	result := make([]Report, 0, len(s.state.Reports))
	for _, value := range s.state.Reports {
		result = append(result, value)
	}
	slices.SortFunc(result, func(a, b Report) int {
		if a.CreatedAt.After(b.CreatedAt) {
			return -1
		}
		return 1
	})
	return result
}

func (s *Store) ApplyRetention(dataDir string) (int, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	settings := s.state.Settings
	if settings.RetentionDays <= 0 && settings.RetentionMaxBytes <= 0 {
		return 0, nil
	}
	type candidate struct {
		report Report
		size   int64
	}
	items := make([]candidate, 0, len(s.state.Reports))
	var total int64
	for _, value := range s.state.Reports {
		info, _ := os.Stat(value.Path)
		var size int64
		if info != nil {
			size = info.Size()
		}
		total += size
		items = append(items, candidate{report: value, size: size})
	}
	slices.SortFunc(items, func(a, b candidate) int {
		if a.report.CreatedAt.Before(b.report.CreatedAt) {
			return -1
		}
		return 1
	})
	cutoff := time.Time{}
	if settings.RetentionDays > 0 {
		cutoff = time.Now().UTC().AddDate(0, 0, -settings.RetentionDays)
	}
	removed := 0
	reportDir := filepath.Clean(filepath.Join(dataDir, "reports")) + string(os.PathSeparator)
	for _, item := range items {
		tooOld := !cutoff.IsZero() && item.report.CreatedAt.Before(cutoff)
		tooLarge := settings.RetentionMaxBytes > 0 && total > settings.RetentionMaxBytes
		if !tooOld && !tooLarge {
			continue
		}
		clean := filepath.Clean(item.report.Path)
		if !strings.HasPrefix(clean, reportDir) {
			return removed, errors.New("refusing to remove a report outside the report directory")
		}
		_ = os.Remove(clean)
		_ = os.Remove(clean + ".sha256")
		_ = os.Remove(strings.TrimSuffix(clean, ".pdf") + ".json")
		delete(s.state.Reports, item.report.ID)
		total -= item.size
		removed++
		s.state.Audit = append(s.state.Audit, AuditEvent{
			ID: NewID("audit"), At: time.Now().UTC(), Action: "retention.report_delete",
			Target: item.report.ID,
		})
	}
	if removed > 0 {
		return removed, s.persistLocked()
	}
	return 0, nil
}
