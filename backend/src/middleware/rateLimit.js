const { rateLimit, ipKeyGenerator } = require('express-rate-limit');

// All responses keep the API's { data, error } envelope.
function handler(message) {
  return (req, res) => {
    const retryAfter = res.getHeader('Retry-After');
    res.status(429).json({ data: null, error: message, retry_after_seconds: retryAfter ? Number(retryAfter) : undefined });
  };
}

// Generous per-IP ceiling for the whole API: stops floods/scrapers, never
// gets in the way of normal ERP/POS use (a busy screen makes a few requests/sec).
// If the host puts every client behind one proxy IP this stays harmless
// because the ceiling is high; the account-level login limiter below is what
// actually protects credentials.
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: Number(process.env.RATE_LIMIT_API_MAX) || 2000,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: handler('Too many requests. Please slow down and try again shortly.')
});

// Per-ACCOUNT brute-force protection on login. Keyed on the submitted email,
// not the IP, so it cannot be bypassed by rotating/spoofing source IPs.
// Only FAILED attempts count; a successful login does not consume the budget.
const loginAccountLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: Number(process.env.RATE_LIMIT_LOGIN_MAX) || 10,
  skipSuccessfulRequests: true,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => {
    const email = req.body && typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase().slice(0, 254) : '';
    return email ? `acct:${email}` : `ip:${ipKeyGenerator(req.ip || '')}`;
  },
  handler: handler('Too many failed login attempts. Try again in a few minutes.')
});

// Per-IP limiter on login as a second layer (covers password-spraying across many emails).
const loginIpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: Number(process.env.RATE_LIMIT_LOGIN_IP_MAX) || 60,
  skipSuccessfulRequests: true,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => `ip:${ipKeyGenerator(req.ip || '')}`,
  handler: handler('Too many failed login attempts from this network. Try again in a few minutes.')
});

module.exports = { apiLimiter, loginAccountLimiter, loginIpLimiter };
