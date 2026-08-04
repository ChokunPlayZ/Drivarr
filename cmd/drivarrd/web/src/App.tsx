import React, { useState, useEffect, useCallback } from 'react';
import {
  Box,
  Container,
  Typography,
  Button,
  Snackbar,
  Alert,
  CircularProgress,
  Paper,
} from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';
import StorageIcon from '@mui/icons-material/Storage';
import { User, AppData, NoticeState, Device } from './types';
import { request, routeDevice, deviceURL, reportDownloadURL } from './api';
import { Navbar } from './components/Navbar';
import { Login } from './components/Login';
import { DriveManager } from './components/DriveManager';
import { DriveWorkspace } from './components/DriveWorkspace';
import { TestDialog } from './components/TestDialog';
import { ReportsTable } from './components/ReportsTable';
import { AdminPanel } from './components/AdminPanel';

const emptyData: AppData = {
  devices: [],
  jobs: [],
  reports: [],
  settings: null,
  policies: [],
  profiles: [],
};

const activeStatuses = ['queued', 'validating', 'running', 'pause_requested'];

export const App: React.FC = () => {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [data, setData] = useState<AppData>(emptyData);
  const [page, setPage] = useState<'drives' | 'reports' | 'admin'>('drives');
  const [notice, setNotice] = useState<NoticeState | null>(null);
  const [connected, setConnected] = useState<boolean>(false);
  const [updated, setUpdated] = useState<Date | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [audit, setAudit] = useState<any[]>([]);
  const [testDevice, setTestDevice] = useState<{ device: Device; profileId: string } | null>(null);
  const [workspaceId, setWorkspaceId] = useState<string | null>(routeDevice());
  const [workspaceJobId, setWorkspaceJobId] = useState<string | null>(null);

  const notify = useCallback((message: string, error = false) => {
    setNotice({ message, error });
  }, []);

  const handleError = useCallback(
    (error: any) => {
      if (error.authentication) setUser(null);
      notify(error.message || 'An error occurred', true);
    },
    [notify]
  );

  const refreshAdmin = useCallback(async () => {
    try {
      const [userData, auditData] = await Promise.all([request('/api/v1/users'), request('/api/v1/audit')]);
      setUsers(userData.users || []);
      setAudit(auditData.events || []);
    } catch (error) {
      handleError(error);
    }
  }, [handleError]);

  const refreshAll = useCallback(
    async (currentUser: User | null = user as any, quiet = false) => {
      if (!currentUser) return;
      try {
        const [devices, jobs, reports, settings, policies, profiles] = await Promise.all([
          request('/api/v1/devices'),
          request('/api/v1/jobs'),
          request('/api/v1/reports'),
          request('/api/v1/settings'),
          request('/api/v1/policies'),
          request('/api/v1/profiles'),
        ]);

        setData({
          devices: devices.devices || [],
          jobs: jobs.jobs || [],
          reports: reports.reports || [],
          settings: settings || null,
          policies: policies.policies || [],
          profiles: profiles.profiles || [],
        });
        setConnected(true);
        setUpdated(new Date());

        if (currentUser.role === 'admin') {
          await refreshAdmin();
        }
      } catch (error) {
        setConnected(false);
        if (!quiet) handleError(error);
      }
    },
    [user, refreshAdmin, handleError]
  );

  const refreshLive = useCallback(async () => {
    if (!user) return;
    try {
      const [devices, jobs, reports] = await Promise.all([
        request('/api/v1/devices'),
        request('/api/v1/jobs'),
        request('/api/v1/reports'),
      ]);
      setData((current) => ({
        ...current,
        devices: devices.devices || [],
        jobs: jobs.jobs || [],
        reports: reports.reports || [],
      }));
      setConnected(true);
      setUpdated(new Date());
    } catch (error) {
      setConnected(false);
      handleError(error);
    }
  }, [user, handleError]);

  useEffect(() => {
    request('/api/v1/auth/session')
      .then((session) => {
        setUser(session);
        refreshAll(session);
      })
      .catch(() => setUser(null));
  }, []);

  useEffect(() => {
    if (!user) return;
    const timer = setInterval(refreshLive, 3000);
    return () => clearInterval(timer);
  }, [user, refreshLive]);

  useEffect(() => {
    const pop = () => setWorkspaceId(routeDevice());
    window.addEventListener('popstate', pop);
    return () => window.removeEventListener('popstate', pop);
  }, []);

  const openWorkspace = (id: string, jobId: string | null = null) => {
    setWorkspaceId(id);
    setWorkspaceJobId(jobId);
    if (location.pathname !== deviceURL(id)) {
      history.pushState({ deviceId: id, jobId }, '', deviceURL(id));
    }
  };

  const closeWorkspace = () => {
    setWorkspaceId(null);
    setWorkspaceJobId(null);
    if (routeDevice()) {
      history.pushState({}, '', '/');
    }
  };

  const mutate = async (path: string, options: RequestInit, message?: any, after = refreshAll) => {
    try {
      const result = await request(path, options);
      if (message) {
        notify(typeof message === 'function' ? message(result) : message);
      }
      await after(user);
      return result;
    } catch (error) {
      handleError(error);
      throw error;
    }
  };

  const generateAndDownloadReport = async (path: string, message: any) => {
    try {
      const result = await request(path, { method: 'POST' });
      notify(typeof message === 'function' ? message(result) : message);
      location.assign(reportDownloadURL(result.id));
      await refreshAll(user);
      return result;
    } catch (error) {
      handleError(error);
      throw error;
    }
  };

  const login = async (credentials: Record<string, string>) => {
    const session = await request('/api/v1/auth/login', {
      method: 'POST',
      body: JSON.stringify(credentials),
    });
    setUser(session);
    await refreshAll(session);
  };

  const logout = async () => {
    await request('/api/v1/auth/logout', { method: 'POST' }).catch(() => {});
    setUser(null);
    setWorkspaceId(null);
  };

  const jobAction = async (job: any, action: string) => {
    if (action === 'delete') {
      await mutate(`/api/v1/jobs/${job.id}`, { method: 'DELETE' }, 'Test deleted');
      return;
    }
    if (action === 'report') {
      await generateAndDownloadReport(`/api/v1/jobs/${job.id}/report`, 'PDF created; download started');
      return;
    }
    await mutate(`/api/v1/jobs/${job.id}/${action}`, { method: 'POST' }, `${action} requested`);
  };

  const driveReport = async (id: string) => {
    await generateAndDownloadReport(
      `/api/v1/devices/${encodeURIComponent(id)}/report`,
      (res: any) => `Full PDF created with ${res.testCount} tests; download started`
    );
  };

  if (user === undefined) {
    return (
      <Box
        sx={{
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 2,
        }}
      >
        <CircularProgress size={48} color="primary" />
        <Typography variant="body1" sx={{ color: 'text.secondary', fontWeight: 600 }}>
          Loading Drivarr...
        </Typography>
      </Box>
    );
  }

  if (!user) {
    return <Login onLogin={login} />;
  }

  const activeJobCount = data.jobs.filter((j) => activeStatuses.includes(j.status) || j.status === 'paused').length;
  const workspaceDevice = data.devices.find((d) => d.id === workspaceId);

  return (
    <Box sx={{ minHeight: '100vh', pb: 8 }}>
      <Navbar
        user={user}
        deviceCount={data.devices.length}
        connected={connected}
        activeTab={page}
        onSelectTab={(tab) => setPage(tab)}
        onLogout={logout}
      />

      <Container maxWidth="xl" sx={{ mt: 4 }}>
        {page === 'drives' && (
          <Box>
            <Box
              sx={{
                display: 'flex',
                justify: 'space-between',
                alignItems: 'center',
                mb: 4,
                flexWrap: 'wrap',
                gap: 2,
              }}
            >
              <Box>
                <Typography variant="caption" sx={{ color: 'primary.light', fontWeight: 700, letterSpacing: '0.05em' }}>
                  HARDWARE DIAGNOSTICS
                </Typography>
                <Typography variant="h4" sx={{ fontWeight: 800 }}>
                  Connected Physical Drives
                </Typography>
                <Typography variant="body2" sx={{ color: 'text.secondary', mt: 0.5 }}>
                  Select a test below. Every test available for each drive is shown with its latest result.
                </Typography>
              </Box>

              <Box sx={{ display: 'flex', gap: 2, alignItems: 'center' }}>
                {activeJobCount > 0 && (
                  <Paper
                    sx={{
                      px: 2,
                      py: 1,
                      backgroundColor: 'rgba(99, 102, 241, 0.1)',
                      border: '1px solid rgba(99, 102, 241, 0.3)',
                      borderRadius: 3,
                    }}
                  >
                    <Typography variant="body2" sx={{ fontWeight: 700, color: 'primary.light' }}>
                      {activeJobCount} test{activeJobCount === 1 ? '' : 's'} running
                    </Typography>
                  </Paper>
                )}

                <Button
                  variant="outlined"
                  color="primary"
                  startIcon={<RefreshIcon />}
                  onClick={() =>
                    mutate('/api/v1/discovery/refresh', { method: 'POST' }, 'Looking for drives...', () =>
                      new Promise((resolve) => setTimeout(() => refreshAll(user).then(resolve), 1000))
                    )
                  }
                >
                  Refresh drives
                </Button>
              </Box>
            </Box>

            {data.devices.length ? (
              data.devices.map((device) => (
                <DriveManager
                  key={device.id}
                  device={device}
                  jobs={data.jobs}
                  profiles={data.profiles}
                  settings={data.settings}
                  role={user.role}
                  onOpen={openWorkspace}
                  onRun={(selected, profileId) => setTestDevice({ device: selected, profileId })}
                  onAction={jobAction}
                  onReport={driveReport}
                  onRetry={(id) =>
                    mutate(`/api/v1/devices/${encodeURIComponent(id)}/retry`, { method: 'POST' }, 'Manual probe scheduled')
                  }
                />
              ))
            ) : (
              <Paper
                sx={{
                  p: 8,
                  textAlign: 'center',
                  backgroundColor: 'rgba(255, 255, 255, 0.02)',
                  border: '1px dashed rgba(255, 255, 255, 0.1)',
                  borderRadius: 4,
                }}
              >
                <StorageIcon sx={{ fontSize: 64, color: 'text.secondary', mb: 2, opacity: 0.4 }} />
                <Typography variant="h5" sx={{ fontWeight: 700 }}>
                  No drives found
                </Typography>
                <Typography variant="body2" sx={{ color: 'text.secondary', mt: 1 }}>
                  Connect a drive, then refresh discovery.
                </Typography>
              </Paper>
            )}

            <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mt: 2, textAlign: 'center' }}>
              {updated ? `Last checked ${updated.toLocaleTimeString()}` : 'Checking for drives...'}
            </Typography>
          </Box>
        )}

        {page === 'reports' && (
          <Box>
            <Box sx={{ mb: 4 }}>
              <Typography variant="caption" sx={{ color: 'secondary.light', fontWeight: 700, letterSpacing: '0.05em' }}>
                TAMPER-EVIDENT EVIDENCE
              </Typography>
              <Typography variant="h4" sx={{ fontWeight: 800 }}>
                Generated PDF Reports
              </Typography>
            </Box>

            <ReportsTable
              reports={data.reports}
              onVerify={(id) =>
                mutate(`/api/v1/reports/${id}/verify`, {}, (res: any) =>
                  res.valid ? 'PDF checksum is valid' : 'PDF has been modified'
                )
              }
            />
          </Box>
        )}

        {page === 'admin' && user.role === 'admin' && (
          <AdminPanel
            settings={data.settings}
            users={users}
            audit={audit}
            onSettings={(form) => {
              const formData = new FormData(form);
              const values = Object.fromEntries(formData);
              return mutate(
                '/api/v1/settings',
                {
                  method: 'PUT',
                  body: JSON.stringify({
                    ...data.settings,
                    organization: values.organization,
                    maxConcurrentJobs: Number(values.maxConcurrentJobs),
                    maxDestructiveJobs: Number(values.maxDestructiveJobs),
                    jobChunkMiB: Number(values.jobChunkMiB),
                    retentionDays: Number(values.retentionDays),
                    retentionMaxBytes: Number(values.retentionMaxBytes),
                    destructiveEnabled: values.destructiveEnabled === 'on',
                  }),
                },
                'Settings saved'
              );
            }}
            onUser={(form) =>
              mutate(
                '/api/v1/users',
                {
                  method: 'POST',
                  body: JSON.stringify(Object.fromEntries(new FormData(form))),
                },
                'User created',
                refreshAdmin
              )
            }
            onPassword={async (form) => {
              await mutate(
                '/api/v1/auth/password',
                {
                  method: 'POST',
                  body: JSON.stringify(Object.fromEntries(new FormData(form))),
                },
                'Password changed. Sign in again.'
              );
              setUser(null);
            }}
            onProfile={(form) => {
              const values = Object.fromEntries(new FormData(form));
              return mutate(
                '/api/v1/profiles',
                {
                  method: 'POST',
                  body: JSON.stringify({
                    ...values,
                    blockSizeKiB: Number(values.blockSizeKiB),
                    queueDepth: Number(values.queueDepth),
                    durationSeconds: Number(values.durationSeconds),
                    rateMiB: Number(values.rateMiB),
                  }),
                },
                'Advanced profile created'
              );
            }}
            onPolicy={(form) => {
              const values = Object.fromEntries(new FormData(form));
              return mutate(
                '/api/v1/policies',
                {
                  method: 'POST',
                  body: JSON.stringify({
                    name: values.name,
                    failOnSmart: values.failOnSmart === 'on',
                    failOnIoError: values.failOnIoError === 'on',
                    warnPendingAbove: Number(values.warnPendingAbove),
                    warnReallocatedAbove: Number(values.warnReallocatedAbove),
                    warnUncorrectableAbove: Number(values.warnUncorrectableAbove),
                  }),
                },
                'Grading policy created'
              );
            }}
          />
        )}
      </Container>

      {testDevice && (
        <TestDialog
          device={testDevice.device}
          profiles={data.profiles}
          policies={data.policies}
          initialProfileId={testDevice.profileId}
          onClose={() => setTestDevice(null)}
          onSubmit={async (body) => {
            await mutate(
              '/api/v1/jobs',
              {
                method: 'POST',
                body: JSON.stringify(body),
              },
              body.presetId ? 'Complete check queued' : 'Test queued'
            );
            setTestDevice(null);
          }}
        />
      )}

      {workspaceDevice && (
        <DriveWorkspace
          device={workspaceDevice}
          jobs={data.jobs}
          role={user.role}
          initialJobId={workspaceJobId}
          onClose={closeWorkspace}
          onAction={jobAction}
          onReport={driveReport}
        />
      )}

      <Snackbar
        open={Boolean(notice)}
        autoHideDuration={6000}
        onClose={() => setNotice(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        {notice ? (
          <Alert onClose={() => setNotice(null)} severity={notice.error ? 'error' : 'success'} sx={{ width: '100%', borderRadius: 3 }}>
            {notice.message}
          </Alert>
        ) : undefined}
      </Snackbar>
    </Box>
  );
};
