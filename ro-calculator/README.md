# RO System Engineering Calculator

A **local-only** engineering tool for the preliminary design of Reverse Osmosis (RO) water treatment systems.
You enter the production requirement and the raw-water analysis, and it calculates the RO array, pumps, pipes,
pretreatment, dosing, tanks, electrical load, process flow diagram, Bill of Materials, optional cost estimate,
and a PDF design report.

- Runs on **your own computer** at `http://localhost:3000`
- **No cloud, no SaaS, no account, no external API.** You need internet only once, to install dependencies
- All data is stored in a local **SQLite** file (`data/ro-calculator.db`)
- Every calculation runs locally. The same TypeScript engine runs in the browser (live results) and on the server (PDF)

> **PRELIMINARY ENGINEERING DESIGN.** The results are simplified engineering estimates. They are **not** a
> manufacturer-certified projection. Before procurement or construction, check the final equipment selection against a
> complete, certified water analysis and against manufacturer data and design software (membrane projection, pump
> curves, antiscalant projection).

---

## 1. Installation on Windows

### Requirements
- **Windows 10/11 (64-bit)**
- **Node.js 22 LTS** (Node 20 or 24 also work). Download it from <https://nodejs.org> and keep the default
  installer options. To check the install, open *Command Prompt* and run `node -v`
- About 400 MB of free disk space for dependencies

### Option A: double-click (easiest)
1. Copy the `ro-calculator` folder to your PC, for example `C:\RO-Calculator`.
2. Double-click **`start-windows.bat`**.
   - The first run installs dependencies (`npm install`, internet needed once) and builds the user interface.
   - It then starts the local server and opens **http://localhost:3000** in your browser.
3. To stop the application, close the black command window, or press `Ctrl + C` in it.

### Option B: command line
```bat
cd C:\RO-Calculator
npm install
npm run build
npm start
```
Then open **http://localhost:3000**.

On first start the database file `data\ro-calculator.db` is created. The migration is applied automatically, and seed
data is loaded:
- 13 membrane models (8" and 4"; typical datasheet values)
- 39 generic pump duty points
- a pipe catalogue: PVC-U PN16, HDPE PE100 SDR11, SS316L Sch10S/Sch40S
- default assumptions and settings
- the sample project **"30 m³/h RO System"**

### Offline use
After `npm install` and `npm run build`, the application needs **no internet connection at all**.

### Troubleshooting
| Problem | Solution |
|---|---|
| `npm install` fails on `better-sqlite3` | Use Node.js **22 LTS** (prebuilt binaries are downloaded for it). With an unusual Node version, install "Visual Studio Build Tools – Desktop development with C++" or switch to Node 22. |
| Port 3000 already in use | Create a `.env` file (copy `.env.example`) and set `PORT=3001`. |
| The page says "frontend has not been built" | Run `npm run build`, then `npm start`. |
| Start again with an empty database | Stop the app, then run `npm run db:reset` (this deletes all projects). |

---

## 2. Configuration (`.env`)
Copy `.env.example` to `.env` to change the defaults:

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `3000` | Local web server port |
| `HOST` | `127.0.0.1` | `127.0.0.1` means only this PC can open the app. Use `0.0.0.0` only if you want to open it from other PCs on your LAN |
| `DATABASE_PATH` | `./data/ro-calculator.db` | SQLite file location |
| `SEED_SAMPLE` | `true` | Create the 30 m³/h sample project on first start |

**Backup:** stop the application and copy `data\ro-calculator.db`. You can also export single projects as JSON from
the **Projects** page and import them again later, on the same or another PC.

---

## 3. Using the application

| Sidebar | What it does |
|---|---|
| **Dashboard** | Project count, library size, the active project's RO design summary, recent projects |
| **Projects** | Create, open/edit, duplicate, export (JSON), import, delete, open the PDF |
| **New RO Design** | Blank design or a copy of the 30 m³/h sample |
| **Membrane Library** | Add, edit, copy or delete membrane models (area, flow, rejection, max pressure/temperature, pH, test conditions) |
| **Pump Library** | Add, edit or delete pump duty points, used to pre-select pumps and check their operating range |
| **Pipe Calculator** | Stand-alone pipe sizing, unit converter, editable pipe catalogue and materials |
| **Pretreatment** | Pretreatment recommendation for the active project, with reasons, data used and sizing |
| **BOM** | Editable Bill of Materials and optional cost estimate |
| **Reports** | Open or download the PDF report, and print a summary |
| **Settings** | Display units (m³/h, m³/day, L/h, L/min, gpm / bar, psi, kPa, m head / kW, HP), company name for the report header, global default assumptions |

The **design editor** (`Projects → Open`) has these tabs:

- **Inputs:** Project · Production · Raw Water · Membrane · Pumps & Site · Treatment options · Tanks · Assumptions
- **Results:** Summary · RO/Membranes · Pumps · Pipes · Pretreatment & Dosing · Tanks · Electrical · Process Flow · BOM & Cost · Warnings

Results recalculate **live** as you type. Press **Save** (`Ctrl+S`) to store the project in the local database.
Every warning is labelled **🟢 Acceptable**, **🟡 Review** or **🔴 Critical**.

### Water analysis
Parameters marked `required` are needed for a reliable design. Leave a field **empty** if it was not measured; never
enter 0 for an unmeasured value. Missing data is reported as **INSUFFICIENT DATA — LAB ANALYSIS REQUIRED**. Where
equipment is included only as a precaution because data is missing, the reason says so.

---

## 4. Engineering method (summary)

Every formula is shown in the application next to its result. Every assumption is listed and editable on the
**Assumptions** tab (per project) and in **Settings** (global defaults for new projects).

