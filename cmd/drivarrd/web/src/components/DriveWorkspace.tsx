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

  // Render modal for individual test detail view if initialJobId is set and selected exists
  if (initialJobId && selected) {
    return (
      <Dialog open fullWidth maxWidth="md" onClose={onClose}>
        <DialogTitle sx={{ m: 0, p: 3, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Box>
            <Typography variant="caption" sx={{ color: 'primary.light', fontWeight: 700, letterSpacing: '0.05em' }}>
              TEST DETAILS
            </Typography>
            <Typography id="test-detail-title" variant="h5" sx={{ fontWeight: 800 }}>
              {selected.profileName || statusLabel(selected.kind)}
            </Typography>
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
              {probe.model || device.name || device.id} · {device.path}
            </Typography>
          </Box>
          <IconButton aria-label="Close test details" onClick={onClose} sx={{ color: 'text.secondary' }}>
            <CloseIcon />
          </IconButton>
        </DialogTitle>
        <DialogContent dividers sx={{ p: 3 }}>
          {/* Progress Hero */}
          <Paper sx={{ p: 3, mb: 3, background: 'linear-gradient(135deg, rgba(99, 102, 241, 0.1) 0%, rgba(17, 24, 39, 1) 100%)', borderRadius: 3 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
              <StatusChip value={selected.status} size="medium" />
              <Typography variant="h4" sx={{ fontWeight: 800, color: 'primary.light' }}>
                {percent.toFixed(1)}% complete
              </Typography>
            </Box>
            <Typography variant="body2" sx={{ color: 'text.secondary', mb: 2 }}>
              {selected.currentPhase || selected.error || 'No additional result details'}
            </Typography>
            <LinearProgress variant="determinate" value={percent} sx={{ height: 10, borderRadius: 5 }} />
          </Paper>

          {/* Metrics Grid */}
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
                <Paper sx={{ p: 2, backgroundColor: 'rgba(255, 255, 255, 0.02)' }}>
                  <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block' }}>
                    {label}
                  </Typography>
                  <Typography variant="body1" sx={{ fontWeight: 700, mt: 0.5 }}>
                    {val}
                  </Typography>
                </Paper>
              </Grid>
            ))}
          </Grid>

          {selected.error && (
            <Paper sx={{ p: 2, mb: 3, backgroundColor: 'rgba(239, 68, 68, 0.1)', color: 'error.light', border: '1px solid rgba(239, 68, 68, 0.3)' }}>
              <Typography variant="body2" sx={{ fontWeight: 600 }}>
                {selected.error}
              </Typography>
            </Paper>
          )}

          <Box sx={{ mb: 3 }}>
            <JobActions job={selected} role={role} onAction={onAction} verbose />
          </Box>

          {selected.kind === 'surface_read' && (
            <Box sx={{ mt: 3 }}>
              <Typography variant="h6" sx={{ fontWeight: 700, mb: 2 }}>
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
      {/* Header Bar */}
      <DialogTitle
        id="workspace-title"
        sx={{
          backgroundColor: '#111827',
          borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
          display: 'flex',
          justify: 'space-between',
          alignItems: 'center',
          px: 4,
          py: 2,
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <Box
            sx={{
              width: 44,
              height: 44,
              borderRadius: 3,
              background: 'linear-gradient(135deg, #6366F1 0%, #06B6D4 100%)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#FFF',
            }}
          >
            <StorageIcon />
          </Box>
          <Box>
            <Typography variant="caption" sx={{ color: 'secondary.light', fontWeight: 700, letterSpacing: '0.05em' }}>
              LIVE DRIVE WORKSPACE
            </Typography>
            <Typography variant="h5" sx={{ fontWeight: 800, lineHeight: 1.1 }}>
              {probe.model || device.name || device.id}
            </Typography>
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>
              {device.path} · {probe.protocol || 'unknown protocol'} · {fmtBytes(probe.capacityBytes)}
            </Typography>
          </Box>
        </Box>

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <StatusChip value={device.status} size="medium" />
          <IconButton aria-label="Close full-screen drive view" onClick={onClose} sx={{ color: 'text.secondary' }}>
            <CloseIcon fontSize="large" />
          </IconButton>
        </Box>
      </DialogTitle>

      <DialogContent sx={{ backgroundColor: '#0B0F19', p: 4 }}>
        <Grid container spacing={3} sx={{ mb: 4 }}>
          {/* Drive Condition Panel */}
          <Grid item xs={12} md={6}>
            <Card sx={{ height: '100%', p: 1 }}>
              <CardContent>
                <Typography variant="caption" sx={{ color: 'primary.light', fontWeight: 700, letterSpacing: '0.05em' }}>
                  DRIVE CONDITION
                </Typography>
                <Typography variant="h6" sx={{ fontWeight: 800, mt: 0.5 }}>
                  {probe.model || device.name || device.id}
                </Typography>
                <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mb: 2 }}>
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
                      <Paper sx={{ p: 1.5, backgroundColor: 'rgba(255, 255, 255, 0.02)', border: '1px solid rgba(255, 255, 255, 0.05)' }}>
                        <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block' }}>
                          {label}
                        </Typography>
                        <Typography
                          variant="body2"
                          sx={{
                            fontWeight: 700,
                            color: label === 'SMART Health' && probe.smartPassed === false ? 'error.main' : 'text.primary',
                          }}
                        >
                          {val}
                        </Typography>
                      </Paper>
                    </Grid>
                  ))}
                </Grid>

                {probe.smartSelfTest && (
                  <Paper sx={{ p: 2, backgroundColor: 'rgba(59, 130, 246, 0.1)', border: '1px solid rgba(59, 130, 246, 0.3)', borderRadius: 2 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                      <StatusChip value="running" size="small" />
                      <Box>
                        <Typography variant="body2" sx={{ fontWeight: 700 }}>
                          {smartSelfTestLabel(probe.smartSelfTest)}
                        </Typography>
                        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                          {probe.smartSelfTest.status || 'Detected from drive firmware'}
                        </Typography>
                      </Box>
                    </Box>
                  </Paper>
                )}
              </CardContent>
            </Card>
          </Grid>

          {/* Selected Test / Live Progress Panel */}
          <Grid item xs={12} md={6}>
            <Card sx={{ height: '100%', p: 1 }}>
              <CardContent>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                  <Box>
                    <Typography variant="caption" sx={{ color: 'secondary.light', fontWeight: 700, letterSpacing: '0.05em' }}>
                      LIVE PROGRESS
                    </Typography>
                    <Typography variant="h6" sx={{ fontWeight: 800 }}>
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
                        <Typography variant="h3" sx={{ fontWeight: 800, color: 'primary.light' }}>
                          {percent.toFixed(1)}%
                        </Typography>
                        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                          complete
                        </Typography>
                      </Box>
                      <Box sx={{ flex: 1 }}>
                        <StatusChip value={selected.status} size="medium" />
                        <Typography variant="h6" sx={{ fontWeight: 700, mt: 0.5 }}>
                          {selected.profileName || statusLabel(selected.kind)}
                        </Typography>
                        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                          {selected.currentPhase || selected.error || 'Waiting for worker update'}
                        </Typography>
                      </Box>
                    </Box>

                    <LinearProgress variant="determinate" value={percent} sx={{ height: 10, borderRadius: 5, mb: 3 }} />

                    <Grid container spacing={1.5} sx={{ mb: 3 }}>
                      <Grid item xs={4}>
                        <Paper sx={{ p: 1.5, textAlign: 'center', backgroundColor: 'rgba(255, 255, 255, 0.02)' }}>
                          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                            Checked
                          </Typography>
                          <Typography variant="body2" sx={{ fontWeight: 700 }}>
                            {fmtBytes(selected.completedBytes)} / {fmtBytes(selected.totalBytes)}
                          </Typography>
                        </Paper>
                      </Grid>
                      <Grid item xs={4}>
                        <Paper sx={{ p: 1.5, textAlign: 'center', backgroundColor: 'rgba(255, 255, 255, 0.02)' }}>
                          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                            Performance
                          </Typography>
                          <Typography variant="body2" sx={{ fontWeight: 700, color: 'secondary.light' }}>
                            {fmtSpeed(selected.readBps)}
                          </Typography>
                        </Paper>
                      </Grid>
                      <Grid item xs={4}>
                        <Paper sx={{ p: 1.5, textAlign: 'center', backgroundColor: 'rgba(255, 255, 255, 0.02)' }}>
                          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                            Errors
                          </Typography>
                          <Typography variant="body2" sx={{ fontWeight: 700, color: (selected.errors?.length || 0) > 0 ? 'error.main' : 'success.main' }}>
                            {selected.errors?.length || 0}
                          </Typography>
                        </Paper>
                      </Grid>
                    </Grid>

                    <JobActions job={selected} role={role} onAction={onAction} verbose />
                  </Box>
                ) : (
                  <Paper sx={{ p: 4, textAlign: 'center', backgroundColor: 'rgba(255, 255, 255, 0.02)', border: '1px dashed rgba(255, 255, 255, 0.1)' }}>
                    <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                      No test is associated with this drive.
                    </Typography>
                  </Paper>
                )}
              </CardContent>
            </Card>
          </Grid>
        </Grid>

        {/* Sector Map Section */}
        <Card sx={{ mb: 4, p: 1 }}>
          <CardContent>
            <Box sx={{ mb: 2 }}>
              <Typography variant="caption" sx={{ color: 'primary.light', fontWeight: 700, letterSpacing: '0.05em' }}>
                REAL-TIME MEDIA VIEW
              </Typography>
              <Typography variant="h6" sx={{ fontWeight: 800 }}>
                Full Sector Map
              </Typography>
              <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                Mapped from durable byte checkpoints and sector errors
              </Typography>
            </Box>
            <SurfaceMap job={surface} />
          </CardContent>
        </Card>

        {/* Integrity Cross-Check Banner */}
        <Card
          sx={{
            mb: 4,
            p: 1,
            backgroundColor:
              assessment.kind === 'suspicious'
                ? 'rgba(239, 68, 68, 0.08)'
                : assessment.kind === 'consistent'
                ? 'rgba(16, 185, 129, 0.08)'
                : 'rgba(245, 158, 11, 0.08)',
            border:
              assessment.kind === 'suspicious'
                ? '1px solid rgba(239, 68, 68, 0.3)'
                : assessment.kind === 'consistent'
                ? '1px solid rgba(16, 185, 129, 0.3)'
                : '1px solid rgba(245, 158, 11, 0.3)',
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
              <Typography variant="h6" sx={{ fontWeight: 800 }}>
                {assessment.label}
              </Typography>
            </Box>
            {assessment.evidence.map((item) => (
              <Typography key={item} variant="body2" sx={{ color: 'text.secondary', ml: 4, mb: 0.5 }}>
                • {item}
              </Typography>
            ))}
            <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mt: 1.5, fontStyle: 'italic' }}>
              <strong>Heuristic only:</strong> conflicting counters can indicate a reset but do not prove intentional wiping.
            </Typography>
          </CardContent>
        </Card>

        {/* SMART Attribute Table */}
        <Card sx={{ mb: 4, p: 1 }}>
          <CardContent>
            <Box sx={{ mb: 2 }}>
              <Typography variant="caption" sx={{ color: 'secondary.light', fontWeight: 700, letterSpacing: '0.05em' }}>
                COMPLETE DEVICE LOG
              </Typography>
              <Typography variant="h6" sx={{ fontWeight: 800 }}>
                SMART Attribute Table
              </Typography>
              <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                {probe.smartAttributes?.length || 0} attributes · updated {fmtDate(probe.collectedAt)}
              </Typography>
            </Box>
            <Paper sx={{ overflowX: 'auto' }}>
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
                        <TableCell sx={{ fontWeight: 600 }}>{attr.name}</TableCell>
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

        {/* FARM Log Table */}
        <Card sx={{ mb: 4, p: 1 }}>
          <CardContent>
            <Box sx={{ mb: 2 }}>
              <Typography variant="caption" sx={{ color: 'secondary.light', fontWeight: 700, letterSpacing: '0.05em' }}>
                COMPLETE DEVICE LOG
              </Typography>
              <Typography variant="h6" sx={{ fontWeight: 800 }}>
                Seagate FARM Table
              </Typography>
              <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                {farm.length} scalar metrics
              </Typography>
            </Box>
            <Paper sx={{ overflowX: 'auto' }}>
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
                        <TableCell sx={{ fontFamily: 'monospace', color: 'primary.light' }}>
                          {metric.replaceAll('.', ' › ')}
                        </TableCell>
                        <TableCell sx={{ fontWeight: 600 }}>{val}</TableCell>
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

        {/* All Tests Timeline */}
        <Card sx={{ mb: 4, p: 1 }}>
          <CardContent>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2, flexWrap: 'wrap', gap: 2 }}>
              <Box>
                <Typography variant="caption" sx={{ color: 'primary.light', fontWeight: 700, letterSpacing: '0.05em' }}>
                  EVIDENCE TIMELINE
                </Typography>
                <Typography variant="h6" sx={{ fontWeight: 800 }}>
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
                <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                  {driveJobs.length} retained job{driveJobs.length === 1 ? '' : 's'}
                </Typography>
              </Box>
            </Box>

            <Paper sx={{ overflowX: 'auto' }}>
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
                        <TableCell sx={{ fontFamily: 'monospace', fontWeight: 700 }}>{j.id}</TableCell>
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
