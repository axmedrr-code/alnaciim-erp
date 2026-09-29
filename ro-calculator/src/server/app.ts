import express, { type NextFunction, type Request, type Response } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { runDesign } from '../shared/engine';
import { blankDesign, sample30m3h } from '../shared/sample';
import type { DesignInput } from '../shared/types';
import { ROOT, type Db } from './db/client';
import { buildReportPdf } from './pdf/report';
import { Repo } from './repo';
import { designInputSchema, exportFileSchema, membraneSchema, pipeMaterialSchema, pipeSizeSchema, pumpSchema, settingsSchema } from './validation';

class HttpError extends Error {
  constructor(readonly status: number, message: string, readonly details?: unknown) {
    super(message);
  }
}

function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const r = schema.safeParse(body);
  if (!r.success) {
    const msg = r.error.issues.map((i) => `${i.path.join('.') || '(body)'}: ${i.message}`).join('; ');
    throw new HttpError(400, `Invalid input – ${msg}`, r.error.issues);
  }
  return r.data;
}

function idParam(req: Request) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, 'Invalid id');
  return id;
}

function safeFilename(s: string) {
  return s.replace(/[^a-zA-Z0-9-_ ]+/g, '').trim().replace(/\s+/g, '_').slice(0, 80) || 'project';
}

