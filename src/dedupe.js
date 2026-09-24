import crypto from 'node:crypto';

const STOP = new Set(['for','rent','rental','available','now','the','and','with','from','per','month','monthly','villa','house','room','apartment','studio','in','at','to','of','a','an','is','this','that','bali']);

export function normalizeListingText(s='') {
  return s.toLowerCase()
    .replace(/https?:\/\/\S+/g,' ')
    .replace(/(?:\+?\d[\d\s().-]{7,}\d)/g,' PHONE ')
    .replace(/\b(?:rp\.?|idr|thb|vnd|myr|php|usd|฿|₫|₱|\$)\s*[\d.,]+\s*(?:jt|juta|k|m|million|tr|triệu)?/giu,' PRICE ')
    .replace(/[^\p{L}\p{N}]+/gu,' ')
    .replace(/\s+/g,' ')
    .trim();
}

export function tokenSet(s='') {
  return new Set(normalizeListingText(s).split(' ').filter(x => x.length > 2 && !STOP.has(x)));
}

export function jaccard(a,b) {
  if (!a.size || !b.size) return 0;
  let inter=0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

export function contentFingerprint(text='') {
  return crypto.createHash('sha1').update(normalizeListingText(text)).digest('hex');
}

function closePrice(a,b) {
  if (!a || !b) return false;
  const d=Math.abs(a-b)/Math.max(a,b);
  return d <= 0.03;
}

export function duplicateScore(a,b) {
  if (a.source_url && b.source_url && canonicalUrl(a.source_url) === canonicalUrl(b.source_url)) return {score:1, reason:'same_url'};
  if (a.content_fingerprint && b.content_fingerprint && a.content_fingerprint===b.content_fingerprint) return {score:1, reason:'same_text'};

  const samePhone = !!(a.contact_phone && b.contact_phone && digits(a.contact_phone)===digits(b.contact_phone));
  const priceMatch = closePrice(Number(a.price),Number(b.price)) && (!a.currency || !b.currency || a.currency===b.currency);
  const areaMatch = !a.area || !b.area || String(a.area).toLowerCase()===String(b.area).toLowerCase();
  const typeMatch = !a.property_type || !b.property_type || a.property_type===b.property_type;
  const bedsMatch = a.bedrooms==null || b.bedrooms==null || Number(a.bedrooms)===Number(b.bedrooms);
  const textSim = jaccard(tokenSet(a.description||''), tokenSet(b.description||''));

  if (samePhone && priceMatch && areaMatch) return {score:0.99, reason:'phone_price_area'};
  if (samePhone && textSim >= 0.42) return {score:0.97, reason:'phone_text'};
  if (priceMatch && areaMatch && typeMatch && bedsMatch && textSim >= 0.58) return {score:0.94, reason:'property_text'};
  if (textSim >= 0.82 && areaMatch) return {score:0.93, reason:'very_similar_text'};
  return {score:textSim, reason:'similarity'};
}

export function isDuplicate(a,b) { return duplicateScore(a,b).score >= 0.93; }

function digits(s=''){ return String(s).replace(/\D/g,''); }
export function canonicalUrl(s='') {
  try {
    const u=new URL(s);
    ['__cft__','__tn__','mibextid','ref','refid','comment_id'].forEach(k=>u.searchParams.delete(k));
    u.hash='';
    return u.toString().replace(/\/$/,'');
  } catch { return s; }
}
