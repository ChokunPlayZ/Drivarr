package main

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"drivarr/internal/core"
	"drivarr/internal/report"
)

type userContextKey struct{}

func (a *api) registerApplicationRoutes(mux *http.ServeMux) {
	mux.HandleFunc("POST /api/v1/auth/login", a.login)
	mux.Handle("GET /api/v1/auth/session", a.require(a.session, core.RoleViewer, core.RoleOperator, core.RoleAdmin))
	mux.Handle("POST /api/v1/auth/logout", a.require(a.logout, core.RoleViewer, core.RoleOperator, core.RoleAdmin))
	mux.Handle("POST /api/v1/auth/password", a.require(a.changePassword, core.RoleViewer, core.RoleOperator, core.RoleAdmin))
	mux.Handle("GET /api/v1/users", a.require(a.users, core.RoleAdmin))
	mux.Handle("POST /api/v1/users", a.require(a.createUser, core.RoleAdmin))
	mux.Handle("GET /api/v1/settings", a.require(a.settings, core.RoleViewer, core.RoleOperator, core.RoleAdmin))
	mux.Handle("PUT /api/v1/settings", a.require(a.updateSettings, core.RoleAdmin))
	mux.Handle("GET /api/v1/policies", a.require(a.policies, core.RoleViewer, core.RoleOperator, core.RoleAdmin))
	mux.Handle("POST /api/v1/policies", a.require(a.savePolicy, core.RoleAdmin))
	mux.Handle("GET /api/v1/profiles", a.require(a.profiles, core.RoleViewer, core.RoleOperator, core.RoleAdmin))
	mux.Handle("POST /api/v1/profiles", a.require(a.saveProfile, core.RoleAdmin))
	mux.Handle("GET /api/v1/jobs", a.require(a.listJobs, core.RoleViewer, core.RoleOperator, core.RoleAdmin))
	mux.Handle("POST /api/v1/jobs", a.require(a.createJob, core.RoleOperator, core.RoleAdmin))
	mux.Handle("POST /api/v1/jobs/{id}/pause", a.require(a.pauseJob, core.RoleOperator, core.RoleAdmin))
	mux.Handle("POST /api/v1/jobs/{id}/resume", a.require(a.resumeJob, core.RoleOperator, core.RoleAdmin))
	mux.Handle("POST /api/v1/jobs/{id}/cancel", a.require(a.cancelJob, core.RoleOperator, core.RoleAdmin))
	mux.Handle("GET /api/v1/reports", a.require(a.listReports, core.RoleViewer, core.RoleOperator, core.RoleAdmin))
	mux.Handle("POST /api/v1/jobs/{id}/report", a.require(a.generateReport, core.RoleOperator, core.RoleAdmin))
	mux.Handle("POST /api/v1/devices/{id}/report", a.require(a.generateDriveReport, core.RoleOperator, core.RoleAdmin))
	mux.Handle("GET /api/v1/reports/{id}/download", a.require(a.downloadReport, core.RoleViewer, core.RoleOperator, core.RoleAdmin))
	mux.Handle("GET /api/v1/reports/{id}/checksum", a.require(a.downloadChecksum, core.RoleViewer, core.RoleOperator, core.RoleAdmin))
	mux.Handle("GET /api/v1/reports/{id}/verify", a.require(a.verifyReport, core.RoleViewer, core.RoleOperator, core.RoleAdmin))
	mux.Handle("GET /api/v1/audit", a.require(a.audit, core.RoleAdmin))
}

func (a *api) require(next http.HandlerFunc, roles ...core.Role) http.Handler {
	allowed := make(map[core.Role]bool)
	for _, role := range roles {
		allowed[role] = true
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		cookie, err := r.Cookie("drivarr_session")
		if err != nil {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "authentication required"})
			return
		}
		user, ok := a.store.Session(cookie.Value)
		if !ok || !allowed[user.Role] {
			writeJSON(w, http.StatusForbidden, map[string]string{"error": "permission denied"})
			return
		}
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			origin := r.Header.Get("Origin")
			if origin != "" && !sameOrigin(origin, r) {
				writeJSON(w, http.StatusForbidden, map[string]string{"error": "origin validation failed"})
				return
			}
		}
		next(w, r.WithContext(context.WithValue(r.Context(), userContextKey{}, user)))
	})
}

func sameOrigin(origin string, r *http.Request) bool {
	expectedScheme := "http"
	if r.TLS != nil {
		expectedScheme = "https"
	}
	return origin == expectedScheme+"://"+r.Host
}

func requestUser(r *http.Request) core.User {
	user, _ := r.Context().Value(userContextKey{}).(core.User)
	return user
}

func remoteIP(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err == nil {
		return host
	}
	return r.RemoteAddr
}

