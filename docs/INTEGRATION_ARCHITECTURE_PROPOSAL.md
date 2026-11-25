# Al-Naciim ERP — Integration Architecture Proposal

**Status:** PROPOSAL ONLY — nothing in this document is implemented, connected or deployed.
**Scope:** Alnaciim ERP / POS / Route Operations (this repository) and its possible integrations with **Odoo**, **WMS**, **NUWACO** and **Railway**.
**Approval required:** yes. No integration code, credential, database link or deployment will be created until the decisions in section 10 are approved in writing.

> **Soo koobid (Somali):** Warbixintan waa qorshe, maaha hirgelin. Waxay qeexaysaa sida ERP-gu ula hadli karo Odoo, WMS iyo NUWACO si ammaan ah, adigoo ilaalinaya in nidaamyadu **gooni gooni** u ahaadaan: **API oo kaliya** (ma jiro DB wadaag ah, ma jiro secret wadaag ah), **GEEDSAN iyo NUWACO waligood lama isku darayo**, iyo Railway oo aan ahayn integration ee ah goobta hore ee deployment/xogta. Qaybta 10aad waxay liis gareynaysaa go'aannada aan kaa u baahanahay.

---

## 1. What is known — and what is not

| Topic | Evidence in this repository | Consequence |
|---|---|---|
| Odoo | Only a design note (`docs/DESIGN.md`) that Odoo was *considered and not chosen* as the ERP, and a comment in migration 008. No adapter, no API contract, no credentials. | We do not know what Odoo is used for at Al-Naciim (accounting? inventory? CRM?) or which version/modules/API (JSON-2, XML-RPC, custom). |
| WMS | No reference at all. | We do not know its vendor, API, data model, or whether it is warehouse-of-record for any stock. |
| NUWACO | Mentioned only as "not implemented, no contract". | We do not know its role (customer, project, partner, separate company) or any interface. |
| GEEDSAN | Not in the repository. Your instruction: *never mix GEEDSAN and NUWACO projects.* | Treated as a hard isolation requirement between two independent projects. |
| Railway | Deployment/config references only. The old Railway database is **not** an integration; its data has not been recovered. | Handled as a separate migration/recovery topic (section 8), never as a live connection. |

**Therefore this proposal defines the architecture, security model, data contracts' *shape* and a phased plan. It deliberately does not guess any partner's API.** Each partner adapter is built only after that partner supplies (a) written API documentation, (b) a sandbox or test tenant, and (c) an owner who approves the data flow.

## 2. Non-negotiable principles (from the project-separation rules)

1. **Independent systems.** ERP/POS, Odoo, WMS, NUWACO and GEEDSAN stay separate products with separate code, databases, secrets, JWT keys and deployments.
2. **API-only.** Systems exchange data over HTTPS APIs. No shared database, no cross-database queries, no database links, no replica of another system's tables inside the ERP database.
3. **No shared secrets.** Every connection has its own credential, stored only in the environment of the component that uses it. No secret is ever committed, logged or printed.
4. **TEST first, synthetic data.** All development uses the Neon TEST database and synthetic data. No production data is used for testing; production and Railway are untouched.
5. **Nothing leaves the ERP without an owner.** Every outbound data flow names a business owner, a purpose and the minimum fields needed.
6. **GEEDSAN ≠ NUWACO.** The two are never combined in one connection, queue, mapping table, credential, report or query (section 6).
7. **Reversible.** Every integration has a kill switch and can be turned off without affecting ERP operations.

## 3. Options considered

| Option | Description | Pros | Cons | Verdict |
|---|---|---|---|---|
| A. Manual / file exchange | ERP exports CSV/JSON; partner imports (and vice versa) by a person. | Zero coupling, no credentials, immediate. | Manual effort, delays, human error. | **Phase 1** (safe interim) |
| B. Outbox + separate gateway (recommended) | ERP writes business events to an *outbox* table in its own database. A **separate gateway service per partner** reads events through the ERP's scoped read API, calls the partner, and records the result. | Strong isolation, retries, audit, per-partner credentials, ERP stays up if a partner is down. | One more small service per partner to run. | **Recommended target** |
| C. Direct calls from the ERP backend | ERP code calls partner APIs inline. | Simplest to write. | Couples availability and secrets of every partner into the ERP; hard to isolate GEEDSAN/NUWACO; a partner outage can stall ERP transactions. | Rejected |
| D. Shared database / ETL on DB level | Read or replicate each other's tables. | Fast data access. | Violates the separation rules; exposes schemas and secrets. | **Prohibited** |

## 4. Recommended architecture (Option B)

