import fs from 'node:fs';
import crypto from 'node:crypto';
import { chromium } from 'playwright';
import { AUTH_PATH } from '../config.js';

function absoluteFbUrl(href) {
  if (!href) return null;
  try { return new URL(href, 'https://www.facebook.com').toString(); } catch { return null; }
}
function postKey(post) {
  const fromUrl = post.source_url?.match(/(?:posts|permalink)\/(\d+)/)?.[1] || post.source_url?.match(/[?&]story_fbid=(\d+)/)?.[1];
  if (fromUrl) return fromUrl;
  return crypto.createHash('sha1').update((post.text||'') + '|' + (post.author||'')).digest('hex');
}

export async function collectFacebookGroup(source, opts={}) {
  if (!fs.existsSync(AUTH_PATH)) throw new Error(`Facebook auth state missing. Run: npm run login`);
  const maxScrolls = Number(opts.maxScrolls ?? 12);
  const headless = opts.headless !== false;
  const browser = await chromium.launch({ headless });
  const context = await browser.newContext({ storageState: AUTH_PATH, viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  await page.goto(source.url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForTimeout(2500);

  if (/login|checkpoint/i.test(page.url())) {
    await browser.close();
    throw new Error('Facebook requires login/checkpoint. Run npm run login again and complete it manually.');
  }

  const seen = new Map();
  let unchangedRounds = 0;
  for (let round=0; round<maxScrolls; round++) {
    const articles = page.locator('[role="article"]');
    const count = await articles.count();
    for (let i=0; i<count; i++) {
      const article = articles.nth(i);
      try {
        const text = (await article.innerText({ timeout: 2000 })).trim();
        if (text.length < 20) continue;
        const data = await article.evaluate(el => {
          const links = [...el.querySelectorAll('a[href]')].map(a => ({ href:a.getAttribute('href'), text:(a.textContent||'').trim(), aria:a.getAttribute('aria-label') }));
          const imgs = [...el.querySelectorAll('img[src]')].map(x => x.getAttribute('src')).filter(Boolean);
          return { links, imgs };
        });
        const permalink = data.links.map(l=>l.href).find(h => h && (/\/posts\//.test(h) || /\/permalink\//.test(h) || /story_fbid=/.test(h)));
        const source_url = absoluteFbUrl(permalink);
        const author = data.links.map(l=>l.text).find(t => t && t.length > 1 && t.length < 80) || null;
        const post = { text, source_url, author, images: [...new Set(data.imgs)].slice(0,10), published_label:null };
        seen.set(postKey(post), post);
      } catch {}
    }

    const before = seen.size;
    await page.mouse.wheel(0, 8500);
    await page.waitForTimeout(1400);
    if (seen.size === before) unchangedRounds++; else unchangedRounds = 0;
    if (unchangedRounds >= 3) break;
  }
  await browser.close();
  return [...seen.entries()].map(([source_post_key,p]) => ({...p, source_post_key}));
}
