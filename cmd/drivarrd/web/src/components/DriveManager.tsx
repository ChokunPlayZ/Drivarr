import React from 'react';
import { Device, Job, Profile, Settings } from '../types';
import { StatusChip } from './StatusChip';
import { fmtBytes, fmtDate, statusLabel, smartSelfTestLabel } from '../api';

const activeStatuses = ['queued', 'validating', 'running', 'pause_requested'];
const finishedStatuses = ['completed', 'completed_with_warnings', 'failed', 'cancelled', 'interrupted'];

const testDescriptions: Record<string, string> = {
  smart_short: 'Quick firmware health check',
  smart_long: 'Thorough firmware self-test',
  smart_conveyance: 'Checks for shipping damage',
  speed: 'Read speed and random IOPS',
  surface_read: 'Reads every sector without writing',
  destructive_verify: 'Erases and verifies the entire drive',
};

interface DriveManagerProps {
  device: Device;
  jobs: Job[];
  profiles: Profile[];
  settings: Settings | null;
  role: string;
  onOpen: (id: string, jobId?: string | null) => void;
  onRun: (device: Device, profileId: string) => void;
  onAction: (job: Job, action: string) => void;
  onReport: (id: string) => void;
  onRetry: (id: string) => void;
}

function TestState({ job }: { job?: Job }) {
  if (!job) {
    return (
      <div className="test-state never">
        <strong>Not run yet</strong>
        <span>No result for this drive</span>
      </div>
    );
  }
  const percent = Math.max(0, Math.min(100, (job.progress || 0) * 100));
  const active = activeStatuses.includes(job.status) || job.status === 'paused';

  return (
    <div className={`test-state ${active ? 'active' : ''}`}>
      <StatusChip value={job.status} />
      <span>{active ? `${percent.toFixed(0)}% · ${job.currentPhase || 'In progress'}` : fmtDate(job.finishedAt || job.createdAt)}</span>
      {active && (
        <progress
          className="progress"
          aria-label={`${statusLabel(job.kind)} progress`}
          max="100"
          value={percent}
        />
      )}
    </div>
  );
}

export const DriveManager: React.FC<DriveManagerProps> = ({
  device,
  jobs,
  profiles,
  settings,
  role,
  onOpen,
  onRun,
  onAction,
  onReport,
  onRetry,
}) => {
  const probe = device.probe || {};
  const driveJobs = jobs.filter((j) => j.deviceId === device.id);
  const activeCount = driveJobs.filter((j) => activeStatuses.includes(j.status) || j.status === 'paused').length;

  const enabled = profiles.filter(
    (profile) =>
      profile.enabled &&
      (!profile.kind.startsWith('smart') || probe.smartAvailable) &&
      (profile.kind !== 'destructive_verify' || settings?.destructiveEnabled)
  );

  const latestProfileJob = (profile: Profile) => {
    return driveJobs.find((j) => j.profileId === profile.id) || driveJobs.find((j) => j.kind === profile.kind);
  };

  return (
    <article className={`drive-manager ${device.status === 'quarantined' ? 'is-quarantined' : ''}`}>
      <div className="drive-summary">
        <div className="drive-identity">
          <span className="drive-icon" aria-hidden="true">
            DRIVE
          </span>
          <div>
            <div className="drive-title-line">
              <h2>{probe.model || device.name || device.id}</h2>
              <StatusChip value={device.status} />
            </div>
            <p>
              {device.path} · {fmtBytes(probe.capacityBytes)} · {probe.deviceInterface || probe.protocol || 'Unknown interface'} · S/N {probe.serial || 'unavailable'}
            </p>
          </div>
        </div>

        <div className="drive-health">
          <div>
            <span>SMART</span>
            <strong className={probe.smartPassed === false ? 'bad' : ''}>
              {probe.smartAvailable ? (probe.smartPassed ? 'Passed' : 'Failed') : 'Unavailable'}
            </strong>
          </div>
          <div>
            <span>Temperature</span>
            <strong>{probe.temperatureC ? `${probe.temperatureC} °C` : '—'}</strong>
          </div>
          <div>
            <span>Tests</span>
            <strong>{activeCount ? `${activeCount} active` : `${driveJobs.length} run`}</strong>
          </div>
        </div>

        <div className="drive-menu">
          <button className="quiet-button" onClick={() => onOpen(device.id)}>
            Drive details
          </button>
          {driveJobs.length > 0 && role !== 'viewer' && (
            <button className="quiet-button" onClick={() => onReport(device.id)}>
              PDF report
            </button>
          )}
        </div>
      </div>

      {device.reason && (
        <div className="drive-warning">
          <span>{device.reason}</span>
          {device.status === 'quarantined' && role !== 'viewer' && (
            <button onClick={() => onRetry(device.id)}>Retry probe</button>
          )}
        </div>
      )}

      {probe.smartSelfTest && (
        <div className="firmware-run">
          <span className="pulse" />
          <strong>{smartSelfTestLabel(probe.smartSelfTest)}</strong>
          <span>Reported by drive firmware</span>
        </div>
      )}

      <div className="test-list" aria-label={`Available tests for ${probe.model || device.name}`}>
        <div className="test-list-head">
          <span>Available test</span>
          <span>Latest result</span>
          <span className="sr-only">Actions</span>
        </div>

        {enabled.map((profile) => {
          const job = latestProfileJob(profile);
          const busy = driveJobs.some((candidate) => activeStatuses.includes(candidate.status) || candidate.status === 'paused');
          const destructive = profile.kind === 'destructive_verify';
          const kindLabel = profile.kind.startsWith('smart')
            ? 'SMART'
            : profile.kind === 'speed'
            ? 'SPEED'
            : profile.kind === 'surface_read'
            ? 'READ'
            : 'ERASE';

          return (
            <div className={`test-row ${destructive ? 'destructive-row' : ''}`} key={profile.id}>
              <div className="test-name">
                <span className="test-symbol" aria-hidden="true">
                  {kindLabel}
                </span>
                <div>
                  <strong>{profile.name}</strong>
                  <span>{testDescriptions[profile.kind] || statusLabel(profile.kind)}</span>
                </div>
              </div>

              <TestState job={job} />

              <div className="test-actions">
                {job && (
                  <button
                    className="icon-detail"
                    aria-label={`View ${profile.name} details`}
                    onClick={() => onOpen(device.id, job.id)}
                  >
                    View
                  </button>
                )}
                {role !== 'viewer' && (
                  <button
                    className={destructive ? 'danger-button' : 'run-button'}
                    disabled={busy || device.status === 'quarantined'}
                    onClick={() => onRun(device, profile.id)}
                  >
                    {job && finishedStatuses.includes(job.status) ? 'Run again' : 'Run'}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {role !== 'viewer' && device.status !== 'quarantined' && probe.smartAvailable && (
        <div className="drive-footer">
          <div>
            <strong>Want the full check?</strong>
            <span>Speed, full surface scan, then extended SMART—run in order.</span>
          </div>
          <button
            className="primary-action"
            disabled={activeCount > 0}
            onClick={() => onRun(device, 'preset:complete-drive-check')}
          >
            Run complete check
          </button>
        </div>
      )}
    </article>
  );
};
