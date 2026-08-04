import React from 'react';
import { AppBar, Toolbar, Typography, Box, Button, Chip, Avatar } from '@mui/material';
import StorageIcon from '@mui/icons-material/Storage';
import AssessmentIcon from '@mui/icons-material/Assessment';
import SettingsIcon from '@mui/icons-material/Settings';
import LogoutIcon from '@mui/icons-material/Logout';
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
    <AppBar position="static" color="default">
      <Toolbar>
        <Typography variant="h6" component="div" sx={{ fontWeight: 'bold', mr: 2 }}>
          Drivarr
        </Typography>

        <Chip
          size="small"
          color={connected ? 'success' : 'error'}
          label={connected ? `${deviceCount} drives connected` : 'Offline'}
          variant="outlined"
          sx={{ mr: 4 }}
        />

        <Box sx={{ flexGrow: 1, display: 'flex', gap: 1 }}>
          <Button
            color={activeTab === 'drives' ? 'primary' : 'inherit'}
            variant={activeTab === 'drives' ? 'contained' : 'text'}
            startIcon={<StorageIcon />}
            onClick={() => onSelectTab('drives')}
          >
            Drives
          </Button>

          <Button
            color={activeTab === 'reports' ? 'primary' : 'inherit'}
            variant={activeTab === 'reports' ? 'contained' : 'text'}
            startIcon={<AssessmentIcon />}
            onClick={() => onSelectTab('reports')}
          >
            Reports
          </Button>

          {user.role === 'admin' && (
            <Button
              color={activeTab === 'admin' ? 'primary' : 'inherit'}
              variant={activeTab === 'admin' ? 'contained' : 'text'}
              startIcon={<SettingsIcon />}
              onClick={() => onSelectTab('admin')}
            >
              Settings
            </Button>
          )}
        </Box>

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <Avatar sx={{ width: 32, height: 32 }}>{user.username.charAt(0).toUpperCase()}</Avatar>
          <Typography variant="body2">{user.username}</Typography>
          <Button color="inherit" size="small" startIcon={<LogoutIcon />} onClick={onLogout}>
            Sign out
          </Button>
        </Box>
      </Toolbar>
    </AppBar>
  );
};
