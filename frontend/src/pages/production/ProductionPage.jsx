import {
  LayoutDashboard, ClipboardList, Droplets, Package, Snowflake, BookOpen,
  Boxes, PackageCheck, Factory, AlertOctagon, ShieldCheck, BarChart3, CalendarDays
} from 'lucide-react';
import GroupedTabs from '../../components/GroupedTabs';
import ProductionDashboardTab from './ProductionDashboardTab';
import BatchesTab from './BatchesTab';
import RoWaterProductionTab from './RoWaterProductionTab';
import BottledWaterProductionTab from './BottledWaterProductionTab';
import IceProductionTab from './IceProductionTab';
import CapacityCalendarTab from './CapacityCalendarTab';
import BomTab from './BomTab';
import RawMaterialsTab from './RawMaterialsTab';
import FinishedGoodsTab from './FinishedGoodsTab';
import MachinesTab from './MachinesTab';
import DowntimeTab from './DowntimeTab';
import QualityControlTab from './QualityControlTab';
import ProductionReportsTab from './ProductionReportsTab';

// A Manufacturing Execution System reads as separate stations, not one CRUD table.
// RO Water, Bottled Water, and Ice each get their own scoped dashboard (own KPIs, own
// batch list) instead of one big mixed "Batches" screen — matching the same
// per-line separation already used in Sales & Distribution.
const GROUPS = [
  {
    key: 'dashboard', label: 'Dashboard', icon: LayoutDashboard,
    items: [{ key: 'dashboard', label: 'Production Dashboard', Component: ProductionDashboardTab }]
  },
  {
    key: 'orders', label: 'Production Orders', icon: ClipboardList,
    items: [
      { key: 'all', label: 'All Orders', icon: ClipboardList, Component: BatchesTab },
      { key: 'ro-water', label: 'RO Water', icon: Droplets, Component: RoWaterProductionTab },
      { key: 'bottled', label: 'Bottled Water', icon: Package, Component: BottledWaterProductionTab },
      { key: 'ice', label: 'Ice', icon: Snowflake, Component: IceProductionTab }
    ]
  },
  {
    key: 'capacity-calendar', label: 'Capacity Calendar', icon: CalendarDays,
    items: [{ key: 'capacity-calendar', label: 'Capacity Calendar', Component: CapacityCalendarTab }]
  },
  {
    key: 'bom', label: 'Bill of Materials', icon: BookOpen,
    items: [{ key: 'bom', label: 'Bill of Materials', Component: BomTab }]
  },
  {
    key: 'materials', label: 'Materials & Goods', icon: Boxes,
    items: [
      { key: 'raw', label: 'Raw Materials', icon: Boxes, Component: RawMaterialsTab },
      { key: 'finished', label: 'Finished Goods', icon: PackageCheck, Component: FinishedGoodsTab }
    ]
  },
  {
    key: 'machines', label: 'Machines', icon: Factory,
    items: [
      { key: 'machines', label: 'Machines', icon: Factory, Component: MachinesTab },
      { key: 'downtime', label: 'Downtime', icon: AlertOctagon, Component: DowntimeTab }
    ]
  },
  {
    key: 'quality', label: 'Quality Control', icon: ShieldCheck,
    items: [{ key: 'quality', label: 'Quality Control', Component: QualityControlTab }]
  },
  {
    key: 'reports', label: 'Reports', icon: BarChart3,
    items: [{ key: 'reports', label: 'Production Reports', Component: ProductionReportsTab }]
  }
];

export default function ProductionPage() {
  return (
    <div>
      <div className="page-header">
        <h1><Factory size={22} color="var(--primary)" /> Production</h1>
        <p>RO Water, Bottled Water, and Ice — each run as its own production line.</p>
      </div>
      <GroupedTabs groups={GROUPS} />
    </div>
  );
}
