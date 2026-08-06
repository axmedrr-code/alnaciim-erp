function errorHandler(err, req, res, next) { // eslint-disable-line no-unused-vars
  const statusCode = err.statusCode || 500;
  if (statusCode === 500) console.error(err);

  if (err.code === '23505') return res.status(409).json({ data: null, error: 'Duplicate value violates a unique constraint' });
  if (err.code === '23503') return res.status(409).json({ data: null, error: 'Referenced record does not exist' });

  res.status(statusCode).json({ data: null, error: err.message || 'Internal server error' });
}

module.exports = errorHandler;
