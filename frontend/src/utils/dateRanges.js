// Pure date-math for the global DateFilterBar — every quick filter, rolling period,
// and accounting period resolves to a plain { from, to } pair of 'YYYY-MM-DD' strings,
// which is exactly what every existing report endpoint already accepts. No backend
// change needed: this is just centralizing date arithmetic that used to be absent
// (most report tabs had no date picker at all) or duplicated ad hoc.

function pad(n) { return String(n).padStart(2, '0'); }
function toISO(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function addDays(d, n) { const copy = new Date(d); copy.setDate(copy.getDate() + n); return copy; }
function startOfWeek(d) { const copy = new Date(d); const day = copy.getDay(); const diff = (day === 0 ? -6 : 1) - day; return addDays(copy, diff); } // Monday start
function startOfMonth(d) { return new Date(d.getFullYear(), d.getMonth(), 1); }
function endOfMonth(d) { return new Date(d.getFullYear(), d.getMonth() + 1, 0); }
function startOfQuarter(d) { const q = Math.floor(d.getMonth() / 3); return new Date(d.getFullYear(), q * 3, 1); }
function endOfQuarter(d) { const q = Math.floor(d.getMonth() / 3); return new Date(d.getFullYear(), q * 3 + 3, 0); }
function startOfYear(d) { return new Date(d.getFullYear(), 0, 1); }
function endOfYear(d) { return new Date(d.getFullYear(), 11, 31); }

function range(from, to, label) { return { from: toISO(from), to: toISO(to), label }; }

// ---- Quick Filters ----
export function quickFilters() {
  const now = new Date();
  const yesterday = addDays(now, -1);
  const thisWeekStart = startOfWeek(now);
  const lastWeekStart = addDays(thisWeekStart, -7);
  const lastWeekEnd = addDays(thisWeekStart, -1);
  const thisMonthStart = startOfMonth(now);
  const lastMonthEnd = addDays(thisMonthStart, -1);
  const lastMonthStart = startOfMonth(lastMonthEnd);
  const thisQuarterStart = startOfQuarter(now);
  const lastQuarterEnd = addDays(thisQuarterStart, -1);
  const lastQuarterStart = startOfQuarter(lastQuarterEnd);
  const thisYearStart = startOfYear(now);
  const lastYearEnd = addDays(thisYearStart, -1);
  const lastYearStart = startOfYear(lastYearEnd);

  return [
    { key: 'today', label: 'Today', ...range(now, now, 'Today') },
    { key: 'yesterday', label: 'Yesterday', ...range(yesterday, yesterday, 'Yesterday') },
    { key: 'this_week', label: 'This Week', ...range(thisWeekStart, now, 'This Week') },
    { key: 'last_week', label: 'Last Week', ...range(lastWeekStart, lastWeekEnd, 'Last Week') },
    { key: 'this_month', label: 'This Month', ...range(thisMonthStart, now, 'This Month') },
    { key: 'last_month', label: 'Last Month', ...range(lastMonthStart, lastMonthEnd, 'Last Month') },
    { key: 'this_quarter', label: 'This Quarter', ...range(thisQuarterStart, now, 'This Quarter') },
    { key: 'last_quarter', label: 'Last Quarter', ...range(lastQuarterStart, lastQuarterEnd, 'Last Quarter') },
    { key: 'this_year', label: 'This Year', ...range(thisYearStart, now, 'This Year') },
    { key: 'last_year', label: 'Last Year', ...range(lastYearStart, lastYearEnd, 'Last Year') }
  ];
}

// ---- Rolling Periods ----
export function rollingPeriods() {
  const now = new Date();
  return [7, 30, 90, 180, 365].map((days) => ({
    key: `last_${days}`, label: `Last ${days} Days`, days, ...range(addDays(now, -(days - 1)), now, `Last ${days} Days`)
  }));
}

// ---- Accounting Periods ----
// Uses the real fiscal_years the Finance module already manages when available
// (fiscalYears = rows from GET /finance/fiscal-years), falling back to plain
// calendar-year math for modules that haven't fetched it (e.g. Inventory).
export function accountingPeriods(fiscalYears) {
  const now = new Date();
  const sorted = (fiscalYears || []).slice().sort((a, b) => new Date(b.start_date) - new Date(a.start_date));
  const current = sorted[0];
  const previous = sorted[1];

  const thisQuarterStart = startOfQuarter(now);
  const thisQuarterEnd = endOfQuarter(now);
  const prevQuarterEnd = addDays(thisQuarterStart, -1);
  const prevQuarterStart = startOfQuarter(prevQuarterEnd);

  const items = [];
  if (current) {
    items.push({ key: 'fy_current', label: 'Current Fiscal Year', from: current.start_date, to: current.end_date, sub: current.name });
  } else {
    items.push({ key: 'fy_current', label: 'Current Fiscal Year', ...range(startOfYear(now), endOfYear(now), 'Current Fiscal Year') });
  }
  if (previous) {
    items.push({ key: 'fy_previous', label: 'Previous Fiscal Year', from: previous.start_date, to: previous.end_date, sub: previous.name });
  } else {
    const lastYearStart = new Date(now.getFullYear() - 1, 0, 1);
    const lastYearEnd = new Date(now.getFullYear() - 1, 11, 31);
    items.push({ key: 'fy_previous', label: 'Previous Fiscal Year', ...range(lastYearStart, lastYearEnd, 'Previous Fiscal Year') });
  }
  items.push({ key: 'q_current', label: 'Current Quarter', ...range(thisQuarterStart, thisQuarterEnd, 'Current Quarter') });
  items.push({ key: 'q_previous', label: 'Previous Quarter', ...range(prevQuarterStart, prevQuarterEnd, 'Previous Quarter') });
  return items;
}

// ---- Comparison ----
// "Previous Period" shifts the whole [from,to] window back by its own length
// (immediately preceding, no gap). "Same Period Last Year" shifts back exactly
// one year on the same calendar dates.
export function comparisonRange(from, to, mode) {
  const fromD = new Date(from);
  const toD = new Date(to);
  const lengthDays = Math.round((toD - fromD) / 86400000) + 1;

  if (mode === 'previous_period') {
    const compareTo = addDays(fromD, -1);
    const compareFrom = addDays(compareTo, -(lengthDays - 1));
    return { from: toISO(compareFrom), to: toISO(compareTo) };
  }
  if (mode === 'same_period_last_year') {
    const compareFrom = new Date(fromD.getFullYear() - 1, fromD.getMonth(), fromD.getDate());
    const compareTo = new Date(toD.getFullYear() - 1, toD.getMonth(), toD.getDate());
    return { from: toISO(compareFrom), to: toISO(compareTo) };
  }
  return null;
}

export function daysBetween(from, to) {
  return Math.max(1, Math.round((new Date(to) - new Date(from)) / 86400000) + 1);
}

export function todayISO() { return toISO(new Date()); }
