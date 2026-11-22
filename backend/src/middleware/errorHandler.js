// Connection-level Postgres/network failures. pg wraps multi-address failures in an
// AggregateError with an EMPTY message, which used to surface as an opaque 500.
const DB_DOWN_CODES = new Set(['ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT', 'ECONNRESET', 'EAI_AGAIN', 'ENETUNREACH', '57P01', '57P03', '08000', '08001', '08003', '08006', '28P01', '28000', '3D000']);
function isDbDown(err) {
  if (!err) return false;
  if (DB_DOWN_CODES.has(err.code)) return true;
  return Array.isArray(err.errors) && err.errors.some((e) => DB_DOWN_CODES.has(e && e.code));
}

function errorHandler(err, req, res, next) { // eslint-disable-line no-unused-vars
  if (isDbDown(err)) {
    // Full detail goes to the server log only (pg messages never include the password).
    console.error('Database unavailable:', err.code || (err.errors && err.errors[0] && err.errors[0].code) || err.name, err.message || '');
    return res.status(503).json({ data: null, error: 'Database unavailable' });
  }
  if (err.name === 'JsonWebTokenError' && /secret or private key/i.test(err.message || '')) {
    console.error('JWT_SECRET is not configured');
    return res.status(500).json({ data: null, error: 'Server authentication is not configured' });
  }
  const statusCode = err.statusCode || 500;
  if (statusCode === 500) console.error(err);

  if (err.code === '23505') return res.status(409).json({ data: null, error: 'Duplicate value violates a unique constraint' });
  if (err.code === '23503') return res.status(409).json({ data: null, error: 'Referenced record does not exist' });

  res.status(statusCode).json({ data: null, error: (statusCode === 500 ? 'Internal server error' : err.message) || 'Internal server error' });
}

module.exports = errorHandler;