```
                      ┌─────────────────────────── Alnaciim ERP (this repo) ───────────────────────────┐
  Users ──► React ───►│  Express API ── business transaction ──► Postgres (Neon / future prod)           │
                      │        │                                    │                                    │
                      │        └── same DB transaction ───────────► integration_outbox (event, key, JSON)│
                      │  Read-only Integration API  (/api/v1/integration/*, scoped service accounts)     │
                      └───────────────▲─────────────────────────────────────────────────────────────────┘
                                      │ HTTPS, signed, per-integration credential
        ┌─────────────────────────────┼───────────────────────────────┐
        │                             │                               │
 ┌──────┴───────┐              ┌──────┴───────┐                ┌──────┴───────┐
 │ Odoo gateway │              │ WMS gateway  │                │ NUWACO gw    │   (GEEDSAN gw = a different,
 │ own repo/env │              │ own repo/env │                │ own repo/env │    fully separate deployment)
 └──────┬───────┘              └──────┬───────┘                └──────┬───────┘
        ▼                             ▼                               ▼
      Odoo API                      WMS API                        NUWACO API
```

**Key mechanics**

- **Transactional outbox.** When the ERP posts a business event (for example *PO authorized*, *goods receipt accepted*, *supplier payment approved*, *sales invoice approved*), it inserts an outbox row **in the same database transaction**. The event can therefore never be lost or sent for a transaction that rolled back.
- **Idempotency.** Every event carries a stable key built from the ERP document number plus a version (for example `PO-2026-00012:v3`). Gateways and partners must treat a repeated key as a no-op, so retries are safe.
- **Pull, not push, from the ERP side.** Gateways *pull* events from a read-only integration API using a service account. The ERP never stores or uses partner credentials.
- **Dead-letter and reconciliation.** Failed deliveries are retried with back-off, then parked for a person to review. A daily reconciliation compares counts and totals on both sides and raises an exception in the Operations dashboard.
- **Mapping tables.** `external_id_map(integration, entity, erp_id, external_id)` links ERP products, suppliers, customers and warehouses to partner identifiers; it is scoped per integration and per project.
- **Inbound data is never trusted blindly.** Anything arriving from a partner lands in a *staging* table, is validated, and creates or updates ERP records only through the existing, audited ERP services (so approvals, separation of duties and the double-entry ledger still apply).

## 5. Candidate data flows (to be confirmed per partner — nothing is assumed)

The ERP already has the building blocks these flows need: numbered documents (PR/QT/PO/GRN/MIN/SINV/PV, invoice and receipt numbers), an append-only procurement approval/audit trail, a signed stock movement ledger (`signed_quantity`, migration 037), double-entry journals, and role-based access.

| Domain | Possible direction | System of record to decide | Notes |
|---|---|---|---|
| Item master (products, units) | one-way into ERP or out | **Decision needed** | Needs a shared item code; mapping table handles differences. |
| Suppliers / customers | one-way | **Decision needed** | Personal data: send only what is necessary. |
| Purchase orders / goods receipts | ERP → Odoo or WMS | **Decision needed** | Accepted quantities only; rejected/damaged stay in the ERP. |
| Stock movements / counts | ERP ↔ WMS | **Decision needed** — one system must own stock per warehouse | Two owners of the same stock is the most common integration failure; avoid it. |
| Sales invoices / collections | ERP → Odoo accounting (if Odoo is the finance book) | **Decision needed** | The ERP general ledger must not be double-posted. |
| Accounting entries | ERP → Odoo, or none | **Decision needed** | Summary journal export is safer than line-by-line sync. |
| NUWACO / GEEDSAN project data | per project, separate | **Decision needed** | See section 6. |

## 6. GEEDSAN and NUWACO isolation (hard rule)

- **Separate everything:** one gateway deployment, one credential set, one outbox filter, one mapping scope and one reconciliation report **per project**. A single process or table row never serves both.
- **Project scope in the ERP:** every record that may flow outward is tagged with its project/cost-center scope. A gateway's service account is bound to exactly one scope; requests for another scope return 403 and are audited.
- **Database guard:** `external_id_map` and the outbox carry an `integration` + `project_scope` column with a check that a gateway can only read its own scope.
- **Reports:** no consolidated GEEDSAN+NUWACO report is produced unless you explicitly request it in writing, and then only from the ERP's own ledger, never by merging partner feeds.
- **Tests (acceptance):** an automated test must prove that the NUWACO service account cannot read, write or reconcile GEEDSAN data, and vice versa.

## 7. Security model

