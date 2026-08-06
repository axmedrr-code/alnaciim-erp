import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, AlertTriangle, Wrench, Truck, DollarSign } from 'lucide-react';
import { useApi } from './useApi';

// Real alerts, not decorative ones — every item here is computed from data the
// Dashboard already fetches (/reports/dashboard-summary), just surfaced persistently
// in the top nav instead of only on the dashboard page. No new backend endpoint.
export default function NotificationsBell() {
  const { rows: summary } = useApi('/reports/dashboard-summary');
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const navigate = useNavigate();

  useEffect(() => {
    function handleClick(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const notifications = [];
  if (summary) {
    if (summary.low_stock_count > 0) {
      notifications.push({ icon: AlertTriangle, tone: 'danger', text: `${summary.low_stock_count} item${summary.low_stock_count > 1 ? 's' : ''} below reorder level`, to: '/inventory' });
    }
    if (summary.maintenance_due_count > 0) {
      notifications.push({ icon: Wrench, tone: 'warning', text: `${summary.maintenance_due_count} machine${summary.maintenance_due_count > 1 ? 's' : ''} due for maintenance`, to: '/maintenance' });
    }
    const pendingDeliveries = (summary.pending_deliveries || []).reduce((s, d) => s + Number(d.count), 0);
    if (pendingDeliveries > 0) {
      notifications.push({ icon: Truck, tone: 'info', text: `${pendingDeliveries} deliveries pending`, to: '/sales' });
    }
    if (Number(summary.outstanding_receivables) > 0) {
      notifications.push({ icon: DollarSign, tone: 'danger', text: `$${Number(summary.outstanding_receivables).toFixed(2)} outstanding from customers`, to: '/finance' });
    }
  }

  return (
    <div className="notif-bell" ref={ref}>
      <button className="icon-btn" onClick={() => setOpen((o) => !o)} aria-label="Notifications">
        <Bell size={18} />
        {notifications.length > 0 && <span className="notif-bell__dot">{notifications.length}</span>}
      </button>
      {open && (
        <div className="notif-bell__dropdown">
          <div className="notif-bell__header">Notifications</div>
          {notifications.length ? notifications.map((n, i) => {
            const Icon = n.icon;
            return (
              <button key={i} className="notif-bell__item" onClick={() => { navigate(n.to); setOpen(false); }}>
                <span className={`notif-bell__icon notif-bell__icon--${n.tone}`}><Icon size={15} /></span>
                <span>{n.text}</span>
              </button>
            );
          }) : <div className="notif-bell__empty">You're all caught up.</div>}
        </div>
      )}
    </div>
  );
}
