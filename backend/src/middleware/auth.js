const jwt = require('jsonwebtoken');
const { ApiError } = require('../utils/asyncHandler');

function authenticate(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return next(new ApiError(401, 'Missing bearer token'));

  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch (err) {
    next(new ApiError(401, 'Invalid or expired token'));
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

module.exports = { authenticate, requireRole };
