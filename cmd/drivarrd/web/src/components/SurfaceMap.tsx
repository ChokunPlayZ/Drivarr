import React from 'react';
import { Box, Typography, Tooltip, Grid, Paper, Chip } from '@mui/material';
import { Job } from '../types';
import { fmtBytes, fmtSpeed, statusLabel } from '../api';

interface SurfaceMapProps {
  job?: Job;
}

export const SurfaceMap: React.FC<SurfaceMapProps> = ({ job }) => {
  if (!job) {
    return (
      <Paper
        variant="outlined"
        sx={{
          p: 4,
          textAlign: 'center',
        }}
      >
        <Typography variant="body2" color="text.secondary">
          No surface or drive scan job available to render sector map.
        </Typography>
      </Paper>
    );
  }

  const cells = 384;
  const progress = Math.max(0, Math.min(1, job.progress || 0));
  const current = Math.min(cells - 1, Math.floor(progress * cells));
  const bad = new Set<number>();
  const total = Math.max(1, job.totalBytes || 1);
  const isScanning = ['running', 'validating', 'pause_requested'].includes(job.status);

  for (const error of job.errors || []) {
    const first = Math.max(0, Math.floor((error.offset / total) * cells));
    const last = Math.min(cells - 1, Math.floor(((error.offset + Math.max(1, error.length)) / total) * cells));
    for (let cell = first; cell <= last; cell++) {
      bad.add(cell);
    }
  }

  return (
    <Box sx={{ width: '100%' }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2, flexWrap: 'wrap', gap: 1 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <Chip
            size="small"
            color={isScanning ? 'primary' : job.status === 'paused' ? 'warning' : 'default'}
            label={isScanning ? `Scanning: ${job.profileName || statusLabel(job.kind)}` : `Job ${job.id}: ${statusLabel(job.status)}`}
          />
          {isScanning && (
            <Typography variant="caption" color="primary" fontWeight="bold">
              ● Live Head at Block {current} of {cells}
            </Typography>
          )}
        </Box>
        <Typography variant="caption" color="text.secondary">
          {job.currentPhase || 'Sequential sector inspection'}
        </Typography>
      </Box>

      <Grid container spacing={2} sx={{ mb: 2 }}>
        <Grid item xs={6} sm={3}>
          <Paper variant="outlined" sx={{ p: 1.5 }}>
            <Typography variant="caption" color="text.secondary" display="block">
              Progress
            </Typography>
            <Typography variant="body1" fontWeight="bold" color="primary">
              {(progress * 100).toFixed(1)}%
            </Typography>
          </Paper>
        </Grid>
        <Grid item xs={6} sm={3}>
          <Paper variant="outlined" sx={{ p: 1.5 }}>
            <Typography variant="caption" color="text.secondary" display="block">
              Data Checkpoint
            </Typography>
            <Typography variant="body1" fontWeight="bold">
              {fmtBytes(job.completedBytes)} / {fmtBytes(job.totalBytes)}
            </Typography>
          </Paper>
        </Grid>
        <Grid item xs={6} sm={3}>
          <Paper variant="outlined" sx={{ p: 1.5 }}>
            <Typography variant="caption" color="text.secondary" display="block">
              Current Speed
            </Typography>
            <Typography variant="body1" fontWeight="bold" color="secondary">
              {fmtSpeed(job.readBps)}
            </Typography>
          </Paper>
        </Grid>
        <Grid item xs={6} sm={3}>
          <Paper variant="outlined" sx={{ p: 1.5 }}>
            <Typography variant="caption" color="text.secondary" display="block">
              Unreadable Sectors
            </Typography>
            <Typography
              variant="body1"
              fontWeight="bold"
              color={bad.size > 0 ? 'error' : 'success'}
            >
              {bad.size} ranges
            </Typography>
          </Paper>
        </Grid>
      </Grid>

      {/* Sector Map Grid */}
      <Box
        role="img"
        aria-label="Surface sector block map"
        sx={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(10px, 1fr))',
          gap: '3px',
          p: 2,
          backgroundColor: '#090D16',
          borderRadius: 2,
          border: '1px solid rgba(255, 255, 255, 0.1)',
          maxHeight: 280,
          overflowY: 'auto',
          '@keyframes pulseHead': {
            '0%': { transform: 'scale(1)', boxShadow: '0 0 0 0 rgba(59, 130, 246, 0.7)' },
            '50%': { transform: 'scale(1.5)', boxShadow: '0 0 0 6px rgba(59, 130, 246, 0)' },
            '100%': { transform: 'scale(1)', boxShadow: '0 0 0 0 rgba(59, 130, 246, 0)' },
          },
        }}
      >
        {Array.from({ length: cells }, (_, index) => {
          const isBadCell = bad.has(index);
          const isCurrentCell = index === current && isScanning;
          const isScannedCell = index < current || (progress >= 1 && !isBadCell);

          let bgColor = '#1E293B'; // pending / unscanned
          if (isScannedCell) bgColor = '#10B981'; // green = good
          if (isBadCell) bgColor = '#EF4444'; // red = bad
          if (isCurrentCell) bgColor = '#3B82F6'; // blue = active scanning head

          const start = Math.floor((index / cells) * total);
          const end = Math.floor(((index + 1) / cells) * total);

          return (
            <Tooltip
              key={index}
              title={`Block ${index} (${fmtBytes(start)}–${fmtBytes(end)}) · ${
                isBadCell ? 'unreadable error' : isCurrentCell ? 'active scanning head' : isScannedCell ? 'verified good' : 'pending'
              }`}
              arrow
              placement="top"
            >
              <Box
                sx={{
                  height: 12,
                  borderRadius: '2px',
                  backgroundColor: bgColor,
                  position: 'relative',
                  zIndex: isCurrentCell ? 3 : 1,
                  animation: isCurrentCell ? 'pulseHead 1.2s infinite' : 'none',
                  '&:hover': {
                    transform: 'scale(1.5)',
                    zIndex: 4,
                  },
                }}
              />
            </Tooltip>
          );
        })}
      </Box>

      {/* Legend */}
      <Box sx={{ display: 'flex', gap: 3, mt: 1.5, justifyContent: 'center', flexWrap: 'wrap' }}>
        {[
          { label: 'Verified sector (good)', color: '#10B981' },
          { label: 'Active scanning head', color: '#3B82F6' },
          { label: 'Unreadable error', color: '#EF4444' },
          { label: 'Pending / Unscanned', color: '#1E293B' },
        ].map((item) => (
          <Box key={item.label} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Box sx={{ width: 12, height: 12, borderRadius: '2px', backgroundColor: item.color }} />
            <Typography variant="caption" color="text.secondary">
              {item.label}
            </Typography>
          </Box>
        ))}
      </Box>
    </Box>
  );
};
