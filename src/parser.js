import crypto from 'node:crypto';

const RENTAL_WORDS = [
  'rent','rental','for rent','available','monthly','month','lease','room','villa','house','apartment','studio','kost','kos','guesthouse','homestay',
  'sewa','disewakan','kontrakan','bulanan','kamar','rumah','vila',
  'аренд','сдаю','сдается','комнат','вилла','дом','квартир'
];
const SALE_WORDS = ['for sale','sale only','dijual','freehold','leasehold sale'];
const TYPE_RULES = [
  ['villa', /\bvilla\b|\bvila\b|вилл/iu],
  ['apartment', /\bapartment\b|\bapt\b|квартир/iu],
  ['studio', /\bstudio\b|студи/iu],
  ['guesthouse', /guest\s*house|guesthouse/iu],
  ['homestay', /home\s*stay|homestay/iu],
  ['kost', /\bkost\b|\bkos\b/iu],
  ['room', /\broom\b|\bkamar\b|комнат/iu],
  ['house', /\bhouse\b|\brumah\b|\bhome\b|\bдом\b/iu]
];
const AREAS_BALI = ['Canggu','Berawa','Pererenan','Umalas','Seminyak','Kerobokan','Kuta','Legian','Sanur','Ubud','Penestanan','Sayan','Nusa Dua','Jimbaran','Uluwatu','Ungasan','Bingin','Pecatu','Denpasar','Tabanan','Amed'];

function norm(s='') { return s.toLowerCase().replace(/\s+/g,' ').trim(); }
function firstLine(s='') { return s.split(/\n+/).map(x=>x.trim()).find(Boolean) || ''; }
function capTitle(s='') { const t=firstLine(s).replace(/^[^\p{L}\p{N}]+/u,''); return t.slice(0,110) || 'Rental listing'; }

export function looksLikeRental(text) {
  const n = norm(text);
  const hits = RENTAL_WORDS.filter(w => n.includes(w)).length;
  const sale = SALE_WORDS.some(w => n.includes(w));
  return hits >= 1 && !(sale && hits < 2);
}

function extractBedrooms(text) {
  const patterns = [/\b(\d{1,2})\s*(?:br|bed(?:room)?s?)\b/i, /\b(?:bedrooms?|br)\s*[:\-]?\s*(\d{1,2})\b/i, /(\d{1,2})\s*спал/iu];
  for (const p of patterns) { const m=text.match(p); if (m) return Number(m[1]); }
  return null;
}
function extractBathrooms(text) {
  const m = text.match(/\b(\d{1,2})\s*(?:ba|bath(?:room)?s?)\b/i) || text.match(/\b(?:bathrooms?|ba)\s*[:\-]?\s*(\d{1,2})\b/i);
  return m ? Number(m[1]) : null;
}
function extractPhone(text) {
  const matches = text.match(/(?:\+?\d[\d\s().-]{7,}\d)/g) || [];
  for (const x of matches) {
    const d = x.replace(/\D/g,'');
    if (d.length >= 9 && d.length <= 15) return (x.trim().startsWith('+')?'+':'') + d;
  }
  return null;
}
function extractArea(text, city) {
  if ((city||'').toLowerCase() !== 'bali') return null;
  const hit = AREAS_BALI.find(a => new RegExp(`\\b${a.replace(' ','\\s+')}\\b`,'i').test(text));
  return hit || null;
}
function extractType(text) { for (const [type, re] of TYPE_RULES) if (re.test(text)) return type; return null; }

