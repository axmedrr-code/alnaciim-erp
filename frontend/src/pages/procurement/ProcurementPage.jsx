import { useState } from 'react';
import PurchaseOrdersTab from './PurchaseOrdersTab';
import SuppliersTab from './SuppliersTab';
import PoAuthorizationTab from './PoAuthorizationTab';
import SupplierInvoicesTab from './SupplierInvoicesTab';
import MaterialIssuesTab from './MaterialIssuesTab';

const TABS = [
  { key: 'pos', label: 'Purchase Orders', Component: PurchaseOrdersTab },
  { key: 'flow', label: 'PO Authorization & Tracking', Component: PoAuthorizationTab },
  { key: 'issues', label: 'Material Issues', Component: MaterialIssuesTab },
  { key: 'invoices', label: 'Supplier Invoices & Vouchers', Component: SupplierInvoicesTab },
  { key: 'suppliers', label: 'Suppliers', Component: SuppliersTab }
];

export default function ProcurementPage() {
  const [tab, setTab] = useState('pos');
  const Active = TABS.find((t) => t.key === tab).Component;

  return (
    <div>
      <div className="page-header"><h1>Procurement</h1></div>
      <div className="tabs">
        {TABS.map((t) => (
          <button key={t.key} className={tab === t.key ? 'active' : ''} onClick={() => setTab(t.key)}>{t.label}</button>
        ))}
      </div>
      <Active />
    </div>
  );
}
