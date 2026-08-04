import React from 'react';
import { Box, Button, Tooltip } from '@mui/material';
import PauseIcon from '@mui/icons-material/Pause';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import CancelIcon from '@mui/icons-material/Cancel';
import PictureAsPdfIcon from '@mui/icons-material/PictureAsPdf';
import DeleteIcon from '@mui/icons-material/Delete';
import { Job } from '../types';

const activeStatuses = ['queued', 'validating', 'running', 'pause_requested'];
const reportableStatuses = ['completed', 'completed_with_warnings', 'failed', 'cancelled', 'interrupted'];
const deletableStatuses = ['failed', 'cancelled', 'interrupted'];

interface JobActionsProps {
  job: Job;
  role: string;
  onAction: (job: Job, action: string) => void;
  verbose?: boolean;
}

export const JobActions: React.FC<JobActionsProps> = ({ job, role, onAction, verbose = false }) => {
  if (role === 'viewer') return null;

  const active = activeStatuses.includes(job.status);

  const handleDelete = () => {
    if (confirm('Delete this incomplete test? This cannot be undone.')) {
      onAction(job, 'delete');
    }
  };

  return (
    <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
      {job.status === 'running' && ['surface_read', 'destructive_verify'].includes(job.kind) && (
        <Button
          size="small"
          variant={verbose ? 'outlined' : 'text'}
          color="warning"
          startIcon={<PauseIcon />}
          onClick={() => onAction(job, 'pause')}
        >
          {verbose ? 'Pause test' : 'Pause'}
        </Button>
      )}

      {['paused', 'interrupted'].includes(job.status) && (
        <Button
          size="small"
          variant="contained"
          color="primary"
          startIcon={<PlayArrowIcon />}
          onClick={() => onAction(job, 'resume')}
        >
          {verbose ? 'Resume test' : 'Resume'}
        </Button>
      )}

      {(active || job.status === 'paused') && (
        <Button
          size="small"
          variant="text"
          color="error"
          startIcon={<CancelIcon />}
          onClick={() => onAction(job, 'cancel')}
        >
          {verbose ? 'Cancel test' : 'Cancel'}
        </Button>
      )}

      {reportableStatuses.includes(job.status) && (
        <Button
          size="small"
          variant={verbose ? 'contained' : 'outlined'}
          color="secondary"
          startIcon={<PictureAsPdfIcon />}
          onClick={() => onAction(job, 'report')}
        >
          {verbose ? 'Generate PDF' : 'PDF'}
        </Button>
      )}

      {deletableStatuses.includes(job.status) && (
        <Tooltip title="Delete test record">
          <Button size="small" variant="text" color="error" startIcon={<DeleteIcon />} onClick={handleDelete}>
            {verbose ? 'Delete test' : 'Delete'}
          </Button>
        </Tooltip>
      )}
    </Box>
  );
};
