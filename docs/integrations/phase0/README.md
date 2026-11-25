# Integration Phase 0 — questionnaires (internal cover note)

**This README is internal. Do not send it to any partner.** It explains how to use the five questionnaires in this folder.

> **Soo koobid (Somali):** Halkan waxaa ku jira **su'aalo gooni ah** oo loo diro masuulka nidaam walba: **Odoo, WMS, NUWACO, GEEDSAN**, iyo mid ku saabsan **xogta Railway**. Warqad walba waxaa loo diraa **qofka leh nidaamkaas oo keliya**. **Marna ha isku darin** — warqadaha midkoodna ma sheegayaan nidaamyada kale. Jawaabaha waxaa lagu keydiyaa faylal gooni ah, oo midkoodna kuma qasna kan kale.

## Why this exists

`docs/INTEGRATION_ARCHITECTURE_PROPOSAL.md` (merged) is design-only: no partner API, contract, credential or sandbox exists in this repository. **Nothing can be built until each system's owner answers these questions.** Each answer set decides, for that system alone: the purpose, the data flows and directions, the system of record, the API and authentication, the sandbox, and who approves what.

## The rules (non-negotiable)

1. **One questionnaire per owner, sent separately.** Each file is written so that it never names another Al-Naciim system or project. Do not forward, merge or compare them with partners.
2. **GEEDSAN and NUWACO are never combined** — different owners, different sheets, different answer files, different later gateways.
3. **No secrets in answers.** Nobody should e-mail or paste passwords, API keys, tokens or connection strings. Credentials, if and when needed, are issued later through the owner's own secure channel directly into the component that uses them — never into this repository, chat or e-mail.
4. **No real personal or financial data** is requested or accepted at this stage. Sample payloads must use made-up values.
5. Nothing is connected, configured or deployed because of an answer. Answers only feed the next approval step.

## Files

| File | Send to | Notes |
|---|---|---|
| `PHASE0_ODOO.md` | the owner/administrator of the Odoo system | accounting/inventory/sales system questions |
| `PHASE0_WMS.md` | the owner/administrator of the WMS | warehouse stock-of-record questions |
| `PHASE0_NUWACO.md` | the NUWACO project owner | starts by asking what the project is |
| `PHASE0_GEEDSAN.md` | the GEEDSAN project owner | same template, completely separate |
| `PHASE0_RAILWAY_DATA_RECOVERY.md` | the person who owns the Railway account/data | data **recovery**, not an integration |

## How to run Phase 0

1. Fill in the **Al-Naciim contact** placeholders at the top of each file (name, e-mail, phone) and send each file to its owner on its own. Ask for answers within an agreed date (suggest 10 working days).
2. Receive the answers in a **separate file per system**, named `ANSWERS_<SYSTEM>_<date>.md` (kept outside any shared channel; no secrets in it).
3. Check each answer set with the **intake checklist** below. Ask follow-ups to that owner only.
4. When a system's set is complete, write its **decision record** (below) and bring it for approval. Only then does Phase 1 (safe file exports) or Phase 2 (outbox foundation with a mock partner) start for that system.

## Intake checklist (per system, copy for each)

- [ ] A named business owner **and** a named technical contact were given.
- [ ] The purpose is stated in the owner's words, with the business benefit.
- [ ] Every data flow has a direction (into / out of the Al-Naciim ERP), a frequency and a **system of record**.
- [ ] API documentation (or a statement that none exists) and the authentication method are given.
- [ ] A sandbox/test environment exists, or the owner explains how testing can be done without touching live data.
- [ ] Data protection and legal limits are stated (which fields must not leave, retention, where data may be stored).
- [ ] The owner approved in writing that this exchange may start in TEST with synthetic data.
- [ ] No credentials, personal data or real transactions were included in the answers.

## Decision record (one per system, after the answers are complete)

| Item | Decision |
|---|---|
| System | |
| Owner / technical contact | |
| Purpose and benefit | |
| Flows approved for Phase 1 (file exchange) | |
| Flows approved for Phase 3 pilot (API) | |
| System of record per domain | |
| Authentication and secret handling | |
| Sandbox and test data | |
| Risks and open questions | |
| Approved by (name, date) | |

## Tracking

| System | Sent to (name) | Sent on | Due | Answers received | Complete? | Decision record |
|---|---|---|---|---|---|---|
| Odoo | | | | | | |
| WMS | | | | | | |
| NUWACO | | | | | | |
| GEEDSAN | | | | | | |
| Railway data recovery | | | | | | |