func decodeJSON(w http.ResponseWriter, r *http.Request, target any) bool {
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request: " + err.Error()})
		return false
	}
	return true
}

func (a *api) login(w http.ResponseWriter, r *http.Request) {
	var input struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}
	if !decodeJSON(w, r, &input) {
		return
	}
	user, token, err := a.store.Authenticate(input.Username, input.Password)
	if err != nil {
		time.Sleep(250 * time.Millisecond)
		a.store.Audit("", "auth.failure", input.Username, remoteIP(r), nil)
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "invalid username or password"})
		return
	}
	http.SetCookie(w, newSessionCookie(token, r.TLS != nil))
	w.Header().Set("Cache-Control", "no-store")
	a.store.Audit(user.ID, "auth.login", user.ID, remoteIP(r), nil)
	writeJSON(w, http.StatusOK, user)
}

func (a *api) session(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, requestUser(r))
}

func newSessionCookie(token string, secure bool) *http.Cookie {
	const lifetime = 12 * time.Hour
	return &http.Cookie{
		Name:     "drivarr_session",
		Value:    token,
		Path:     "/",
		HttpOnly: true,
		Secure:   secure,
		SameSite: http.SameSiteStrictMode,
		MaxAge:   int(lifetime / time.Second),
		Expires:  time.Now().UTC().Add(lifetime),
	}
}

func (a *api) logout(w http.ResponseWriter, r *http.Request) {
	if cookie, err := r.Cookie("drivarr_session"); err == nil {
		_ = a.store.Logout(cookie.Value)
	}
	http.SetCookie(w, &http.Cookie{Name: "drivarr_session", Path: "/", MaxAge: -1, HttpOnly: true})
	writeJSON(w, http.StatusOK, map[string]string{"status": "logged out"})
}

func (a *api) changePassword(w http.ResponseWriter, r *http.Request) {
	var input struct {
		CurrentPassword string `json:"currentPassword"`
		NewPassword     string `json:"newPassword"`
	}
	if !decodeJSON(w, r, &input) {
		return
	}
	user := requestUser(r)
	if err := a.store.ChangePassword(user.ID, input.CurrentPassword, input.NewPassword); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "current password is incorrect or the new password is invalid"})
		return
	}
	a.store.Audit(user.ID, "user.password_change", user.ID, remoteIP(r), nil)
	http.SetCookie(w, &http.Cookie{Name: "drivarr_session", Path: "/", MaxAge: -1, HttpOnly: true})
	writeJSON(w, http.StatusOK, map[string]string{"status": "password changed; sign in again"})
}

func (a *api) users(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"users": a.store.ListUsers()})
}

func (a *api) createUser(w http.ResponseWriter, r *http.Request) {
	var input struct {
		Username string    `json:"username"`
		Password string    `json:"password"`
		Role     core.Role `json:"role"`
	}
	if !decodeJSON(w, r, &input) {
		return
	}
	user, err := a.store.CreateUser(input.Username, input.Password, input.Role)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	actor := requestUser(r)
	a.store.Audit(actor.ID, "user.create", user.ID, remoteIP(r), map[string]any{"role": user.Role})
	user.PasswordHash, user.Salt = "", ""
	writeJSON(w, http.StatusCreated, user)
}

func (a *api) settings(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, a.store.Settings())
}

func (a *api) updateSettings(w http.ResponseWriter, r *http.Request) {
	var value core.Settings
	if !decodeJSON(w, r, &value) {
		return
	}
	if err := a.store.UpdateSettings(value); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	a.store.Audit(requestUser(r).ID, "settings.update", "system", remoteIP(r), nil)
	writeJSON(w, http.StatusOK, value)
}

func (a *api) policies(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"policies": a.store.Policies()})
}

func (a *api) savePolicy(w http.ResponseWriter, r *http.Request) {
	var value core.Policy
	if !decodeJSON(w, r, &value) {
		return
	}
	if err := a.store.SavePolicy(value); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	a.store.Audit(requestUser(r).ID, "policy.save", value.ID, remoteIP(r), nil)
	writeJSON(w, http.StatusCreated, value)
}

func (a *api) profiles(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"profiles": a.store.Profiles()})
}

func (a *api) saveProfile(w http.ResponseWriter, r *http.Request) {
	var value core.TestProfile
	if !decodeJSON(w, r, &value) {
		return
	}
	saved, err := a.store.SaveProfile(value)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	a.store.Audit(requestUser(r).ID, "profile.save", saved.ID, remoteIP(r), nil)
	writeJSON(w, http.StatusCreated, saved)
}

func (a *api) listJobs(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"jobs": a.store.Jobs()})
}

