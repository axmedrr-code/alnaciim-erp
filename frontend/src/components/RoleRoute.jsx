import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { canAccess } from '../utils/routeAccess';

// Shows the page only to roles allowed by utils/routeAccess; everyone else gets a clear message instead of an empty page shell.
export default function RoleRoute({ path, children }) {
  const { user } = useAuth();
  if (canAccess(user?.role, path)) return children;
  return (
    <div className="card" style={{ maxWidth: 520, margin: '40px auto', textAlign: 'center' }} role="alert">
      <h2>You do not have access to this page</h2>
      <p className="muted">Your role ({user?.role || 'unknown'}) is not allowed to open it. If you need it, ask an administrator.</p>
      <Link className="btn" to="/">Back to the dashboard</Link>
    </div>
  );
}