| Control | Design |
|---|---|
| Identity | Dedicated non-human role **Integration Service** per integration; no human roles reused. |
| Authorization | Allow-list of integration endpoints, read-only unless a flow explicitly needs write; scoped to project/company. |
| Authentication | Per-integration API key or client certificate; request signing (HMAC with timestamp + nonce) to prevent replay; keys rotated on a schedule and on suspicion. |
| Transport | HTTPS only; IP allow-list where the partner supports it. |
| Secrets | Held only in each component's environment (Render / Vercel / partner side). Never in the repository, logs, URLs, or this chat. |
| Data minimization | Field-level allow-lists per flow; no passwords, tokens, or unrelated personal data. |
| Audit | `integration_audit_log` records every call: who, endpoint, event key, result, duration. Visible to Admin and Operation Manager. |
| Availability | Per-integration kill switch; rate limits; circuit breaker so a partner outage never blocks ERP transactions. |
| Testing | Contract tests against a partner sandbox; end-to-end tests against the Neon TEST database with synthetic data only. |

## 8. Railway

Railway is **not** an integration target. It hosted the earlier deployment; its database contents have not been recovered and are not connected to the TEST stack. Any recovery or migration of Railway data is a **separate project** that needs: a read-only export performed by the data owner, a written mapping to the current schema, a TEST-database rehearsal, a reconciliation sign-off, and your explicit approval before anything touches production. Until then no component connects to Railway.

## 9. Phased roadmap (each phase needs approval to start)

| Phase | Deliverable | Needs from you | Exit criteria |
|---|---|---|---|
| 0 — Discovery | Written answers to section 10; partner API docs and sandbox access; data owners named. | Answers + documents | Signed-off data-flow list per partner |
| 1 — Safe exports | Read-only CSV/JSON exports of agreed data from the ERP (role-restricted, audited). | Which datasets, which format | Partner can import a sample file successfully in TEST |
| 2 — Integration foundation (TEST) | `integration_outbox`, `external_id_map`, `integration_audit_log`, the Integration Service role and read-only integration API; a **mock partner** for tests. | Approval of this architecture | Automated tests pass, including GEEDSAN/NUWACO isolation |
| 3 — One partner pilot | One gateway (separate repo/deployment) for the partner you rank first, TEST-to-sandbox only. | Sandbox credentials delivered through the partner's secure channel | Reconciliation shows zero unexplained differences for an agreed period |
| 4 — Next partners | Repeat per partner, one at a time. | Same | Same |
| 5 — Production readiness | Security review, backup/restore drill, runbook, monitoring, rollback plan. | Production approval | Written go-live approval; production is never touched earlier |

## 10. Decisions and information requested

1. **Direction:** approve Option B (outbox + separate gateways) as the target, with Option A (file exchange) as the interim.
2. **Odoo:** what does Al-Naciim use it for (accounting, inventory, sales, purchasing)? Which version and hosting? Is there a test database and API access?
3. **WMS:** vendor/name, who administers it, API documentation, and which warehouses it owns stock for.
4. **NUWACO:** what is it to Al-Naciim (customer, project, partner, separate company)? Which data must be exchanged, in which direction, how often?
5. **GEEDSAN:** same questions, answered separately from NUWACO.
6. **System of record:** for each domain in section 5, which system is authoritative?
7. **Pilot choice:** which single integration is first, and what is the business benefit that justifies it?
8. **Owners:** a named business owner and a technical contact for each partner.
9. **Railway:** do you want a separate data-recovery plan opened, and who owns the export?
10. **Production:** confirm that production and Railway remain untouched until Phase 5 approval.

## 11. Risks

| Risk | Mitigation |
|---|---|
| Two systems both "own" the same stock or ledger | System-of-record decision per domain before any build (section 10, item 6). |
| Duplicate postings from retries | Idempotency keys; partner-side duplicate rejection; reconciliation. |
| Partner outage stalls the ERP | Outbox pattern; ERP never calls partners inline. |
| Cross-project data leakage (GEEDSAN/NUWACO) | Per-project gateways, credentials, scopes, DB guards and automated isolation tests. |
| Credential exposure | Environment-only secrets, rotation, never printed; no shared secrets between systems. |
| Scope creep | One partner and one flow at a time, each with an explicit approval and exit criteria. |

## 12. What will *not* happen without your explicit approval

- No code is written that calls Odoo, WMS, NUWACO, GEEDSAN or Railway.
- No credentials are requested, stored or entered anywhere.
- No migration, deployment or configuration change is made to production, Railway, Odoo, WMS, NUWACO or GEEDSAN.
- No two projects' data are combined.
