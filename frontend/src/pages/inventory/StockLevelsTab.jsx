import { useState } from 'react';
import { useApi } from '../../components/useApi';
import Table from '../../components/Table';
import { useAuth } from '../../context/AuthContext';

export default function StockLevelsTab() {
  const { user } = useAuth();
  // A Storekeeper only ever sees (and the API only returns) their own assigned warehouse.
  const ownWh = user?.role === 'Storekeeper' ? String(user.assignedWarehouseId || '') : '';
  const [warehouseId, setWarehouseId] = useState(ownWh);
  const { rows: allWarehouses } = useApi('/warehouses');
  const warehouses = ownWh ? (allWarehouses || []).filter((w) => String(w.id) === ownWh) : allWarehouses;
  const { rows } = useApi(`/inventory/stock-levels${warehouseId ? `?warehouse_id=${warehouseId}` : ''}`, [warehouseId]);

  return (
    <div>
      <div className="toolbar">
        <select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
          {!ownWh && <option value="">All warehouses</option>}
          {warehouses?.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
        </select>
      </div>
      <div className="card">
        <Table
          columns={[
            { key: 'sku', header: 'SKU' },
            { key: 'product_name', header: 'Product' },
            { key: 'warehouse_name', header: 'Warehouse' },
            { key: 'quantity', header: 'Quantity', render: (r) => `${Number(r.quantity).toLocaleString()} ${r.unit}` },
            { key: 'updated_at', header: 'Last Updated', render: (r) => new Date(r.updated_at).toLocaleString() }
          ]}
          rows={rows}
        />
      </div>
    </div>
  );
}
