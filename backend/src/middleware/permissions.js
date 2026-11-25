// Central read-access groups. Writes are gated per route with requireRole(...); these groups gate the READ side
// (reports, finance, procurement, ...) so an employee only reaches data that belongs to their job.
// The ERP front-end mirrors these in frontend/src/utils/permissions.js — keep the two in sync.
const PERM = {
  // Accounting records, financial statements, bank/cash.
  FINANCE: ['Admin', 'Finance Officer'],
  // Sales & receivables figures, and the journal entries behind an order.
  SALES_FIN: ['Admin', 'Finance Officer', 'Sales Manager'],
  // Stock quantities/values and movement history.
  INVENTORY_VIEW: ['Admin', 'Inventory Manager', 'Storekeeper', 'Production Manager', 'Sales Manager', 'Finance Officer', 'Operation Manager'],
  // Warehouse names, locations, and managers are operational master data.
  WAREHOUSE_VIEW: ['Admin', 'Inventory Manager', 'Storekeeper', 'Production Manager', 'Sales Manager', 'Finance Officer', 'Operation Manager', 'Procurement Officer', 'Technician'],
  // Legacy tank capacity/location and refill history are limited to fleet/sales managers.
  TANK_VIEW: ['Admin', 'Sales Manager', 'Route Supervisor', 'Supervisor', 'Finance Officer'],
  PRODUCT_PRICE_VIEW: ['Admin', 'Sales Manager', 'Finance Officer', 'Inventory Manager'],
  PRODUCT_COST_VIEW: ['Admin', 'Finance Officer', 'Inventory Manager', 'Production Manager', 'Procurement Officer', 'Operation Manager'],
  // Plant/production data.
  PRODUCTION_VIEW: ['Admin', 'Production Manager', 'Technician', 'Inventory Manager', 'Sales Manager', 'Finance Officer', 'Operation Manager'],
  // Machine/production cost and profitability.
  PRODUCTION_COST: ['Admin', 'Production Manager', 'Finance Officer'],
  MAINTENANCE_VIEW: ['Admin', 'Production Manager', 'Technician'],
  // Purchase orders, suppliers, supplier payments.
  PROCUREMENT_VIEW: ['Admin', 'Procurement Officer', 'Storekeeper', 'Finance Officer', 'Inventory Manager', 'Operation Manager'],
  // Driver / collector / fleet performance and fleet costs.
  FIELD_PERF: ['Admin', 'Sales Manager', 'Route Supervisor', 'Supervisor', 'Finance Officer'],
  // Collections: receivables, customer balances, payments list, follow-ups.
  BILLING_VIEW: ['Admin', 'Finance Officer', 'Collector', 'Sales Manager', 'Route Supervisor', 'Supervisor'],
  // Retail point-of-sale data (sales list, products, customer statement) and its reports.
  RETAIL_OPS: ['Admin', 'Sales Manager', 'Cashier', 'Finance Officer'],
  RETAIL_REPORT: ['Admin', 'Sales Manager', 'Finance Officer']
};

const canSee = (role, group) => Array.isArray(PERM[group]) && PERM[group].includes(role);

module.exports = { PERM, canSee };
