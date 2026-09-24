import fs from 'node:fs';
import path from 'node:path';

export const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
export const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, 'data');
export const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, 'pleasestayhere.db');
export const AUTH_PATH = process.env.FB_AUTH_PATH || path.join(ROOT, 'playwright', '.auth', 'facebook.json');
export const SOURCES_PATH = process.env.SOURCES_PATH || path.join(ROOT, 'config', 'sources.json');

export function loadSources() {
  if (!fs.existsSync(SOURCES_PATH)) return [];
  const value = JSON.parse(fs.readFileSync(SOURCES_PATH, 'utf8'));
  if (!Array.isArray(value)) throw new Error('config/sources.json must be an array');
  return value.filter(s => s.enabled !== false);
}
