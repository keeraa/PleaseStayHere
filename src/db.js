import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { DB_PATH, DATA_DIR } from './config.js';
import { contentFingerprint, duplicateScore } from './dedupe.js';

fs.mkdirSync(DATA_DIR, { recursive: true });
const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode=WAL;');
db.exec('PRAGMA foreign_keys=ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS sources (
  id TEXT PRIMARY KEY, type TEXT NOT NULL, name TEXT, url TEXT NOT NULL,
  country TEXT, city TEXT, last_collected_at TEXT
);
CREATE TABLE IF NOT EXISTS raw_posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT, source_id TEXT NOT NULL,
  source_post_key TEXT NOT NULL, source_url TEXT, author TEXT, text TEXT NOT NULL,
  images_json TEXT NOT NULL DEFAULT '[]', published_label TEXT, collected_at TEXT NOT NULL,
  raw_json TEXT, UNIQUE(source_id, source_post_key), FOREIGN KEY(source_id) REFERENCES sources(id)
);
CREATE TABLE IF NOT EXISTS listings (
  id INTEGER PRIMARY KEY AUTOINCREMENT, raw_post_id INTEGER NOT NULL UNIQUE,
  dedupe_key TEXT, country TEXT, city TEXT, area TEXT, property_type TEXT,
  bedrooms INTEGER, bathrooms INTEGER, price REAL, currency TEXT, price_period TEXT,
  available_from TEXT, title TEXT, description TEXT, contact_phone TEXT, source_url TEXT,
  images_json TEXT NOT NULL DEFAULT '[]', language TEXT, is_agent INTEGER,
  confidence REAL NOT NULL DEFAULT 0, created_at TEXT NOT NULL,
  content_fingerprint TEXT, duplicate_of_listing_id INTEGER, duplicate_score REAL, duplicate_reason TEXT,
  FOREIGN KEY(raw_post_id) REFERENCES raw_posts(id)
);
CREATE INDEX IF NOT EXISTS idx_listings_location ON listings(country, city, area);
CREATE INDEX IF NOT EXISTS idx_listings_price ON listings(currency, price, price_period);
CREATE INDEX IF NOT EXISTS idx_listings_dedupe ON listings(dedupe_key);
CREATE INDEX IF NOT EXISTS idx_listings_duplicate_of ON listings(duplicate_of_listing_id);
CREATE INDEX IF NOT EXISTS idx_raw_collected ON raw_posts(collected_at);
`);

const cols = new Set(db.prepare('PRAGMA table_info(listings)').all().map(x=>x.name));
for (const [name,type] of [['content_fingerprint','TEXT'],['duplicate_of_listing_id','INTEGER'],['duplicate_score','REAL'],['duplicate_reason','TEXT']]) {
  if (!cols.has(name)) db.exec(`ALTER TABLE listings ADD COLUMN ${name} ${type}`);
}

export function upsertSource(source) {
  db.prepare(`INSERT INTO sources (id,type,name,url,country,city) VALUES (?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET type=excluded.type,name=excluded.name,url=excluded.url,country=excluded.country,city=excluded.city`)
    .run(source.id, source.type, source.name || source.id, source.url, source.country || null, source.city || null);
}
export function touchSource(id) { db.prepare('UPDATE sources SET last_collected_at=? WHERE id=?').run(new Date().toISOString(), id); }
export function insertRawPost(post) {
  const info = db.prepare(`INSERT OR IGNORE INTO raw_posts
    (source_id,source_post_key,source_url,author,text,images_json,published_label,collected_at,raw_json)
    VALUES (?,?,?,?,?,?,?,?,?)`).run(post.source_id,post.source_post_key,post.source_url,post.author,post.text,post.images_json,post.published_label,post.collected_at,post.raw_json);
  if (!info.changes) return null;
  return Number(info.lastInsertRowid);
}

function recentCandidates(x) {
  return db.prepare(`SELECT id,source_url,contact_phone,price,currency,area,property_type,bedrooms,description,content_fingerprint
    FROM listings WHERE duplicate_of_listing_id IS NULL
    AND (city IS ? OR city=?) ORDER BY id DESC LIMIT 1200`).all(x.city, x.city);
}

export function insertListing(x) {
  x.content_fingerprint = contentFingerprint(x.description || '');
  let best=null;
  for (const c of recentCandidates(x)) {
    const d=duplicateScore(x,c);
    if (!best || d.score>best.score) best={...d,id:c.id};
    if (d.score===1) break;
  }
  if (best && best.score>=0.93) {
    x.duplicate_of_listing_id=best.id;
    x.duplicate_score=best.score;
    x.duplicate_reason=best.reason;
  } else {
    x.duplicate_of_listing_id=null; x.duplicate_score=best?.score || null; x.duplicate_reason=null;
  }
  return db.prepare(`INSERT OR IGNORE INTO listings
    (raw_post_id,dedupe_key,country,city,area,property_type,bedrooms,bathrooms,price,currency,price_period,available_from,title,description,contact_phone,source_url,images_json,language,is_agent,confidence,created_at,content_fingerprint,duplicate_of_listing_id,duplicate_score,duplicate_reason)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      x.raw_post_id,x.dedupe_key,x.country,x.city,x.area,x.property_type,x.bedrooms,x.bathrooms,x.price,x.currency,x.price_period,x.available_from,x.title,x.description,x.contact_phone,x.source_url,x.images_json,x.language,x.is_agent,x.confidence,x.created_at,x.content_fingerprint,x.duplicate_of_listing_id,x.duplicate_score,x.duplicate_reason
    );
}

