import React from 'react';
import { statusLabel } from '../api';

interface StatusChipProps {
  value?: string;
  children?: React.ReactNode;
}

export const StatusChip: React.FC<StatusChipProps> = ({ value, children }) => {
  const norm = String(value || 'neutral').toLowerCase();
  return (
    <span className={`status status-${norm}`}>
      {children || statusLabel(value)}
    </span>
  );
};