export function createApp(db: Db, opts: { staticDir?: string | null } = {}) {
  const repo = new Repo(db);
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '10mb' }));

  const api = express.Router();

  api.get('/health', (_req, res) => {
    res.json({ ok: true, app: 'RO System Engineering Calculator', time: new Date().toISOString() });
  });

  // ---------------------------------------------------------------- projects
  api.get('/projects', (_req, res) => {
    res.json(repo.listProjects());
  });

  api.post('/projects', (req, res) => {
    const body = req.body ?? {};
    let data: DesignInput;
    if (body.data) data = parse(designInputSchema, body.data) as DesignInput;
    else {
      const { assumptions } = repo.getSettings();
      const firstBw = repo.findMembrane('DuPont FilmTec', 'BW30-400') ?? repo.listMembranes()[0] ?? null;
      data = body.template === 'sample' ? sample30m3h(assumptions, firstBw?.id ?? null) : blankDesign(assumptions, firstBw?.id ?? null);
      if (typeof body.name === 'string' && body.name.trim()) data.project.name = body.name.trim();
    }
    res.status(201).json(repo.createProject(data));
  });

  api.get('/projects/:id', (req, res) => {
    const p = repo.getProject(idParam(req));
    if (!p) throw new HttpError(404, 'Project not found');
    res.json(p);
  });

  api.put('/projects/:id', (req, res) => {
    const data = parse(designInputSchema, req.body?.data ?? req.body) as DesignInput;
    const p = repo.updateProject(idParam(req), data);
    if (!p) throw new HttpError(404, 'Project not found');
    res.json(p);
  });

  api.delete('/projects/:id', (req, res) => {
    if (!repo.deleteProject(idParam(req))) throw new HttpError(404, 'Project not found');
    res.status(204).end();
  });

  api.post('/projects/:id/duplicate', (req, res) => {
    const p = repo.duplicateProject(idParam(req));
    if (!p) throw new HttpError(404, 'Project not found');
    res.status(201).json(p);
  });

  api.get('/projects/:id/export', (req, res) => {
    const p = repo.getProject(idParam(req));
    if (!p) throw new HttpError(404, 'Project not found');
    const membrane = repo.getMembrane(p.data.membrane.membraneId);
    const file = { format: 'ro-calculator-project', version: 1, exportedAt: new Date().toISOString(), project: p.data, membrane: membrane ? { ...membrane, id: undefined } : null };
    res.setHeader('Content-Disposition', `attachment; filename="${safeFilename(p.name)}.roproj.json"`);
    res.json(file);
  });

  api.post('/projects/import', (req, res) => {
    const file = parse(exportFileSchema, req.body);
    const data = file.project as DesignInput;
    // Re-link the membrane by manufacturer + model, adding it to the local library if missing
    if (file.membrane) {
      const m = file.membrane;
      const existing = repo.findMembrane(m.manufacturer, m.model) ?? repo.createMembrane({ ...m, notes: m.notes ?? '' });
      data.membrane.membraneId = existing.id;
    } else if (data.membrane.membraneId != null && !repo.getMembrane(data.membrane.membraneId)) {
      data.membrane.membraneId = null;
    }
    res.status(201).json(repo.createProject(data));
  });

  api.get('/projects/:id/calculate', (req, res) => {
    const p = repo.getProject(idParam(req));
    if (!p) throw new HttpError(404, 'Project not found');
    res.json(runDesign(p.data, repo.context(p.data)));
  });

  api.post('/calculate', (req, res) => {
    const data = parse(designInputSchema, req.body?.data ?? req.body) as DesignInput;
    res.json(runDesign(data, repo.context(data)));
  });

  api.get('/projects/:id/report.pdf', async (req, res) => {
    const p = repo.getProject(idParam(req));
    if (!p) throw new HttpError(404, 'Project not found');
    const ctx = repo.context(p.data);
    const result = runDesign(p.data, ctx);
    const pdf = await buildReportPdf({ input: p.data, result, membrane: ctx.membrane, settings: repo.getSettings() });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `${req.query.download ? 'attachment' : 'inline'}; filename="${safeFilename(p.name)}_RO_Design_Report.pdf"`);
    res.send(pdf);
  });

  // ---------------------------------------------------------------- libraries
  api.get('/library', (_req, res) => {
    res.json({ membranes: repo.listMembranes(), pumps: repo.listPumps(), pipeSizes: repo.listPipeSizes(), pipeMaterials: repo.listPipeMaterials() });
  });

  api.get('/membranes', (_req, res) => res.json(repo.listMembranes()));
  api.post('/membranes', (req, res) => res.status(201).json(repo.createMembrane(parse(membraneSchema, req.body))));
  api.put('/membranes/:id', (req, res) => {
    const m = repo.updateMembrane(idParam(req), parse(membraneSchema, req.body));
    if (!m) throw new HttpError(404, 'Membrane not found');
    res.json(m);
  });
  api.delete('/membranes/:id', (req, res) => {
    const id = idParam(req);
    const used = repo.listProjects().filter((p) => repo.getProject(p.id)?.data.membrane.membraneId === id);
    if (used.length) throw new HttpError(409, `Membrane is used by project(s): ${used.map((p) => p.name).join(', ')}`);
    if (!repo.deleteMembrane(id)) throw new HttpError(404, 'Membrane not found');
    res.status(204).end();
  });

  api.get('/pumps', (_req, res) => res.json(repo.listPumps()));
  api.post('/pumps', (req, res) => res.status(201).json(repo.createPump(parse(pumpSchema, req.body))));
  api.put('/pumps/:id', (req, res) => {
    const p = repo.updatePump(idParam(req), parse(pumpSchema, req.body));
    if (!p) throw new HttpError(404, 'Pump not found');
    res.json(p);
  });
  api.delete('/pumps/:id', (req, res) => {
    if (!repo.deletePump(idParam(req))) throw new HttpError(404, 'Pump not found');
    res.status(204).end();
  });

  api.get('/pipe-materials', (_req, res) => res.json(repo.listPipeMaterials()));
  api.post('/pipe-materials', (req, res) => res.status(201).json(repo.upsertPipeMaterial(parse(pipeMaterialSchema, req.body))));
  api.delete('/pipe-materials/:name', (req, res) => {
    if (!repo.deletePipeMaterial(String(req.params.name))) throw new HttpError(404, 'Material not found');
    res.status(204).end();
  });
  api.get('/pipe-sizes', (_req, res) => res.json(repo.listPipeSizes()));
  api.post('/pipe-sizes', (req, res) => {
    const p = parse(pipeSizeSchema, req.body);
    if (!repo.listPipeMaterials().some((m) => m.name === p.material)) throw new HttpError(400, `Unknown material "${p.material}" – add it first.`);
    try {
      res.status(201).json(repo.createPipeSize(p));
    } catch (e) {
      throw new HttpError(409, `DN ${p.dn} already exists for ${p.material}`, String(e));
    }
  });
  api.put('/pipe-sizes/:id', (req, res) => {
    const p = repo.updatePipeSize(idParam(req), parse(pipeSizeSchema, req.body));
    if (!p) throw new HttpError(404, 'Pipe size not found');
    res.json(p);
  });
  api.delete('/pipe-sizes/:id', (req, res) => {
    if (!repo.deletePipeSize(idParam(req))) throw new HttpError(404, 'Pipe size not found');
    res.status(204).end();
  });

  // ---------------------------------------------------------------- settings
  api.get('/settings', (_req, res) => res.json(repo.getSettings()));
  api.put('/settings', (req, res) => {
    const s = parse(settingsSchema, req.body);
    if (s.assumptions) repo.setSetting('assumptions', s.assumptions);
    if (s.units) repo.setSetting('units', s.units);
    if (s.company) repo.setSetting('company', s.company);
    res.json(repo.getSettings());
  });

  api.use((_req, _res, next) => next(new HttpError(404, 'API endpoint not found')));
  app.use('/api', api);

  // ---------------------------------------------------------------- static frontend (production build)
  const staticDir = opts.staticDir === undefined ? path.join(ROOT, 'dist', 'client') : opts.staticDir;
  if (staticDir && fs.existsSync(path.join(staticDir, 'index.html'))) {
    app.use(express.static(staticDir, { index: false }));
    app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(path.join(staticDir, 'index.html')));
  } else {
    app.get('/', (_req, res) =>
      res.type('html').send('<h2>RO System Engineering Calculator – API is running.</h2><p>The frontend has not been built. Run <code>npm run build</code> and restart, or use <code>npm run dev</code> and open the Vite URL.</p>'),
    );
  }

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) {
      res.status(err.status).json({ error: err.message, details: err.details });
      return;
    }
    const status = (err as { status?: number; type?: string })?.type === 'entity.parse.failed' ? 400 : 500;
    if (status === 500) console.error(err);
    res.status(status).json({ error: status === 400 ? 'Malformed JSON body' : `Internal error: ${(err as Error)?.message ?? err}` });
  });

  return app;
}
