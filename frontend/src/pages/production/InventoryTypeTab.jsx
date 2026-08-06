import { useMemo } from 'react';
import { Boxes, DollarSign, AlertTriangle, XCircle } from 'lucide-react';
import { useApi } from '../../components/useApi';
import Table from '../../components/Table';

// MES-facing view of stock for one product type — Raw Materials (what's available to
// consume) or Finished Goods (what production has produced). Same /reports/inventory
// endpoint the Inventory module uses, just filtered and framed for a production
// audience instead of a warehouse-keeping one.
export default function InventoryTypeTab({ productType, label }) {
  const { rows } = useApi('/reports/inventory');
  const filtered = useMemo(() => (rows || []).filter((r) => r.product_type === productType), [rows, productType]);

  if (!rows) return <p className="muted">Loading…</p>;

  const skuCount = new Set(filtered.map((r) => r.sku)).size;
  const stockValue = filtered.reduce((s, r) => s + Number(r.stock_value), 0);
  const lowStock = filtered.filter((r) => r.is_low_stock).length;
  const outOfStock = filtered.filter((r) => Number(r.quantity) <= 0).length;

  return (
    <div>
      <div className="kpi-grid">
        <div className="kpi-card">
          <div className="kpi-card__top"><div className="kpi-card__icon"><Boxes size={18} /></div></div>
          <div className="kpi-card__label">{label} SKUs</div>
          <div className="kpi-card__value">{skuCount}</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-card__top"><div className="kpi-card__icon kpi-card__icon--accent"><DollarSign size={18} /></div></div>
          <div className="kpi-card__label">Stock Value</div>
          <div className="kpi-card__value">${stockValue.toFixed(2)}</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-card__top"><div className={`kpi-card__icon${lowStock > 0 ? ' kpi-card__icon--danger' : ' kpi-card__icon--success'}`}><AlertTriangle size={18} /></div></div>
          <div className="kpi-card__label">Low Stock</div>
          <div className="kpi-card__value" style={{ color: lowStock > 0 ? 'var(--danger)' : undefined }}>{lowStock}</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-card__top"><div className={`kpi-card__icon${outOfStock > 0 ? ' kpi-card__icon--danger' : ' kpi-card__icon--success'}`}><XCircle size={18} /></div></div>
          <div className="kpi-card__label">Out of Stock</div>
          <div className="kpi-card__value" style={{ color: outOfStock > 0 ? 'var(--danger)' : undefined }}>{outOfStock}</div>
        </div>
      </div>

      <div className="card">
        <h3>{label} Stock by Warehouse</h3>
        <Table
          columns={[
            { key: 'warehouse_name', header: 'Warehouse' },
            { key: 'sku', header: 'SKU' },
            { key: 'product_name', header: 'Product' },
            { key: 'quantity', header: 'Qty', render: (r) => `${Number(r.quantity).toLocaleString()} ${r.unit}` },
            { key: 'stock_value', header: 'Value', render: (r) => `$${Number(r.stock_value).toFixed(2)}` },
            { key: 'is_low_stock', header: 'Status', render: (r) => <span className={`badge badge--${r.is_low_stock ? 'low' : 'ok'}`}>{r.is_low_stock ? 'Low' : 'OK'}</span> }
          ]}
          rows={filtered}
          emptyText={`No ${label.toLowerCase()} stock recorded yet.`}
          searchable searchPlaceholder={`Search ${label.toLowerCase()}…`} sortable pageSize={12}
        />
      </div>
    </div>
  );
}
