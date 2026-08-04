import React from 'react';
import { Settings, User, AuditEvent } from '../types';
import { fmtDate } from '../api';

interface AdminPanelProps {
  settings: Settings | null;
  users: User[];
  audit: AuditEvent[];
  onSettings: (form: HTMLFormElement) => Promise<void>;
  onUser: (form: HTMLFormElement) => Promise<void>;
  onPassword: (form: HTMLFormElement) => Promise<void>;
  onProfile: (form: HTMLFormElement) => Promise<void>;
  onPolicy: (form: HTMLFormElement) => Promise<void>;
}

function NumberField({ label, name, min, max, value }: { label: string; name: string; min: string; max?: string; value: any }) {
  return (
    <label>
      {label}
      <input name={name} type="number" min={min} max={max} defaultValue={value} />
    </label>
  );
}

function ResetForm({ onSubmit, children, className }: { onSubmit: (form: HTMLFormElement) => Promise<void>; children: React.ReactNode; className: string }) {
  return (
    <form
      className={className}
      onSubmit={async (e) => {
        e.preventDefault();
        await onSubmit(e.currentTarget);
        e.currentTarget.reset();
      }}
    >
      {children}
    </form>
  );
}

export const AdminPanel: React.FC<AdminPanelProps> = ({
  settings,
  users,
  audit,
  onSettings,
  onUser,
  onPassword,
  onProfile,
  onPolicy,
}) => {
  if (!settings) return null;

  return (
    <>
      <div className="section-heading">
        <div>
          <p className="eyebrow">System</p>
          <h2>Administration</h2>
        </div>
      </div>

      <div className="admin-grid">
        <form
          className="panel"
          onSubmit={(e) => {
            e.preventDefault();
            onSettings(e.currentTarget);
          }}
        >
          <h3>Testing policy</h3>
          <label>
            Organization
            <input name="organization" required defaultValue={settings.organization} />
          </label>
          <NumberField label="Concurrent jobs" name="maxConcurrentJobs" min="1" max="32" value={settings.maxConcurrentJobs} />
          <NumberField label="Destructive concurrency" name="maxDestructiveJobs" min="1" max="32" value={settings.maxDestructiveJobs} />
          <NumberField label="Chunk size (MiB)" name="jobChunkMiB" min="16" max="4096" value={settings.jobChunkMiB} />
          <NumberField label="Report retention days (0 = forever)" name="retentionDays" min="0" value={settings.retentionDays} />
          <NumberField label="Report storage limit in bytes (0 = unlimited)" name="retentionMaxBytes" min="0" value={settings.retentionMaxBytes} />

          <label className="check">
            <input name="destructiveEnabled" type="checkbox" defaultChecked={settings.destructiveEnabled} />
            Enable destructive verification
          </label>

          <button className="filled" type="submit">
            Save settings
          </button>
        </form>

        <ResetForm className="panel" onSubmit={onUser}>
          <h3>Add user</h3>
          <label>
            Username
            <input name="username" minLength={3} required />
          </label>
          <label>
            Temporary password
            <input name="password" type="password" minLength={12} required />
          </label>
          <label>
            Role
            <select name="role" defaultValue="viewer">
              <option value="viewer">Viewer</option>
              <option value="operator">Operator</option>
              <option value="admin">Administrator</option>
            </select>
          </label>
          <button className="filled" type="submit">
            Create user
          </button>

          <div>
            {users.map((u) => (
              <div className="user-row" key={u.id || u.username}>
                <span>{u.username}</span>
                <small>{u.role}</small>
              </div>
            ))}
          </div>
        </ResetForm>

        <ResetForm className="panel" onSubmit={onPassword}>
          <h3>Change my password</h3>
          <label>
            Current password
            <input name="currentPassword" type="password" required />
          </label>
          <label>
            New password
            <input name="newPassword" type="password" minLength={12} required />
          </label>
          <button className="filled" type="submit">
            Change password
          </button>
        </ResetForm>

        <ResetForm className="panel" onSubmit={onProfile}>
          <h3>Create advanced test profile</h3>
          <label>
            Name
            <input name="name" required />
          </label>
          <label>
            Test type
            <select name="kind" defaultValue="speed">
              <option value="speed">Speed test</option>
              <option value="surface_read">Surface read</option>
              <option value="destructive_verify">Destructive verification</option>
            </select>
          </label>
          <NumberField label="Block size (KiB)" name="blockSizeKiB" min="4" max="16384" value="1024" />
          <NumberField label="Queue depth" name="queueDepth" min="1" max="128" value="1" />
          <NumberField label="Duration seconds" name="durationSeconds" min="0" max="86400" value="15" />
          <NumberField label="Rate limit MiB/s (0 = unlimited)" name="rateMiB" min="0" value="0" />
          <button className="filled" type="submit">
            Create profile
          </button>
        </ResetForm>

        <ResetForm className="panel" onSubmit={onPolicy}>
          <h3>Create grading policy</h3>
          <label>
            Name
            <input name="name" required />
          </label>
          <label className="check">
            <input name="failOnSmart" type="checkbox" defaultChecked />
            Fail on SMART health failure
          </label>
          <label className="check">
            <input name="failOnIoError" type="checkbox" defaultChecked />
            Fail on scan I/O error
          </label>
          <NumberField label="Warn when pending sectors exceed" name="warnPendingAbove" min="0" value="0" />
          <NumberField label="Warn when reallocated sectors exceed" name="warnReallocatedAbove" min="0" value="0" />
          <NumberField label="Warn when uncorrectable sectors exceed" name="warnUncorrectableAbove" min="0" value="0" />
          <button className="filled" type="submit">
            Create policy
          </button>
        </ResetForm>
      </div>

      <div className="section-heading">
        <div>
          <p className="eyebrow">Accountability</p>
          <h2>Audit log</h2>
        </div>
      </div>

      <div className="table-card">
        <table>
          <thead>
            <tr>
              <th>Time</th>
              <th>Action</th>
              <th>User</th>
              <th>Target</th>
            </tr>
          </thead>
          <tbody>
            {audit.map((event, index) => (
              <tr key={`${event.at}-${event.action}-${index}`}>
                <td>{fmtDate(event.at)}</td>
                <td>{event.action}</td>
                <td>{event.userId || 'system'}</td>
                <td>{event.target || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
};
