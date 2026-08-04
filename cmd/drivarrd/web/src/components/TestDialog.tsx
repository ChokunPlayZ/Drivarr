import React, { useState } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  Box,
  Typography,
  Alert,
  IconButton,
  ListSubheader,
  Slider,
  Paper,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import WarningIcon from '@mui/icons-material/Warning';
import LockOpenIcon from '@mui/icons-material/LockOpen';
import LockIcon from '@mui/icons-material/Lock';
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
  const [swipeValue, setSwipeValue] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const isPreset = profileId.startsWith('preset:');
  const isDestructive = profiles.find((p) => p.id === profileId)?.kind === 'destructive_verify';
  const isSwipedConfirmed = swipeValue >= 95;
  const probe = device.probe || {};

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (isDestructive && !isSwipedConfirmed) {
      setError('Please swipe all the way to the right to confirm destructive erase.');
      return;
    }

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
        body.serialConfirmation = probe.serial || '';
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
          <Typography variant="caption" color="primary" fontWeight="bold">
            NEW DIAGNOSTIC TEST
          </Typography>
          <Typography variant="h5" fontWeight="bold">
            {probe.model || device.name || device.id}
          </Typography>
        </Box>
        <IconButton aria-label="Close" onClick={onClose}>
          <CloseIcon />
        </IconButton>
      </DialogTitle>

      <Box component="form" onSubmit={handleSubmit}>
        <DialogContent dividers sx={{ p: 3, display: 'flex', flexDirection: 'column', gap: 3 }}>
          {error && <Alert severity="error">{error}</Alert>}

          <FormControl fullWidth>
            <InputLabel id="profile-select-label">Test Profile</InputLabel>
            <Select
              labelId="profile-select-label"
              value={profileId}
              label="Test Profile"
              onChange={(e) => {
                setProfileId(e.target.value);
                setSwipeValue(0);
              }}
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
            <Typography variant="body2" color="text.secondary" sx={{ p: 2, backgroundColor: 'action.hover', borderRadius: 1 }}>
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
            <Paper variant="outlined" sx={{ p: 2.5, borderColor: 'error.main', backgroundColor: 'rgba(239, 68, 68, 0.08)' }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, color: 'error.main', mb: 1 }}>
                <WarningIcon />
                <Typography variant="subtitle2" fontWeight="bold">
                  Destructive Erase Warning
                </Typography>
              </Box>

              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                This test will permanently erase all data on <strong>{probe.model || device.name}</strong> (S/N {probe.serial || 'unavailable'}).
              </Typography>

              <Box
                sx={{
                  p: 2,
                  borderRadius: 2,
                  backgroundColor: isSwipedConfirmed ? 'error.dark' : 'background.paper',
                  border: '1px solid',
                  borderColor: isSwipedConfirmed ? 'error.main' : 'divider',
                  transition: 'all 0.2s ease',
                }}
              >
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                  <Typography variant="caption" fontWeight="bold" color={isSwipedConfirmed ? '#FFF' : 'text.primary'}>
                    {isSwipedConfirmed ? 'SWIPE CONFIRMED — UNLOCKED' : 'SWIPE TO CONFIRM ERASE ▶'}
                  </Typography>
                  {isSwipedConfirmed ? <LockOpenIcon color="inherit" fontSize="small" /> : <LockIcon color="action" fontSize="small" />}
                </Box>

                <Slider
                  value={swipeValue}
                  onChange={(_, val) => setSwipeValue(val as number)}
                  onChangeCommitted={(_, val) => {
                    if ((val as number) < 95) setSwipeValue(0);
                    else setSwipeValue(100);
                  }}
                  color={isSwipedConfirmed ? 'error' : 'primary'}
                  sx={{
                    '& .MuiSlider-thumb': {
                      width: 28,
                      height: 28,
                    },
                  }}
                />
              </Box>
            </Paper>
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
            disabled={loading || (isDestructive && !isSwipedConfirmed)}
            startIcon={<PlayArrowIcon />}
          >
            {loading ? 'Submitting...' : isPreset ? 'Start preset' : 'Start test'}
          </Button>
        </DialogActions>
      </Box>
    </Dialog>
  );
};
