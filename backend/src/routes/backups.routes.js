const { Router } = require('express');
const { asyncHandler, ApiError } = require('../utils/asyncHandler');
const { requireRole } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const schemas = require('../validation/schemas');
const backupService = require('../services/backupService');

const router = Router();

router.use(requireRole('Admin'));
router.param('id', (req, res, next, v) => (/^\d+$/.test(String(v)) && Number(v) <= 2147483647 ? next() : next(new ApiError(404, 'Record not found'))));

router.get('/schedule', asyncHandler(async (req, res) => {
  res.json({
    data: {
      cron_schedule: process.env.BACKUP_CRON_SCHEDULE || '0 2 * * *',
      retention_days: Number(process.env.BACKUP_RETENTION_DAYS) || 30
    },
    error: null
  });
}));

router.get('/', asyncHandler(async (req, res) => {
  res.json({ data: await backupService.listBackups(), error: null });
}));

router.get('/logs', asyncHandler(async (req, res) => {
  res.json({ data: await backupService.listLogs(), error: null });
}));

router.post('/', asyncHandler(async (req, res) => {
  const result = await backupService.createBackup({ triggerType: 'manual', triggeredBy: req.user.id });
  res.status(201).json({ data: result, error: null });
}));

router.get('/:id/download', asyncHandler(async (req, res) => {
  const { filePath, filename } = await backupService.getBackupFile(req.params.id);
  res.download(filePath, filename);
}));

// A restore replaces the WHOLE live database with an older copy. It is switched off unless the operator of this deployment
// has explicitly enabled it (ALLOW_DB_RESTORE=true), so a mistaken click or a stolen Admin session cannot wipe a hosted database.
router.post('/:id/restore', validate(schemas.restoreBackupConfirm), asyncHandler(async (req, res) => {
  if (process.env.ALLOW_DB_RESTORE !== 'true') {
    throw new ApiError(403, 'Restoring a backup is disabled on this server. The server operator must set ALLOW_DB_RESTORE=true to allow it.');
  }
  const result = await backupService.restoreBackup({ backupLogId: req.params.id, triggeredBy: req.user.id });
  res.json({ data: result, error: null });
}));

router.delete('/:id', asyncHandler(async (req, res) => {
  await backupService.deleteBackup(req.params.id);
  res.status(204).send();
}));

module.exports = router;