func (a *api) createJob(w http.ResponseWriter, r *http.Request) {
	var input struct {
		DeviceID           string        `json:"deviceId"`
		Kind               core.TestKind `json:"kind"`
		ProfileID          string        `json:"profileId"`
		PolicyID           string        `json:"policyId"`
		SerialConfirmation string        `json:"serialConfirmation"`
		ReauthPassword     string        `json:"reauthPassword"`
	}
	if !decodeJSON(w, r, &input) {
		return
	}
	device, ok := a.supervisor.Device(input.DeviceID)
	if !ok {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "device not found"})
		return
	}
	kind := input.Kind
	if profile, exists := a.store.Profile(input.ProfileID); exists {
		kind = profile.Kind
	}
	if kind == core.TestDestructive && !a.store.VerifyPassword(requestUser(r).ID, input.ReauthPassword) {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "password reauthentication failed"})
		return
	}
	job, err := a.jobs.Create(requestUser(r), device, input.Kind, input.ProfileID, input.PolicyID, input.SerialConfirmation)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusCreated, job)
}

func (a *api) pauseJob(w http.ResponseWriter, r *http.Request)  { a.jobAction(w, r, "pause") }
func (a *api) resumeJob(w http.ResponseWriter, r *http.Request) { a.jobAction(w, r, "resume") }
func (a *api) cancelJob(w http.ResponseWriter, r *http.Request) { a.jobAction(w, r, "cancel") }

func (a *api) jobAction(w http.ResponseWriter, r *http.Request, action string) {
	id := r.PathValue("id")
	var err error
	switch action {
	case "pause":
		err = a.jobs.Pause(id)
	case "resume":
		err = a.jobs.Resume(id)
	case "cancel":
		err = a.jobs.Cancel(id)
	}
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	a.store.Audit(requestUser(r).ID, "job."+action, id, remoteIP(r), nil)
	writeJSON(w, http.StatusAccepted, map[string]string{"status": action + " requested"})
}

func (a *api) listReports(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"reports": a.store.Reports()})
}

func (a *api) generateReport(w http.ResponseWriter, r *http.Request) {
	job, ok := a.store.Job(r.PathValue("id"))
	if !ok {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "job not found"})
		return
	}
	if job.Status != core.JobCompleted && job.Status != core.JobWarning && job.Status != core.JobFailed &&
		job.Status != core.JobCancelled && job.Status != core.JobInterrupted {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "job has not reached a reportable state"})
		return
	}
	device, _ := a.supervisor.Device(job.DeviceID)
	value, err := report.Generate(a.dataDir, a.store, job, device, requestUser(r))
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	a.store.Audit(requestUser(r).ID, "report.generate", value.ID, remoteIP(r), map[string]any{"job": job.ID})
	writeJSON(w, http.StatusCreated, value)
}

func (a *api) generateDriveReport(w http.ResponseWriter, r *http.Request) {
	deviceID := r.PathValue("id")
	device, ok := a.supervisor.Device(deviceID)
	if !ok {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "device not found"})
		return
	}
	allJobs := a.store.Jobs()
	deviceJobs := make([]core.Job, 0)
	for _, job := range allJobs {
		if job.DeviceID == deviceID {
			deviceJobs = append(deviceJobs, job)
		}
	}
	if len(deviceJobs) == 0 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "drive has no retained tests to report"})
		return
	}
	value, err := report.GenerateDrive(a.dataDir, a.store, device, deviceJobs, requestUser(r))
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	a.store.Audit(requestUser(r).ID, "report.generate_drive", value.ID, remoteIP(r), map[string]any{
		"device": deviceID, "tests": len(deviceJobs),
	})
	writeJSON(w, http.StatusCreated, value)
}

func (a *api) downloadReport(w http.ResponseWriter, r *http.Request) {
	value, ok := a.store.Report(r.PathValue("id"))
	if !ok {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Content-Type", "application/pdf")
	w.Header().Set("Content-Disposition", `attachment; filename="`+filepath.Base(value.Path)+`"`)
	http.ServeFile(w, r, value.Path)
}

func (a *api) downloadChecksum(w http.ResponseWriter, r *http.Request) {
	value, ok := a.store.Report(r.PathValue("id"))
	if !ok {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	_, _ = io.WriteString(w, value.PDFSHA256+"  "+filepath.Base(value.Path)+"\n")
}

func (a *api) verifyReport(w http.ResponseWriter, r *http.Request) {
	value, ok := a.store.Report(r.PathValue("id"))
	if !ok {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "report not found"})
		return
	}
	valid, err := report.Verify(value)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"valid": valid, "pdfSha256": value.PDFSHA256, "dataSha256": value.DataSHA256})
}

func (a *api) audit(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"events": a.store.AuditEvents(500)})
}

func securePathWithin(base, value string) bool {
	relative, err := filepath.Rel(base, value)
	return err == nil && relative != ".." && !strings.HasPrefix(relative, ".."+string(os.PathSeparator))
}

var _ = errors.Is
