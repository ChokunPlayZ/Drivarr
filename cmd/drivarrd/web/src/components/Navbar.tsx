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
  onSelectTab: (tab: string) => void;
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
        backgroundColor: 'rgba(17, 24, 39, 0.85)',
        backdropFilter: 'blur(12px)',
        borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
        boxShadow: '0 4px 20px rgba(0, 0, 0, 0.4)',
      }}
    >
      <Toolbar sx={{ justifyContent: 'space-between', px: { xs: 2, md: 4 } }}>
        {/* Brand Section */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <Box
            sx={{
              width: 42,
              height: 42,
              borderRadius: 3,
              background: 'linear-gradient(135deg, #6366F1 0%, #06B6D4 100%)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontWeight: 800,
              fontSize: '1.4rem',
              color: '#FFF',
              boxShadow: '0 0 15px rgba(99, 102, 241, 0.5)',
            }}
          >
            D
          </Box>
          <Box>
            <Typography variant="h6" sx={{ fontWeight: 700, lineHeight: 1.1, letterSpacing: '-0.01em' }}>
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
                    animation: connected ? 'pulse 2s infinite' : 'none',
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

        {/* Navigation Tabs */}
        <Box sx={{ display: 'flex', gap: 1 }}>
          <Button
            startIcon={<StorageIcon />}
            variant={activeTab === 'drives' ? 'contained' : 'text'}
            color={activeTab === 'drives' ? 'primary' : 'inherit'}
            onClick={() => onSelectTab('drives')}
            sx={{
              px: 2.5,
              py: 1,
              borderRadius: 2.5,
              fontWeight: 600,
              color: activeTab === 'drives' ? '#FFF' : 'text.secondary',
            }}
          >
            Drives
          </Button>

          <Button
            startIcon={<AssessmentIcon />}
            variant={activeTab === 'reports' ? 'contained' : 'text'}
            color={activeTab === 'reports' ? 'primary' : 'inherit'}
            onClick={() => onSelectTab('reports')}
            sx={{
              px: 2.5,
              py: 1,
              borderRadius: 2.5,
              fontWeight: 600,
              color: activeTab === 'reports' ? '#FFF' : 'text.secondary',
            }}
          >
            Reports
          </Button>

          {user.role === 'admin' && (
            <Button
              startIcon={<SettingsIcon />}
              variant={activeTab === 'admin' ? 'contained' : 'text'}
              color={activeTab === 'admin' ? 'primary' : 'inherit'}
              onClick={() => onSelectTab('admin')}
              sx={{
                px: 2.5,
                py: 1,
                borderRadius: 2.5,
                fontWeight: 600,
                color: activeTab === 'admin' ? '#FFF' : 'text.secondary',
              }}
            >
              Settings
            </Button>
          )}
        </Box>

        {/* User / Logout */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Avatar
              sx={{
                width: 34,
                height: 34,
                bgcolor: 'secondary.dark',
                fontSize: '0.875rem',
                fontWeight: 700,
              }}
            >
              {user.username.charAt(0).toUpperCase()}
            </Avatar>
            <Box sx={{ display: { xs: 'none', sm: 'block' } }}>
              <Typography variant="body2" sx={{ fontWeight: 600, lineHeight: 1.2 }}>
                {user.username}
              </Typography>
              <Typography variant="caption" sx={{ color: 'text.secondary', textTransform: 'capitalize' }}>
                {user.role}
              </Typography>
            </Box>
          </Box>

          <Tooltip title="Sign Out">
            <Button
              color="inherit"
              size="small"
              onClick={onLogout}
              startIcon={<LogoutIcon />}
              sx={{
                color: 'text.secondary',
                '&:hover': { color: 'error.main', backgroundColor: 'rgba(239, 68, 68, 0.08)' },
              }}
            >
              Sign out
            </Button>
          </Tooltip>
        </Box>
      </Toolbar>
    </AppBar>
  );
};
