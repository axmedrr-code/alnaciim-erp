function chartAccountUpdateViolation({ accountId, parentId, descendantIds = [], isSystem, isActive, requestedActive }) {
  if (isSystem && isActive && requestedActive === false) return 'System accounts cannot be deactivated';
  if (parentId === null || parentId === undefined) return null;
  if (Number(parentId) === Number(accountId)) return 'An account cannot be its own parent';
  if (descendantIds.some((id) => Number(id) === Number(parentId))) return 'An account cannot use one of its descendants as its parent';
  return null;
}

module.exports = { chartAccountUpdateViolation };
