import React, { useState } from 'react';
import {
  Paper,
  List,
  ListItem,
  ListItemText,
  ListItemIcon,
  IconButton,
  Menu,
  MenuItem,
  Typography,
  Box,
  Divider,
  LinearProgress,
  Chip,
} from '@mui/material';
import StorageIcon from '@mui/icons-material/Storage';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import PictureAsPdfIcon from '@mui/icons-material/PictureAsPdf';
import RefreshIcon from '@mui/icons-material/Refresh';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import EjectIcon from '@mui/icons-material/Eject';
import AccountTreeIcon from '@mui/icons-material/AccountTree';
import { Device, Job, Profile, Settings } from '../types';
import { StatusChip } from './StatusChip';
import { fmtBytes, statusLabel, smartSelfTestLabel } from '../api';

const activeStatuses = ['queued', 'validating', 'running', 'pause_requested', 'cancel_requested'];

interface DriveListViewProps {
  devices: Device[];
  jobs: Job[];
  profiles: Profile[];
  settings: Settings | null;
  role: string;
  onOpen: (id: string, jobId?: string | null) => void;
  onRun: (device: Device, profileId: string) => void;
  onAction: (job: Job, action: string) => void;
  onReport: (id: string) => void;
  onRetry: (id: string) => void;
  onEject: (id: string) => void;
  onPartition: (device: Device) => void;
}

