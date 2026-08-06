import { useState } from 'react';
import UsersTab from './UsersTab';
import BackupsTab from './BackupsTab';
import AuditLogTab from './AuditLogTab';

const TABS = [
  { key: 'users', label: 'Users', Component: UsersTab },
  { key: 'audit', label: 'Audit Log', Component: AuditLogTab },
  { key: 'backups', label: 'Backups', Component: BackupsTab }
];

export default function SettingsPage() {
  const [tab, setTab] = useState('users');
  const Active = TABS.find((t) => t.key === tab).Component;

  return (
    <div>
      <div className="page-header"><h1>Settings</h1></div>
      <div className="tabs">
        {TABS.map((t) => (
          <button key={t.key} className={tab === t.key ? 'active' : ''} onClick={() => setTab(t.key)}>{t.label}</button>
        ))}
      </div>
      <Active />
    </div>
  );
}
