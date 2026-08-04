import React from 'react';
import { Job } from '../types';
import { fmtBytes, fmtSpeed } from '../api';

interface SurfaceMapProps {
  job?: Job;
}

export const SurfaceMap: React.FC<SurfaceMapProps> = ({ job }) => {
  if (!job) {
    return <div className="workspace-empty">No surface scan has been run on this drive.</div>;
  }

  const cells = 384;
  const progress = Math.max(0, Math.min(1, job.progress || 0));
  const current = Math.min(cells - 1, Math.floor(progress * cells));
  const bad = new Set<number>();
  const total = Math.max(1, job.totalBytes || 1);

  for (const error of job.errors || []) {
    const first = Math.max(0, Math.floor((error.offset / total) * cells));
    const last = Math.min(cells - 1, Math.floor(((error.offset + Math.max(1, error.length)) / total) * cells));
    for (let cell = first; cell <= last; cell++) {
      bad.add(cell);
    }
  }

  return (
    <>
      <div className="map-meta">
        <span>
          <strong>{(progress * 100).toFixed(1)}%</strong> scanned
        </span>
        <span>
          <strong>{fmtBytes(job.completedBytes)}</strong> of {fmtBytes(job.totalBytes)}
        </span>
        <span>
          <strong>{fmtSpeed(job.readBps)}</strong> current rate
        </span>
        <span>
          <strong>{bad.size}</strong> affected ranges
        </span>
        <span>{job.id}</span>
      </div>

      <div className="drive-map" role="img" aria-label="Full surface scan block map">
        {Array.from({ length: cells }, (_, index) => {
          const type = bad.has(index)
            ? 'bad'
            : index > current
            ? 'pending'
            : index === current && progress < 1
            ? 'current'
            : 'good';
          const start = Math.floor((index / cells) * total);
          const end = Math.floor(((index + 1) / cells) * total);

          return (
            <i
              key={index}
              className={`map-${type}`}
              title={`${fmtBytes(start)}–${fmtBytes(end)} · ${type === 'bad' ? 'unreadable' : type}`}
            />
          );
        })}
      </div>

      <div className="map-legend">
        <span>
          <i className="map-good" /> Read successfully
        </span>
        <span>
          <i className="map-current" /> Current range
        </span>
        <span>
          <i className="map-bad" /> Unreadable
        </span>
        <span>
          <i className="map-pending" /> Not scanned
        </span>
      </div>
    </>
  );
};
