function buildRetailCustomerSearch(value) {
  const rawQuery = String(value || '').trim();
  const compactQuery = rawQuery.replace(/[,\s]/g, '');
  if (rawQuery.length < 2 || compactQuery.length < 2) return null;

  return {
    rawQuery,
    compactQuery,
    likeQuery: `%${rawQuery}%`,
    compactLikeQuery: `%${compactQuery}%`
  };
}

module.exports = { buildRetailCustomerSearch };
