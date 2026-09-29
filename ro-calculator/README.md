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

On first start the database file `data\ro-calculator.db` is created. The migrations are applied automatically
(an existing version-1 database is upgraded in place), and seed data is loaded:
- 5 **DEMO** membrane records (8" and 4"). They are clearly-labelled sample values, **not manufacturer data**.
  Enter your manufacturers' datasheet values in the Membrane Library
- 39 **DEMO** pumps with DEMO curves (flow, head, efficiency, NPSHr). Enter the real manufacturer curves
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
| **Membrane Library** | Add, edit, copy or delete membrane models: datasheet values, test conditions, recommended operating range (flux, element recovery, vessel flows, ΔP), data source. DEMO records are badged |
| **Water Chemistry** | Ion table, ionic balance, TDS (measured / sum of ions / conductivity), osmotic pressure, LSI/RSI and sulfate/silica saturation. Missing data is shown as LABORATORY DATA REQUIRED |
| **Pump Library** | Pumps with manufacturer curves (flow, head, efficiency, NPSHr) entered point by point, with a live curve chart |
| **Pipe Calculator** | Stand-alone pipe sizing, unit converter, editable pipe catalogue and materials |
| **Pretreatment** | Pretreatment recommendation for the active project, with reasons, data used and sizing |
| **BOM** | Editable Bill of Materials and optional cost estimate |
| **Reports** | Open or download the PDF report, and print a summary |
| **Settings** | Display units (m³/h, m³/day, L/h, L/min, gpm / bar, psi, kPa, m head / kW, HP), company name for the report header, global default assumptions |

The **design editor** (`Projects → Open`) has these tabs:

- **Inputs:** Project · Production · Raw Water · Membrane · Pumps & Site · Treatment options · Tanks · Assumptions
- **Results:** Summary · Water Chemistry · RO/Membranes (stage-by-stage, element by element) · Pumps (curve selection, operating point, NPSH) · Pipes (fittings, DN override, Darcy–Weisbach / Hazen–Williams) · Pretreatment & Dosing · Tanks · Electrical · Process Flow · BOM & Cost · Warnings

Every key result has a **"How was this calculated?"** section showing the input, formula, assumptions and result.

Results recalculate **live** as you type. Press **Save** (`Ctrl+S`) to store the project in the local database.
Every warning is labelled **🟢 Acceptable**, **🟡 Review** or **🔴 Critical**.

### Water analysis
Parameters marked `required` are needed for a reliable design. Leave a field **empty** if it was not measured; never
enter 0 for an unmeasured value. Missing data is reported as **INSUFFICIENT DATA — LAB ANALYSIS REQUIRED**. Where
equipment is included only as a precaution because data is missing, the reason says so.

---

## 4. Engineering method (summary)

Every formula is shown in the application next to its result. Every assumption is listed and editable on the
**Assumptions** tab (per project) and in **Settings** (global defaults for new projects). The numerical verification
and the phase-1 → phase-2 comparison are in [VERIFICATION.md](VERIFICATION.md).

| Module | Method |
|---|---|
| Production | Q_p = m³/day ÷ hours × peak factor (or override), Q_f = Q_p ÷ R, Q_c = Q_f − Q_p |
| Water chemistry | Ion table (mg/L, mmol/L, meq/L), ionic balance, TDS from the sum of ions; osmotic pressure π = φ·R·T·Σcᵢ (a NaCl coefficient is used as a flagged fallback when the ion analysis is incomplete) |
| Membrane array | Element count from the design flux; automatic or **manual** array (vessels per stage, e.g. 2:1, 3:1, 4:2, 5:2, 6:3). An automatic array is checked with the solver and replaced by the nearest array that meets the vessel flow limits |
| Element model | Solution–diffusion, element by element: Jw = A·TCF·FF·NDP, NDP = P_avg − P_p − (π_wall − π_p), β = exp(0.7·r), C_p = B·C_m/(Jw + B), ΔP = ΔP_ref·(Q_avg/Q_ref)^1.7. A and B are derived from the datasheet test point. The feed pressure is **solved** so that the array delivers Q_p. Per element: flows, recovery, flux, pressures, osmotic pressures, NDP, β, permeate TDS, rejection, TCF, pressure-correction factor |
| Scaling | LSI and RSI (feed/concentrate), CaSO₄/BaSO₄/SrSO₄ saturation (Davies), silica vs temperature; acid dose from carbonate equilibrium |
| Pretreatment | Rules with explicit triggers and water-quality risk warnings (hardness, silica, Fe, Mn, turbidity, SDI, chlorine). Antiscalant dose is INDICATIVE until the supplier's dose is entered |
| Pumps | TDH = static + pipe friction + minor losses + equipment losses + required operating pressure − suction. P_h = ρ·g·Q·H; P_s = P_h ÷ η; **calculated** motor power = P_s × safety factor, shown separately from the **recommended standard** IEC motor |
| Pump curves | Manufacturer curve (Q, H, η, NPSHr) → head and efficiency at duty, excess head, BEP ratio, system-curve intersection, NPSHa vs NPSHr + margin |
| Pipes | d = √(4Q ÷ (π·v_max)) → catalogue DN (or a forced DN). Darcy–Weisbach (Swamee–Jain) or Hazen–Williams; minor losses ΣK·v²/2g with editable fittings; Re, f, loss per 100 m, pressure rating |
| Tanks / electrical / BOM | As in phase 1 |

Scope limits of this version (clearly simplified, not hidden):
- **Not a manufacturer projection.** The element model uses generic correlations (β, ΔP, TCF). Verify with the manufacturer's software
- Single train, single pass, single design temperature. No interstage booster, energy recovery device or concentrate recirculation
- LSI is not valid above 10 000 mg/L. The Stiff & Davis index is not implemented, and this is flagged
- Membrane and pump seed data are **DEMO** values. No manufacturer data is included
- Costing supports USD. Unit costs are entered by you

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
