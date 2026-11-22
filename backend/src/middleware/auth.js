const jwt = require('jsonwebtoken');
const { ApiError } = require('../utils/asyncHandler');
const { pool } = require('../config/db');

// A valid signature is not enough: the account must still exist, be active, and the role is
// taken from the database (not the token) so deactivation / role changes take effect without
// waiting for the token to expire. Results are cached briefly to keep this to ~1 query per user
// per AUTH_CACHE_TTL_MS (default 30 s; 0 disables the cache). Admin user updates invalidate it.
function readTtl() {
  const raw = process.env.AUTH_CACHE_TTL_MS;
  if (raw === undefined || raw === '') return 30000;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : 30000;
}
const TTL_MS = readTtl();
const cache = new Map(); // userId -> { at, row }

function invalidateUser(id) { cache.delete(Number(id)); }

async function lookupUser(id) {
  const now = Date.now();
  const hit = cache.get(id);
  if (TTL_MS > 0 && hit && now - hit.at < TTL_MS) return hit.row;
  const { rows } = await pool.query(
    'SELECT u.id, u.is_active, r.name AS role_name FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = $1',
    [id]
  );
  const row = rows[0] || null;
  if (TTL_MS > 0) {
    if (cache.size > 5000) cache.clear();
    cache.set(id, { at: now, row });
  }
  return row;
}

async function authenticate(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return next(new ApiError(401, 'Missing bearer token'));

  let payload;
  try {
    // Pin the algorithm so a token can never select a weaker/different one.
    payload = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
  } catch (err) {
    return next(new ApiError(401, 'Invalid or expired token'));
  }

  try {
    const user = await lookupUser(Number(payload.id));
    if (!user || !user.is_active) return next(new ApiError(401, 'Account is disabled or no longer exists'));
    req.user = { ...payload, role: user.role_name };
    next();
  } catch (err) {
    next(err); // database problems surface through the error handler (503 when the DB is down)
  }
}

function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) return next(new ApiError(401, 'Not authenticated'));
    if (!allowedRoles.includes(req.user.role)) {
      return next(new ApiError(403, `Requires one of roles: ${allowedRoles.join(', ')}`));
    }
    next();
  };
}

module.exports = { authenticate, requireRole, invalidateUser };
