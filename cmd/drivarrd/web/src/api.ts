import { DeviceProbe, HistoryAssessment, SmartSelfTest } from './types';

export const fmtBytes = (bytes = 0): string => {
  if (!bytes) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let index = 0;
  while (value >= 1000 && index < units.length - 1) {
    value /= 1000;
    index++;
  }
  return `${value.toFixed(index > 2 ? 2 : 0)} ${units[index]}`;
};

export const fmtSpeed = (value?: number): string => (value ? `${fmtBytes(value)}/s` : '—');

export const fmtDate = (value?: string): string => (value ? new Date(value).toLocaleString() : '—');

export const statusLabel = (value?: string): string => String(value || 'unknown').replaceAll('_', ' ');

export const deviceURL = (id: string): string => `/drives/${encodeURIComponent(id)}`;

export const reportDownloadURL = (id: string): string => `/api/v1/reports/${encodeURIComponent(id)}/download`;

export const routeDevice = (): string | null =>
  location.pathname.startsWith('/drives/') ? decodeURIComponent(location.pathname.slice(8).split('/')[0] || '') : null;

export async function request<T = any>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
    ...options,
  });
  const content = response.headers.get('content-type') || '';
  const body = content.includes('json') ? await response.json() : await response.text();
  if (!response.ok) {
    const error: any = new Error(body?.error || `Request failed (${response.status})`);
    error.authentication = response.status === 401 || response.status === 403;
    throw error;
  }
  return body as T;
}

export function flattenFARM(value: any, prefix = '', rows: [string, string][] = []): [string, string][] {
  if (value === null || value === undefined) return rows;
  if (Array.isArray(value)) {
    value.forEach((item, index) => flattenFARM(item, `${prefix}[${index}]`, rows));
    return rows;
  }
  if (typeof value === 'object') {
    Object.entries(value).forEach(([key, item]) => flattenFARM(item, prefix ? `${prefix}.${key}` : key, rows));
    return rows;
  }
  rows.push([prefix || 'value', String(value)]);
  return rows;
}

export function historyAssessment(probe: DeviceProbe = {}): HistoryAssessment {
  if (!probe.smartAvailable) {
    return {
      kind: 'indeterminate',
      label: 'SMART history unavailable',
      evidence: ['The device did not expose SMART lifetime counters.'],
    };
  }
  const rows = flattenFARM(probe.farm);
  const numberFrom = (val: string) => Number(String(val).replaceAll(',', '').match(/-?\d+(?:\.\d+)?/)?.[0] || 0);
  const farmHoursRow = rows.find(([key]) => /spindle.*hours|power.?on.*hours/i.test(key));
  const smartHours = Number(probe.powerOnHours || probe.smartAttributes?.find((attr) => attr.id === 9)?.rawValue || 0);
  const farmHours = farmHoursRow ? numberFrom(farmHoursRow[1]) : 0;

  if (smartHours > 0 && farmHours > Math.max(smartHours * 4, smartHours + 1000)) {
    return {
      kind: 'suspicious',
      label: 'Possible SMART history reset',
      evidence: [
        `SMART reports ${smartHours.toLocaleString()} power-on hours while FARM reports ${farmHours.toLocaleString()} lifetime hours.`,
        'Independent lifetime counters are materially inconsistent. Review raw evidence before accepting the drive.',
      ],
    };
  }
  if (probe.farmAvailable) {
    return {
      kind: 'consistent',
      label: 'History counters consistent',
      evidence: ['No material rollback was found between the available SMART and FARM lifetime counters.'],
    };
  }
  return {
    kind: 'indeterminate',
    label: 'No independent FARM cross-check',
    evidence: ['SMART is available, but no independent FARM lifetime log was returned for comparison.'],
  };
}

export function smartSelfTestLabel(test?: SmartSelfTest): string {
  if (!test) return 'Not running';
  const kind = String(test.kind || 'SMART self-test').replace(/\s+in progress$/i, '');
  return Number.isFinite(test.progressPercent) ? `${kind} · ${test.progressPercent}%` : `${kind} · in progress`;
}
