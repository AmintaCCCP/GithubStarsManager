import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { getDb } from '../db/connection.js';
import { config } from '../config.js';

const router = Router();

const JWT_SECRET = config.encryptionKey || 'fallback_secret_for_dev_only';
const JWT_EXPIRES_IN = '7d';

// Register
router.post('/register', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }

    const db = getDb();

    // Check if user already exists
    const existingUser = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
    if (existingUser) {
      return res.status(409).json({ error: 'Username already exists' });
    }

    // Determine role (first user is SuperAdmin)
    const countRow = db.prepare('SELECT COUNT(*) as count FROM users').get() as { count: number };
    const isFirstUser = countRow.count === 0;
    const role = isFirstUser ? 'SuperAdmin' : 'User';

    // Hash password
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    // Insert user
    const insertResult = db.prepare(
      'INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)'
    ).run(username, passwordHash, role);

    const newUserId = insertResult.lastInsertRowid;

    // Save github token if provided
    const { github_token } = req.body;
    if (github_token) {
      const { encrypt } = await import('../services/crypto.js');
      const encryptedToken = encrypt(github_token, config.encryptionKey);
      db.prepare(
        'INSERT INTO settings (key, value, user_id) VALUES (?, ?, ?)'
      ).run('github_token', encryptedToken, newUserId);
    }

    // Generate token
    const token = jwt.sign(
      { id: newUserId, username, role },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );

    res.status(201).json({
      user: {
        id: newUserId,
        username,
        role,
      },
      token,
    });
  } catch (err) {
    console.error('Registration error:', err);
    res.status(500).json({ error: 'Internal server error during registration' });
  }
});

// Login
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }

    const db = getDb();
    
    // Find user
    const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username) as any;
    if (!user) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    // Verify password
    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    // Generate token
    const token = jwt.sign(
      { id: user.id, username: user.username, role: user.role },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );

    res.json({
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
        appriseUrl: user.apprise_url
      },
      token,
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Internal server error during login' });
  }
});

// Update Profile
router.patch('/profile', async (req, res) => {
  try {
    const userId = (req as any).user?.id;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const { apprise_url, password } = req.body;
    const db = getDb();

    if (password) {
      const salt = await bcrypt.genSalt(10);
      const passwordHash = await bcrypt.hash(password, salt);
      db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(passwordHash, userId);
    }

    if (apprise_url !== undefined) {
      db.prepare('UPDATE users SET apprise_url = ? WHERE id = ?').run(apprise_url, userId);
    }

    const updatedUser = db.prepare('SELECT id, username, role, apprise_url FROM users WHERE id = ?').get(userId) as any;
    res.json({
      id: updatedUser.id,
      username: updatedUser.username,
      role: updatedUser.role,
      appriseUrl: updatedUser.apprise_url
    });
  } catch (err) {
    console.error('Profile update error:', err);
    res.status(500).json({ error: 'Internal server error during profile update' });
  }
});

export default router;
