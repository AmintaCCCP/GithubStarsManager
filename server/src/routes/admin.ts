import { Router } from 'express';
import { getDb } from '../db/connection.js';

const router = Router();

// Middleware to check if user is SuperAdmin
const requireAdmin = (req: any, res: any, next: any) => {
  if (req.user?.role !== 'SuperAdmin') {
    return res.status(403).json({ error: 'Forbidden', code: 'FORBIDDEN' });
  }
  next();
};

// GET /api/admin/users
router.get('/api/admin/users', requireAdmin, (req, res) => {
  try {
    const db = getDb();
    const users = db.prepare('SELECT id, username, role, created_at FROM users').all();
    res.json(users);
  } catch (err) {
    console.error('Failed to get users:', err);
    res.status(500).json({ error: 'Internal server error', code: 'INTERNAL_ERROR' });
  }
});

// POST /api/admin/users
router.post('/api/admin/users', requireAdmin, async (req, res) => {
  try {
    const { username, password, role } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required', code: 'MISSING_FIELDS' });
    }

    const db = getDb();
    const bcrypt = await import('bcryptjs');
    const passwordHash = await bcrypt.default.hash(password, 10);

    const userRole = role === 'SuperAdmin' ? 'SuperAdmin' : 'User';

    const insertResult = db.prepare(
      'INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)'
    ).run(username, passwordHash, userRole);

    const newUser = db.prepare('SELECT id, username, role, created_at FROM users WHERE id = ?').get(insertResult.lastInsertRowid);
    res.status(201).json(newUser);
  } catch (err: any) {
    console.error('Failed to create user:', err);
    if (err.message?.includes('UNIQUE constraint failed')) {
      res.status(409).json({ error: 'Username already exists', code: 'USERNAME_EXISTS' });
    } else {
      res.status(500).json({ error: 'Internal server error', code: 'INTERNAL_ERROR' });
    }
  }
});

// DELETE /api/admin/users/:id
router.delete('/api/admin/users/:id', requireAdmin, (req, res) => {
  try {
    const id = req.params.id;
    const db = getDb();

    // Prevent deleting self
    if (!req.user || Number(id) === req.user.id) {
      return res.status(400).json({ error: 'Cannot delete yourself or undefined user', code: 'CANNOT_DELETE_SELF' });
    }

    db.prepare('DELETE FROM users WHERE id = ?').run(id);
    res.json({ message: 'User deleted successfully' });
  } catch (err) {
    console.error('Failed to delete user:', err);
    res.status(500).json({ error: 'Internal server error', code: 'INTERNAL_ERROR' });
  }
});

export default router;
