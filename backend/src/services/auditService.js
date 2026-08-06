// Generic audit trail writer. Called from within the same DB transaction as the
// mutation it's recording, so the audit row and the change it describes commit
// or roll back together. old/new values are stored as JSONB snapshots.
async function logAudit(client, { userId, action, entityType, entityId, oldValue, newValue }) {
  await client.query(
    `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, old_value, new_value)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [userId || null, action, entityType, entityId || null, oldValue ? JSON.stringify(oldValue) : null, newValue ? JSON.stringify(newValue) : null]
  );
}

module.exports = { logAudit };
