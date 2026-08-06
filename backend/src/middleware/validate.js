const { ApiError } = require('../utils/asyncHandler');

// Validates req.body/query/params against a zod schema shaped as
// { body?, query?, params? }. On success, replaces req.body/query with the
// parsed (and coerced/defaulted) values so handlers can trust their shape.
function validate(schema) {
  return (req, res, next) => {
    const result = schema.safeParse({ body: req.body, query: req.query, params: req.params });
    if (!result.success) {
      const message = result.error.issues
        .map((issue) => `${issue.path.join('.') || 'body'}: ${issue.message}`)
        .join('; ');
      return next(new ApiError(400, message));
    }
    if (result.data.body !== undefined) req.body = result.data.body;
    if (result.data.query !== undefined) req.query = result.data.query;
    next();
  };
}

module.exports = { validate };
