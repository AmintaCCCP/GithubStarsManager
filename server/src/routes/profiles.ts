import { Router } from 'express';
import { deleteProfileDb, isValidProfileId, listProfiles, ProfileInUseError } from '../db/connection.js';
import { logger } from '../services/logger.js';

const router = Router();

// GET /api/profiles
router.get('/api/profiles', (_req, res) => {
  try {
    const profiles = listProfiles();
    res.json({ profiles });
  } catch (err) {
    logger.errorFromError('profiles.list', 'GET /api/profiles error', err);
    res.status(500).json({ error: 'Failed to list profiles', code: 'LIST_PROFILES_FAILED' });
  }
});

// DELETE /api/profiles/:id
router.delete('/api/profiles/:id', (req, res) => {
  const id = req.params.id;
  if (!id || !isValidProfileId(id)) {
    res.status(400).json({ error: 'Invalid profile ID', code: 'INVALID_PROFILE_ID' });
    return;
  }

  try {
    deleteProfileDb(id);
    res.json({ deleted: true });
  } catch (err) {
    if (err instanceof ProfileInUseError) {
      res.status(409).json({ error: err.message, code: err.code });
      return;
    }
    logger.errorFromError('profiles.delete', `DELETE /api/profiles/${id} error`, err);
    res.status(500).json({ error: 'Failed to delete profile', code: 'DELETE_PROFILE_FAILED' });
  }
});

export default router;
