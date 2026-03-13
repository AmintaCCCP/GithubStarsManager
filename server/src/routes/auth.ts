import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { getDb } from '../db/connection.js';
import { config } from '../config.js';
import { authMiddleware } from '../middleware/auth.js';

const router = Router();

const JWT_SECRET = config.encryptionKey || 'fallback_secret_for_dev_only';
const JWT_EXPIRES_IN = '7d';

function validateEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

router.post('/register', async (req, res) => {
  try {
    const { email, password, display_name, github_token } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    if (!validateEmail(email)) {
      return res.status(400).json({ error: 'Invalid email format' });
    }

    const db = getDb();

    const existingUser = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
    if (existingUser) {
      return res.status(409).json({ error: 'Email already registered' });
    }

    const countRow = db.prepare('SELECT COUNT(*) as count FROM users').get() as { count: number };
    const isFirstUser = countRow.count === 0;
    const role = isFirstUser ? 'SuperAdmin' : 'User';

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    const username = display_name || email.split('@')[0];

    const insertResult = db.prepare(
      'INSERT INTO users (email, username, password_hash, role, display_name) VALUES (?, ?, ?, ?, ?)'
    ).run(email, username, passwordHash, role, display_name || null);

    const newUserId = insertResult.lastInsertRowid;

    if (github_token) {
      const { encrypt } = await import('../services/crypto.js');
      const encryptedToken = encrypt(github_token, config.encryptionKey);
      db.prepare(
        'INSERT INTO settings (key, value, user_id) VALUES (?, ?, ?)'
      ).run('github_token', encryptedToken, newUserId);
    }

    const token = jwt.sign(
      { id: newUserId, email, username, role },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );

    res.status(201).json({
      user: {
        id: newUserId,
        email,
        username,
        role,
        displayName: display_name || null,
      },
      token,
    });
  } catch (err) {
    console.error('Registration error:', err);
    res.status(500).json({ error: 'Internal server error during registration' });
  }
});

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const db = getDb();
    
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email) as any;
    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const token = jwt.sign(
      { id: user.id, email: user.email, username: user.username, role: user.role },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );

    res.json({
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        role: user.role,
        displayName: user.display_name,
        avatarUrl: user.avatar_url,
        appriseUrl: user.apprise_url
      },
      token,
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Internal server error during login' });
  }
});

router.patch('/profile', authMiddleware, async (req, res) => {
  try {
    const userId = (req as any).user?.id;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const { apprise_url, password, username, display_name, avatar_url } = req.body;
    const db = getDb();

    if (password) {
      const salt = await bcrypt.genSalt(10);
      const passwordHash = await bcrypt.hash(password, salt);
      db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(passwordHash, userId);
    }

    if (apprise_url !== undefined) {
      db.prepare('UPDATE users SET apprise_url = ? WHERE id = ?').run(apprise_url, userId);
    }

    if (username !== undefined) {
      const existing = db.prepare('SELECT id FROM users WHERE username = ? AND id != ?').get(username, userId);
      if (existing) {
        return res.status(409).json({ error: 'Username already taken' });
      }
      db.prepare('UPDATE users SET username = ? WHERE id = ?').run(username, userId);
    }

    if (display_name !== undefined) {
      db.prepare('UPDATE users SET display_name = ? WHERE id = ?').run(display_name, userId);
    }

    if (avatar_url !== undefined) {
      db.prepare('UPDATE users SET avatar_url = ? WHERE id = ?').run(avatar_url, userId);
    }

    const updatedUser = db.prepare('SELECT id, email, username, role, display_name, avatar_url, apprise_url FROM users WHERE id = ?').get(userId) as any;
    res.json({
      id: updatedUser.id,
      email: updatedUser.email,
      username: updatedUser.username,
      role: updatedUser.role,
      displayName: updatedUser.display_name,
      avatarUrl: updatedUser.avatar_url,
      appriseUrl: updatedUser.apprise_url
    });
  } catch (err) {
    console.error('Profile update error:', err);
    res.status(500).json({ error: 'Internal server error during profile update' });
  }
});

router.get('/profile', authMiddleware, async (req, res) => {
  try {
    const userId = (req as any).user?.id;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const db = getDb();
    const user = db.prepare('SELECT id, email, username, role, display_name, avatar_url, apprise_url FROM users WHERE id = ?').get(userId) as any;
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({
      id: user.id,
      email: user.email,
      username: user.username,
      role: user.role,
      displayName: user.display_name,
      avatarUrl: user.avatar_url,
      appriseUrl: user.apprise_url
    });
  } catch (err) {
    console.error('Profile fetch error:', err);
    res.status(500).json({ error: 'Internal server error during profile fetch' });
  }
});

export default router;
