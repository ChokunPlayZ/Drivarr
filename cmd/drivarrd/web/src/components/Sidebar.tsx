import React from 'react';
import {
  Box,
  Drawer,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Typography,
  Chip,
  Avatar,
  Divider,
  Button,
} from '@mui/material';
import StorageIcon from '@mui/icons-material/Storage';
import AssessmentIcon from '@mui/icons-material/Assessment';
import SettingsIcon from '@mui/icons-material/Settings';
import LogoutIcon from '@mui/icons-material/Logout';
import CircleIcon from '@mui/icons-material/Circle';
import { User } from '../types';

const drawerWidth = 240;

interface SidebarProps {
  user: User;
  deviceCount: number;
  connected: boolean;
  activeTab: 'drives' | 'reports' | 'admin';
  onSelectTab: (tab: 'drives' | 'reports' | 'admin') => void;
  onLogout: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  user,
  deviceCount,
  connected,
  activeTab,
  onSelectTab,
  onLogout,
}) => {
  return (
    <Drawer
      variant="permanent"
      sx={{
        width: drawerWidth,
        flexShrink: 0,
        '& .MuiDrawer-paper': {
          width: drawerWidth,
          boxSizing: 'border-box',
          display: 'flex',
          flexDirection: 'column',
          justify: 'space-between',
          backgroundColor: 'background.paper',
          borderRight: '1px solid rgba(255, 255, 255, 0.08)',
        },
      }}
    >
      <Box>
        {/* Brand Header */}
        <Box sx={{ p: 2.5, display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <Box
            sx={{
              width: 36,
              height: 36,
              borderRadius: 2,
              backgroundColor: 'primary.main',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#FFF',
              fontWeight: 'bold',
              fontSize: '1.2rem',
            }}
          >
            D
          </Box>
          <Box>
            <Typography variant="h6" fontWeight="bold" lineHeight={1.1}>
              Drivarr
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Drive Diagnostics
            </Typography>
          </Box>
        </Box>

        <Box sx={{ px: 2, pb: 1 }}>
          <Chip
            size="small"
            icon={<CircleIcon sx={{ fontSize: '8px !important' }} />}
            color={connected ? 'success' : 'error'}
            label={connected ? `${deviceCount} drive${deviceCount === 1 ? '' : 's'} online` : 'Offline'}
            variant="outlined"
            fullWidth
          />
        </Box>

        <Divider sx={{ my: 1 }} />

        {/* Navigation List */}
        <List component="nav" sx={{ px: 1 }}>
          <ListItem disablePadding>
            <ListItemButton
              selected={activeTab === 'drives'}
              onClick={() => onSelectTab('drives')}
              sx={{ borderRadius: 2, mb: 0.5 }}
            >
              <ListItemIcon>
                <StorageIcon color={activeTab === 'drives' ? 'primary' : 'inherit'} />
              </ListItemIcon>
              <ListItemText primary="Drives" />
            </ListItemButton>
          </ListItem>

          <ListItem disablePadding>
            <ListItemButton
              selected={activeTab === 'reports'}
              onClick={() => onSelectTab('reports')}
              sx={{ borderRadius: 2, mb: 0.5 }}
            >
              <ListItemIcon>
                <AssessmentIcon color={activeTab === 'reports' ? 'primary' : 'inherit'} />
              </ListItemIcon>
              <ListItemText primary="Reports" />
            </ListItemButton>
          </ListItem>

          {user.role === 'admin' && (
            <ListItem disablePadding>
              <ListItemButton
                selected={activeTab === 'admin'}
                onClick={() => onSelectTab('admin')}
                sx={{ borderRadius: 2, mb: 0.5 }}
              >
                <ListItemIcon>
                  <SettingsIcon color={activeTab === 'admin' ? 'primary' : 'inherit'} />
                </ListItemIcon>
                <ListItemText primary="Settings" />
              </ListItemButton>
            </ListItem>
          )}
        </List>
      </Box>

      {/* User Info & Logout Footer */}
      <Box sx={{ p: 2 }}>
        <Divider sx={{ mb: 2 }} />
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 1.5 }}>
          <Avatar sx={{ width: 36, height: 36, bgcolor: 'primary.dark' }}>
            {user.username.charAt(0).toUpperCase()}
          </Avatar>
          <Box sx={{ overflow: 'hidden' }}>
            <Typography variant="subtitle2" fontWeight="bold" noWrap>
              {user.username}
            </Typography>
            <Typography variant="caption" color="text.secondary" display="block" noWrap>
              {user.role}
            </Typography>
          </Box>
        </Box>
        <Button
          fullWidth
          variant="outlined"
          color="inherit"
          size="small"
          startIcon={<LogoutIcon />}
          onClick={onLogout}
        >
          Sign out
        </Button>
      </Box>
    </Drawer>
  );
};
