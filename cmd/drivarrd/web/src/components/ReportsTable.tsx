import React from 'react';
import { Report } from '../types';
import { StatusChip } from './StatusChip';
import { fmtDate, reportDownloadURL } from '../api';

interface ReportsTableProps {
  reports: Report[];
  onVerify: (id: string) => void;
}

export const ReportsTable: React.FC<ReportsTableProps> = ({ reports, onVerify }) => {
  if (!reports.length) {
    return <div className="empty">Generate a PDF from a completed test.</div>;
  }

  return (
    <table>
      <thead>
        <tr>
          <th>Report</th>
          <th>Coverage</th>
          <th>Verdict</th>
          <th>Created</th>
          <th>Integrity</th>
          <th>Download</th>
        </tr>
      </thead>
      <tbody>
        {reports.map((report) => (
          <tr key={report.id}>
            <td>
              <strong>{report.id}</strong>
            </td>
            <td>
              {report.scope === 'drive'
                ? `Full drive · ${report.testCount} test${report.testCount === 1 ? '' : 's'}`
                : report.jobId}
            </td>
            <td>
              <StatusChip value={report.verdict === 'pass' ? 'completed' : report.verdict}>
                {report.verdict}
              </StatusChip>
            </td>
            <td>{fmtDate(report.createdAt)}</td>
            <td>
              <button onClick={() => onVerify(report.id)}>Verify</button>
            </td>
            <td>
              <a href={reportDownloadURL(report.id)}>PDF</a> ·{' '}
              <a href={`/api/v1/reports/${encodeURIComponent(report.id)}/checksum`}>SHA-256</a>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
};
