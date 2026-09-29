import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { runDesign, type DesignResult } from '../shared/engine';
import type { DesignInput } from '../shared/types';
import { DEFAULT_UNITS, type DisplayUnits } from '../shared/units';
import { api, type Library, type ProjectFull, type Settings } from './api';

interface Toast {
  id: number;
  kind: 'ok' | 'error' | 'info';
  text: string;
}

interface AppCtx {
  settings: Settings | null;
  library: Library | null;
  units: DisplayUnits;
  reloadSettings: () => Promise<void>;
  reloadLibrary: () => Promise<void>;
  toast: (text: string, kind?: Toast['kind']) => void;
  activeProjectId: number | null;
  setActiveProjectId: (id: number | null) => void;
  error: string | null;
}

const Ctx = createContext<AppCtx | null>(null);

function readActive(): number | null {
  try {
    const v = localStorage.getItem('ro.activeProjectId');
    return v ? Number(v) : null;
  } catch {
    return null;
  }
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [library, setLibrary] = useState<Library | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [activeProjectId, setActive] = useState<number | null>(readActive);
  const nextId = useRef(1);

  const toast = useCallback((text: string, kind: Toast['kind'] = 'ok') => {
    const id = nextId.current++;
    setToasts((t) => [...t, { id, kind, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 7000 : 3500);
  }, []);
  const reloadSettings = useCallback(async () => setSettings(await api.settings()), []);
  const reloadLibrary = useCallback(async () => setLibrary(await api.library()), []);
  const setActiveProjectId = useCallback((id: number | null) => {
    setActive(id);
    try {
      if (id) localStorage.setItem('ro.activeProjectId', String(id));
      else localStorage.removeItem('ro.activeProjectId');
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    Promise.all([reloadSettings(), reloadLibrary()]).catch((e) => setError(`Cannot reach the local server: ${e.message}. Is "npm start" running?`));
  }, [reloadSettings, reloadLibrary]);

  const value = useMemo<AppCtx>(
    () => ({ settings, library, units: settings?.units ?? DEFAULT_UNITS, reloadSettings, reloadLibrary, toast, activeProjectId, setActiveProjectId, error }),
    [settings, library, reloadSettings, reloadLibrary, toast, activeProjectId, setActiveProjectId, error],
  );
  return (
    <Ctx.Provider value={value}>
      {children}
      <div className="toasts">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.kind}`}>
            {t.text}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export function useApp() {
  const c = useContext(Ctx);
  if (!c) throw new Error('useApp outside provider');
  return c;
}

/** Load a project, keep an editable copy, and recalculate live with the shared engine. */
export function useProjectDesign(id: number | null) {
  const { library, toast, setActiveProjectId } = useApp();
  const [project, setProject] = useState<ProjectFull | null>(null);
  const [data, setData] = useState<DesignInput | null>(null);
  const [dirty, setDirty] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!id) {
      setProject(null);
      setData(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    api
      .project(id)
      .then((p) => {
        if (cancelled) return;
        setProject(p);
        setData(p.data);
        setDirty(false);
        setActiveProjectId(p.id);
      })
      .catch((e) => !cancelled && setLoadError(e.message))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [id, setActiveProjectId]);

  const update = useCallback((fn: (d: DesignInput) => void) => {
    setData((prev) => {
      if (!prev) return prev;
      const next = structuredClone(prev);
      fn(next);
      return next;
    });
    setDirty(true);
  }, []);

  const result: DesignResult | null = useMemo(() => {
    if (!data || !library) return null;
    try {
      const membrane = library.membranes.find((m) => m.id === data.membrane.membraneId) ?? null;
      return runDesign(data, { membrane, pipeSizes: library.pipeSizes, pipeMaterials: library.pipeMaterials, pumps: library.pumps });
    } catch (e) {
      console.error(e);
      return null;
    }
  }, [data, library]);

  const save = useCallback(async () => {
    if (!project || !data) return false;
    setSaving(true);
    try {
      const p = await api.saveProject(project.id, data);
      setProject(p);
      setDirty(false);
      toast('Project saved to local database');
      return true;
    } catch (e) {
      toast(`Save failed: ${(e as Error).message}`, 'error');
      return false;
    } finally {
      setSaving(false);
    }
  }, [project, data, toast]);

  return { project, data, setData, update, result, dirty, save, saving, loading, loadError };
}
