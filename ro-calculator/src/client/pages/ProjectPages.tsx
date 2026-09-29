import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { fmt, fmtFlow } from '../../shared/units';
import { api, downloadJson, type ProjectRow } from '../api';
import { SummaryDashboard } from '../components/Results';
import { Card, Disclaimer, Empty, PageHeader } from '../components/ui';
import { useApp, useProjectDesign } from '../context';

export function DashboardPage() {
  const { activeProjectId, units, library, error } = useApp();
  const [rows, setRows] = useState<ProjectRow[] | null>(null);
  const { result, project } = useProjectDesign(activeProjectId);
  useEffect(() => {
    api.projects().then(setRows).catch(() => setRows([]));
  }, []);
  return (
    <>
      <PageHeader
        title="Dashboard"
        subtitle="RO System Engineering Calculator – local, offline engineering design tool"
        actions={
          <Link className="btn btn-primary" to="/new">
            + New RO design
          </Link>
        }
      />
      {error && <div className="alert">{error}</div>}
      <div className="stat-row">
        <div className="stat">
          <div className="stat-value">{rows?.length ?? '…'}</div>
          <div className="stat-label">Projects</div>
        </div>
        <div className="stat">
          <div className="stat-value">{library?.membranes.length ?? '…'}</div>
          <div className="stat-label">Membrane models</div>
        </div>
        <div className="stat">
          <div className="stat-value">{library?.pumps.length ?? '…'}</div>
          <div className="stat-label">Pumps in library</div>
        </div>
        <div className="stat">
          <div className="stat-value">{library ? new Set(library.pipeSizes.map((p) => p.material)).size : '…'}</div>
          <div className="stat-label">Pipe materials</div>
        </div>
      </div>
      {project && result ? (
        <Card
          title={
            <>
              Active project: <Link to={`/design/${project.id}?tab=summary`}>{project.name}</Link>
            </>
          }
          actions={
            <Link className="btn btn-sm" to={`/design/${project.id}?tab=summary`}>
              Open design
            </Link>
          }
        >
          <SummaryDashboard result={result} units={units} />
        </Card>
      ) : (
        <Card title="Get started">
          <p>
            Open a project from <Link to="/projects">Projects</Link>, or start a <Link to="/new">new RO design</Link>. The sample project <b>“30 m³/h RO System”</b> is created automatically on first start.
          </p>
        </Card>
      )}
      <Card title="Recent projects">
        {!rows ? (
          <p className="muted">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="muted">No projects yet.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Project</th>
                <th>Customer</th>
                <th>Reference</th>
                <th>Updated</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 8).map((r) => (
                <tr key={r.id}>
                  <td>
                    <Link to={`/design/${r.id}?tab=summary`}>{r.name}</Link>
                  </td>
                  <td>{r.customer}</td>
                  <td>{r.reference}</td>
                  <td className="small muted">{new Date(r.updatedAt).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      <Disclaimer />
    </>
  );
}

export function ProjectsPage() {
  const { toast, activeProjectId, setActiveProjectId } = useApp();
  const [rows, setRows] = useState<ProjectRow[] | null>(null);
  const [q, setQ] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const load = () => api.projects().then(setRows).catch((e) => toast(e.message, 'error'));
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn();
      toast(ok);
      await load();
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };

  const filtered = (rows ?? []).filter((r) => `${r.name} ${r.customer} ${r.location} ${r.reference}`.toLowerCase().includes(q.toLowerCase()));

  return (
    <>
      <PageHeader
        title="Projects"
        subtitle="All projects are stored in the local SQLite database on this computer."
        actions={
          <>
            <input className="search" placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} />
            <Link className="btn btn-primary" to="/new">
              + New project
            </Link>
            <button className="btn" onClick={() => fileRef.current?.click()}>
              Import…
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".json,application/json"
              hidden
              onChange={async (e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (!f) return;
                try {
                  const json = JSON.parse(await f.text());
                  const p = await api.importProject(json);
                  toast(`Imported “${p.name}”`);
                  await load();
                } catch (err) {
                  toast(`Import failed: ${(err as Error).message}`, 'error');
                }
              }}
            />
          </>
        }
      />
      <Card>
        {!rows ? (
          <p className="muted">Loading…</p>
        ) : filtered.length === 0 ? (
          <Empty>
            No projects. <Link to="/new">Create a new RO design</Link>.
          </Empty>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Project</th>
                <th>Customer</th>
                <th>Location</th>
                <th>Reference</th>
                <th>Created</th>
                <th>Updated</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id} className={r.id === activeProjectId ? 'active-row' : ''}>
                  <td>
                    <Link to={`/design/${r.id}?tab=summary`}>
                      <b>{r.name}</b>
                    </Link>
                  </td>
                  <td>{r.customer}</td>
                  <td>{r.location}</td>
                  <td>{r.reference}</td>
                  <td className="small muted">{new Date(r.createdAt).toLocaleDateString()}</td>
                  <td className="small muted">{new Date(r.updatedAt).toLocaleString()}</td>
                  <td className="nowrap">
                    <button className="btn btn-xs" onClick={() => navigate(`/design/${r.id}?tab=project`)}>
                      Open / Edit
                    </button>
                    <button className="btn btn-xs" onClick={() => act(() => api.duplicateProject(r.id), 'Project duplicated')}>
                      Duplicate
                    </button>
                    <button
                      className="btn btn-xs"
                      onClick={() =>
                        act(async () => {
                          const file = await api.exportProject(r.id);
                          downloadJson(`${r.name.replace(/[^a-z0-9-_ ]/gi, '').replace(/\s+/g, '_') || 'project'}.roproj.json`, file);
                        }, 'Project exported')
                      }
                    >
                      Export
                    </button>
                    <a className="btn btn-xs" href={api.reportUrl(r.id)} target="_blank" rel="noreferrer">
                      PDF
                    </a>
                    <button
                      className="btn btn-xs btn-danger"
                      onClick={() => {
                        if (confirm(`Delete project “${r.name}”? This cannot be undone.`))
                          void act(async () => {
                            await api.deleteProject(r.id);
                            if (activeProjectId === r.id) setActiveProjectId(null);
                          }, 'Project deleted');
                      }}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
}

export function NewDesignPage() {
  const navigate = useNavigate();
  const { toast } = useApp();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const create = async (template: 'blank' | 'sample') => {
    setBusy(true);
    try {
      const p = await api.createProject({ template, name: name.trim() || undefined });
      toast(`Project “${p.name}” created`);
      navigate(`/design/${p.id}?tab=${template === 'sample' ? 'summary' : 'project'}`);
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <PageHeader title="New RO Design" subtitle="Create a project in the local database, then enter requirements and water analysis." />
      <div className="grid-2">
        <Card title="Blank design">
          <p>Start with default assumptions (from Settings) and an empty water analysis. Missing water-quality data will be flagged.</p>
          <label className="field">
            <span className="field-label">Project name</span>
            <span className="field-input">
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Hotel RO plant 20 m³/h" />
            </span>
          </label>
          <button className="btn btn-primary" disabled={busy} onClick={() => create('blank')}>
            Create blank design
          </button>
        </Card>
        <Card title="From sample: 30 m³/h RO System">
          <p>
            Brackish borehole water (TDS 2 550 mg/L, 28 °C), 600 m³/day in 20 h, 75 % recovery, BW30-400 membranes. Useful to explore every module immediately.
          </p>
          <p className="muted small">Summary: {fmtFlow(30)} permeate, {fmt(40, 0, 'm³/h')} feed.</p>
          <button className="btn" disabled={busy} onClick={() => create('sample')}>
            Create from sample
          </button>
        </Card>
      </div>
    </>
  );
}
