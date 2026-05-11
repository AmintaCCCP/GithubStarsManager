import { Router } from 'express';
import { getDb } from '../db/connection.js';
import * as analysisService from '../services/analysisService.js';

const router = Router();

// POST /api/analysis/batch — start analysis
router.post('/api/analysis/batch', (req, res) => {
  try {
    const { repositoryIds, configId, language, categoryNames } = req.body as {
      repositoryIds?: unknown;
      configId?: unknown;
      language?: unknown;
      categoryNames?: unknown;
    };

    if (!Array.isArray(repositoryIds) || repositoryIds.length === 0) {
      res.status(400).json({ error: 'repositoryIds must be a non-empty array', code: 'ANALYSIS_INVALID_REQUEST' });
      return;
    }
    if (!repositoryIds.every((id) => typeof id === 'number' && id > 0)) {
      res.status(400).json({ error: 'repositoryIds must be positive integers', code: 'ANALYSIS_INVALID_REQUEST' });
      return;
    }
    if (!configId || typeof configId !== 'string') {
      res.status(400).json({ error: 'configId is required', code: 'ANALYSIS_INVALID_REQUEST' });
      return;
    }

    // Verify config exists
    const db = getDb();
    const aiConfig = db.prepare('SELECT id FROM ai_configs WHERE id = ?').get(configId);
    if (!aiConfig) {
      res.status(404).json({ error: 'AI config not found', code: 'AI_CONFIG_NOT_FOUND' });
      return;
    }

    const lang = typeof language === 'string' && language === 'en' ? 'en' : 'zh';
    const cats = Array.isArray(categoryNames) ? categoryNames.filter((c) => typeof c === 'string') : [];

    const batch = analysisService.createBatch(
      repositoryIds as number[],
      configId,
      lang,
      cats,
    );

    res.status(202).json({
      batchId: batch.batchId,
      status: batch.status,
      total: batch.total,
    });
  } catch (err) {
    console.error('POST /api/analysis/batch error:', err);
    res.status(500).json({ error: 'Failed to start analysis', code: 'ANALYSIS_START_FAILED' });
  }
});

// GET /api/analysis/batches/active — list running batches (for page-refresh recovery)
router.get('/api/analysis/batches/active', (_req, res) => {
  try {
    const active = analysisService.getRunningBatches();
    res.json(active);
  } catch (err) {
    console.error('GET /api/analysis/batches/active error:', err);
    res.status(500).json({ error: 'Failed to get active batches', code: 'ANALYSIS_ACTIVE_FAILED' });
  }
});

// GET /api/analysis/batch/:batchId — check progress
router.get('/api/analysis/batch/:batchId', (req, res) => {
  try {
    const batch = analysisService.getBatchStatus(req.params.batchId);
    if (!batch) {
      res.status(404).json({ error: 'Batch not found', code: 'ANALYSIS_BATCH_NOT_FOUND' });
      return;
    }
    res.json(batch);
  } catch (err) {
    console.error('GET /api/analysis/batch error:', err);
    res.status(500).json({ error: 'Failed to get analysis progress', code: 'ANALYSIS_PROGRESS_FAILED' });
  }
});

// POST /api/analysis/batch/:batchId/cancel — cancel analysis
router.post('/api/analysis/batch/:batchId/cancel', (_req, res) => {
  try {
    const cancelled = analysisService.cancelBatch(_req.params.batchId);
    if (!cancelled) {
      res.status(404).json({ error: 'Batch not found or already completed', code: 'ANALYSIS_BATCH_NOT_FOUND' });
      return;
    }
    res.json({ batchId: _req.params.batchId, status: 'cancelled' });
  } catch (err) {
    console.error('POST /api/analysis/batch/cancel error:', err);
    res.status(500).json({ error: 'Failed to cancel analysis', code: 'ANALYSIS_CANCEL_FAILED' });
  }
});

export default router;
