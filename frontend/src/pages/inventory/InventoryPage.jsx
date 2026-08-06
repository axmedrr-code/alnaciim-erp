import { useState } from 'react';
import ProductsTab from './ProductsTab';
import StockLevelsTab from './StockLevelsTab';
import MovementsTab from './MovementsTab';
import WarehousesTab from './WarehousesTab';

const TABS = [
  { key: 'products', label: 'Products', Component: ProductsTab },
  { key: 'stock', label: 'Stock Levels', Component: StockLevelsTab },
  { key: 'movements', label: 'Movements', Component: MovementsTab },
  { key: 'warehouses', label: 'Warehouses', Component: WarehousesTab }
];

export default function InventoryPage() {
  const [tab, setTab] = useState('products');
  const Active = TABS.find((t) => t.key === tab).Component;

  return (
    <div>
      <div className="page-header"><h1>Inventory</h1></div>
      <div className="tabs">
        {TABS.map((t) => (
          <button key={t.key} className={tab === t.key ? 'active' : ''} onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
      </div>
      <Active />
    </div>
  );
}
