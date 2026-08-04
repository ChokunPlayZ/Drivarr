import React from 'react';
import { User } from '../types';
import { StorageIcon, ReportIcon, SettingsIcon, LogoutIcon } from './Icons';

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
    <header>
      <div className="brand-mark" aria-hidden="true">
        D
      </div>
      <div className="brand-copy">
        <h1>Drivarr</h1>
        <p>{deviceCount} drive{deviceCount === 1 ? '' : 's'} connected</p>
      </div>
      <div
        className={`connection-dot ${connected ? 'online' : ''}`}
        title={connected ? 'System online' : 'Reconnecting'}
      />
      <nav className="top-nav" aria-label="Primary navigation">
        <button
          className={`nav-item ${activeTab === 'drives' ? 'active' : ''}`}
          onClick={() => onSelectTab('drives')}
        >
          <StorageIcon size={16} /> Drives
        </button>
        <button
          className={`nav-item ${activeTab === 'reports' ? 'active' : ''}`}
          onClick={() => onSelectTab('reports')}
        >
          <ReportIcon size={16} /> Reports
        </button>
        {user.role === 'admin' && (
          <button
            className={`nav-item ${activeTab === 'admin' ? 'active' : ''}`}
            onClick={() => onSelectTab('admin')}
          >
            <SettingsIcon size={16} /> Settings
          </button>
        )}
      </nav>
      <button className="account-button" onClick={onLogout} title="Sign out">
        {user.username}
        <span>Sign out</span>
      </button>
    </header>
  );
};
