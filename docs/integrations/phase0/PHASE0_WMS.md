# Al-Naciim Water Company — Integration questionnaire: WMS (Phase 0)

**To:** the owner / administrator of the warehouse management system (WMS) · **From:** Al-Naciim Water Company — [contact name, e-mail, phone] · **Date:** [date] · **Please reply by:** [date]

> **Soo koobid:** Waxaan rabnaa inaan fahanno sida WMS-kaagu u maamulo bakhaarrada iyo stock-ga, si aan u go'aamino haddii ERP-ga Al-Naciim iyo WMS ay is-weydaarsan karaan xog si ammaan ah — gaar ahaan **yaa leh run-ka stock-ga** meel walba. **Midna ha ku qorin password, API key, token ama xog dhab ah.**

## 1. Why we are asking

Al-Naciim Water Company runs its own ERP (inventory, production, procurement, sales and finance). We are **only collecting information** to decide whether and how that ERP and your WMS could exchange data. **Nothing will be connected, changed or sent to your system because of this questionnaire.** Any later step needs your written approval, starts in a test environment with made-up data, and keeps both systems completely separate (no shared database, no shared passwords).

**Please do not send:** passwords, API keys, tokens, connection strings, real stock data or real customer data. If a step later needs credentials, you will issue them through your own secure channel.

## 2. About you and the system

1. Who is the **business owner** of the WMS (name, role, e-mail)? Who is the **technical contact** (administrator, vendor or integrator)?
2. **Which WMS** is it (product name and vendor), which **version**, and is it hosted by you, the vendor or a third party (and where)?
3. **Which warehouses, depots and stores** does it manage? For each: code, name, type (raw materials, finished goods, spare parts, depot, other) and whether it is a physical site we may deal with.
4. Which **items** does it hold (finished goods, raw materials, packaging, spare parts)? Are item codes (SKUs) shared with other systems or unique to the WMS?
5. Does it use **lots/batches, expiry dates, serial numbers, bins/locations or units of measure conversions**? Which are mandatory?
6. Is there a **test/staging** environment, separate from live?

## 3. What would the exchange be for?

7. In your words, what **business problem** would an exchange with the Al-Naciim ERP solve? What benefit do you expect, and for whom?
8. **The most important question — who owns the stock?** For each warehouse in question 3, which system is the **single source of truth** for stock quantities today: the WMS, the Al-Naciim ERP, or neither? (Two systems must never both be the master of the same stock.)
9. Which of these might be exchanged? Mark the **direction** (**A** = Al-Naciim → WMS, **W** = WMS → Al-Naciim, **B** = both, **N** = no).

| Data | Direction | Master system | How often? |
|---|---|---|---|
| Item master (codes, names, units) | | | |
| Expected receipts (purchase orders / advance notices) | | | |
| Goods received (accepted / damaged / rejected quantities) | | | |
| Stock issues / dispatches | | | |
| Stock transfers between warehouses | | | |
| Stock counts and adjustments | | | |
| Current stock levels (snapshot) | | | |
| Returns | | | |
| Other (describe) | | | |

10. For each ticked row: automatic exchange or a **file export/import by a person** (CSV/Excel) at first?
11. Which **events** does the WMS record that would matter to us (receipt posted, pick confirmed, adjustment approved)? Are corrections made by **reversal** or by editing?

## 4. Technical interface

12. Which interface exists: **REST/SOAP API, EDI, webhooks/events, database views (not preferred), scheduled file drop (SFTP/CSV), other**? Please do not offer direct database access.
13. Where is the **API/interface documentation**? Which formats (JSON, XML, CSV) and which character set?
14. **Authentication** allowed (API key, OAuth, client certificate)? Can a **dedicated integration account with limited permissions** be created?
15. Any **IP allow-listing**, VPN or firewall rules? Rate limits or batch-size limits?
16. How are **idempotency and duplicates** handled (can we send the same message twice safely)? Is there a unique reference per message?
17. How are **identifiers** mapped: do warehouses, items, suppliers and customers have stable codes we can match?
18. **Time zone, units and rounding** rules (e.g. litres vs. cubic metres, packs vs. units).

## 5. Volumes and operations

19. Approximate **volumes** per month for each flow (receipts, issues, transfers, items).
20. **Maintenance windows**, planned upgrades and how API changes are announced.
21. Who supports the integration on your side, and what are their working hours/response times?
22. How should **errors and mismatches** be handled (who is alerted, retry rules, manual review)? How are stock **differences** between systems reconciled today?

## 6. Security, privacy and approval

23. Which **data-protection, contractual or audit constraints** apply? May data be stored in another country?
24. Is **written approval** (IT security, operations, management) required before an exchange starts? Who signs it?
25. Who must be involved in **testing** and in any later **go-live** decision?

## 7. Test plan

26. How can we test **without touching real stock** (test warehouse, sample items)? May we receive **made-up sample messages** (one receipt, one issue, one adjustment)?
27. What would **success** look like for a first pilot with one flow? Which flow first, and why?

## 8. Timeline and contacts

28. Earliest realistic start for a test, and dates to avoid (stock-takes, audits, upgrades).
29. Who may we contact for follow-up, and how?

---
**Reply format:** answer in a separate document or by replying to this file, numbering your answers like the questions. If a question does not apply, write "not applicable"; if you do not know, write "unknown — will find out by [date]". **Please do not include any secrets or real stock/personal data.**

Thank you. — Al-Naciim Water Company
