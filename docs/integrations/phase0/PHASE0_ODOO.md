# Al-Naciim Water Company — Integration questionnaire: Odoo (Phase 0)

**To:** the owner / administrator of the Odoo system · **From:** Al-Naciim Water Company — [contact name, e-mail, phone] · **Date:** [date] · **Please reply by:** [date]

> **Soo koobid:** Waxaan rabnaa inaan fahanno sida Odoo uu u shaqeeyo iyo xogta uu leeyahay, si aan u go'aamino haddii ERP-ga Al-Naciim iyo Odoo ay is-weydaarsan karaan xog si ammaan ah. **Midna ha ku qorin password, API key, token ama xog macmiil dhab ah.** Su'aalahan waxay kaa mid yihiin kuwa kaliya aad leedahay.

## 1. Why we are asking

Al-Naciim Water Company runs its own ERP (inventory, production, procurement, sales and finance). We are **only collecting information** to decide whether and how that ERP and your Odoo system could exchange data. **Nothing will be connected, changed or sent to your system because of this questionnaire.** Any later step needs your written approval, starts in a test environment with made-up data, and keeps both systems completely separate (no shared database, no shared passwords).

**Please do not send:** passwords, API keys, tokens, connection strings, real customer/employee data or real financial figures. If a step later needs credentials, you will issue them through your own secure channel.

## 2. About you and the system

1. Who is the **business owner** of the Odoo system (name, role, e-mail)? Who is the **technical contact** (administrator or partner/integrator)?
2. In your own words: **what is Odoo used for** at your organisation (accounting, inventory, sales, purchasing, manufacturing, CRM, HR, other)? Which departments use it?
3. Who hosts it: Odoo Online, Odoo.sh, your own server, or a partner? In which country/region is the data stored?
4. **Version and edition** (e.g. 16 / 17 / 18; Community or Enterprise)? Which modules are installed? Any custom modules?
5. Is it a **single company or multi-company** set-up? Which company/companies would be involved?
6. Is there a **test/staging database** we may use (separate from live)? How is it refreshed?

## 3. What would the exchange be for?

7. In your words, what **business problem** would an exchange with the Al-Naciim ERP solve? What benefit would you expect, and for whom?
8. Which of these might be exchanged? Tick any that apply and mark the **direction** (**A** = Al-Naciim → Odoo, **O** = Odoo → Al-Naciim, **B** = both, **N** = no).

| Data | Direction | Which system should be the **master** (source of truth)? | How often? |
|---|---|---|---|
| Product / item catalogue (codes, names, units) | | | |
| Customers | | | |
| Suppliers | | | |
| Purchase orders / goods receipts | | | |
| Sales invoices and receipts | | | |
| Stock levels / stock movements | | | |
| Accounting journal entries (summary or line by line) | | | |
| Chart of accounts / cost centres / projects | | | |
| Payments (customer or supplier) | | | |
| Other (describe) | | | |

9. For each ticked row: should the data move **automatically**, or is a **file export/import by a person** (CSV/Excel) acceptable at first?
10. Are there data you **must not** receive or must not send (confidential prices, personal data, other companies' data)?

## 4. Technical interface

11. Which interface would your administrator allow: **JSON-RPC / XML-RPC / the newer JSON-2 API, REST via a module, webhooks/automated actions, scheduled file exchange, other**?
12. Where is the **API documentation** (link or file) for your version? Are there custom endpoints or fields we must know about?
13. **Authentication:** what is allowed (API key per user, OAuth, dedicated integration user)? Would a **dedicated integration user with limited permissions** be possible? Is multi-factor authentication enforced for such users?
14. Any **IP allow-listing**, VPN or firewall rules? Rate limits or volume limits per hour/day?
15. How are **records identified** across systems? Do products, partners (customers/suppliers), taxes, units, warehouses and accounts have **stable external codes** we could map to?
16. **Currencies, taxes and fiscal calendar:** which currency/currencies, tax rules and fiscal year does the exchange need to respect? Are periods ever locked or closed in a way that would reject postings?
17. **Accounting rules:** if journal entries or invoices were exchanged, who defines the accounts and mapping? Are there approval workflows in Odoo that an incoming record would have to pass?

## 5. Volumes and operations

18. Approximate **volumes** per month for each flow you ticked (invoices, receipts, stock moves, products, partners).
19. Your **maintenance windows**, upgrade plans for the next 12 months, and how you are notified of API changes.
20. Who supports the integration on your side (internal team or partner), and what are their **working hours and response times**?
21. How do you want **errors handled** (alert to whom, retry rules, manual review queue)?

## 6. Security, privacy and approval

22. Which **data-protection or legal constraints** apply (local law, contracts, audit rules)? May data be copied to a system hosted in another country?
23. Is a **written approval** (e.g. from IT security, finance or management) required before an exchange starts? Who signs it?
24. Who must be informed or involved for **testing** and for any later **go-live** decision?

## 7. Test plan

25. How can we test **without touching live data** (test database, sample company)? May we receive **made-up sample records** (a few products, one customer, one invoice) to understand your formats?
26. What would **success** look like for a first pilot (one flow only)? Which flow would you choose first, and why?

## 8. Timeline and contacts

27. Earliest realistic start for a test, and any dates we must avoid (year-end, audits, upgrades).
28. Who may we contact for follow-up questions, and what is the best way and time?

---
**Reply format:** answer in a separate document or by replying to this file, numbering your answers like the questions. If a question does not apply, write "not applicable". If you do not know, write "unknown — will find out by [date]". **Please do not include any secrets or real personal/financial data.**

Thank you. — Al-Naciim Water Company
