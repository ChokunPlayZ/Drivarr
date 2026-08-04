import React, { useState } from 'react';
import {
  Grid,
  Card,
  CardContent,
  Typography,
  TextField,
  FormControlLabel,
  Checkbox,
  Button,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  Box,
  Table,
  TableHead,
  TableRow,
  TableCell,
  TableBody,
  Paper,
  Divider,
  Chip,
  Alert,
} from '@mui/material';
import SaveIcon from '@mui/icons-material/Save';
import PersonAddIcon from '@mui/icons-material/PersonAdd';
import LockResetIcon from '@mui/icons-material/LockReset';
import AddCircleOutlinedIcon from '@mui/icons-material/AddCircleOutlined';
import PolicyIcon from '@mui/icons-material/Policy';
import { Settings, User, AuditEvent } from '../types';
import { fmtDate } from '../api';

interface AdminPanelProps {
  settings: Settings | null;
  users: User[];
  audit: AuditEvent[];
  onSettings: (form: HTMLFormElement) => Promise<void>;
  onUser: (form: HTMLFormElement) => Promise<void>;
  onPassword: (form: HTMLFormElement) => Promise<void>;
  onProfile: (form: HTMLFormElement) => Promise<void>;
  onPolicy: (form: HTMLFormElement) => Promise<void>;
}

