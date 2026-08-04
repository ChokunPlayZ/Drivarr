import React from 'react';
import { AppBar, Toolbar, Typography, Box, Button, Chip, Avatar, Tooltip } from '@mui/material';
import StorageIcon from '@mui/icons-material/Storage';
import AssessmentIcon from '@mui/icons-material/Assessment';
import SettingsIcon from '@mui/icons-material/Settings';
import LogoutIcon from '@mui/icons-material/Logout';
import CircleIcon from '@mui/icons-material/Circle';
import { User } from '../types';

interface NavbarProps {
  user: User;
  deviceCount: number;
  connected: boolean;
  activeTab: string;
  onSelectTab: (tab: 'drives' | 'reports' | 'admin') => void;
  onLogout: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  user,
  deviceCount,
  connected,
  activeTab,
  onSelectTab,
  onLogout,
}) => {
  return (
    <AppBar
      position="sticky"
      sx={{
        backgroundColor: 'rgba(17, 24, 39, 0.9)',
        backdropFilter: 'blur(12px)',
        borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
        boxShadow: '0 4px 20px rgba(0, 0, 0, 0.4)',
      }}
    >
      <Toolbar sx={{ justifyContent: 'space-between', px: { xs: 2, md: 4 } }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <Box
            sx={{
              width: 40,
              height: 40,
              borderRadius: 3,
              background: 'linear-gradient(135deg, #6366F1 0%, #06B6D4 100%)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontWeight: 800,
              fontSize: '1.3rem',
              color: '#FFF',
              boxShadow: '0 0 15px rgba(99, 102, 241, 0.4)',
            }}
          >
            D
          </Box>
          <Box>
            <Typography variant="h6" sx={{ fontWeight: 700, lineHeight: 1.1 }}>
              Drivarr
            </Typography>
            <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 500 }}>
              {deviceCount} drive{deviceCount === 1 ? '' : 's'} connected
            </Typography>
          </Box>
          <Tooltip title={connected ? 'System Online' : 'Reconnecting...'}>
            <Chip
              size="small"
              icon={
                <CircleIcon
                  sx={{
                    fontSize: '10px !important',
                    color: connected ? '#10B981 !important' : '#EF4444 !important',
                  }}
                />
              }
              label={connected ? 'Online' : 'Offline'}
              sx={{
                ml: 1,
                backgroundColor: connected ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)',
                borderColor: connected ? 'rgba(16, 185, 129, 0.3)' : 'rgba(239, 68, 68, 0.3)',
                color: connected ? '#34D399' : '#F87171',
              }}
              variant="outlined"
            />
          </Tooltip>
        </Box>

        <Box sx={{ display: 'flex', gap: 1 }}>
          <Button
            startIcon={<StorageIcon />}
            variant={activeTab === 'drives' ? 'contained' : 'text'}
            color={activeTab === 'drives' ? 'primary' : 'inherit'}
            onClick={() => onSelectTab('drives')}
            sx={{ px: 2.5, py: 1, borderRadius: 2.5, fontWeight: 700 }}
          >
            Drives
          </Button>

          <Button
            startIcon={<AssessmentIcon />}
            variant={activeTab === 'reports' ? 'contained' : 'text'}
            color={activeTab === 'reports' ? 'primary' : 'inherit'}
            onClick={() => onSelectTab('reports')}
            sx={{ px: 2.5, py: 1, borderRadius: 2.5, fontWeight: 700 }}
          >
            Reports
          </Button>

          {user.role === 'admin' && (
            <Button
              startIcon={<SettingsIcon />}
              variant={activeTab === 'admin' ? 'contained' : 'text'}
              color={activeTab === 'admin' ? 'primary' : 'inherit'}
              onClick={() => onSelectTab('admin')}
              sx={{ px: 2.5, py: 1, borderRadius: 2.5, fontWeight: 700 }}
            >
              Settings
            </Button>
          )}
        </Box>

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <Avatar
            sx={{
              width: 34,
              height: 34,
              bgcolor: 'primary.dark',
              fontSize: '0.875rem',
              fontWeight: 700,
            }}
          >
            {user.username.charAt(0).toUpperCase()}
          </Avatar>

          <Button
            color="inherit"
            size="small"
            onClick={onLogout}
            startIcon={<LogoutIcon />}
            sx={{ color: 'text.secondary', '&:hover': { color: 'error.main' } }}
          >
            Sign out
          </Button>
        </Box>
      </Toolbar>
    </AppBar>
  );
};
