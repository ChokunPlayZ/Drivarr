import React from 'react';
import { Device, Job } from '../types';
import { StatusChip } from './StatusChip';
import { fmtBytes, historyAssessment, smartSelfTestLabel, deviceURL } from '../api';

interface DeviceCardProps {
  device: Device;
  jobs: Job[];
  role: string;
  onOpen: (id: string) => void;
  onTest: (device: Device) => void;
  onReport: (id: string) => void;
  onRetry: (id: string) => void;
}

export const DeviceCard: React.FC<DeviceCardProps> = ({
  device,
  jobs,
  role,
  onOpen,
  onTest,
  onReport,
  onRetry,
}) => {
  const probe = device.probe || {};
  const history = historyAssessment(probe);
  const testCount = jobs.filter((j) => j.deviceId === device.id).length;

  const facts: [string, string][] = [
    ['Serial', probe.serial || '—'],
    ['Capacity', fmtBytes(probe.capacityBytes)],
    ['Drive interface', probe.deviceInterface || '—'],
    ['Recording type', probe.recordingType || '—'],
    ['Temperature', probe.temperatureC ? `${probe.temperatureC} °C` : '—'],
    ['SMART', probe.smartAvailable ? (probe.smartPassed ? 'Passed' : 'Failed') : 'Unavailable'],
    ['Power-on hours', probe.powerOnHours ? probe.powerOnHours.toLocaleString() : '—'],
    ['Pending sectors', probe.pendingSectors !== undefined ? String(probe.pendingSectors) : '—'],
    ['FARM', probe.farmAvailable ? 'Available' : 'Unavailable'],
    ['SMART history', history.label],
  ];

  return (
    <article className="device-card">
      <div className="device-title">
        <div>
          <h3>{probe.model || device.name || device.id}</h3>
          <a
            className="path-link"
            href={deviceURL(device.id)}
            onClick={(e) => {
              e.preventDefault();
              onOpen(device.id);
            }}
            title="Open full-screen drive workspace"
          >
            {device.path} <span>OPEN ↗</span>
          </a>
        </div>
        <StatusChip value={device.status} />
      </div>

      <div className="facts">
        {facts.map(([label, value]) => (
          <div className="fact" key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
          </div>
        ))}
      </div>

      {probe.smartSelfTest && (
        <div className="smart-test-banner">
          <StatusChip value="running" />
          <div>
            <strong>{smartSelfTestLabel(probe.smartSelfTest)}</strong>
            <small>Detected from the drive firmware</small>
          </div>
        </div>
      )}

      {device.reason && <p className="reason">{device.reason}</p>}

      {role !== 'viewer' && (
        <div className="card-actions">
          <button className="filled" onClick={() => onTest(device)}>
            Run test
          </button>
          {testCount > 0 && (
            <button className="tonal" onClick={() => onReport(device.id)}>
              Full report ({testCount})
            </button>
          )}
          {device.status === 'quarantined' && (
            <button className="tonal" onClick={() => onRetry(device.id)}>
              Retry probe
            </button>
          )}
        </div>
      )}
    </article>
  );
};
