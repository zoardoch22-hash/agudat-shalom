// בדיקות דף קביעת סיסמה + הפניית טוקני Identity.
// שימוש: python3 tests/serve-with-headers.py 8771 --mock-netlify &
//        BASE=http://127.0.0.1:8771/ node tests/set-password.test.mjs
import puppeteer from 'puppeteer-core';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const AXE = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
const BASE = process.env.BASE || 'http://127.0.0.1:8771/';
let fail = 0;
const ok = (name, cond, extra = '') => { if (!cond) fail++; console.log(`${cond ? '✓' : '✗'} ${name}${extra ? ' – ' + extra : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const mock = (p, body) => fetch(`${BASE}__mock/${p}`, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME || '/usr/bin/google-chrome',
  headless: 'new',
  args: ['--no-sandbox'],
});
const ctx = await browser.createBrowserContext();

async function open(url) {
  const page = await ctx.newPage();
  const errors = [];
  const posts = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('request', (r) => {
    if (r.method() === 'POST' || r.method() === 'PUT') {
      posts.push({ method: r.method(), url: r.url() });
    }
  });
  await page.setViewport({ width: 1100, height: 800 });
  await page.goto(BASE + url, { waitUntil: 'networkidle0' });
  await sleep(200);
  return { page, errors, posts };
}

async function axe(page) {
  await page.evaluate(AXE);
  return page.evaluate(async () => {
    const r = await window.axe.run(document, {
      preload: false,
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'] },
    });
    return r.violations.map((v) => `${v.id}(${v.impact}) x${v.nodes.length}: ${v.nodes.slice(0, 3).map((x) => x.target.join(' ')).join(' | ')}`);
  });
}

await mock('reset', {});

// 1) הפניה מדף ציבורי עם recovery_token
{
  const page = await ctx.newPage();
  await page.goto(BASE + 'index.html#recovery_token=valid-recovery', { waitUntil: 'networkidle0' });
  await sleep(400);
  const u = page.url();
  ok('public #recovery_token → admin/set-password.html', /admin\/set-password\.html/.test(u) && /recovery_token=valid-recovery/.test(u), u);
  await page.close();
}

// 2) הפניה מ-times / donate
{
  const page = await ctx.newPage();
  await page.goto(BASE + 'times.html#invite_token=valid-invite', { waitUntil: 'networkidle0' });
  await sleep(400);
  ok('times #invite_token → set-password', /set-password\.html/.test(page.url()) && /invite_token=/.test(page.url()), page.url());
  await page.close();
}

// 3) חגורת בטיחות: /admin/#recovery_token → set-password
{
  const page = await ctx.newPage();
  await page.goto(BASE + 'admin/#recovery_token=valid-recovery', { waitUntil: 'networkidle0' });
  await sleep(400);
  ok('admin/#recovery_token → set-password.html', /set-password\.html/.test(page.url()), page.url());
  await page.close();
}

// 4) טופס: אי-התאמה + אורך קצר
{
  const { page, errors } = await open('admin/set-password.html#recovery_token=valid-recovery');
  ok('form visible with Hebrew title', await page.$eval('#sp-title', (e) => /קביעת סיסמה/.test(e.textContent)));
  ok('password fields labeled', await page.evaluate(() => {
    const l1 = document.querySelector('label[for="sp-pass"]');
    const l2 = document.querySelector('label[for="sp-pass2"]');
    return l1 && /סיסמה חדשה/.test(l1.textContent) && l2 && /אימות סיסמה/.test(l2.textContent);
  }));
  const ax0 = await axe(page);
  ok('axe: set-password form', ax0.length === 0, ax0.join('; '));

  await page.type('#sp-pass', 'short');
  await page.type('#sp-pass2', 'short');
  await page.click('#sp-submit');
  await sleep(100);
  ok('short password → Hebrew min-length error', /8 תווים/.test(await page.$eval('#sp-msg', (e) => e.textContent)));

  await page.$eval('#sp-pass', (e) => { e.value = ''; });
  await page.$eval('#sp-pass2', (e) => { e.value = ''; });
  await page.type('#sp-pass', 'goodpass1');
  await page.type('#sp-pass2', 'goodpass2');
  await page.click('#sp-submit');
  await sleep(100);
  ok('mismatch → Hebrew error', /אינן תואמות/.test(await page.$eval('#sp-msg', (e) => e.textContent)));
  const realErrs = errors.filter((e) => !/frame-ancestors.*meta/i.test(e));
  ok('console clean on validation', realErrs.length === 0, realErrs.join('; '));
  await page.close();
}

// 5) שליחה תקינה → verify + session
{
  await mock('reset', {});
  const { page, posts } = await open('admin/set-password.html#recovery_token=valid-recovery');
  await page.type('#sp-pass', 'new-pass-456');
  await page.type('#sp-pass2', 'new-pass-456');

  const verifyBodies = [];
  page.on('request', async (r) => {
    if (r.url().includes('/.netlify/identity/verify') && r.method() === 'POST') {
      try { verifyBodies.push(r.postData()); } catch { /* ignore */ }
    }
  });

  await page.click('#sp-submit');
  await page.waitForSelector('#sp-success:not([hidden])', { timeout: 5000 });
  ok('success panel shown (הסיסמה נשמרה)', await page.$eval('#sp-success h1', (e) => e.textContent.trim() === 'הסיסמה נשמרה'));

  // request interception via posts array – verify was POSTed
  const verifyPost = posts.find((p) => p.url.includes('/.netlify/identity/verify') && p.method === 'POST');
  ok('POST /.netlify/identity/verify called', !!verifyPost, posts.map((p) => p.method + ' ' + p.url).join('; '));

  // בדיקת גוף הבקשה דרך evaluate של מה שנשלח – נאסוף מחדש עם CDP
  const bodyCheck = await page.evaluate(async () => {
    // כבר נשלח; נבדוק שה-session נשמר
    const s = JSON.parse(localStorage.getItem('gotrue.user') || 'null');
    return s && s.email === 'admin@example.test' && !!s.token?.access_token && !!s.token?.refresh_token && s.token.expires_at > Date.now();
  });
  ok('gotrue.user session stored (shared with admin/edit)', bodyCheck);

  // hash cleared
  ok('hash cleared after success', !/#/.test(page.url()) || !/recovery_token/.test(page.url()), page.url());

  const ax1 = await axe(page);
  ok('axe: success state', ax1.length === 0, ax1.join('; '));
  await page.close();
}

// 5b) גוף verify כולל type+token+password
{
  await mock('reset', {});
  const page = await ctx.newPage();
  let verifyBody = null;
  await page.setRequestInterception(true);
  page.on('request', (r) => {
    if (r.url().includes('/.netlify/identity/verify') && r.method() === 'POST') {
      verifyBody = r.postData();
    }
    r.continue();
  });
  await page.goto(BASE + 'admin/set-password.html#recovery_token=valid-recovery', { waitUntil: 'networkidle0' });
  await page.type('#sp-pass', 'new-pass-789');
  await page.type('#sp-pass2', 'new-pass-789');
  await page.click('#sp-submit');
  await page.waitForSelector('#sp-success:not([hidden])', { timeout: 5000 });
  let parsed = null;
  try { parsed = JSON.parse(verifyBody || 'null'); } catch { /* ignore */ }
  ok('verify body: type recovery + token + password', parsed && parsed.type === 'recovery' && parsed.token === 'valid-recovery' && parsed.password === 'new-pass-789', JSON.stringify(parsed));
  await page.close();
}

// 6) טוקן שפג תוקף → הודעת שגיאה בעברית
{
  await mock('reset', {});
  const { page } = await open('admin/set-password.html#recovery_token=expired-token');
  await page.type('#sp-pass', 'new-pass-456');
  await page.type('#sp-pass2', 'new-pass-456');
  await page.click('#sp-submit');
  await page.waitForSelector('#sp-missing:not([hidden])', { timeout: 5000 });
  const text = await page.evaluate(() => document.getElementById('sp-missing').textContent);
  const hasLogin = await page.$('#sp-missing a[href="./"]');
  ok('expired token → Hebrew error + login link', /פג תוקף|נוצל|אינו תקף/.test(text) && !!hasLogin, text.slice(0, 160));
  await page.close();
}

// 7) invite_token שולח type signup (GoTrue acceptInvite)
{
  await mock('reset', {});
  const page = await ctx.newPage();
  let verifyBody = null;
  await page.setRequestInterception(true);
  page.on('request', (r) => {
    if (r.url().includes('/.netlify/identity/verify') && r.method() === 'POST') verifyBody = r.postData();
    r.continue();
  });
  await page.goto(BASE + 'admin/set-password.html#invite_token=valid-invite', { waitUntil: 'networkidle0' });
  ok('invite title Hebrew', /הזמנה/.test(await page.$eval('#sp-title', (e) => e.textContent)));
  await page.type('#sp-pass', 'invite-pass1');
  await page.type('#sp-pass2', 'invite-pass1');
  await page.click('#sp-submit');
  await page.waitForSelector('#sp-success:not([hidden])', { timeout: 5000 });
  const parsed = JSON.parse(verifyBody || 'null');
  ok('invite → verify type signup (GoTrue)', parsed && parsed.type === 'signup' && parsed.token === 'valid-invite' && parsed.password === 'invite-pass1', JSON.stringify(parsed));
  await page.close();
}

await ctx.close();
await browser.close();
console.log(fail ? `\n${fail} FAILED` : '\nALL PASSED');
process.exit(fail ? 1 : 0);
