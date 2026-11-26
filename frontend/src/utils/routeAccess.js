import { REPORT_ROLES } from './permissions';

// Single source of truth for which roles may open each page. The sidebar (Layout) and the route guard (RoleRoute) both read it,
// so a page can never be hidden from the menu yet still reachable by typing its URL. The API enforces the same rules server-side;
// this only stops a role without access from seeing an empty page shell. `null` = every signed-in role.
export const ROUTE_ROLES = {
  '/': null,
  '/operations': ['Admin', 'Operation Manager'],
  '/logistics': ['Admin', 'Operation Manager', 'Route Supervisor', 'Supervisor', 'Sales Manager', 'Data Entry Operator', 'Driver'],
  '/tanker-loading': ['Admin', 'Storekeeper', 'Data Entry Operator'],
  '/collections': ['Collector'],
  '/inventory': ['Admin', 'Inventory Manager', 'Storekeeper'],
  '/production': ['Admin', 'Production Manager', 'Technician'],
  '/sales': ['Admin', 'Sales Manager', 'Cashier'],
  '/requisitions': null,
  '/procurement': ['Admin', 'Procurement Officer', 'Storekeeper', 'Inventory Manager', 'Operation Manager', 'Finance Officer'],
  '/maintenance': ['Admin', 'Production Manager', 'Technician'],
  '/finance': ['Admin', 'Finance Officer'],
  '/reports': REPORT_ROLES,
  '/settings': ['Admin'],
  '/driver': ['Admin', 'Driver']
};

export function canAccess(role, path) {
  const roles = ROUTE_ROLES[path];
  return !roles || roles.includes(role);
}
