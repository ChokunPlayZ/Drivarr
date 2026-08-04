import React, { useState, useEffect, useCallback } from 'react';
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

function Notice({ notice }: { notice: NoticeState | null }) {
  if (!notice) return null;
  return (
    <div id="notice" className={`notice ${notice.error ? 'notice-error' : ''}`}>
      {notice.message}
    </div>
  );
}

const formObject = (form: HTMLFormElement) => Object.fromEntries(new FormData(form));

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
    setTimeout(() => setNotice(null), 6000);
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

  const activeJobCount = data.jobs.filter((j) => activeStatuses.includes(j.status) || j.status === 'paused').length;
  const workspaceDevice = data.devices.find((d) => d.id === workspaceId);

  if (user === undefined) {
    return (
      <div className="login-shell">
        <div className="login-card">
          <p className="supporting">Loading Drivarr…</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return <Login onLogin={login} />;
  }

  return (
    <>
      <Navbar
        user={user}
        deviceCount={data.devices.length}
        connected={connected}
        activeTab={page}
        onSelectTab={(tab) => setPage(tab)}
        onLogout={logout}
      />

      <main>
        <Notice notice={notice} />

        <section className={`page ${page === 'drives' ? 'active' : ''}`}>
          <div className="page-intro">
            <div>
              <p className="eyebrow">Drive testing</p>
              <h1>Drives</h1>
              <p>Select a test below. Every test available for each drive is shown with its latest result.</p>
            </div>
            <div className="intro-actions">
              {activeJobCount > 0 && (
                <span className="active-summary">
                  <i />
                  {activeJobCount} active
                </span>
              )}
              <button
                className="refresh-button"
                onClick={() =>
                  mutate('/api/v1/discovery/refresh', { method: 'POST' }, 'Looking for drives…', () =>
                    new Promise((resolve) => setTimeout(() => refreshAll(user).then(resolve), 1000))
                  )
                }
              >
                ↻ <span>Refresh drives</span>
              </button>
            </div>
          </div>

          <div className="drive-stack" aria-live="polite">
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
              <div className="empty-state">
                <span>▰</span>
                <h2>No drives found</h2>
                <p>Connect a drive, then refresh discovery.</p>
              </div>
            )}
          </div>

          <p className="last-updated">
            {updated ? `Last checked ${updated.toLocaleTimeString()}` : 'Checking for drives…'}
          </p>
        </section>

        <section className={`page ${page === 'reports' ? 'active' : ''}`}>
          <div className="section-heading">
            <div>
              <p className="eyebrow">Evidence</p>
              <h2>PDF reports</h2>
            </div>
          </div>
          <div className="table-card">
            <ReportsTable
              reports={data.reports}
              onVerify={(id) =>
                mutate(`/api/v1/reports/${id}/verify`, {}, (res: any) =>
                  res.valid ? 'PDF checksum is valid' : 'PDF has been modified'
                )
              }
            />
          </div>
        </section>

        <section className={`page ${page === 'admin' ? 'active' : ''}`}>
          {user.role === 'admin' && (
            <AdminPanel
              settings={data.settings}
              users={users}
              audit={audit}
              onSettings={(form) => {
                const values = formObject(form);
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
                    body: JSON.stringify(formObject(form)),
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
                    body: JSON.stringify(formObject(form)),
                  },
                  'Password changed. Sign in again.'
                );
                setUser(null);
              }}
              onProfile={(form) => {
                const values = formObject(form);
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
                const values = formObject(form);
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
        </section>
      </main>

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
    </>
  );
};
