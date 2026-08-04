import React from 'react';
import {
  Table,
  TableHead,
  TableRow,
  TableCell,
  TableBody,
  Button,
  Box,
  Typography,
  Paper,
  Link,
  Tooltip,
} from '@mui/material';
import PictureAsPdfIcon from '@mui/icons-material/PictureAsPdf';
import VerifiedUserIcon from '@mui/icons-material/VerifiedUser';
import KeyIcon from '@mui/icons-material/Key';
import { Report } from '../types';
import { StatusChip } from './StatusChip';
import { fmtDate, reportDownloadURL } from '../api';

interface ReportsTableProps {
  reports: Report[];
  onVerify: (id: string) => void;
}

export const ReportsTable: React.FC<ReportsTableProps> = ({ reports, onVerify }) => {
  if (!reports.length) {
    return (
      <Paper
        sx={{
          p: 6,
          textAlign: 'center',
          backgroundColor: 'rgba(255, 255, 255, 0.02)',
          border: '1px dashed rgba(255, 255, 255, 0.1)',
          borderRadius: 3,
        }}
      >
        <PictureAsPdfIcon sx={{ fontSize: 48, color: 'text.secondary', mb: 1, opacity: 0.5 }} />
        <Typography variant="h6" sx={{ fontWeight: 700 }}>
          No PDF reports generated yet
        </Typography>
        <Typography variant="body2" sx={{ color: 'text.secondary', mt: 0.5 }}>
          Generate a PDF report from a completed drive test or drive workspace.
        </Typography>
      </Paper>
    );
  }

  return (
    <Paper sx={{ overflowX: 'auto', borderRadius: 3 }}>
      <Table>
        <TableHead>
          <TableRow>
            <TableCell>Report ID</TableCell>
            <TableCell>Coverage Scope</TableCell>
            <TableCell>Verdict</TableCell>
            <TableCell>Created</TableCell>
            <TableCell>Integrity Check</TableCell>
            <TableCell align="right">Download</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {reports.map((report) => (
            <TableRow key={report.id} hover>
              <TableCell sx={{ fontFamily: 'monospace', fontWeight: 700 }}>{report.id}</TableCell>
              <TableCell>
                {report.scope === 'drive'
                  ? `Full drive · ${report.testCount} test${report.testCount === 1 ? '' : 's'}`
                  : report.jobId}
              </TableCell>
              <TableCell>
                <StatusChip value={report.verdict === 'pass' ? 'completed' : report.verdict} label={report.verdict} size="small" />
              </TableCell>
              <TableCell>{fmtDate(report.createdAt)}</TableCell>
              <TableCell>
                <Button
                  size="small"
                  variant="outlined"
                  color="info"
                  startIcon={<VerifiedUserIcon />}
                  onClick={() => onVerify(report.id)}
                >
                  Verify
                </Button>
              </TableCell>
              <TableCell align="right">
                <Box sx={{ display: 'inline-flex', gap: 1.5, alignItems: 'center' }}>
                  <Button
                    size="small"
                    variant="contained"
                    color="secondary"
                    component="a"
                    href={reportDownloadURL(report.id)}
                    startIcon={<PictureAsPdfIcon />}
                  >
                    PDF
                  </Button>
                  <Tooltip title="View SHA-256 Checksum Sidecar">
                    <Link
                      href={`/api/v1/reports/${encodeURIComponent(report.id)}/checksum`}
                      underline="hover"
                      sx={{ color: 'text.secondary', display: 'flex', alignItems: 'center', gap: 0.5, fontSize: '0.85rem' }}
                    >
                      <KeyIcon fontSize="small" /> SHA-256
                    </Link>
                  </Tooltip>
                </Box>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Paper>
  );
};
