import {
  LayoutDashboard, Droplets, Package, Snowflake, Truck, Users,
  ClipboardList, Send, BarChart3, Building2, Receipt
} from 'lucide-react';
import GroupedTabs from '../../components/GroupedTabs';
import OverviewDashboardTab from './OverviewDashboardTab';
import RoWaterTab from './RoWaterTab';
import BottledWaterTab from './BottledWaterTab';
import IceTab from './IceTab';
import TankersTab from './TankersTab';
import CustomersTab from './CustomersTab';
import OrdersTab from './OrdersTab';
import DeliveriesTab from './DeliveriesTab';
import SalesReportsTab from './SalesReportsTab';
import RetailSalesTab from './RetailSalesTab';

// Each business line gets its own fully separate section — own KPIs, own charts, own
// tables — instead of one dashboard that blends bulk water, bottled water, and ice
// together. Every group below has exactly one item, so GroupedTabs renders a single
// row of section pills with no redundant sub-tab row underneath.
const GROUPS = [
  { key: 'overview', label: 'Overview Dashboard', icon: LayoutDashboard, items: [{ key: 'overview', label: 'Overview Dashboard', Component: OverviewDashboardTab }] },
  { key: 'ro-water', label: 'RO Water (Bulk)', icon: Droplets, items: [{ key: 'ro-water', label: 'RO Water (Bulk)', Component: RoWaterTab }] },
  { key: 'bottled', label: 'Bottled Water', icon: Package, items: [{ key: 'bottled', label: 'Bottled Water', Component: BottledWaterTab }] },
  { key: 'ice', label: 'Ice', icon: Snowflake, items: [{ key: 'ice', label: 'Ice', Component: IceTab }] },
  { key: 'tankers', label: 'Tankers', icon: Truck, items: [{ key: 'tankers', label: 'Tankers', Component: TankersTab }] },
  { key: 'customers', label: 'Customers', icon: Users, items: [{ key: 'customers', label: 'Customers', Component: CustomersTab }] },
  { key: 'orders', label: 'Bulk Water Orders', icon: ClipboardList, items: [{ key: 'orders', label: 'Bulk Water Orders', Component: OrdersTab }] },
  { key: 'retail-sales', label: 'Retail Sales & Billing', icon: Receipt, items: [{ key: 'retail-sales', label: 'Retail Sales & Billing', Component: RetailSalesTab }] },
  { key: 'deliveries', label: 'Deliveries', icon: Send, items: [{ key: 'deliveries', label: 'Deliveries', Component: DeliveriesTab }] },
  { key: 'reports', label: 'Reports', icon: BarChart3, items: [{ key: 'reports', label: 'Reports', Component: SalesReportsTab }] }
];

export default function SalesPage() {
  return (
    <div>
      <div className="page-header">
        <h1><Building2 size={22} color="var(--primary)" /> Sales & Distribution</h1>
        <p>Bulk (RO) Water, Bottled Water, and Ice — kept as separate business lines throughout.</p>
      </div>
      <GroupedTabs groups={GROUPS} />
    </div>
  );
}
