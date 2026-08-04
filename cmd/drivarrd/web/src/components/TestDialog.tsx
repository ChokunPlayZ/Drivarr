import React, { useState } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  Box,
  Typography,
  Alert,
  IconButton,
  ListSubheader,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import WarningIcon from '@mui/icons-material/Warning';
import { Device, Profile, Policy } from '../types';

interface TestDialogProps {
  device: Device;
  profiles: Profile[];
  policies: Policy[];
  initialProfileId?: string;
  onClose: () => void;
  onSubmit: (body: Record<string, string>) => Promise<void>;
}

export const TestDialog: React.FC<TestDialogProps> = ({
  device,
  profiles,
  policies,
  initialProfileId = 'preset:complete-drive-check',
  onClose,
  onSubmit,
}) => {
  const enabledProfiles = profiles.filter((p) => p.enabled);
  const [profileId, setProfileId] = useState(initialProfileId);
  const [policyId, setPolicyId] = useState(policies[0]?.id || '');
  const [serialConfirmation, setSerialConfirmation] = useState('');
  const [reauthPassword, setReauthPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const isPreset = profileId.startsWith('preset:');
  const isDestructive = profiles.find((p) => p.id === profileId)?.kind === 'destructive_verify';
  const probe = device.probe || {};

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const body: Record<string, string> = {
        deviceId: device.id,
        policyId,
      };

      if (isPreset) {
        body.presetId = profileId.slice(7);
      } else {
        body.profileId = profileId;
      }

      if (isDestructive) {
        body.serialConfirmation = serialConfirmation;
        body.reauthPassword = reauthPassword;
      }

      await onSubmit(body);
    } catch (err: any) {
      setError(err.message || 'Failed to start test');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open fullWidth maxWidth="sm" onClose={onClose}>
      <DialogTitle sx={{ m: 0, p: 3, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Box>
          <Typography variant="caption" sx={{ color: 'primary.light', fontWeight: 700, letterSpacing: '0.05em' }}>
            NEW DIAGNOSTIC TEST
          </Typography>
          <Typography variant="h5" sx={{ fontWeight: 800 }}>
            {probe.model || device.name || device.id}
          </Typography>
        </Box>
        <IconButton aria-label="Close" onClick={onClose} sx={{ color: 'text.secondary' }}>
          <CloseIcon />
        </IconButton>
      </DialogTitle>

      <Box component="form" onSubmit={handleSubmit}>
        <DialogContent dividers sx={{ p: 3, display: 'flex', flexDirection: 'column', gap: 3 }}>
          {error && (
            <Alert severity="error" sx={{ borderRadius: 2 }}>
              {error}
            </Alert>
          )}

          <FormControl fullWidth>
            <InputLabel id="profile-select-label">Test Profile</InputLabel>
            <Select
              labelId="profile-select-label"
              value={profileId}
              label="Test Profile"
              onChange={(e) => setProfileId(e.target.value)}
            >
              <ListSubheader disableSticky>Presets</ListSubheader>
              <MenuItem value="preset:complete-drive-check">
                Complete drive check · 3 ordered tests
              </MenuItem>

              <ListSubheader disableSticky>Individual Tests</ListSubheader>
              {enabledProfiles.map((p) => (
                <MenuItem key={p.id} value={p.id}>
                  {p.name}
                  {p.builtIn ? '' : ' · advanced'}
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          {isPreset && (
            <Typography variant="body2" sx={{ color: 'text.secondary', background: 'rgba(255, 255, 255, 0.03)', p: 2, borderRadius: 2 }}>
              Runs read speed and random IOPS, a full non-destructive error scan, then the drive firmware’s extended offline SMART self-test.
            </Typography>
          )}

          <FormControl fullWidth>
            <InputLabel id="policy-select-label">Grading Policy</InputLabel>
            <Select
              labelId="policy-select-label"
              value={policyId}
              label="Grading Policy"
              onChange={(e) => setPolicyId(e.target.value)}
            >
              {policies.map((pol) => (
                <MenuItem key={pol.id} value={pol.id}>
                  {pol.name} · v{pol.version}
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          {isDestructive && (
            <Alert severity="error" icon={<WarningIcon />} sx={{ borderRadius: 2 }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 800, mb: 1 }}>
                This permanently erases the entire drive.
              </Typography>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
                <TextField
                  label="Type the drive serial to confirm"
                  size="small"
                  required
                  fullWidth
                  value={serialConfirmation}
                  onChange={(e) => setSerialConfirmation(e.target.value)}
                />
                <TextField
                  label="Re-enter your password"
                  type="password"
                  size="small"
                  required
                  fullWidth
                  autoComplete="current-password"
                  value={reauthPassword}
                  onChange={(e) => setReauthPassword(e.target.value)}
                />
              </Box>
            </Alert>
          )}
        </DialogContent>

        <DialogActions sx={{ p: 3, gap: 1 }}>
          <Button onClick={onClose} variant="text" color="inherit">
            Cancel
          </Button>
          <Button
            type="submit"
            variant="contained"
            color={isDestructive ? 'error' : 'primary'}
            disabled={loading}
            startIcon={<PlayArrowIcon />}
          >
            {loading ? 'Submitting...' : isPreset ? 'Start preset' : 'Start test'}
          </Button>
        </DialogActions>
      </Box>
    </Dialog>
  );
};
