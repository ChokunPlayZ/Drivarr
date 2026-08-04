import React from 'react';
import { Box, Typography, Tooltip, Grid, Paper } from '@mui/material';
import { Job } from '../types';
import { fmtBytes, fmtSpeed } from '../api';

interface SurfaceMapProps {
  job?: Job;
}

export const SurfaceMap: React.FC<SurfaceMapProps> = ({ job }) => {
  if (!job) {
    return (
      <Paper
        sx={{
          p: 4,
          textAlign: 'center',
          backgroundColor: 'rgba(255, 255, 255, 0.02)',
          border: '1px dashed rgba(255, 255, 255, 0.1)',
          borderRadius: 3,
        }}
      >
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
          No surface scan has been run on this drive.
        </Typography>
      </Paper>
    );
  }

  const cells = 384;
  const progress = Math.max(0, Math.min(1, job.progress || 0));
  const current = Math.min(cells - 1, Math.floor(progress * cells));
  const bad = new Set<number>();
  const total = Math.max(1, job.totalBytes || 1);

  for (const error of job.errors || []) {
    const first = Math.max(0, Math.floor((error.offset / total) * cells));
    const last = Math.min(cells - 1, Math.floor(((error.offset + Math.max(1, error.length)) / total) * cells));
    for (let cell = first; cell <= last; cell++) {
      bad.add(cell);
    }
  }

  return (
    <Box sx={{ width: '100%' }}>
      {/* Map Metadata Bar */}
      <Grid container spacing={2} sx={{ mb: 2 }}>
        <Grid item xs={6} sm={3}>
          <Box sx={{ backgroundColor: 'rgba(255, 255, 255, 0.03)', p: 1.5, borderRadius: 2 }}>
            <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block' }}>
              Scanned
            </Typography>
            <Typography variant="body1" sx={{ fontWeight: 700, color: 'primary.light' }}>
              {(progress * 100).toFixed(1)}%
            </Typography>
          </Box>
        </Grid>
        <Grid item xs={6} sm={3}>
          <Box sx={{ backgroundColor: 'rgba(255, 255, 255, 0.03)', p: 1.5, borderRadius: 2 }}>
            <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block' }}>
              Completed Data
            </Typography>
            <Typography variant="body1" sx={{ fontWeight: 700 }}>
              {fmtBytes(job.completedBytes)} / {fmtBytes(job.totalBytes)}
            </Typography>
          </Box>
        </Grid>
        <Grid item xs={6} sm={3}>
          <Box sx={{ backgroundColor: 'rgba(255, 255, 255, 0.03)', p: 1.5, borderRadius: 2 }}>
            <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block' }}>
              Current Speed
            </Typography>
            <Typography variant="body1" sx={{ fontWeight: 700, color: 'secondary.light' }}>
              {fmtSpeed(job.readBps)}
            </Typography>
          </Box>
        </Grid>
        <Grid item xs={6} sm={3}>
          <Box sx={{ backgroundColor: 'rgba(255, 255, 255, 0.03)', p: 1.5, borderRadius: 2 }}>
            <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block' }}>
              Bad Blocks
            </Typography>
            <Typography
              variant="body1"
              sx={{ fontWeight: 700, color: bad.size > 0 ? 'error.main' : 'success.main' }}
            >
              {bad.size} ranges
            </Typography>
          </Box>
        </Grid>
      </Grid>

      {/* Grid of Sector Cells */}
      <Box
        role="img"
        aria-label="Full surface scan block map"
        sx={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(10px, 1fr))',
          gap: '3px',
          p: 2,
          backgroundColor: '#090D16',
          borderRadius: 3,
          border: '1px solid rgba(255, 255, 255, 0.08)',
          maxHeight: 280,
          overflowY: 'auto',
        }}
      >
        {Array.from({ length: cells }, (_, index) => {
          const type = bad.has(index)
            ? 'bad'
            : index > current
            ? 'pending'
            : index === current && progress < 1
            ? 'current'
            : 'good';

          const start = Math.floor((index / cells) * total);
          const end = Math.floor(((index + 1) / cells) * total);

          let bgColor = '#1E293B'; // pending
          if (type === 'good') bgColor = '#10B981';
          if (type === 'current') bgColor = '#3B82F6';
          if (type === 'bad') bgColor = '#EF4444';

          return (
            <Tooltip
              key={index}
              title={`${fmtBytes(start)}–${fmtBytes(end)} · ${type === 'bad' ? 'unreadable' : type}`}
              arrow
              placement="top"
            >
              <Box
                sx={{
                  height: 12,
                  borderRadius: '2px',
                  backgroundColor: bgColor,
                  transition: 'transform 0.1s ease',
                  animation: type === 'current' ? 'pulse 1s infinite' : 'none',
                  '&:hover': {
                    transform: 'scale(1.4)',
                    zIndex: 2,
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
          { label: 'Read successfully', color: '#10B981' },
          { label: 'Current range', color: '#3B82F6' },
          { label: 'Unreadable sector', color: '#EF4444' },
          { label: 'Not scanned', color: '#1E293B' },
        ].map((item) => (
          <Box key={item.label} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Box sx={{ width: 12, height: 12, borderRadius: '2px', backgroundColor: item.color }} />
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>
              {item.label}
            </Typography>
          </Box>
        ))}
      </Box>
    </Box>
  );
};
