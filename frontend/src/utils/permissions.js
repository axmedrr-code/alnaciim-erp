// Mirrors backend/src/middleware/permissions.js (the backend is the source of truth and enforces these;
// the front-end only uses them to avoid showing widgets/menus a role cannot open). Keep the two in sync.
export const PERM = {
  FINANCE: ['Admin', 'Finance Officer'],
  SALES_FIN: ['Admin', 'Finance Officer', 'Sales Manager'],
  INVENTORY_VIEW: ['Admin', 'Inventory Manager', 'Storekeeper', 'Production Manager', 'Sales Manager', 'Finance Officer'],
  PRODUCTION_VIEW: ['Admin', 'Production Manager', 'Technician', 'Inventory Manager', 'Sales Manager', 'Finance Officer'],
  PRODUCTION_COST: ['Admin', 'Production Manager', 'Finance Officer'],
  MAINTENANCE_VIEW: ['Admin', 'Production Manager', 'Technician'],
  PROCUREMENT_VIEW: ['Admin', 'Procurement Officer', 'Storekeeper', 'Finance Officer', 'Inventory Manager'],
  FIELD_PERF: ['Admin', 'Sales Manager', 'Route Supervisor', 'Supervisor', 'Finance Officer'],
  BILLING_VIEW: ['Admin', 'Finance Officer', 'Collector', 'Sales Manager', 'Cashier', 'Route Supervisor', 'Supervisor'],
  RETAIL_OPS: ['Admin', 'Sales Manager', 'Cashier', 'Finance Officer'],
  RETAIL_REPORT: ['Admin', 'Sales Manager', 'Finance Officer']
};

export const canSee = (role, group) => (PERM[group] || []).includes(role);

// Roles that have at least one report or executive-dashboard widget.
export const REPORT_ROLES = Array.from(new Set([
  ...PERM.FINANCE, ...PERM.SALES_FIN, ...PERM.INVENTORY_VIEW, ...PERM.PRODUCTION_VIEW
])).filter((r) => r !== 'Technician' && r !== 'Storekeeper');
