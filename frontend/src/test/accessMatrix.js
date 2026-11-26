// The access policy written out by hand, independently of the table in utils/routeAccess.js.
// If someone widens or narrows a role in the table, the tests fail and the change has to be made on purpose in both places.
export const ROUTES = ['/operations', '/logistics', '/tanker-loading', '/collections', '/inventory', '/production', '/sales', '/requisitions', '/procurement', '/maintenance', '/finance', '/reports', '/settings', '/driver'];

export const EXPECTED = {
  'Admin': ['/operations', '/logistics', '/tanker-loading', '/inventory', '/production', '/sales', '/requisitions', '/procurement', '/maintenance', '/finance', '/reports', '/settings', '/driver'],
  'Operation Manager': ['/operations', '/logistics', '/requisitions', '/procurement', '/reports'],
  'Finance Officer': ['/requisitions', '/procurement', '/finance', '/reports'],
  'Cashier': ['/sales', '/requisitions'],
  'Collector': ['/collections', '/requisitions'],
  'Storekeeper': ['/tanker-loading', '/inventory', '/requisitions', '/procurement'],
  'Inventory Manager': ['/inventory', '/requisitions', '/procurement', '/reports'],
  'Production Manager': ['/production', '/requisitions', '/maintenance', '/reports'],
  'Technician': ['/production', '/requisitions', '/maintenance'],
  'Procurement Officer': ['/requisitions', '/procurement'],
  'Data Entry Operator': ['/logistics', '/tanker-loading', '/requisitions'],
  'Route Supervisor': ['/logistics', '/requisitions'],
  'Supervisor': ['/logistics', '/requisitions'],
  'Sales Manager': ['/logistics', '/sales', '/requisitions', '/reports'],
  'Driver': ['/logistics', '/requisitions', '/driver'],
  'Department Head': ['/requisitions']
};
