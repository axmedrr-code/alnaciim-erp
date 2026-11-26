import { Link } from 'react-router-dom';

export default function NotFound() {
  return (
    <div className="card" style={{ maxWidth: 520, margin: '40px auto', textAlign: 'center' }}>
      <h2>Page not found</h2>
      <p className="muted">This address does not exist.</p>
      <Link className="btn" to="/">Back to the dashboard</Link>
    </div>
  );
}
