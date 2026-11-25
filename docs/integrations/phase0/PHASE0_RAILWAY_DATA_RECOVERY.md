# Al-Naciim Water Company — Questionnaire: recovery of data held on Railway (Phase 0)

**To:** the person who owns or administers the Railway account / project that held Al-Naciim's earlier database · **From:** Al-Naciim Water Company — [contact name, e-mail, phone] · **Date:** [date] · **Please reply by:** [date]

> **Soo koobid:** Kani ma aha isku-xirid nidaamyo. Waa **dib-u-soo-kabasho xog** oo ku jirtay Railway (nidaamkii hore ee Al-Naciim). Waxaan rabnaa inaan ogaano **waxa weli jira**, **yaa leh**, iyo sida ammaan ah loo soo saari karo **koobi** (export). **Midna ha ku qorin password, API key, token ama connection string.** Wax live ah lama taabanayo.

## 1. Why we are asking

Al-Naciim Water Company's earlier system stored its data in a database on Railway. That data has **not been recovered** into the current test system. Before anyone touches it we need to know **what exists**, **who owns it**, and **how a safe copy could be taken** without changing or deleting anything. **Nothing will be connected, restored, deleted or changed because of this questionnaire.** No live system will be linked to Railway.

**Please do not send:** passwords, API keys, tokens, connection strings or any real customer/financial data. If a copy is later produced, it will be handed over through a secure channel agreed in advance, not by e-mail or chat.

## 2. Ownership and access

1. Who **owns** the Railway account and the project(s) (name, role, e-mail)? Who **administers** it day to day? Is the billing owner the same person?
2. Which **Railway project(s) and service(s)** held the earlier Al-Naciim database (names and what each was for)? Is the database service still **present**, **stopped**, or **deleted**?
3. Is the account on a **paid or free plan**, and is it **active**, **suspended** or **closed** (and since when)? Is there any outstanding balance?
4. Who can currently **sign in** to the dashboard? Is **two-factor authentication** enabled, and who holds the recovery method?
5. Who is the **data owner** at Al-Naciim who can authorise a copy of this data to be taken and used (name, role)?

## 3. What exists

6. Which **database** was it (PostgreSQL, other; version if known) and roughly **how large**?
7. Does the project have **automatic backups, snapshots or volume backups**, and from which dates? Is any **manual dump/export** already stored somewhere (who has it, when was it made)?
8. Approximately **when was data last written** to it, and was the earlier system still in use after that?
9. Which **kinds of records** were held (customers, drums/HNO numbers, invoices, payments, stock, route data, users)? Which of them **matter most** to recover?
10. Were there **file attachments or images** stored outside the database (volumes, object storage)?
11. Has anything been **deleted or changed** since the incident that interrupted access? If so, what and when?

## 4. Recovery options

12. Does Railway **Support** need to be involved (e.g. a deleted or suspended service)? Has a **support request** already been sent, to whom and when, and with what reply?
13. Can the owner produce a **read-only copy** with the database tools of their own choice (for example a standard PostgreSQL dump) **without writing to the original**? If not, what is blocking it?
14. Who should **perform** the export, and where will the copy be **stored temporarily** (encrypted location owned by Al-Naciim)? Who may access it?
15. Are there any **deadlines** (account deletion dates, plan expiry, billing cut-offs) that make this urgent?

## 5. Privacy, legal and approval

16. Does the data contain **personal or financial information** that is subject to legal or contractual limits (privacy law, customer agreements, tax record retention)? Which fields?
17. How long must the original data be **kept**, and may a copy be loaded into a **test system** for rehearsal (with personal fields masked if required)?
18. Who must **approve in writing** before a copy is taken, and before it is used for anything?

## 6. How the copy will be verified (for your information)

If a copy is produced, we plan to: (a) load it **only into a separate rehearsal database** (never into live systems); (b) compare **row counts and money totals** against any reports you still hold (customer balances, sales totals); (c) map it to the current system's structure and have the data owner sign off; (d) only then ask for approval for any further step. Please tell us which **reports or totals** from the old system still exist that we can use for this comparison (balance of debtors, monthly sales, drum/HNO counts…).

## 7. Timeline and contacts

19. Earliest realistic date for the export, and dates to avoid.
20. Who may we contact for follow-up questions, and how?

---
**Reply format:** answer in a separate document or by replying to this file, numbering your answers like the questions. If you do not know, write "unknown — will find out by [date]". **Please do not include any secrets or real personal/financial data.**

Thank you. — Al-Naciim Water Company
