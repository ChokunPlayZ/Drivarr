import React, { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  IconButton,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  TextField,
  Typography,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import WarningIcon from '@mui/icons-material/Warning';
import AccountTreeIcon from '@mui/icons-material/AccountTree';
import { Device } from '../types';

interface PartitionDialogProps {
  device: Device;
  onClose: () => void;
  onSubmit: (body: Record<string, string>) => Promise<void>;
}

export const PartitionDialog: React.FC<PartitionDialogProps> = ({ device, onClose, onSubmit }) => {
  const [table, setTable] = useState('gpt');
  const [filesystem, setFilesystem] = useState('ext4');
  const [label, setLabel] = useState('');
  const [serialConfirmation, setSerialConfirmation] = useState('');
  const [reauthPassword, setReauthPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const probe = device.probe || {};
  const confirmed = Boolean(probe.serial) && serialConfirmation === probe.serial && reauthPassword.length > 0;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    if (!confirmed) {
      setError('Enter the exact serial number and your password to continue.');
      return;
    }
    setLoading(true);
    try {
      await onSubmit({ table, filesystem, label: filesystem === 'none' ? '' : label, serialConfirmation, reauthPassword });
    } catch (err: any) {
      setError(err.message || 'Partitioning failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open fullWidth maxWidth="sm" onClose={loading ? undefined : onClose}>
      <DialogTitle sx={{ p: 3, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Box>
          <Typography variant="caption" color="error" fontWeight="bold">
            DESTRUCTIVE DRIVE TOOL
          </Typography>
          <Typography variant="h5" fontWeight="bold">
            Create partition
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {probe.model || device.name || device.id} · {device.path}
          </Typography>
        </Box>
        <IconButton aria-label="Close partition tool" onClick={onClose} disabled={loading}>
          <CloseIcon />
        </IconButton>
      </DialogTitle>

      <Box component="form" onSubmit={submit}>
        <DialogContent dividers sx={{ p: 3, display: 'flex', flexDirection: 'column', gap: 2.5 }}>
          <Alert severity="error" icon={<WarningIcon />}>
            This permanently removes every existing partition and all data on this drive. The operation cannot be undone.
          </Alert>
          {error && <Alert severity="error">{error}</Alert>}

          <Box sx={{ display: 'flex', gap: 2 }}>
            <FormControl fullWidth>
              <InputLabel id="partition-table-label">Partition table</InputLabel>
              <Select labelId="partition-table-label" label="Partition table" value={table} onChange={(e) => setTable(e.target.value)}>
                <MenuItem value="gpt">GPT · recommended</MenuItem>
                <MenuItem value="mbr">MBR · legacy systems</MenuItem>
              </Select>
            </FormControl>
            <FormControl fullWidth>
              <InputLabel id="filesystem-label">Filesystem</InputLabel>
              <Select
                labelId="filesystem-label"
                label="Filesystem"
                value={filesystem}
                onChange={(e) => setFilesystem(e.target.value)}
              >
                <MenuItem value="ext4">ext4</MenuItem>
                <MenuItem value="none">Unformatted</MenuItem>
              </Select>
            </FormControl>
          </Box>

          <TextField
            label="Volume label (optional)"
            value={label}
            disabled={filesystem === 'none'}
            inputProps={{ maxLength: 16, pattern: '[A-Za-z0-9 _-]*' }}
            helperText="Up to 16 letters, numbers, spaces, hyphens, or underscores"
            onChange={(e) => setLabel(e.target.value)}
          />

          <Paper variant="outlined" sx={{ p: 2.5, borderColor: 'error.main' }}>
            <Typography variant="subtitle2" fontWeight="bold" sx={{ mb: 1.5 }}>
              Confirm target drive
            </Typography>
            <TextField
              fullWidth
              required
              label={`Type serial: ${probe.serial || 'unavailable'}`}
              value={serialConfirmation}
              autoComplete="off"
              onChange={(e) => setSerialConfirmation(e.target.value)}
              error={serialConfirmation.length > 0 && serialConfirmation !== probe.serial}
              disabled={!probe.serial}
              sx={{ mb: 2 }}
            />
            <TextField
              fullWidth
              required
              type="password"
              label="Administrator password"
              value={reauthPassword}
              autoComplete="current-password"
              onChange={(e) => setReauthPassword(e.target.value)}
            />
          </Paper>
        </DialogContent>

        <DialogActions sx={{ p: 3, gap: 1 }}>
          <Button onClick={onClose} color="inherit" disabled={loading}>Cancel</Button>
          <Button type="submit" variant="contained" color="error" disabled={!confirmed || loading} startIcon={<AccountTreeIcon />}>
            {loading ? 'Partitioning…' : 'Erase and partition'}
          </Button>
        </DialogActions>
      </Box>
    </Dialog>
  );
};
