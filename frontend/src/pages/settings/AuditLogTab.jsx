import { useState } from 'react';
import { useApi } from '../../components/useApi';
import Table from '../../components/Table';

const ACTION_BADGE = { CREATE: 'ok', UPDATE: 'pending', DELETE: 'low' };

export default function AuditLogTab() {
  const [entityType, setEntityType] = useState('');
  const [action, setAction] = useState('');
  const params = new URLSearchParams();
  if (entityType) params.set('entity_type', entityType);
  if (action) params.set('action', action);
  const { rows } = useApi(`/audit-logs?${params.toString()}`, [entityType, action]);

  return (
    <div>
      <div className="toolbar">
        <select value={entityType} onChange={(e) => setEntityType(e.target.value)}>
          <option value="">All entities</option>
          <option value="customer">Customer</option>
          <option value="sales_order">Sales Order</option>
          <option value="payment">Payment</option>
          <option value="qaade">Qaade</option>
          <option value="user">User</option>
        </select>
        <select value={action} onChange={(e) => setAction(e.target.value)}>
          <option value="">All actions</option>
          <option value="CREATE">Create</option>
          <option value="UPDATE">Update</option>
          <option value="DELETE">Delete</option>
        </select>
      </div>
      <div className="card">
        <Table
          columns={[
            { key: 'created_at', header: 'Date', render: (r) => new Date(r.created_at).toLocaleString() },
            { key: 'action', header: 'Action', render: (r) => <span className={`badge badge--${ACTION_BADGE[r.action]}`}>{r.action}</span> },
            { key: 'entity_type', header: 'Entity' },
            { key: 'entity_id', header: 'Entity ID' },
            { key: 'user_name', header: 'By', render: (r) => r.user_name || 'System' }
          ]}
          rows={rows}
          emptyText="No audit activity recorded yet."
        />
      </div>
    </div>
  );
}