export const DriveListView: React.FC<DriveListViewProps> = ({
  devices,
  jobs,
  profiles,
  settings,
  role,
  onOpen,
  onRun,
  onAction,
  onReport,
  onRetry,
  onEject,
  onPartition,
}) => {
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const [selectedDevice, setSelectedDevice] = useState<Device | null>(null);

  const handleOpenMenu = (event: React.MouseEvent<HTMLElement>, device: Device) => {
    event.stopPropagation();
    setAnchorEl(event.currentTarget);
    setSelectedDevice(device);
  };

  const handleCloseMenu = () => {
    setAnchorEl(null);
    setSelectedDevice(null);
  };

  if (!devices.length) {
    return (
      <Paper sx={{ p: 6, textAlign: 'center' }}>
        <StorageIcon sx={{ fontSize: 48, color: 'text.secondary', mb: 1 }} />
        <Typography variant="h6">No drives found</Typography>
        <Typography variant="body2" color="text.secondary">
          Connect a drive, then refresh discovery.
        </Typography>
      </Paper>
    );
  }

  return (
    <Paper variant="outlined">
      <List disablePadding>
        {devices.map((device, index) => {
          const probe = device.probe || {};
          const driveJobs = jobs.filter((j) => j.deviceId === device.id);
          const activeJob = driveJobs.find((j) => activeStatuses.includes(j.status) || j.status === 'paused');
          const completedJobs = driveJobs.filter((j) =>
            ['completed', 'completed_with_warnings', 'passed'].includes(j.status)
          );

          // Compute dynamic status chip for the drive
          let driveChipValue = device.status;
          let driveChipLabel: string | undefined = undefined;

          if (activeJob) {
            if (activeJob.status === 'queued') {
              driveChipValue = 'queued';
              driveChipLabel =
                driveJobs.length > 1
                  ? `Queued (${completedJobs.length}/${driveJobs.length} done)`
                  : 'Queued';
            } else if (activeJob.status === 'paused') {
              driveChipValue = 'paused';
              driveChipLabel = 'Paused';
            } else {
              driveChipValue = 'running';
              driveChipLabel = `Testing: ${activeJob.profileName || statusLabel(activeJob.kind)}`;
            }
          }

          return (
            <React.Fragment key={device.id}>
              {index > 0 && <Divider />}
              <ListItem
                sx={{
                  py: 2,
                  px: 3,
                  cursor: 'pointer',
                  '&:hover': { backgroundColor: 'action.hover' },
                }}
                onClick={() => onOpen(device.id)}
                secondaryAction={
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    {role !== 'viewer' && (
                      <IconButton
                        aria-label={`Eject ${probe.model || device.name}`}
                        title={activeJob ? 'Finish or cancel the active test before ejecting' : 'Safely eject drive'}
                        disabled={Boolean(activeJob) || device.status === 'probing' || device.status === 'ejecting'}
                        onClick={(event) => {
                          event.stopPropagation();
                          if (window.confirm(`Safely eject ${probe.model || device.name || device.path}?`)) {
                            onEject(device.id);
                          }
                        }}
                      >
                        <EjectIcon />
                      </IconButton>
                    )}
                    <IconButton
                      edge="end"
                      aria-label={`Options menu for ${probe.model || device.name}`}
                      onClick={(e) => handleOpenMenu(e, device)}
                    >
                      <MoreVertIcon />
                    </IconButton>
                  </Box>
                }
              >
                <ListItemIcon sx={{ minWidth: 48 }}>
                  <StorageIcon color={device.status === 'quarantined' ? 'error' : 'primary'} />
                </ListItemIcon>

                <ListItemText
                  primary={
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
                      <Typography variant="subtitle1" fontWeight="bold">
                        {probe.model || device.name || device.id}
                      </Typography>
                      <StatusChip value={driveChipValue} label={driveChipLabel} />
                      {probe.smartSelfTest && (
                        <Chip
                          size="small"
                          color="info"
                          variant="outlined"
                          label={smartSelfTestLabel(probe.smartSelfTest)}
                        />
                      )}
                    </Box>
                  }
                  secondary={
                    <Box sx={{ mt: 0.5 }}>
                      <Typography variant="body2" color="text.secondary">
                        {device.path} · {fmtBytes(probe.capacityBytes)} · S/N {probe.serial || 'unavailable'} · Temp {probe.temperatureC ? `${probe.temperatureC} °C` : '—'} · SMART {probe.smartAvailable ? (probe.smartPassed ? 'Passed' : 'Failed') : 'Unavailable'}
                      </Typography>

                      {activeJob && (
                        <Box sx={{ mt: 1, maxWidth: 450 }}>
                          <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
                            <Typography variant="caption" color="primary" fontWeight="bold">
                              {activeJob.profileName || statusLabel(activeJob.kind)} ({activeJob.status}): {activeJob.currentPhase || 'In progress'}
                            </Typography>
                            <Typography variant="caption" color="text.secondary">
                              {((activeJob.progress || 0) * 100).toFixed(0)}%
                            </Typography>
                          </Box>
                          <LinearProgress variant="determinate" value={Math.max(0, Math.min(100, (activeJob.progress || 0) * 100))} />
                        </Box>
                      )}
                    </Box>
                  }
                />
              </ListItem>
            </React.Fragment>
          );
        })}
      </List>

      {/* Drive Action Options Menu */}
      <Menu
        anchorEl={anchorEl}
        open={Boolean(anchorEl && selectedDevice)}
        onClose={handleCloseMenu}
      >
        {selectedDevice && (
          <Box>
            <MenuItem
              onClick={() => {
                const id = selectedDevice.id;
                handleCloseMenu();
                onOpen(id);
              }}
            >
              <ListItemIcon>
                <OpenInNewIcon fontSize="small" />
              </ListItemIcon>
              <ListItemText primary="Drive details & workspace" />
            </MenuItem>

            {role !== 'viewer' && selectedDevice.status !== 'quarantined' && selectedDevice.probe?.smartAvailable && (
              <MenuItem
                onClick={() => {
                  const dev = selectedDevice;
                  handleCloseMenu();
                  onRun(dev, 'preset:complete-drive-check');
                }}
              >
                <ListItemIcon>
                  <CheckCircleIcon fontSize="small" color="primary" />
                </ListItemIcon>
                <ListItemText primary="Complete drive check" secondary="Speed, surface read, SMART" />
              </MenuItem>
            )}

            {role !== 'viewer' && selectedDevice.status !== 'quarantined' && (
              <MenuItem
                onClick={() => {
                  const dev = selectedDevice;
                  handleCloseMenu();
                  onRun(dev, 'smart_short');
                }}
              >
                <ListItemIcon>
                  <PlayArrowIcon fontSize="small" />
                </ListItemIcon>
                <ListItemText primary="Run diagnostic test..." />
              </MenuItem>
            )}

            {role !== 'viewer' && jobs.some((j) => j.deviceId === selectedDevice.id) && (
              <MenuItem
                onClick={() => {
                  const id = selectedDevice.id;
                  handleCloseMenu();
                  onReport(id);
                }}
              >
                <ListItemIcon>
                  <PictureAsPdfIcon fontSize="small" color="secondary" />
                </ListItemIcon>
                <ListItemText primary="Generate PDF report" />
              </MenuItem>
            )}

            {role !== 'viewer' && selectedDevice.status === 'quarantined' && (
              <MenuItem
                onClick={() => {
                  const id = selectedDevice.id;
                  handleCloseMenu();
                  onRetry(id);
                }}
              >
                <ListItemIcon>
                  <RefreshIcon fontSize="small" color="warning" />
                </ListItemIcon>
                <ListItemText primary="Retry probe" />
              </MenuItem>
            )}

            {role === 'admin' && settings?.destructiveEnabled && selectedDevice.probe?.serial && selectedDevice.status === 'ready' && !jobs.some(
              (job) => job.deviceId === selectedDevice.id && (activeStatuses.includes(job.status) || job.status === 'paused')
            ) && (
              <MenuItem
                onClick={() => {
                  const dev = selectedDevice;
                  handleCloseMenu();
                  onPartition(dev);
                }}
              >
                <ListItemIcon>
                  <AccountTreeIcon fontSize="small" color="error" />
                </ListItemIcon>
                <ListItemText primary="Partition drive…" secondary="Erases all existing data" />
              </MenuItem>
            )}
          </Box>
        )}
      </Menu>
    </Paper>
  );
};
