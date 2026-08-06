const { Router } = require('express');
const { asyncHandler } = require('../utils/asyncHandler');
const { requireRole } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const schemas = require('../validation/schemas');
const backupService = require('../services/backupService');

const router = Router();

router.use(requireRole('Admin'));

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

router.post('/:id/restore', validate(schemas.restoreBackupConfirm), asyncHandler(async (req, res) => {
  const result = await backupService.restoreBackup({ backupLogId: req.params.id, triggeredBy: req.user.id });
  res.json({ data: result, error: null });
}));

router.delete('/:id', asyncHandler(async (req, res) => {
  await backupService.deleteBackup(req.params.id);
  res.status(204).send();
}));

module.exports = router;