export const AdminPanel: React.FC<AdminPanelProps> = ({
  settings,
  users,
  audit,
  onSettings,
  onUser,
  onPassword,
  onProfile,
  onPolicy,
}) => {
  if (!settings) return null;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {/* Header */}
      <Box>
        <Typography variant="caption" sx={{ color: 'primary.light', fontWeight: 700, letterSpacing: '0.05em' }}>
          SYSTEM CONTROL
        </Typography>
        <Typography variant="h4" sx={{ fontWeight: 800 }}>
          Administration & Policy Configuration
        </Typography>
      </Box>

      <Grid container spacing={3}>
        {/* Form 1: Testing Policy Settings */}
        <Grid item xs={12} md={6}>
          <Card sx={{ height: '100%', p: 1 }}>
            <CardContent>
              <Typography variant="h6" sx={{ fontWeight: 700, mb: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
                <SaveIcon color="primary" /> Testing Policy & Engine Limits
              </Typography>
              <Box
                component="form"
                onSubmit={async (e) => {
                  e.preventDefault();
                  await onSettings(e.currentTarget);
                }}
                sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}
              >
                <TextField label="Organization Name" name="organization" required defaultValue={settings.organization} size="small" fullWidth />
                <Grid container spacing={2}>
                  <Grid item xs={6}>
                    <TextField label="Max Concurrent Jobs" name="maxConcurrentJobs" type="number" required defaultValue={settings.maxConcurrentJobs} slotProps={{ htmlInput: { min: 1, max: 32 } }} size="small" fullWidth />
                  </Grid>
                  <Grid item xs={6}>
                    <TextField label="Max Destructive Jobs" name="maxDestructiveJobs" type="number" required defaultValue={settings.maxDestructiveJobs} slotProps={{ htmlInput: { min: 1, max: 32 } }} size="small" fullWidth />
                  </Grid>
                  <Grid item xs={6}>
                    <TextField label="Chunk Size (MiB)" name="jobChunkMiB" type="number" required defaultValue={settings.jobChunkMiB} slotProps={{ htmlInput: { min: 16, max: 4096 } }} size="small" fullWidth />
                  </Grid>
                  <Grid item xs={6}>
                    <TextField label="Report Retention (Days)" name="retentionDays" type="number" required defaultValue={settings.retentionDays} slotProps={{ htmlInput: { min: 0 } }} size="small" fullWidth />
                  </Grid>
                  <Grid item xs={12}>
                    <TextField label="Report Storage Limit Bytes (0=unlimited)" name="retentionMaxBytes" type="number" required defaultValue={settings.retentionMaxBytes} slotProps={{ htmlInput: { min: 0 } }} size="small" fullWidth />
                  </Grid>
                </Grid>
                <FormControlLabel
                  control={<Checkbox name="destructiveEnabled" defaultChecked={settings.destructiveEnabled} color="error" />}
                  label="Enable destructive verification workloads"
                />
                <Button type="submit" variant="contained" color="primary" startIcon={<SaveIcon />}>
                  Save Settings
                </Button>
              </Box>
            </CardContent>
          </Card>
        </Grid>

        {/* Form 2: User Management */}
        <Grid item xs={12} md={6}>
          <Card sx={{ height: '100%', p: 1 }}>
            <CardContent>
              <Typography variant="h6" sx={{ fontWeight: 700, mb: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
                <PersonAddIcon color="secondary" /> Account Management
              </Typography>
              <Box
                component="form"
                onSubmit={async (e) => {
                  e.preventDefault();
                  const form = e.currentTarget;
                  await onUser(form);
                  form.reset();
                }}
                sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}
              >
                <TextField label="Username" name="username" required slotProps={{ htmlInput: { minLength: 3 } }} size="small" fullWidth />
                <TextField label="Temporary Password" name="password" type="password" required slotProps={{ htmlInput: { minLength: 12 } }} size="small" fullWidth />
                <FormControl size="small" fullWidth>
                  <InputLabel id="role-label">Role</InputLabel>
                  <Select labelId="role-label" name="role" defaultValue="viewer" label="Role">
                    <MenuItem value="viewer">Viewer</MenuItem>
                    <MenuItem value="operator">Operator</MenuItem>
                    <MenuItem value="admin">Administrator</MenuItem>
                  </Select>
                </FormControl>
                <Button type="submit" variant="contained" color="secondary" startIcon={<PersonAddIcon />}>
                  Create User Account
                </Button>
              </Box>

              <Divider sx={{ my: 2.5 }} />

              <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1, color: 'text.secondary' }}>
                Existing System Users ({users.length})
              </Typography>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, maxHeight: 160, overflowY: 'auto' }}>
                {users.map((u) => (
                  <Paper key={u.id || u.username} sx={{ p: 1.5, display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: 'rgba(255, 255, 255, 0.02)' }}>
                    <Typography variant="body2" sx={{ fontWeight: 700 }}>
                      {u.username}
                    </Typography>
                    <Chip size="small" label={u.role} color={u.role === 'admin' ? 'primary' : u.role === 'operator' ? 'secondary' : 'default'} variant="outlined" />
                  </Paper>
                ))}
              </Box>
            </CardContent>
          </Card>
        </Grid>

        {/* Form 3: Password Change */}
        <Grid item xs={12} md={4}>
          <Card sx={{ height: '100%', p: 1 }}>
            <CardContent>
              <Typography variant="h6" sx={{ fontWeight: 700, mb: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
                <LockResetIcon color="warning" /> Security & Password
              </Typography>
              <Box
                component="form"
                onSubmit={async (e) => {
                  e.preventDefault();
                  const form = e.currentTarget;
                  await onPassword(form);
                  form.reset();
                }}
                sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}
              >
                <TextField label="Current Password" name="currentPassword" type="password" required size="small" fullWidth />
                <TextField label="New Password (min 12 chars)" name="newPassword" type="password" required slotProps={{ htmlInput: { minLength: 12 } }} size="small" fullWidth />
                <Button type="submit" variant="outlined" color="warning" startIcon={<LockResetIcon />}>
                  Change Password
                </Button>
              </Box>
            </CardContent>
          </Card>
        </Grid>

        {/* Form 4: Create Advanced Profile */}
        <Grid item xs={12} md={4}>
          <Card sx={{ height: '100%', p: 1 }}>
            <CardContent>
              <Typography variant="h6" sx={{ fontWeight: 700, mb: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
                <AddCircleOutlinedIcon color="info" /> Custom Test Profile
              </Typography>
              <Box
                component="form"
                onSubmit={async (e) => {
                  e.preventDefault();
                  const form = e.currentTarget;
                  await onProfile(form);
                  form.reset();
                }}
                sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}
              >
                <TextField label="Profile Name" name="name" required size="small" fullWidth />
                <FormControl size="small" fullWidth>
                  <InputLabel id="kind-label">Test Type</InputLabel>
                  <Select labelId="kind-label" name="kind" defaultValue="speed" label="Test Type">
                    <MenuItem value="speed">Speed Test</MenuItem>
                    <MenuItem value="surface_read">Surface Read</MenuItem>
                    <MenuItem value="destructive_verify">Destructive Verification</MenuItem>
                  </Select>
                </FormControl>
                <Grid container spacing={1.5}>
                  <Grid item xs={6}>
                    <TextField label="Block Size (KiB)" name="blockSizeKiB" type="number" defaultValue="1024" slotProps={{ htmlInput: { min: 4, max: 16384 } }} size="small" fullWidth />
                  </Grid>
                  <Grid item xs={6}>
                    <TextField label="Queue Depth" name="queueDepth" type="number" defaultValue="1" slotProps={{ htmlInput: { min: 1, max: 128 } }} size="small" fullWidth />
                  </Grid>
                  <Grid item xs={6}>
                    <TextField label="Duration (sec)" name="durationSeconds" type="number" defaultValue="15" slotProps={{ htmlInput: { min: 0, max: 86400 } }} size="small" fullWidth />
                  </Grid>
                  <Grid item xs={6}>
                    <TextField label="Rate Limit (MiB/s)" name="rateMiB" type="number" defaultValue="0" slotProps={{ htmlInput: { min: 0 } }} size="small" fullWidth />
                  </Grid>
                </Grid>
                <Button type="submit" variant="outlined" color="info" startIcon={<AddCircleOutlinedIcon />}>
                  Create Profile
                </Button>
              </Box>
            </CardContent>
          </Card>
        </Grid>

        {/* Form 5: Create Grading Policy */}
        <Grid item xs={12} md={4}>
          <Card sx={{ height: '100%', p: 1 }}>
            <CardContent>
              <Typography variant="h6" sx={{ fontWeight: 700, mb: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
                <PolicyIcon color="success" /> Custom Grading Policy
              </Typography>
              <Box
                component="form"
                onSubmit={async (e) => {
                  e.preventDefault();
                  const form = e.currentTarget;
                  await onPolicy(form);
                  form.reset();
                }}
                sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}
              >
                <TextField label="Policy Name" name="name" required size="small" fullWidth />
                <FormControlLabel control={<Checkbox name="failOnSmart" defaultChecked color="success" />} label="Fail on SMART failure" />
                <FormControlLabel control={<Checkbox name="failOnIoError" defaultChecked color="success" />} label="Fail on I/O error" />
                <TextField label="Warn Pending Sectors Above" name="warnPendingAbove" type="number" defaultValue="0" slotProps={{ htmlInput: { min: 0 } }} size="small" fullWidth />
                <TextField label="Warn Reallocated Above" name="warnReallocatedAbove" type="number" defaultValue="0" slotProps={{ htmlInput: { min: 0 } }} size="small" fullWidth />
                <TextField label="Warn Uncorrectable Above" name="warnUncorrectableAbove" type="number" defaultValue="0" slotProps={{ htmlInput: { min: 0 } }} size="small" fullWidth />
                <Button type="submit" variant="outlined" color="success" startIcon={<PolicyIcon />}>
                  Create Policy
                </Button>
              </Box>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* Audit Log Table */}
      <Box sx={{ mt: 2 }}>
        <Typography variant="caption" sx={{ color: 'secondary.light', fontWeight: 700, letterSpacing: '0.05em' }}>
          ACCOUNTABILITY & TRACEABILITY
        </Typography>
        <Typography variant="h5" sx={{ fontWeight: 800, mb: 2 }}>
          System Audit Log
        </Typography>
        <Paper sx={{ overflowX: 'auto', borderRadius: 3 }}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Timestamp</TableCell>
                <TableCell>Action Executed</TableCell>
                <TableCell>User Account</TableCell>
                <TableCell>Target Resource</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {audit.map((event, index) => (
                <TableRow key={`${event.at}-${event.action}-${index}`} hover>
                  <TableCell>{fmtDate(event.at)}</TableCell>
                  <TableCell sx={{ fontWeight: 600, color: 'primary.light' }}>{event.action}</TableCell>
                  <TableCell>{event.userId || 'system'}</TableCell>
                  <TableCell sx={{ fontFamily: 'monospace' }}>{event.target || '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Paper>
      </Box>
    </Box>
  );
};
