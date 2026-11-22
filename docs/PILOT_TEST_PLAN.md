# Al-Naciim ERP — Employee Pilot Test Plan (TEST environment)

**Purpose:** let selected employees use the ERP/POS on fictional TEST data, so operational problems are found before production.

| | |
|---|---|
| ERP (office users) | https://alnaciim-erp-test.vercel.app |
| POS / Route Operations | https://alnaciim-pos-test.vercel.app |
| API | https://alnaciim-erp-test-api.onrender.com |
| Data | **TEST database only** — fictional customers, no real money, no real customers |

> The first request after a quiet period can take up to ~50 seconds (free hosting wakes up). Wait once, then it is fast.

## Ground rules for testers
1. Use **only your own pilot account**. Never share passwords; never reuse a real password.
2. Enter **fictional or clearly labelled data**. Put `PILOT TEST` in notes. Do **not** record real customer payments or real sales.
3. If something is blocked ("Requires one of roles…"), that may be correct for your role — note it, don't work around it.
4. Report every problem with: **who / what you did / what you expected / what happened / screenshot / time**.
5. Passwords: ask the administrator for yours. Accounts start **locked**; a password is issued when your testing starts and can be reissued at any time.

## Pilot accounts (one per person; e-mail = `pilot.<name>@alnaciim.test`)
| Group | Account | Role | Notes |
|---|---|---|---|
| Cashiers | `pilot.cashier1`, `pilot.cashier2` | Cashier | Retail sales (bottled water, ice) |
| Sales staff | `pilot.sales1`, `pilot.sales2` | Sales Manager* | Customers, sales orders, retail sales |
| Warehouse | `pilot.store1` (WH-FG-01), `pilot.store2` (WH-DEP-01) | Storekeeper | Stock, transfers, tanker loading |
| Warehouse manager | `pilot.invmgr` | Inventory Manager | Stock receipts, adjustments |
| Accountants | `pilot.acct1`, `pilot.acct2` | Finance Officer | Payments, ledger, reports |
| Collector | `pilot.collector1` | Collector | Field collections only |
| Dispatchers | `pilot.dispatch1` (Route Supervisor), `pilot.dispatch2` (Supervisor) | | Tanker dispatch, routes |
| Driver | `pilot.driver1` | Driver | Tanker dispatch only |
| Managers | `pilot.salesmgr`, `pilot.prodmgr` | Sales Manager, Production Manager | Dashboards, reports |
| Data entry | `pilot.dataentry` | Data Entry Operator | Reconciliation |

\* There is no separate "Sales Rep" role yet; sales staff use the Sales Manager role (see report, finding M3).

## Scenarios

### A. Cashiers
| # | Steps | Expected |
|---|---|---|
| A1 | Sales Screen → customer **Al-Amal Retail Shop**, Ice, qty 2, **Cash** → Save | Sale saved, invoice number `HNO-INV-…`, paid, stock of Ice down by 2 |
| A2 | Bottled Water, qty 3, **Credit** for **Towfiiq Wholesale Traders** | Invoice created; the customer balance rises by the total |
| A3 | Try to sell more than is in stock | Refused: "Insufficient stock"; nothing saved |
| A4 | Open **Sales List**, search `PILOT` | Your invoices appear |
| A5 | Try to open Finance, Users, Backups, or Receive Payment | Blocked / not available |

### B. Sales staff
| # | Steps | Expected |
|---|---|---|
| B1 | Register a customer (code `PILOT-xxx`, name "PILOT TEST …") | Customer saved |
| B2 | Create a **credit sales order** (5 × Bottled Water) and approve it | Order created; approval respects the credit limit |
| B3 | Ring up a retail cash sale | Invoice issued, stock down |
| B4 | Open a **customer statement** | Invoices, payments and balance match |
| B5 | Try to record a payment or change stock | Blocked |

### C. Warehouse staff
| # | Steps | Expected |
|---|---|---|
| C1 | View stock levels | All warehouses listed |
| C2 | Transfer 5 boxes Bottled Water **WH-FG-01 → WH-DEP-01** | Source −5, destination +5 |
| C3 | (Inventory Manager) receive 20 boxes (stock IN) | Stock +20 |
| C4 | Try to remove more than is on hand | Refused |
| C5 | (Storekeeper) load 500 L of Bulk Water onto a tanker from **WH-RO-01** | Truck load opened, WH-RO-01 −500 |
| C6 | Try to record a sale or a payment | Blocked |

### D. Accountants and collector
| # | Steps | Expected |
|---|---|---|
| D1 | Receive payment of 6.00 (cash) for **Towfiiq Wholesale Traders** | Payment saved, `HNO-TXN-…`, balance −6.00 |
| D2 | (Collector) record a 4.00 field collection | Balance −4.00 |
| D3 | Open **Receivables**, **Aging**, and the customer's balance | Numbers agree with D1/D2 |
| D4 | Reports → **Trial Balance** | Debit = Credit |
| D5 | Enter a zero/negative payment | Rejected |
| D6 | Try to sell, move stock, or create a customer | Blocked |

### E. Dispatchers and driver (tanker)
| # | Steps | Expected |
|---|---|---|
| E1 | Route Operations → dispatch the loaded tanker to **Golis Distribution Co.**, 200 L, cash received 4.00 | Route completed, invoice created, balance +(total − 4.00) |
| E2 | Try to dispatch more litres than are on the truck | Refused: "Only … L remaining" |
| E3 | See the routes list and truck status | Visible |
| E4 | (Driver) open the dispatch screen | Allowed; cannot access payments, retail sales, inventory |

### F. Managers
| # | Steps | Expected |
|---|---|---|
| F1 | Sales Manager: retail dashboard and collections dashboard | Loads, figures agree with the day's invoices |
| F2 | Inventory Manager: stock and low-stock alerts | Loads |
| F3 | Production Manager: production batches / capacity calendar | Loads |
| F4 | Try a function that belongs to another department | Blocked |

## End-of-day check (administrator)
- Trial balance balanced; no negative stock (except Bulk Water tanker, see report H2).
- Every invoice has a stock movement and a ledger entry.
- Issues log reviewed and triaged.

## How passwords are issued (TEST only)
The administrator asks for a pilot account's password to be issued; it is placed on the clipboard and handed over privately. It is never written to files, chat or logs. Re-issuing replaces the old one.
