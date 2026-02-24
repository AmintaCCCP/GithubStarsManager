import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

interface Config {
  port: number;
  apiSecret: string | null;
  encryptionKey: string;
  dbPath: string;
  nodeEnv: string;
}

function resolveDataDir(): string {
  const dataDir = path.resolve(process.cwd(), 'data');
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  return dataDir;
}

function resolveEncryptionKey(dataDir: string): string {
  const envKey = process.env.ENCRYPTION_KEY;
  if (envKey) {
    return envKey;
  }

  const keyFilePath = path.join(dataDir, '.encryption-key');
  if (fs.existsSync(keyFilePath)) {
    return fs.readFileSync(keyFilePath, 'utf-8').trim();
  }

  const newKey = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(keyFilePath, newKey, { mode: 0o600 });
  console.log('Generated new encryption key and saved to data/.encryption-key');
  return newKey;
}

function loadConfig(): Config {
  const dataDir = resolveDataDir();

  return {
    port: parseInt(process.env.PORT || '3000', 10),
    apiSecret: process.env.API_SECRET || null,
    encryptionKey: resolveEncryptionKey(dataDir),
    dbPath: process.env.DB_PATH || path.join(dataDir, 'data.db'),
    nodeEnv: process.env.NODE_ENV || 'development',
  };
}

export const config = loadConfig();
