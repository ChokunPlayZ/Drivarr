import React from 'react';
import { Chip, ChipProps } from '@mui/material';
import CheckCircleOutlinedIcon from '@mui/icons-material/CheckCircleOutlined';
import ErrorOutlinedIcon from '@mui/icons-material/ErrorOutlined';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import HourglassEmptyIcon from '@mui/icons-material/HourglassEmpty';
import PauseCircleOutlinedIcon from '@mui/icons-material/PauseCircleOutlined';
import PlayCircleOutlinedIcon from '@mui/icons-material/PlayCircleOutlined';
import CancelOutlinedIcon from '@mui/icons-material/CancelOutlined';
import { statusLabel } from '../api';

interface StatusChipProps extends Omit<ChipProps, 'color'> {
  value?: string;
}

export const StatusChip: React.FC<StatusChipProps> = ({ value, label, size = 'small', ...props }) => {
  const status = String(value || 'unknown').toLowerCase();
  const text = label || statusLabel(status);

  let color: 'default' | 'primary' | 'secondary' | 'error' | 'info' | 'success' | 'warning' = 'default';
  let icon = <HourglassEmptyIcon fontSize="small" />;
  let customStyle = {};

  if (['healthy', 'completed', 'passed', 'pass', 'consistent'].includes(status)) {
    color = 'success';
    icon = <CheckCircleOutlinedIcon fontSize="small" />;
  } else if (['running', 'validating', 'active'].includes(status)) {
    color = 'primary';
    icon = <PlayCircleOutlinedIcon fontSize="small" />;
  } else if (['paused', 'pause_requested'].includes(status)) {
    color = 'warning';
    icon = <PauseCircleOutlinedIcon fontSize="small" />;
  } else if (['completed_with_warnings', 'suspicious', 'warning', 'queued'].includes(status)) {
    color = 'warning';
    icon = <WarningAmberIcon fontSize="small" />;
  } else if (['failed', 'bad', 'quarantined', 'error'].includes(status)) {
    color = 'error';
    icon = <ErrorOutlinedIcon fontSize="small" />;
  } else if (['cancelled', 'interrupted'].includes(status)) {
    color = 'default';
    icon = <CancelOutlinedIcon fontSize="small" />;
    customStyle = { opacity: 0.7 };
  }

  return (
    <Chip
      size={size}
      color={color}
      icon={icon}
      label={text}
      sx={customStyle}
      variant="outlined"
      {...props}
    />
  );
};
