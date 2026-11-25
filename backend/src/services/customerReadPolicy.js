const HNO_ONLY_ROLES = new Set(['Driver', 'Data Entry Operator']);

function customerReadPolicy(role, query = {}) {
  const hnoOnly = HNO_ONLY_ROLES.has(role);
  const hasHnoLookup = Boolean(String(query.hno || '').trim() || String(query.hno_like || '').trim());
  if (hnoOnly && !hasHnoLookup) return null;
  return { hnoOnly, maxResults: hnoOnly ? 8 : 50 };
}

module.exports = { customerReadPolicy };
