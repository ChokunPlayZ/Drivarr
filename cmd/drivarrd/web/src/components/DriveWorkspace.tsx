import React, { useRef, useEffect, useState, useMemo } from 'react';
import { Device, Job } from '../types';
import { StatusChip } from './StatusChip';
import { JobActions } from './JobActions';
import { SurfaceMap } from './SurfaceMap';
import { fmtBytes, fmtSpeed, fmtDate, statusLabel, historyAssessment, flattenFARM, smartSelfTestLabel } from '../api';

interface DriveWorkspaceProps {
  device: Device;
  jobs: Job[];
  role: string;
  initialJobId?: string | null;
  onClose: () => void;
  onAction: (job: Job, action: string) => void;
  onReport: (id: string) => void;
}

function DataSection({ eyebrow, title, meta, children }: { eyebrow: string; title: string; meta: string; children: React.ReactNode }) {
  return (
    <section className="workspace-section">
      <div className="workspace-section-head">
        <div>
          <p className="eyebrow">{eyebrow}</p>
          <h3>{title}</h3>
        </div>
        <span>{meta}</span>
      </div>
      <div className="table-card">{children}</div>
    </section>
  );
}

export const DriveWorkspace: React.FC<DriveWorkspaceProps> = ({
  device,
  jobs,
  role,
  initialJobId,
  onClose,
  onAction,
  onReport,
}) => {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const driveJobs = useMemo(() => jobs.filter((job) => job.deviceId === device.id), [jobs, device.id]);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    const preferred =
      driveJobs.find((job) => job.id === initialJobId)?.id ||
      driveJobs.find((job) => ['running', 'paused', 'validating'].includes(job.status))?.id ||
      driveJobs[0]?.id ||
      null;

    setSelectedId((current) =>
      driveJobs.some((job) => job.id === initialJobId)
        ? initialJobId!
        : driveJobs.some((job) => job.id === current)
        ? current
        : preferred
    );
  }, [driveJobs, initialJobId]);

  useEffect(() => {
    dialogRef.current?.showModal();
    return () => dialogRef.current?.close();
  }, []);

  const probe = device.probe || {};
  const selected = driveJobs.find((job) => job.id === (initialJobId || selectedId)) || driveJobs[0] || null;
  const surface =
    driveJobs.find((job) => job.kind === 'surface_read' && ['running', 'paused'].includes(job.status)) ||
    driveJobs.find((job) => job.kind === 'surface_read');

  const assessment = historyAssessment(probe);
  const farm = flattenFARM(probe.farm);
  const percent = Math.max(0, Math.min(100, (selected?.progress || 0) * 100));

  if (initialJobId && selected) {
    return (
      <dialog ref={dialogRef} className="test-detail-dialog" aria-labelledby="test-detail-title" onClose={onClose}>
        <div className="test-detail-head">
          <div>
            <p className="eyebrow">Test details</p>
            <h2 id="test-detail-title">{selected.profileName || statusLabel(selected.kind)}</h2>
            <p>{probe.model || device.name || device.id} · {device.path}</p>
          </div>
          <button className="icon-button" aria-label="Close test details" onClick={onClose}>
            ×
          </button>
        </div>

        <div className="test-detail-body">
          <div className="test-result-hero">
            <div>
              <StatusChip value={selected.status} />
              <h3>{percent.toFixed(1)}% complete</h3>
              <p>{selected.currentPhase || selected.error || 'No additional result details'}</p>
            </div>
            <progress
              className="test-detail-progress"
              aria-label={`${statusLabel(selected.kind)} progress`}
              max="100"
              value={percent}
            >
              {percent.toFixed(1)}%
            </progress>
          </div>

          <div className="test-detail-grid">
            {[
              ['Started', fmtDate(selected.startedAt || selected.createdAt)],
              ['Finished', fmtDate(selected.finishedAt)],
              ['Data checked', `${fmtBytes(selected.completedBytes)} / ${fmtBytes(selected.totalBytes)}`],
              ['Read speed', fmtSpeed(selected.readBps)],
              ['Random read', selected.readIops ? `${selected.readIops.toFixed(1)} IOPS` : '—'],
              ['Errors', String(selected.errors?.length || 0)],
            ].map(([label, value]) => (
              <div key={label}>
                <span>{label}</span>
                <strong>{value}</strong>
              </div>
            ))}
          </div>

          {selected.error && <p className="test-error">{selected.error}</p>}

          <JobActions job={selected} role={role} onAction={onAction} verbose />

          {selected.kind === 'surface_read' && (
            <section className="test-map">
              <div>
                <p className="eyebrow">Media result</p>
                <h3>Sector map</h3>
              </div>
              <SurfaceMap job={selected} />
            </section>
          )}
        </div>
      </dialog>
    );
  }

  return (
    <dialog ref={dialogRef} className="drive-workspace" aria-labelledby="workspace-title" onClose={onClose}>
      <div className="workspace-bar">
        <div>
          <p className="eyebrow">Live drive workspace</p>
          <h2 id="workspace-title">{probe.model || device.name || device.id}</h2>
          <p className="workspace-path">
            {device.path} · {probe.protocol || 'unknown protocol'} · {fmtBytes(probe.capacityBytes)}
          </p>
        </div>
        <div className="workspace-bar-actions">
          <StatusChip value={device.status} />
          <button className="icon-button" aria-label="Close full-screen drive view" onClick={onClose}>
            ×
          </button>
        </div>
      </div>

      <div className="workspace-content">
        <div className="workspace-hero">
          <section className="workspace-panel">
            <p className="eyebrow">Drive condition</p>
            <h3>{probe.model || device.name || device.id}</h3>
            <p className="supporting">
              Serial {probe.serial || 'unavailable'} · firmware {probe.firmware || 'unavailable'} · collected {fmtDate(probe.collectedAt)}
            </p>
            <div className="workspace-overview">
              {[
                ['SMART health', probe.smartAvailable ? (probe.smartPassed ? 'Passed' : 'Failed') : 'Unavailable'],
                ['Drive interface', probe.deviceInterface || '—'],
                ['Recording type', probe.recordingType || '—'],
                ['Temperature', probe.temperatureC ? `${probe.temperatureC} °C` : '—'],
                ['Power-on hours', probe.powerOnHours ? probe.powerOnHours.toLocaleString() : '—'],
                ['Pending sectors', probe.pendingSectors !== undefined ? String(probe.pendingSectors) : '—'],
                ['Reallocated', probe.reallocatedSectors !== undefined ? String(probe.reallocatedSectors) : '—'],
                ['Uncorrectable', probe.uncorrectableSectors !== undefined ? String(probe.uncorrectableSectors) : '—'],
              ].map(([label, value]) => (
                <div className="fact" key={label}>
                  <span>{label}</span>
                  <strong className={label === 'SMART health' && probe.smartPassed === false ? 'bad' : ''}>
                    {value}
                  </strong>
                </div>
              ))}
            </div>

            {probe.smartSelfTest && (
              <div className="smart-test-banner workspace-smart-test">
                <StatusChip value="running" />
                <div>
                  <strong>{smartSelfTestLabel(probe.smartSelfTest)}</strong>
                  <small>{probe.smartSelfTest.status || 'Detected from drive firmware'}</small>
                </div>
              </div>
            )}
          </section>

          <section className="workspace-panel">
            <div className="workspace-section-head">
              <div>
                <p className="eyebrow">Live progress</p>
                <h3>Selected test</h3>
              </div>
              {driveJobs.length > 1 && (
                <label className="job-selector">
                  View test
                  <select value={selected?.id || ''} onChange={(e) => setSelectedId(e.target.value)}>
                    {driveJobs.map((job) => (
                      <option key={job.id} value={job.id}>
                        {job.id} · {statusLabel(job.status)} · {statusLabel(job.kind)}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>

            {selected ? (
              <div className="live-progress">
                <div className="progress-ring">
                  <strong>{percent.toFixed(1)}%</strong>
                  <span>complete</span>
                  <progress
                    className="detail-progress"
                    aria-label={`${statusLabel(selected.kind)} progress`}
                    max="100"
                    value={percent}
                  >
                    {percent.toFixed(1)}%
                  </progress>
                </div>

                <div>
                  <StatusChip value={selected.status} />
                  <h3>{selected.profileName || statusLabel(selected.kind)}</h3>
                  <p className="supporting">{selected.currentPhase || selected.error || 'Waiting for worker update'}</p>

                  <div className="job-detail-list">
                    <div className="job-detail">
                      <span>Checked</span>
                      <strong>{fmtBytes(selected.completedBytes)} / {fmtBytes(selected.totalBytes)}</strong>
                    </div>
                    <div className="job-detail">
                      <span>Performance</span>
                      <strong>{fmtSpeed(selected.readBps)}</strong>
                    </div>
                    <div className="job-detail">
                      <span>Sector errors</span>
                      <strong>{selected.errors?.length || 0}</strong>
                    </div>
                  </div>

                  <JobActions job={selected} role={role} onAction={onAction} verbose />
                </div>
              </div>
            ) : (
              <div className="workspace-empty">No test is associated with this drive.</div>
            )}
          </section>
        </div>

        <section className="workspace-panel workspace-section">
          <div className="workspace-section-head">
            <div>
              <p className="eyebrow">Real-time media view</p>
              <h3>Full sector map</h3>
            </div>
            <span>Mapped from durable byte checkpoints and sector errors</span>
          </div>
          <SurfaceMap job={surface} />
        </section>

        <section className={`workspace-section integrity-card ${assessment.kind}`}>
          <h3>{assessment.label}</h3>
          {assessment.evidence.map((item) => (
            <p key={item}>• {item}</p>
          ))}
          <p>
            <strong>Heuristic only:</strong> conflicting counters can indicate a reset but do not prove intentional wiping.
          </p>
        </section>

        <DataSection
          eyebrow="Complete device log"
          title="SMART attribute table"
          meta={`${probe.smartAttributes?.length || 0} attributes · updated ${fmtDate(probe.collectedAt)}`}
        >
          <table className="smart-full-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>Attribute</th>
                <th>Current</th>
                <th>Worst</th>
                <th>Threshold</th>
                <th>Raw value</th>
                <th>Failed</th>
              </tr>
            </thead>
            <tbody>
              {probe.smartAttributes?.length ? (
                probe.smartAttributes.map((attribute) => (
                  <tr key={attribute.id}>
                    <td>{attribute.id}</td>
                    <td>{attribute.name}</td>
                    <td>{attribute.current}</td>
                    <td>{attribute.worst}</td>
                    <td>{attribute.threshold}</td>
                    <td>{attribute.rawString || attribute.rawValue}</td>
                    <td>{attribute.whenFailed || '—'}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={7}>The current device snapshot does not include SMART attributes.</td>
                </tr>
              )}
            </tbody>
          </table>
        </DataSection>

        <DataSection
          eyebrow="Complete device log"
          title="Seagate FARM table"
          meta={`${farm.length} scalar metrics`}
        >
          <table className="farm-table">
            <thead>
              <tr>
                <th>Metric path</th>
                <th>Value</th>
                <th>Source</th>
              </tr>
            </thead>
            <tbody>
              {farm.length ? (
                farm.map(([metric, value]) => (
                  <tr key={metric}>
                    <td>{metric.replaceAll('.', ' › ')}</td>
                    <td>{value}</td>
                    <td>
                      <span className="source-chip">FARM log</span>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={3}>
                    {probe.farmAvailable
                      ? 'The FARM log was returned without displayable scalar fields.'
                      : 'FARM is unavailable for this device.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </DataSection>

        <section className="workspace-section">
          <div className="workspace-section-head">
            <div>
              <p className="eyebrow">Evidence timeline</p>
              <h3>All tests for this drive</h3>
            </div>
            <div className="actions">
              {driveJobs.length > 0 && role !== 'viewer' && (
                <button className="filled" onClick={() => onReport(device.id)}>
                  Generate full PDF ({driveJobs.length} tests)
                </button>
              )}
              <span>{driveJobs.length} retained job{driveJobs.length === 1 ? '' : 's'}</span>
            </div>
          </div>

          <div className="table-card">
            <table>
              <thead>
                <tr>
                  <th>Job</th>
                  <th>Test</th>
                  <th>Status</th>
                  <th>Progress</th>
                  <th>Phase</th>
                  <th>Performance</th>
                </tr>
              </thead>
              <tbody>
                {driveJobs.length ? (
                  driveJobs.map((job) => (
                    <tr key={job.id}>
                      <td>{job.id}</td>
                      <td>{statusLabel(job.kind)}</td>
                      <td>
                        <StatusChip value={job.status} />
                      </td>
                      <td>{((job.progress || 0) * 100).toFixed(1)}%</td>
                      <td>{job.currentPhase || job.error || '—'}</td>
                      <td>{fmtSpeed(job.readBps)}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={6}>No tests have been run on this drive.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </dialog>
  );
};