| Module | Method |
|---|---|
| Production | Q_p = m³/day ÷ hours × peak factor (or override), Q_f = Q_p ÷ R, Q_c = Q_f − Q_p |
| Membranes | N = ceil(Q_p·1000 ÷ (J_design·A)); vessels = ceil(N ÷ elements per vessel); stages from recovery (≤ 50 % → 1, ≤ 75 % → 2, else 3) with a 2:1 / 4:2:1 taper; checks on flux, feed and concentrate flow per vessel, and element recovery |
| Pressure | Permeability A from the datasheet test point; TCF = exp(K(1/298 − 1/T)); NDP = J ÷ (A·TCF·fouling factor); P_feed = NDP + π_avg − π_p + ΔP/2 + P_permeate, with π_avg from the log-mean concentration factor × polarisation factor |
| Salt passage | Nominal passage scaled by flux ratio, TCF, concentration factor and an ageing factor (screening estimate) |
| Scaling | LSI (Langelier) of the concentrate (pH_c ≈ pH_f + log CF); CaSO4 / BaSO4 / SrSO4 saturation with Davies activity coefficients; silica solubility vs temperature; acid dose from carbonate equilibrium (pKa 6.35) |
| Pretreatment | Rule set with explicit triggers (turbidity, SDI, Fe, Mn, free chlorine, TOC, LSI, CaSO4, silica); filter vessels sized from loading rate and standard diameters; cartridge count from flow per 40" element; softener resin from hardness × flow × cycle |
| Pumps | Head components listed one by one (static, friction, filters, membrane pressure, suction). P_hyd = ρ·g·Q·H; shaft = P_hyd ÷ η_pump; motor = next IEC size ≥ shaft × sizing factor; checked against the pump library (70–120 % of rated flow) |
| Pipes | d = √(4Q ÷ (π·v_max)), then the smallest catalogue ID ≥ d (the catalogue is data, not code); Darcy–Weisbach with Swamee–Jain and temperature-dependent viscosity; fittings allowance; pressure rating check |
| Tanks | Raw = Q_raw × hours; product = max(Q_p × hours, peak deficit); reject; CIP (L per element); chemical tanks (days of autonomy); freeboard; standard sizes |
| Electrical | Connected load, running load, kWh/day, kWh/m³, full-load current, main incomer |

Scope limits of this version (clearly simplified, not hidden):
- Single RO train and single pass. No 2nd pass, no energy recovery device, no concentrate recirculation
- Equal flux per element is assumed for the stage flows. There is no element-by-element projection
- Scaling indices are screening estimates. Confirm antiscalant choice and dose with the supplier's software
- Pump selection uses duty points and a simplified parabolic curve. Confirm with the published pump curves
- Seed membrane values are typical datasheet values. Check them against current manufacturer datasheets
- Costing supports USD. Unit costs are entered by you; no prices are built in

---

## 5. Development

```bash
npm install
npm run dev        # API on :3000 (tsx watch) + Vite UI on http://localhost:5173 (proxy /api → 3000)
npm test           # Vitest: engine, database/API, project save/load, PDF
npm run typecheck  # TypeScript strict check (client + server)
npm run build      # production UI build → dist/client (served by npm start)
npm run db:generate  # regenerate the Drizzle SQL migration after changing src/server/db/schema.ts
npm run db:migrate | db:seed | db:reset
```

### Technology
- **Frontend:** React 19 + TypeScript + Vite, React Router, plain CSS, and an SVG process flow diagram
- **Backend:** Node.js + Express 5 + TypeScript (run with `tsx`), zod validation
- **Database:** SQLite (better-sqlite3) + **Drizzle ORM**, with migrations in `drizzle/`
- **PDF:** PDFKit, server-side, using built-in fonts only
- **Tests:** Vitest + Supertest

### Project structure
```
ro-calculator/
├─ src/shared/            calculation engine (browser + server)
│  ├─ assumptions.ts      central register of all design assumptions
│  ├─ types.ts            design input & library types
│  ├─ catalog.ts          seed data (membranes, pumps, pipe catalogue)
│  ├─ sample.ts           30 m³/h sample project
│  ├─ units.ts            unit conversion
│  └─ engine/             water, production, membrane, pretreatment, pipes, pumps, dosing, tanks, electrical, bom
├─ src/server/            Express API, SQLite/Drizzle, PDF report
├─ src/client/            React UI (pages, components)
├─ drizzle/               SQL migrations
├─ tests/                 engine / api / pdf tests
├─ start-windows.bat      Windows launcher
└─ .env.example
```

### REST API (localhost only)
`GET/POST /api/projects`, `GET/PUT/DELETE /api/projects/:id`, `POST /api/projects/:id/duplicate`,
`GET /api/projects/:id/export`, `POST /api/projects/import`, `GET /api/projects/:id/calculate`,
`GET /api/projects/:id/report.pdf`, `POST /api/calculate`, `GET /api/library`, CRUD on `/api/membranes`,
`/api/pumps`, `/api/pipe-sizes`, `/api/pipe-materials`, `GET/PUT /api/settings`, `GET /api/health`.

---

## 6. Degdeg – ku rakibida Windows (Somali quick start)
1. Ku rakib **Node.js 22 LTS** (https://nodejs.org).
2. Folder-ka `ro-calculator` ku koobiyee kombiyuutarkaaga.
3. Laba-guji **`start-windows.bat`**. Markii ugu horreysay wuxuu soo dejinayaa dependencies-ka (internet hal mar
   ayaa loo baahan yahay), kadibna wuxuu furayaa **http://localhost:3000**.
4. Xogtaada oo dhan waxay ku kaydsantaa `data\ro-calculator.db`, waana local. Cloud lama isticmaalo.
5. Mashruuca tijaabada ah **"30 m³/h RO System"** si toos ah ayuu u abuurmaa.
