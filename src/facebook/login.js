import fs from 'node:fs';
import readline from 'node:readline/promises';
import { chromium } from 'playwright';
import { AUTH_PATH } from '../config.js';

fs.mkdirSync(new URL('../../playwright/.auth/', import.meta.url), { recursive: true });
const browser = await chromium.launch({ headless: false });
const context = await browser.newContext();
const page = await context.newPage();
await page.goto('https://www.facebook.com/', { waitUntil: 'domcontentloaded' });

console.log('\nLog in to Facebook in the opened browser.');
console.log('When the normal Facebook home/feed is visible, return here and press Enter.');
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
await rl.question('Press Enter after login: ');
await context.storageState({ path: AUTH_PATH });
await rl.close();
await browser.close();
console.log(`Saved browser auth state to ${AUTH_PATH}`);
