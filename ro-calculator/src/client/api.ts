import type { Assumptions } from '../shared/assumptions';
import type { DesignInput, MembraneSpec, PipeMaterial, PipeSize, PumpSpec } from '../shared/types';
import type { DisplayUnits } from '../shared/units';

export interface ProjectRow {
  id: number;
  name: string;
  customer: string;
  location: string;
  reference: string;
  createdAt: string;
  updatedAt: string;
}
export interface ProjectFull extends ProjectRow {
  data: DesignInput;
}
export interface CompanyInfo {
  name: string;
  address: string;
  phone: string;
  email: string;
}
export interface Settings {
  assumptions: Assumptions;
  units: DisplayUnits;
  company: CompanyInfo;
}
export interface Library {
  membranes: (MembraneSpec & { builtin: boolean })[];
  pumps: (PumpSpec & { builtin: boolean })[];
  pipeSizes: PipeSize[];
  pipeMaterials: PipeMaterial[];
}

async function req<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${url}`, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`;
    try {
      const j = await res.json();
      if (j?.error) msg = j.error;
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const api = {
  health: () => req<{ ok: boolean }>('GET', '/health'),
  projects: () => req<ProjectRow[]>('GET', '/projects'),
  project: (id: number) => req<ProjectFull>('GET', `/projects/${id}`),
  createProject: (body: { template?: 'blank' | 'sample'; name?: string; data?: DesignInput }) => req<ProjectFull>('POST', '/projects', body),
  saveProject: (id: number, data: DesignInput) => req<ProjectFull>('PUT', `/projects/${id}`, { data }),
  deleteProject: (id: number) => req<void>('DELETE', `/projects/${id}`),
  duplicateProject: (id: number) => req<ProjectFull>('POST', `/projects/${id}/duplicate`),
  exportProject: (id: number) => req<unknown>('GET', `/projects/${id}/export`),
  importProject: (file: unknown) => req<ProjectFull>('POST', '/projects/import', file),
  library: () => req<Library>('GET', '/library'),
  saveMembrane: (m: Omit<MembraneSpec, 'id'>, id?: number) => (id ? req<MembraneSpec>('PUT', `/membranes/${id}`, m) : req<MembraneSpec>('POST', '/membranes', m)),
  deleteMembrane: (id: number) => req<void>('DELETE', `/membranes/${id}`),
  savePump: (p: Omit<PumpSpec, 'id'>, id?: number) => (id ? req<PumpSpec>('PUT', `/pumps/${id}`, p) : req<PumpSpec>('POST', '/pumps', p)),
  deletePump: (id: number) => req<void>('DELETE', `/pumps/${id}`),
  savePipeMaterial: (m: PipeMaterial) => req<PipeMaterial>('POST', '/pipe-materials', m),
  deletePipeMaterial: (name: string) => req<void>('DELETE', `/pipe-materials/${encodeURIComponent(name)}`),
  savePipeSize: (p: Omit<PipeSize, 'id'>, id?: number) => (id ? req<PipeSize>('PUT', `/pipe-sizes/${id}`, p) : req<PipeSize>('POST', '/pipe-sizes', p)),
  deletePipeSize: (id: number) => req<void>('DELETE', `/pipe-sizes/${id}`),
  settings: () => req<Settings>('GET', '/settings'),
  saveSettings: (s: Partial<Settings>) => req<Settings>('PUT', '/settings', s),
  reportUrl: (id: number, download = false) => `/api/projects/${id}/report.pdf${download ? '?download=1' : ''}`,
};

export function downloadJson(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