function toNumber(raw) {
  const s = raw.replace(/\s/g,'').replace(/,/g,'').replace(/\.(?=\d{3}(?:\D|$))/g,'');
  const n = Number(s.replace(/[^0-9.]/g,''));
  return Number.isFinite(n) ? n : null;
}
function extractPrice(text) {
  const rules = [
    { currency:'IDR', re:/(?:rp\.?|idr)\s*([\d.,]+)\s*(jt|juta|m|million)?/ig, mult:x=>/jt|juta|m|million/i.test(x||'')?1e6:1 },
    { currency:'THB', re:/(?:฿|thb)\s*([\d.,]+)\s*(k)?/ig, mult:x=>x?1e3:1 },
    { currency:'VND', re:/(?:₫|vnd)\s*([\d.,]+)\s*(m|million|tr|triệu)?/igu, mult:x=>x?1e6:1 },
    { currency:'MYR', re:/(?:rm|myr)\s*([\d.,]+)\s*(k)?/ig, mult:x=>x?1e3:1 },
    { currency:'PHP', re:/(?:₱|php)\s*([\d.,]+)\s*(k)?/ig, mult:x=>x?1e3:1 },
    { currency:'USD', re:/(?:\$|usd)\s*([\d.,]+)\s*(k)?/ig, mult:x=>x?1e3:1 }
  ];
  for (const rule of rules) {
    const m = rule.re.exec(text);
    if (m) { const base=toNumber(m[1]); if (base) return { price: base*rule.mult(m[2]), currency: rule.currency }; }
  }
  const juta = text.match(/\b([\d.,]+)\s*(?:jt|juta)\b/i);
  if (juta) { const base=toNumber(juta[1]); if (base) return { price:base*1e6, currency:'IDR' }; }
  return { price:null, currency:null };
}
function extractPeriod(text) {
  if (/per\s*day|\/\s*day|daily|harian/i.test(text)) return 'day';
  if (/per\s*week|\/\s*week|weekly|mingguan/i.test(text)) return 'week';
  if (/per\s*year|\/\s*year|yearly|annual|tahunan/i.test(text)) return 'year';
  if (/per\s*month|\/\s*month|monthly|bulan|bulanan|\/\s*mo\b/i.test(text)) return 'month';
  return null;
}
function detectLanguage(text) {
  if (/[а-яё]/i.test(text)) return 'ru';
  if (/\b(sewa|disewakan|kamar|rumah|bulanan|juta|tersedia)\b/i.test(text)) return 'id';
  if (/\b(phòng|thuê|triệu|tháng)\b/iu.test(text)) return 'vi';
  return 'en';
}

export function dedupeKey({text, contact_phone, price, currency, area}) {
  const stable = [contact_phone || '', price || '', currency || '', area || '', norm(text).replace(/https?:\/\/\S+/g,'').slice(0,220)].join('|');
  return crypto.createHash('sha1').update(stable).digest('hex');
}

export function parseListing(raw, source={}) {
  if (!looksLikeRental(raw.text)) return null;
  const p = extractPrice(raw.text);
  const phone = extractPhone(raw.text);
  const area = extractArea(raw.text, source.city);
  const result = {
    raw_post_id: raw.id,
    country: source.country || null,
    city: source.city || null,
    area,
    property_type: extractType(raw.text),
    bedrooms: extractBedrooms(raw.text),
    bathrooms: extractBathrooms(raw.text),
    price: p.price,
    currency: p.currency,
    price_period: extractPeriod(raw.text),
    available_from: /available\s+now|ready\s+now|tersedia\s+sekarang/i.test(raw.text) ? 'now' : null,
    title: capTitle(raw.text),
    description: raw.text.trim(),
    contact_phone: phone,
    source_url: raw.source_url || null,
    images_json: raw.images_json || '[]',
    language: detectLanguage(raw.text),
    is_agent: /\bagent\b|property\s+agent|broker|agency/i.test(raw.text) ? 1 : null,
    confidence: 0,
    created_at: new Date().toISOString()
  };
  const signals = [result.price, result.property_type, result.area, result.bedrooms, result.contact_phone].filter(v=>v!==null).length;
  result.confidence = Math.min(0.98, 0.45 + signals*0.1);
  result.dedupe_key = dedupeKey({...result, text:raw.text});
  return result;
}