export function stats() {
  return {
    sources: db.prepare('SELECT COUNT(*) c FROM sources').get().c,
    rawPosts: db.prepare('SELECT COUNT(*) c FROM raw_posts').get().c,
    listings: db.prepare('SELECT COUNT(*) c FROM listings').get().c,
    uniqueListings: db.prepare('SELECT COUNT(*) c FROM listings WHERE duplicate_of_listing_id IS NULL').get().c,
    duplicatesHidden: db.prepare('SELECT COUNT(*) c FROM listings WHERE duplicate_of_listing_id IS NOT NULL').get().c,
    byCity: db.prepare(`SELECT COALESCE(city,'?') city, COUNT(*) count FROM listings WHERE duplicate_of_listing_id IS NULL GROUP BY city ORDER BY count DESC LIMIT 20`).all()
  };
}

export function listListings(filters={}) {
  const where=[]; const args=[];
  if (!filters.includeDuplicates) where.push('l.duplicate_of_listing_id IS NULL');
  if (filters.city) { where.push('l.city=?'); args.push(filters.city); }
  if (filters.area) { where.push('l.area=?'); args.push(filters.area); }
  if (filters.type) { where.push('l.property_type=?'); args.push(filters.type); }
  if (filters.currency) { where.push('l.currency=?'); args.push(filters.currency); }
  if (filters.minPrice) { where.push('l.price>=?'); args.push(Number(filters.minPrice)); }
  if (filters.maxPrice) { where.push('l.price<=?'); args.push(Number(filters.maxPrice)); }
  if (filters.q) { where.push('(l.title LIKE ? OR l.description LIKE ? OR l.area LIKE ?)'); const q=`%${filters.q}%`; args.push(q,q,q); }
  const sql=`SELECT l.*, s.name source_name, r.author, r.collected_at FROM listings l
    JOIN raw_posts r ON r.id=l.raw_post_id JOIN sources s ON s.id=r.source_id
    ${where.length?'WHERE '+where.join(' AND '):''} ORDER BY r.collected_at DESC, l.id DESC LIMIT 1000`;
  return db.prepare(sql).all(...args).map(x=>({...x,images:JSON.parse(x.images_json||'[]')}));
}

export function facets() {
  return {
    cities: db.prepare(`SELECT city value, COUNT(*) count FROM listings WHERE duplicate_of_listing_id IS NULL AND city IS NOT NULL GROUP BY city ORDER BY count DESC`).all(),
    areas: db.prepare(`SELECT area value, COUNT(*) count FROM listings WHERE duplicate_of_listing_id IS NULL AND area IS NOT NULL GROUP BY area ORDER BY count DESC`).all(),
    types: db.prepare(`SELECT property_type value, COUNT(*) count FROM listings WHERE duplicate_of_listing_id IS NULL AND property_type IS NOT NULL GROUP BY property_type ORDER BY count DESC`).all()
  };
}

export default db;
