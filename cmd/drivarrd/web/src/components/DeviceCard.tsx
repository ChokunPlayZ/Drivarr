import React from 'react';
import { Card, CardContent, Box, Typography, Button, Grid, Divider, Alert } from '@mui/material';
import StorageIcon from '@mui/icons-material/Storage';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import PictureAsPdfIcon from '@mui/icons-material/PictureAsPdf';
import RefreshIcon from '@mui/icons-material/Refresh';
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
  const driveJobs = jobs.filter((job) => job.deviceId === device.id);

  const facts: [string, string][] = [
    ['Serial', probe.serial || '—'],
    ['Capacity', fmtBytes(probe.capacityBytes)],
    ['Drive Interface', probe.deviceInterface || '—'],
    ['Recording Type', probe.recordingType || '—'],
    ['Temperature', probe.temperatureC ? `${probe.temperatureC} °C` : '—'],
    ['SMART Status', probe.smartAvailable ? (probe.smartPassed ? 'Passed' : 'Failed') : 'Unavailable'],
    ['Power-on Hours', probe.powerOnHours ? probe.powerOnHours.toLocaleString() : '—'],
    ['Pending Sectors', probe.pendingSectors !== undefined ? String(probe.pendingSectors) : '—'],
    ['FARM Telemetry', probe.farmAvailable ? 'Available' : 'Unavailable'],
    ['SMART History', history.label],
  ];

  return (
    <Card sx={{ mb: 3 }}>
      <CardContent sx={{ p: 3 }}>
        {/* Title Header */}
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 2, flexWrap: 'wrap', gap: 2 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <Box
              sx={{
                width: 48,
                height: 48,
                borderRadius: 3,
                backgroundColor: 'rgba(99, 102, 241, 0.1)',
                border: '1px solid rgba(99, 102, 241, 0.3)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'primary.light',
              }}
            >
              <StorageIcon sx={{ fontSize: 28 }} />
            </Box>
            <Box>
              <Typography variant="h5" sx={{ fontWeight: 700, lineHeight: 1.2 }}>
                {probe.model || device.name || device.id}
              </Typography>
              <Typography
                component="a"
                href={deviceURL(device.id)}
                onClick={(e) => {
                  e.preventDefault();
                  onOpen(device.id);
                }}
                variant="body2"
                sx={{
                  color: 'secondary.light',
                  textDecoration: 'none',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 0.5,
                  fontWeight: 600,
                  '&:hover': { textDecoration: 'underline' },
                }}
              >
                {device.path} <OpenInNewIcon sx={{ fontSize: 14 }} />
              </Typography>
            </Box>
          </Box>
          <StatusChip value={device.status} size="medium" />
        </Box>

        {/* Warning if any */}
        {device.reason && (
          <Alert severity="warning" sx={{ mb: 2.5, borderRadius: 2 }}>
            {device.reason}
          </Alert>
        )}

        {/* Firmware test banner if running */}
        {probe.smartSelfTest && (
          <Alert severity="info" icon={<StatusChip value="running" size="small" />} sx={{ mb: 2.5, borderRadius: 2 }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
              {smartSelfTestLabel(probe.smartSelfTest)}
            </Typography>
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>
              Detected from drive firmware
            </Typography>
          </Alert>
        )}

        {/* Grid of drive facts */}
        <Grid container spacing={2} sx={{ mb: 3 }}>
          {facts.map(([label, value]) => (
            <Grid item xs={6} sm={4} md={2.4} key={label}>
              <Box
                sx={{
                  p: 1.5,
                  borderRadius: 2,
                  backgroundColor: 'rgba(255, 255, 255, 0.02)',
                  border: '1px solid rgba(255, 255, 255, 0.05)',
                  height: '100%',
                }}
              >
                <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', fontWeight: 500 }}>
                  {label}
                </Typography>
                <Typography variant="body2" sx={{ fontWeight: 700, mt: 0.5, wordBreak: 'break-word' }}>
                  {value}
                </Typography>
              </Box>
            </Grid>
          ))}
        </Grid>

        <Divider sx={{ mb: 2.5 }} />

        {/* Card Actions */}
        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <Button variant="outlined" startIcon={<OpenInNewIcon />} onClick={() => onOpen(device.id)}>
            Drive details
          </Button>

          {role !== 'viewer' && (
            <>
              {driveJobs.length > 0 && (
                <Button
                  variant="outlined"
                  color="secondary"
                  startIcon={<PictureAsPdfIcon />}
                  onClick={() => onReport(device.id)}
                >
                  Full report ({driveJobs.length})
                </Button>
              )}

              {device.status === 'quarantined' && (
                <Button variant="outlined" color="warning" startIcon={<RefreshIcon />} onClick={() => onRetry(device.id)}>
                  Retry probe
                </Button>
              )}

              <Button
                variant="contained"
                color="primary"
                startIcon={<PlayArrowIcon />}
                onClick={() => onTest(device)}
              >
                Run test
              </Button>
            </>
          )}
        </Box>
      </CardContent>
    </Card>
  );
};
