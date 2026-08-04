import React, { useState, useMemo, useEffect } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  IconButton,
  Box,
  Typography,
  Grid,
  Card,
  CardContent,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  Table,
  TableHead,
  TableRow,
  TableCell,
  TableBody,
  Button,
  Chip,
  Paper,
  LinearProgress,
  Divider,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import StorageIcon from '@mui/icons-material/Storage';
import PictureAsPdfIcon from '@mui/icons-material/PictureAsPdf';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import WarningIcon from '@mui/icons-material/Warning';
import HelpOutlinedIcon from '@mui/icons-material/HelpOutlined';
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

export const DriveWorkspace: React.FC<DriveWorkspaceProps> = ({
  device,
  jobs,
  role,
  initialJobId,
  onClose,
  onAction,
  onReport,
}) => {
  const driveJobs = useMemo(() => jobs.filter((j) => j.deviceId === device.id), [jobs, device.id]);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    const preferred =
      driveJobs.find((j) => j.id === initialJobId)?.id ||
      driveJobs.find((j) => ['running', 'paused', 'validating'].includes(j.status))?.id ||
      driveJobs[0]?.id ||
      null;

    setSelectedId((current) =>
      driveJobs.some((j) => j.id === initialJobId)
        ? initialJobId!
        : driveJobs.some((j) => j.id === current)
        ? current
        : preferred
    );
  }, [driveJobs, initialJobId]);

  const probe = device.probe || {};
  const selected = driveJobs.find((j) => j.id === (initialJobId || selectedId)) || driveJobs[0] || null;
  const surface =
    driveJobs.find((j) => j.kind === 'surface_read' && ['running', 'paused'].includes(j.status)) ||
    driveJobs.find((j) => j.kind === 'surface_read');

  const assessment = historyAssessment(probe);
  const farm = flattenFARM(probe.farm);
  const percent = Math.max(0, Math.min(100, (selected?.progress || 0) * 100));

  if (initialJobId && selected) {
    return (
      <Dialog open fullWidth maxWidth="md" onClose={onClose}>
        <DialogTitle sx={{ m: 0, p: 3, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Box>
            <Typography variant="caption" color="primary" fontWeight="bold">
              TEST DETAILS
            </Typography>
            <Typography id="test-detail-title" variant="h5" fontWeight="bold">
              {selected.profileName || statusLabel(selected.kind)}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {probe.model || device.name || device.id} · {device.path}
            </Typography>
          </Box>
          <IconButton aria-label="Close test details" onClick={onClose}>
            <CloseIcon />
          </IconButton>
        </DialogTitle>

        <DialogContent dividers sx={{ p: 3 }}>
          <Paper variant="outlined" sx={{ p: 3, mb: 3 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
              <StatusChip value={selected.status} size="medium" />
              <Typography variant="h4" fontWeight="bold" color="primary">
                {percent.toFixed(1)}% complete
              </Typography>
            </Box>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              {selected.currentPhase || selected.error || 'No additional result details'}
            </Typography>
            <LinearProgress variant="determinate" value={percent} sx={{ height: 8, borderRadius: 1 }} />
          </Paper>

          <Grid container spacing={2} sx={{ mb: 3 }}>
            {[
              ['Started', fmtDate(selected.startedAt || selected.createdAt)],
              ['Finished', fmtDate(selected.finishedAt)],
              ['Data Checked', `${fmtBytes(selected.completedBytes)} / ${fmtBytes(selected.totalBytes)}`],
              ['Read Speed', fmtSpeed(selected.readBps)],
              ['Random Read', selected.readIops ? `${selected.readIops.toFixed(1)} IOPS` : '—'],
              ['Errors', String(selected.errors?.length || 0)],
            ].map(([label, val]) => (
              <Grid item xs={6} sm={4} key={label}>
                <Paper variant="outlined" sx={{ p: 2 }}>
                  <Typography variant="caption" color="text.secondary" display="block">
                    {label}
                  </Typography>
                  <Typography variant="body1" fontWeight="bold" sx={{ mt: 0.5 }}>
                    {val}
                  </Typography>
                </Paper>
              </Grid>
            ))}
          </Grid>

          {selected.error && (
            <Alert severity="error" sx={{ mb: 3 }}>
              {selected.error}
            </Alert>
          )}

          <Box sx={{ mb: 3 }}>
            <JobActions job={selected} role={role} onAction={onAction} verbose />
          </Box>

          {selected.kind === 'surface_read' && (
            <Box sx={{ mt: 3 }}>
              <Typography variant="h6" fontWeight="bold" sx={{ mb: 2 }}>
                Sector Map
              </Typography>
              <SurfaceMap job={selected} />
            </Box>
          )}
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open fullScreen onClose={onClose}>
      <DialogTitle
        id="workspace-title"
        sx={{
          borderBottom: '1px solid',
          borderColor: 'divider',
          display: 'flex',
          justify: 'space-between',
          alignItems: 'center',
          px: 4,
          py: 2,
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <StorageIcon color="primary" sx={{ fontSize: 32 }} />
          <Box>
            <Typography variant="caption" color="text.secondary" fontWeight="bold">
              FULL DRIVE VIEW & WORKSPACE
            </Typography>
            <Typography variant="h5" fontWeight="bold" lineHeight={1.1}>
              {probe.model || device.name || device.id}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {device.path} · {probe.protocol || 'unknown protocol'} · {fmtBytes(probe.capacityBytes)}
            </Typography>
          </Box>
        </Box>

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <StatusChip value={device.status} size="medium" />
          <IconButton aria-label="Close full-screen drive view" onClick={onClose}>
            <CloseIcon fontSize="large" />
          </IconButton>
        </Box>
      </DialogTitle>

      <DialogContent sx={{ p: 4 }}>
        <Grid container spacing={3} sx={{ mb: 4 }}>
          {/* Drive Condition Card */}
          <Grid item xs={12} md={6}>
            <Card variant="outlined" sx={{ height: '100%' }}>
              <CardContent>
                <Typography variant="caption" color="primary" fontWeight="bold">
                  DRIVE CONDITION
                </Typography>
                <Typography variant="h6" fontWeight="bold" sx={{ mt: 0.5 }}>
                  {probe.model || device.name || device.id}
                </Typography>
                <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 2 }}>
                  Serial {probe.serial || 'unavailable'} · Firmware {probe.firmware || 'unavailable'} · Collected {fmtDate(probe.collectedAt)}
                </Typography>

                <Grid container spacing={1.5} sx={{ mb: 2 }}>
                  {[
                    ['SMART Health', probe.smartAvailable ? (probe.smartPassed ? 'Passed' : 'Failed') : 'Unavailable'],
                    ['Drive Interface', probe.deviceInterface || '—'],
                    ['Recording Type', probe.recordingType || '—'],
                    ['Temperature', probe.temperatureC ? `${probe.temperatureC} °C` : '—'],
                    ['Power-on Hours', probe.powerOnHours ? probe.powerOnHours.toLocaleString() : '—'],
                    ['Pending Sectors', probe.pendingSectors !== undefined ? String(probe.pendingSectors) : '—'],
                    ['Reallocated', probe.reallocatedSectors !== undefined ? String(probe.reallocatedSectors) : '—'],
                    ['Uncorrectable', probe.uncorrectableSectors !== undefined ? String(probe.uncorrectableSectors) : '—'],
                  ].map(([label, val]) => (
                    <Grid item xs={6} key={label}>
                      <Paper variant="outlined" sx={{ p: 1.5 }}>
                        <Typography variant="caption" color="text.secondary" display="block">
                          {label}
                        </Typography>
                        <Typography
                          variant="body2"
                          fontWeight="bold"
                          color={label === 'SMART Health' && probe.smartPassed === false ? 'error' : 'text.primary'}
                        >
                          {val}
                        </Typography>
                      </Paper>
                    </Grid>
                  ))}
                </Grid>

                {probe.smartSelfTest && (
                  <Paper variant="outlined" sx={{ p: 2, display: 'flex', alignItems: 'center', gap: 2 }}>
                    <StatusChip value="running" size="small" />
                    <Box>
                      <Typography variant="body2" fontWeight="bold">
                        {smartSelfTestLabel(probe.smartSelfTest)}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {probe.smartSelfTest.status || 'Detected from drive firmware'}
                      </Typography>
                    </Box>
                  </Paper>
                )}
              </CardContent>
            </Card>
          </Grid>

          {/* Live Progress / Selected Test Card */}
          <Grid item xs={12} md={6}>
            <Card variant="outlined" sx={{ height: '100%' }}>
              <CardContent>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                  <Box>
                    <Typography variant="caption" color="secondary" fontWeight="bold">
                      LIVE PROGRESS
                    </Typography>
                    <Typography variant="h6" fontWeight="bold">
                      Selected Test
                    </Typography>
                  </Box>

                  {driveJobs.length > 1 && (
                    <FormControl size="small" sx={{ minWidth: 200 }}>
                      <InputLabel id="job-select-label">Select test</InputLabel>
                      <Select
                        labelId="job-select-label"
                        value={selected?.id || ''}
                        label="Select test"
                        onChange={(e) => setSelectedId(e.target.value)}
                      >
                        {driveJobs.map((j) => (
                          <MenuItem key={j.id} value={j.id}>
                            {j.id} · {statusLabel(j.status)} · {statusLabel(j.kind)}
                          </MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                  )}
                </Box>

                {selected ? (
                  <Box>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2 }}>
                      <Box sx={{ textAlign: 'center', minWidth: 100 }}>
                        <Typography variant="h3" fontWeight="bold" color="primary">
                          {percent.toFixed(1)}%
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          complete
                        </Typography>
                      </Box>
                      <Box sx={{ flex: 1 }}>
                        <StatusChip value={selected.status} size="medium" />
                        <Typography variant="h6" fontWeight="bold" sx={{ mt: 0.5 }}>
                          {selected.profileName || statusLabel(selected.kind)}
                        </Typography>
                        <Typography variant="body2" color="text.secondary">
                          {selected.currentPhase || selected.error || 'Waiting for worker update'}
                        </Typography>
                      </Box>
                    </Box>

                    <LinearProgress variant="determinate" value={percent} sx={{ height: 8, borderRadius: 1, mb: 3 }} />

                    <Grid container spacing={1.5} sx={{ mb: 3 }}>
                      <Grid item xs={4}>
                        <Paper variant="outlined" sx={{ p: 1.5, textAlign: 'center' }}>
                          <Typography variant="caption" color="text.secondary">
                            Checked
                          </Typography>
                          <Typography variant="body2" fontWeight="bold">
                            {fmtBytes(selected.completedBytes)} / {fmtBytes(selected.totalBytes)}
                          </Typography>
                        </Paper>
                      </Grid>
                      <Grid item xs={4}>
                        <Paper variant="outlined" sx={{ p: 1.5, textAlign: 'center' }}>
                          <Typography variant="caption" color="text.secondary">
                            Performance
                          </Typography>
                          <Typography variant="body2" fontWeight="bold" color="secondary">
                            {fmtSpeed(selected.readBps)}
                          </Typography>
                        </Paper>
                      </Grid>
                      <Grid item xs={4}>
                        <Paper variant="outlined" sx={{ p: 1.5, textAlign: 'center' }}>
                          <Typography variant="caption" color="text.secondary">
                            Errors
                          </Typography>
                          <Typography
                            variant="body2"
                            fontWeight="bold"
                            color={(selected.errors?.length || 0) > 0 ? 'error' : 'success'}
                          >
                            {selected.errors?.length || 0}
                          </Typography>
                        </Paper>
                      </Grid>
                    </Grid>

                    <JobActions job={selected} role={role} onAction={onAction} verbose />
                  </Box>
                ) : (
                  <Paper variant="outlined" sx={{ p: 4, textAlign: 'center' }}>
                    <Typography variant="body2" color="text.secondary">
                      No test is associated with this drive.
                    </Typography>
                  </Paper>
                )}
              </CardContent>
            </Card>
          </Grid>
        </Grid>

        {/* Sector Map Card */}
        <Card variant="outlined" sx={{ mb: 4 }}>
          <CardContent>
            <Box sx={{ mb: 2 }}>
              <Typography variant="caption" color="primary" fontWeight="bold">
                REAL-TIME MEDIA VIEW
              </Typography>
              <Typography variant="h6" fontWeight="bold">
                Full Sector Map
              </Typography>
              <Typography variant="caption" color="text.secondary">
                Mapped from durable byte checkpoints and sector errors
              </Typography>
            </Box>
            <SurfaceMap job={surface} />
          </CardContent>
        </Card>

        {/* Drive Wipe Integrity Card */}
        <Card
          variant="outlined"
          sx={{
            mb: 4,
            borderColor:
              assessment.kind === 'suspicious'
                ? 'error.main'
                : assessment.kind === 'consistent'
                ? 'success.main'
                : 'warning.main',
          }}
        >
          <CardContent>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 1 }}>
              {assessment.kind === 'suspicious' ? (
                <WarningIcon color="error" />
              ) : assessment.kind === 'consistent' ? (
                <CheckCircleIcon color="success" />
              ) : (
                <HelpOutlinedIcon color="warning" />
              )}
              <Typography variant="h6" fontWeight="bold">
                {assessment.label}
              </Typography>
            </Box>
            {assessment.evidence.map((item) => (
              <Typography key={item} variant="body2" color="text.secondary" sx={{ ml: 4, mb: 0.5 }}>
                • {item}
              </Typography>
            ))}
            <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1.5, fontStyle: 'italic' }}>
              <strong>Heuristic only:</strong> conflicting counters can indicate a reset but do not prove intentional wiping.
            </Typography>
          </CardContent>
        </Card>

        {/* SMART Attribute Table Card */}
        <Card variant="outlined" sx={{ mb: 4 }}>
          <CardContent>
            <Box sx={{ mb: 2 }}>
              <Typography variant="caption" color="secondary" fontWeight="bold">
                COMPLETE DEVICE LOG
              </Typography>
              <Typography variant="h6" fontWeight="bold">
                SMART Attribute Table
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {probe.smartAttributes?.length || 0} attributes · updated {fmtDate(probe.collectedAt)}
              </Typography>
            </Box>
            <Paper variant="outlined" sx={{ overflowX: 'auto' }}>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>ID</TableCell>
                    <TableCell>Attribute</TableCell>
                    <TableCell>Current</TableCell>
                    <TableCell>Worst</TableCell>
                    <TableCell>Threshold</TableCell>
                    <TableCell>Raw Value</TableCell>
                    <TableCell>Failed</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {probe.smartAttributes?.length ? (
                    probe.smartAttributes.map((attr) => (
                      <TableRow key={attr.id} hover>
                        <TableCell>{attr.id}</TableCell>
                        <TableCell fontWeight="bold">{attr.name}</TableCell>
                        <TableCell>{attr.current}</TableCell>
                        <TableCell>{attr.worst}</TableCell>
                        <TableCell>{attr.threshold}</TableCell>
                        <TableCell>{attr.rawString || attr.rawValue}</TableCell>
                        <TableCell>{attr.whenFailed || '—'}</TableCell>
                      </TableRow>
                    ))
                  ) : (
                    <TableRow>
                      <TableCell colSpan={7} align="center" sx={{ color: 'text.secondary', py: 3 }}>
                        The current device snapshot does not include SMART attributes.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </Paper>
          </CardContent>
        </Card>

        {/* Seagate FARM Table Card */}
        <Card variant="outlined" sx={{ mb: 4 }}>
          <CardContent>
            <Box sx={{ mb: 2 }}>
              <Typography variant="caption" color="secondary" fontWeight="bold">
                COMPLETE DEVICE LOG
              </Typography>
              <Typography variant="h6" fontWeight="bold">
                Seagate FARM Table
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {farm.length} scalar metrics
              </Typography>
            </Box>
            <Paper variant="outlined" sx={{ overflowX: 'auto' }}>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Metric Path</TableCell>
                    <TableCell>Value</TableCell>
                    <TableCell>Source</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {farm.length ? (
                    farm.map(([metric, val]) => (
                      <TableRow key={metric} hover>
                        <TableCell sx={{ fontFamily: 'monospace' }}>
                          {metric.replaceAll('.', ' › ')}
                        </TableCell>
                        <TableCell fontWeight="bold">{val}</TableCell>
                        <TableCell>
                          <Chip size="small" label="FARM log" color="secondary" variant="outlined" />
                        </TableCell>
                      </TableRow>
                    ))
                  ) : (
                    <TableRow>
                      <TableCell colSpan={3} align="center" sx={{ color: 'text.secondary', py: 3 }}>
                        {probe.farmAvailable
                          ? 'The FARM log was returned without displayable scalar fields.'
                          : 'FARM is unavailable for this device.'}
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </Paper>
          </CardContent>
        </Card>

        {/* Evidence Timeline Card */}
        <Card variant="outlined" sx={{ mb: 4 }}>
          <CardContent>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2, flexWrap: 'wrap', gap: 2 }}>
              <Box>
                <Typography variant="caption" color="primary" fontWeight="bold">
                  EVIDENCE TIMELINE
                </Typography>
                <Typography variant="h6" fontWeight="bold">
                  All Tests for this Drive
                </Typography>
              </Box>

              <Box sx={{ display: 'flex', gap: 2, alignItems: 'center' }}>
                {driveJobs.length > 0 && role !== 'viewer' && (
                  <Button
                    variant="contained"
                    color="secondary"
                    startIcon={<PictureAsPdfIcon />}
                    onClick={() => onReport(device.id)}
                  >
                    Generate full PDF ({driveJobs.length} tests)
                  </Button>
                )}
                <Typography variant="caption" color="text.secondary">
                  {driveJobs.length} retained job{driveJobs.length === 1 ? '' : 's'}
                </Typography>
              </Box>
            </Box>

            <Paper variant="outlined" sx={{ overflowX: 'auto' }}>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Job ID</TableCell>
                    <TableCell>Test Kind</TableCell>
                    <TableCell>Status</TableCell>
                    <TableCell>Progress</TableCell>
                    <TableCell>Phase / Details</TableCell>
                    <TableCell>Speed</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {driveJobs.length ? (
                    driveJobs.map((j) => (
                      <TableRow key={j.id} hover>
                        <TableCell sx={{ fontFamily: 'monospace', fontWeight: 'bold' }}>{j.id}</TableCell>
                        <TableCell>{statusLabel(j.kind)}</TableCell>
                        <TableCell>
                          <StatusChip value={j.status} size="small" />
                        </TableCell>
                        <TableCell>{((j.progress || 0) * 100).toFixed(1)}%</TableCell>
                        <TableCell>{j.currentPhase || j.error || '—'}</TableCell>
                        <TableCell>{fmtSpeed(j.readBps)}</TableCell>
                      </TableRow>
                    ))
                  ) : (
                    <TableRow>
                      <TableCell colSpan={6} align="center" sx={{ color: 'text.secondary', py: 3 }}>
                        No tests have been run on this drive.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </Paper>
          </CardContent>
        </Card>
      </DialogContent>
    </Dialog>
  );
};
