export interface User {
  id?: string;
  username: string;
  role: 'admin' | 'operator' | 'viewer';
}

export interface SmartAttribute {
  id: number;
  name: string;
  current: number;
  worst: number;
  threshold: number;
  rawValue: number;
  rawString?: string;
  whenFailed?: string;
}

export interface SmartSelfTest {
  kind: string;
  progressPercent?: number;
  status?: string;
}

export interface DeviceProbe {
  model?: string;
  serial?: string;
  capacityBytes?: number;
  deviceInterface?: string;
  protocol?: string;
  recordingType?: string;
  temperatureC?: number;
  smartAvailable?: boolean;
  smartPassed?: boolean;
  powerOnHours?: number;
  pendingSectors?: number;
  reallocatedSectors?: number;
  uncorrectableSectors?: number;
  farmAvailable?: boolean;
  farm?: any;
  smartAttributes?: SmartAttribute[];
  smartSelfTest?: SmartSelfTest;
  firmware?: string;
  collectedAt?: string;
}

export interface Device {
  id: string;
  name?: string;
  path: string;
  status: string;
  reason?: string;
  probe?: DeviceProbe;
}

export interface SectorError {
  offset: number;
  length: number;
}

export interface Job {
  id: string;
  deviceId: string;
  devicePath: string;
  profileId: string;
  profileName?: string;
  kind: 'smart_short' | 'smart_long' | 'smart_conveyance' | 'speed' | 'surface_read' | 'destructive_verify' | string;
  status: 'queued' | 'validating' | 'running' | 'pause_requested' | 'paused' | 'completed' | 'completed_with_warnings' | 'failed' | 'cancelled' | 'interrupted' | string;
  progress?: number;
  currentPhase?: string;
  readBps?: number;
  readIops?: number;
  completedBytes?: number;
  totalBytes?: number;
  startedAt?: string;
  finishedAt?: string;
  createdAt?: string;
  error?: string;
  errors?: SectorError[];
}

export interface Report {
  id: string;
  scope: 'drive' | 'job' | string;
  deviceId?: string;
  jobId?: string;
  testCount?: number;
  verdict?: string;
  createdAt?: string;
}

export interface Settings {
  organization: string;
  maxConcurrentJobs: number;
  maxDestructiveJobs: number;
  jobChunkMiB: number;
  retentionDays: number;
  retentionMaxBytes: number;
  destructiveEnabled: boolean;
}

export interface Policy {
  id: string;
  name: string;
  version: number;
  failOnSmart: boolean;
  failOnIoError: boolean;
  warnPendingAbove: number;
  warnReallocatedAbove: number;
  warnUncorrectableAbove: number;
}

export interface Profile {
  id: string;
  name: string;
  kind: string;
  enabled: boolean;
  builtIn: boolean;
  blockSizeKiB?: number;
  queueDepth?: number;
  durationSeconds?: number;
  rateMiB?: number;
}

export interface AuditEvent {
  at: string;
  action: string;
  userId?: string;
  target?: string;
}

export interface AppData {
  devices: Device[];
  jobs: Job[];
  reports: Report[];
  settings: Settings | null;
  policies: Policy[];
  profiles: Profile[];
}

export interface NoticeState {
  message: string;
  error?: boolean;
}

export interface HistoryAssessment {
  kind: 'consistent' | 'suspicious' | 'indeterminate';
  label: string;
  evidence: string[];
}
