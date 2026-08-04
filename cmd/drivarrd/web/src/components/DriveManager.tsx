import React from 'react';
import { Card, CardContent, Box, Typography, Button, LinearProgress, Paper, Divider, Stack } from '@mui/material';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import PictureAsPdfIcon from '@mui/icons-material/PictureAsPdf';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import RefreshIcon from '@mui/icons-material/Refresh';
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

  const enabledProfiles = profiles.filter(
    (profile) =>
      profile.enabled &&
      (!profile.kind.startsWith('smart') || probe.smartAvailable) &&
      (profile.kind !== 'destructive_verify' || settings?.destructiveEnabled)
  );

  const getLatestJob = (profile: Profile) => {
    return driveJobs.find((j) => j.profileId === profile.id) || driveJobs.find((j) => j.kind === profile.kind);
  };

  return (
    <Card sx={{ mb: 3 }}>
      <CardContent sx={{ p: 3 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2, flexWrap: 'wrap', gap: 2 }}>
          <Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
              <Typography variant="h5" fontWeight="bold">
                {probe.model || device.name || device.id}
              </Typography>
              <StatusChip value={device.status} />
            </Box>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              {device.path} · {fmtBytes(probe.capacityBytes)} · {probe.deviceInterface || probe.protocol || 'Unknown interface'} · S/N {probe.serial || 'unavailable'}
            </Typography>
          </Box>

          <Box sx={{ display: 'flex', gap: 1 }}>
            <Button size="small" variant="outlined" onClick={() => onOpen(device.id)}>
              Drive details
            </Button>
            {driveJobs.length > 0 && role !== 'viewer' && (
              <Button size="small" variant="outlined" color="secondary" startIcon={<PictureAsPdfIcon />} onClick={() => onReport(device.id)}>
                PDF report
              </Button>
            )}
          </Box>
        </Box>

        {device.reason && (
          <Paper variant="outlined" sx={{ p: 2, mb: 2, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Typography variant="body2" color="error">
              {device.reason}
            </Typography>
            {device.status === 'quarantined' && role !== 'viewer' && (
              <Button size="small" variant="contained" color="error" startIcon={<RefreshIcon />} onClick={() => onRetry(device.id)}>
                Retry probe
              </Button>
            )}
          </Paper>
        )}

        {probe.smartSelfTest && (
          <Paper variant="outlined" sx={{ p: 2, mb: 2.5, display: 'flex', alignItems: 'center', gap: 2 }}>
            <StatusChip value="running" />
            <Box>
              <Typography variant="subtitle2" fontWeight="bold">
                {smartSelfTestLabel(probe.smartSelfTest)}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                Reported by drive firmware
              </Typography>
            </Box>
          </Paper>
        )}

        <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 1.5 }}>
          Available Diagnostics ({enabledProfiles.length})
        </Typography>

        <Stack spacing={1.5} sx={{ mb: 3 }}>
          {enabledProfiles.map((profile) => {
            const job = getLatestJob(profile);
            const isBusy = driveJobs.some((cand) => activeStatuses.includes(cand.status) || cand.status === 'paused');
            const isDestructive = profile.kind === 'destructive_verify';
            const percent = Math.max(0, Math.min(100, (job?.progress || 0) * 100));
            const isActive = job ? activeStatuses.includes(job.status) || job.status === 'paused' : false;

            return (
              <Paper
                key={profile.id}
                variant="outlined"
                sx={{
                  p: 2,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 2,
                  flexWrap: 'wrap',
                }}
              >
                <Box sx={{ minWidth: 240, flex: 1 }}>
                  <Typography variant="subtitle1" fontWeight="bold" color={isDestructive ? 'error' : 'text.primary'}>
                    {profile.name}
                  </Typography>
                  <Typography variant="caption" color="text.secondary" display="block">
                    {testDescriptions[profile.kind] || statusLabel(profile.kind)}
                  </Typography>
                </Box>

                <Box sx={{ minWidth: 200, flex: 1 }}>
                  {job ? (
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <StatusChip value={job.status} size="small" />
                        <Typography variant="caption" color="text.secondary">
                          {isActive ? `${percent.toFixed(0)}% · ${job.currentPhase || 'In progress'}` : fmtDate(job.finishedAt || job.createdAt)}
                        </Typography>
                      </Box>
                      {isActive && (
                        <LinearProgress variant="determinate" value={percent} sx={{ height: 6, borderRadius: 1 }} />
                      )}
                    </Box>
                  ) : (
                    <Typography variant="caption" color="text.secondary" fontStyle="italic">
                      Not run yet
                    </Typography>
                  )}
                </Box>

                <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                  {job && (
                    <Button size="small" variant="outlined" startIcon={<OpenInNewIcon fontSize="small" />} onClick={() => onOpen(device.id, job.id)}>
                      View
                    </Button>
                  )}

                  {role !== 'viewer' && (
                    <Button
                      size="small"
                      variant={isDestructive ? 'contained' : 'outlined'}
                      color={isDestructive ? 'error' : 'primary'}
                      disabled={isBusy || device.status === 'quarantined'}
                      startIcon={<PlayArrowIcon fontSize="small" />}
                      onClick={() => onRun(device, profile.id)}
                    >
                      {job && finishedStatuses.includes(job.status) ? 'Run again' : 'Run'}
                    </Button>
                  )}
                </Box>
              </Paper>
            );
          })}
        </Stack>

        {role !== 'viewer' && device.status !== 'quarantined' && probe.smartAvailable && (
          <>
            <Divider sx={{ mb: 2.5 }} />
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 2 }}>
              <Box>
                <Typography variant="subtitle1" fontWeight="bold">
                  Want the full check?
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Speed, full surface scan, then extended SMART—run in order.
                </Typography>
              </Box>

              <Button
                variant="contained"
                color="primary"
                disabled={activeCount > 0}
                startIcon={<PlayArrowIcon />}
                onClick={() => onRun(device, 'preset:complete-drive-check')}
              >
                Run complete check
              </Button>
            </Box>
          </>
        )}
      </CardContent>
    </Card>
  );
};
