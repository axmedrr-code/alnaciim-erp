# Engineering verification report – phase 2 (engine v2.0.0)

> **PRELIMINARY ENGINEERING DESIGN.** FINAL EQUIPMENT SELECTION MUST BE VERIFIED AGAINST ACTUAL WATER
> ANALYSIS AND MANUFACTURER DATASHEETS. This tool is not a manufacturer-certified projection program.

Test run: `npm test` passed **94 of 94 tests** in 4 files: `engine.test.ts`, `engineering.test.ts`, `api.test.ts`
and `pdf.test.ts`. `npm run typecheck` is clean for client and server. The browser end-to-end checks
(Playwright on the production build) showed no console errors.

Status legend:
- **PASS**: the calculation is implemented and numerically verified by automated tests.
- **WARNING**: the calculation is implemented and verified, but has a known modelling limitation that the engineer must be aware of.
- **FAIL**: the module does not work. No module is in this state.

| # | Module | Status | What was verified | Limitation / remark |
|---|---|---|---|---|
| 1 | Production & flow balance | **PASS** | Feed = permeate + reject and recovery = permeate / feed, exact for 10, 30 and 50 m³/h; impossible recovery (0, 100, 120, −5 %) rejected; recovery above the configured limit is red | – |
| 2 | Membrane count & array | **PASS** | N = ceil(Q_p·1000/(J·A)); elements = vessels × elements/vessel; manual 2:1, 3:1, 4:2, 5:2 and 6:3 honoured; the automatic array is re-checked with the solver and must pass its own vessel limits | Maximum 4 stages; identical vessels within a stage |
| 3 | Element-by-element RO model | **WARNING** | Datasheet test point reproduced (flow within 1 %, rejection within 0.05 %); stage balances and element balances hold; salt mass balance within 1 %; P↑ gives Q_p↑ and TDS↑ gives Q_p↓; element solver converges (monotonic bisection) | Solution–diffusion model with generic β, ΔP and TCF correlations; single temperature; no interstage booster, permeate throttling or ERD. **Not a manufacturer projection – verify with manufacturer software.** |
| 4 | Temperature correction | **PASS** | TCF(25 °C) = 1 exactly; formula checked; colder water gives higher pressure and lower permeate TDS | Separate constants for water (K) and salt (K_B) are assumptions |
| 5 | Water chemistry | **PASS** | Ion table, meq balance, TDS as the sum of ions; osmotic pressure by van ’t Hoff (NaCl 1000 mg/L ≈ 0.78 bar); missing data shows LABORATORY DATA REQUIRED; inconsistent analyses flagged | Na is never calculated "by difference"; when the ion analysis is incomplete the coefficient fallback is flagged |
| 6 | Scaling indicators | **WARNING** | LSI, RSI, CaSO₄/BaSO₄/SrSO₄ (Davies activity), silica vs temperature; insufficient data is flagged | Screening only. LSI is not valid above 10 000 mg/L (Stiff & Davis not implemented – flagged); silica pH effect not modelled; antiscalant limits must come from the supplier |
| 7 | Pretreatment rules & water-quality warnings | **PASS** | Hardness, silica, Fe, Mn, turbidity, SDI and chlorine warnings; every item states its reason and the data used; insufficient data is shown | Rule-based preliminary selection; coagulant dose needs jar tests (not sized) |
| 8 | Chemical dosing | **WARNING** | Dosing formulas verified; antiscalant is **INDICATIVE** until a supplier dose is entered (yellow warning); acid dose from carbonate equilibrium | Antiscalant dose/product must come from the supplier projection |
| 9 | Pipe hydraulics | **PASS** | v = Q/A; Re; Swamee–Jain f; Darcy–Weisbach and Hazen–Williams against hand formulas; h_m = ΣK·v²/2g; loss per 100 m; user max velocity honoured; a forced small DN is red; pressure rating checked | Hazen–Williams flagged outside its validity range |
| 10 | Pump TDH & power | **PASS** | TDH = Σ components (static, friction, minor, equipment, operating pressure − suction); P_h = ρgQH; P_s = P_h/η; required motor = P_s × SF; standard IEC size ≥ requirement (shown separately) | Head design margin and motor safety factor are editable assumptions |
| 11 | Pump curve & operating point | **WARNING** | Curve interpolation, system curve, intersection, head at duty, excess head, BEP ratio, NPSHa vs NPSHr; insufficient pressure / outside curve are red; no curve gives "operating point requires confirmation" | **Seeded curves are DEMO data.** Enter the manufacturer's curves |
| 12 | Raw-water (borehole) pump | **PASS** | Static = dynamic level + elevation + tank inlet; friction and minor losses of the riser and transfer line; strainer and extra valve losses; efficiency and flow overrides | Submersible NPSH is assumed satisfied by submergence |
| 13 | Tanks, electrical, BOM, cost | **PASS** | Unchanged from phase 1; all tests pass; BOM shows the calculated motor and the standard motor | – |
| 14 | Unit conversions | **PASS** | m³/h ↔ m³/day, L/h, L/min, gpm; bar ↔ psi, kPa, m head (1 bar = 10.19 m); kW ↔ HP; round trips exact | – |
| 15 | Traceability | **PASS** | Every key result has "How was this calculated?" with input, formula, assumptions and result (UI and PDF) | – |
| 16 | Membrane / pump database (DEMO) | **WARNING** | Seeded records are marked DEMO, and designs using them get a yellow warning; version-1 records are relabelled DEMO by migration 0001 | **No manufacturer data is supplied.** The engineer must enter datasheet values |
| 17 | Database, save/load, import/export, upgrade | **PASS** | CRUD, validation (400/404/409), version-1 projects import and calculate, version-1 database upgrades | – |
| 18 | PDF report | **PASS** | Generated for the sample (32 pages), the blank design, and a design with a selected pump curve; both mandatory labels on every page | Long report (full traceability) |

