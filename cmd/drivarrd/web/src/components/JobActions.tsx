import React from 'react';
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
    <div className={verbose ? 'workspace-actions' : 'actions'}>
      {job.status === 'running' && ['surface_read', 'destructive_verify'].includes(job.kind) && (
        <button className={verbose ? 'tonal' : ''} onClick={() => onAction(job, 'pause')}>
          {verbose ? 'Pause test' : 'Pause'}
        </button>
      )}

      {['paused', 'interrupted'].includes(job.status) && (
        <button className={verbose ? 'filled' : ''} onClick={() => onAction(job, 'resume')}>
          {verbose ? 'Resume test' : 'Resume'}
        </button>
      )}

      {(active || job.status === 'paused') && (
        <button className={verbose ? 'text-button' : ''} onClick={() => onAction(job, 'cancel')}>
          {verbose ? 'Cancel test' : 'Cancel'}
        </button>
      )}

      {reportableStatuses.includes(job.status) && (
        <button className={verbose ? 'tonal' : ''} onClick={() => onAction(job, 'report')}>
          {verbose ? 'Generate PDF' : 'PDF'}
        </button>
      )}

      {deletableStatuses.includes(job.status) && (
        <button className="text-button" onClick={handleDelete}>
          {verbose ? 'Delete test' : 'Delete'}
        </button>
      )}
    </div>
  );
};