## 30 m³/h example: phase 1 vs phase 2

Same inputs (600 m³/day, 20 h/day, 75 % recovery, TDS 2 550 mg/L, 28 °C, 37.2 m² brackish 8" element). No result
is hard-coded; every value below is calculated.

| Result | Phase 1 | Phase 2 | Why it changed |
|---|---|---|---|
| Permeate / feed / reject | 30 / 40 / 10 m³/h | 30 / 40 / 10 m³/h | Flow balance – unchanged |
| Membranes / vessels / array | 42 / 7 / 5:2 | 42 / 7 / 5:2 | Same flux target (22 LMH) and element area. The solver checked 5:2 and it passes all vessel limits, so it was kept. It is **not** forced |
| Feed osmotic pressure | 1.96 bar (NaCl coefficient × TDS) | **1.66 bar** | Now π = φRTΣcᵢ from the actual ion analysis. Divalent Ca/Mg/SO₄ give fewer dissolved particles per mg/L than NaCl |
| Membrane feed pressure | 11.9 bar | **11.13 bar** | Element-by-element solution instead of one lumped equation: lower osmotic pressure (above); polarisation calculated per element (β 1.04–1.13 instead of a fixed 1.1); flow-dependent element ΔP (array total 1.20 bar instead of 12 × 0.2 = 2.4 bar) |
| Stage pressures | – | Stage 1: 11.13 → 10.59 bar; stage 2: 10.59 → 9.93 bar | New stage-by-stage calculation |
| Stage flows | – | Stage 1: 40 → 24.66 + 15.34 m³/h; stage 2: 15.34 → 5.34 + 10.0 m³/h | Unequal flux per stage (stage 1 22.1 LMH, stage 2 12.0 LMH) instead of the equal-flux assumption |
| Permeate TDS | 64 mg/L | **70 mg/L** | Salt passage calculated per element with B·TCF_B (K_B = 3000) and polarisation; the tail elements of stage 2 pass more salt (up to 279 mg/L) |
| HP pump | 42 m³/h @ 13.0 bar, TDH 117.5 m | **42 m³/h @ 12.28 bar, TDH 109.9 m** | Lower membrane pressure; HP line losses now use K-values (0.12 bar) instead of a percentage allowance |
| HP motor | 22 kW | **19.28 kW calculated requirement → 22 kW recommended standard motor** | Now reported separately. The standard size is unchanged because 19.28 kW rounds up to the next IEC size |
| Raw-water pump | 46.2 m³/h @ 77.6 m, 18.5 kW | 46.2 m³/h @ 77.0 m; 17.16 kW calculated → 18.5 kW standard | Minor losses now by K-values (4 elbows, gate, check, exit) instead of a 25 % allowance |
| Warnings | 0 red / 2 yellow | 0 red / 14 yellow | New yellow warnings: DEMO membrane data, manufacturer verification, pump operating points not confirmed (no curve selected), antiscalant dose not confirmed by the supplier, and water-quality risks (hardness, silica, Fe, Mn, turbidity, SDI) |

## Additional test cases (same water, 20 h/day, 75 % recovery)

| Case | Array (automatic) | Flux | Feed pressure | Permeate TDS | HP pump (calc → standard) | Red warnings |
|---|---|---|---|---|---|---|
| 10 m³/h | 1:1:1 × 6 = 18 el. | 14.9 LMH | 11.23 bar | 92 mg/L | 6.46 → 7.5 kW | 0 |
| 30 m³/h | 5:2 × 6 = 42 el. | 19.2 LMH | 11.13 bar | 70 mg/L | 19.28 → 22 kW | 0 |
| 50 m³/h | 7:4 × 6 = 66 el. | 20.4 LMH | 11.69 bar | 65 mg/L | 33.9 → 37 kW | 0 |

For 10 m³/h, the default 2:1 array (3 vessels) **failed** its own check in the element solution: stage-1
concentrate was 2.64 m³/h per vessel, below the 3.0 m³/h minimum. The automatic design therefore searched nearby
arrays and chose 1:1:1 (three vessels in series). It records this in the findings list. The 10 m³/h flux (14.9 LMH)
is below the 22 LMH target but above the membrane's recommended minimum of 12 LMH. Six elements per vessel would
need fewer vessels in parallel; the engineer can change elements per vessel or the array manually.

Negative tests that produce red warnings: excessive recovery (90 %), infeasible osmotic duty, insufficient HP
suction pressure (booster pump disabled), an HP pump curve too weak (insufficient pressure), duty outside the pump
curve, NPSH margin not met, excessive pipe velocity (forced DN), missing temperature (INSUFFICIENT DATA, no pressure
invented), chlorine in the feed, SDI > 5, iron > 1 mg/L, and invalid pH or negative values.
