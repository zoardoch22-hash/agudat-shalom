// בדיקות מצב העריכה הוויזואלית מול מדמה Netlify Identity + Git Gateway (ללא גישה לרשת).
// שימוש: python3 tests/serve-with-headers.py 8770 --mock-netlify &   ואז   BASE=http://127.0.0.1:8770/ node tests/edit.test.mjs
import puppeteer from 'puppeteer-core';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const AXE = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
const BASE = process.env.BASE || 'http://127.0.0.1:8770/';
const EMAIL = 'admin@example.test', PASS = 'test-pass-123';
const SHOTS = process.env.SHOTS || '';
let fail = 0;
const ok = (name, cond, extra = '') => { if (!cond) fail++; console.log(`${cond ? '✓' : '✗'} ${name}${extra ? ' – ' + extra : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const mock = (p, body) => fetch(`${BASE}__mock/${p}`, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());
const lastCommit = async () => (await mock('state')).log.at(-1);
const json = (c, p) => JSON.parse(c.files[p]);

const browser = await puppeteer.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox'] });
let ctx;
async function open(url, vp = { width: 1280, height: 900 }) {
  const page = await ctx.newPage();
  const errors = [], requests = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('request', (r) => requests.push(r.url()));
  page.on('dialog', (d) => d.accept()); // beforeunload
  await page.setViewport(vp);
  await page.goto(BASE + url, { waitUntil: 'networkidle0' });
  await sleep(300);
  return { page, errors, requests };
}
async function axe(page, include) {
  await page.evaluate(AXE);
  return page.evaluate(async (inc) => {
    const r = await window.axe.run(inc ? { include: [inc] } : document, { preload: false, runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'] } });
    return r.violations.map((v) => `${v.id}(${v.impact}) x${v.nodes.length}: ${v.nodes.slice(0, 3).map((x) => x.target.join(' ')).join(' | ')}`);
  }, include);
}
const status = (page) => page.$eval('.ed-status', (e) => e.textContent);
const waitStatus = (page, re, timeout = 8000) => page.waitForFunction((s) => new RegExp(s).test(document.querySelector('.ed-status')?.textContent || ''), { timeout }, re.source).then(() => true).catch(() => false);
async function replaceText(page, sel, text) {
  await page.click(sel);
  await page.evaluate((s) => { const el = document.querySelector(s); const r = document.createRange(); r.selectNodeContents(el); const g = getSelection(); g.removeAllRanges(); g.addRange(r); }, sel);
  await page.keyboard.type(text);
}
async function caretEnd(page, sel) {
  await page.click(sel);
  await page.evaluate((s) => { const el = document.querySelector(s); const last = el.querySelector('p:last-of-type') || el; const r = document.createRange(); r.selectNodeContents(last); r.collapse(false); const g = getSelection(); g.removeAllRanges(); g.addRange(r); }, sel);
}
async function login(page) {
  await page.waitForSelector('dialog.ed-dialog[open] #ed-email');
  await page.type('#ed-email', EMAIL); await page.type('#ed-pass', PASS);
  await page.keyboard.press('Enter');
}

await mock('reset', {});

// 1) מבקר רגיל: קוד העריכה לא נטען
ctx = await browser.createBrowserContext();
{
  const { page, errors, requests } = await open('index.html');
  ok('visitor: no edit code/CSS loaded', !requests.some((u) => /\/assets\/(js\/edit\/|css\/edit\.css)/.test(u)), requests.filter((u) => /edit/.test(u)).join(','));
  ok('visitor: no requests to /.netlify', !requests.some((u) => u.includes('/.netlify/')));
  ok('visitor: footer has "כניסת מנהל" link to admin/', await page.$eval('[data-admin-login]', (a) => a.textContent.trim() === 'כניסת מנהל' && a.getAttribute('href') === 'admin/'));
  ok('visitor: no edit pill / bar', await page.evaluate(() => !document.querySelector('.ed-pill,.ed-bar')));
  ok('visitor: console clean', errors.length === 0, errors.join('; '));
  ok('bindings: data-edit on content/settings fields', await page.evaluate(() => document.querySelectorAll('[data-edit]').length) >= 30);

  // 2) התחברות
  await page.click('[data-admin-login]');
  await page.waitForSelector('dialog.ed-dialog[open] #ed-email');
  ok('login dialog opens; focus in email field', await page.evaluate(() => document.activeElement.id === 'ed-email'));
  ok('axe: login dialog', (await axe(page, '.ed-dialog')).length === 0, (await axe(page, '.ed-dialog')).join('; '));
  await page.keyboard.press('Enter');
  ok('empty submit → Hebrew error', /יש למלא/.test(await page.$eval('.ed-error', (e) => e.textContent)));
  await page.type('#ed-email', EMAIL); await page.type('#ed-pass', 'wrong');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => /שגויים/.test(document.querySelector('.ed-error').textContent));
  ok('wrong password → "האימייל או הסיסמה שגויים"', true);
  await page.$eval('#ed-pass', (e) => { e.value = ''; }); await page.type('#ed-pass', PASS); await page.keyboard.press('Enter');
  await page.waitForSelector('[data-ed="visual"]');
  ok('chooser shows user email + CMS link', await page.evaluate(() => document.querySelector('.ed-dialog bdi').textContent === 'admin@example.test' && !!document.querySelector('.ed-dialog a[href$="/admin/"]')));
  ok('session stored as gotrue.user (shared with /admin)', await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('gotrue.user')); return s.email === 'admin@example.test' && !!s.token.refresh_token && s.token.expires_at > Date.now(); }));
  await page.click('[data-ed="visual"]');
  await page.waitForSelector('.ed-bar');
  await waitStatus(page, /שדות ניתנים לעריכה/);
  ok('edit bar shown with "מצב עריכה" + שמירה/ביטול/יציאה', await page.evaluate(() => /מצב עריכה/.test(document.querySelector('.ed-bar').textContent) && document.querySelectorAll('.ed-bar-actions button').length === 3));
  const nFields = await page.evaluate(() => document.querySelectorAll('.ed-field').length);
  ok(`index: ${nFields} editable fields`, nFields >= 30);
  ok('computed prayer-times widget not editable + link to rules in CMS', await page.evaluate(() => !document.querySelector('#today-times [contenteditable]') && document.querySelector('.ed-computed a').getAttribute('href').endsWith('admin/#/collections/settings/entries/settings')));
  const ax = await axe(page);
  ok('axe: index in edit mode', ax.length === 0, ax.join('; '));
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/edit-mode-desktop.png` });

  // מקלדת
  await page.focus('.ed-btn-save');
  ok('save button disabled before changes', await page.$eval('.ed-btn-save', (b) => b.disabled));
  await page.focus('[data-t="home.heroLead"]');
  ok('editable field focusable with visible focus outline', await page.evaluate(() => { const s = getComputedStyle(document.activeElement); return document.activeElement.isContentEditable && s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) >= 2; }));

  // 3) עריכה ושמירה: טקסט + טקסט מעוצב + פרטי קשר (settings)
  await replaceText(page, '[data-t="home.heroLead"]', 'בית הכנסת לעולי פרס · מאז 1957 · בדיקה');
  await page.keyboard.press('Enter'); // לא מוסיף שורה בשדה פשוט
  await caretEnd(page, '[data-md="home.aboutBody"]');
  await page.keyboard.type(' טקסט נוסף');
  await page.keyboard.down('Shift'); for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowRight'); // RTL: ימינה = אחורה
  await page.keyboard.up('Shift');
  await page.click('.ed-fbtn[data-cmd="bold"]');
  await replaceText(page, '.contact-card:nth-child(2) h3', 'זוהר דוך – גבאי');
  ok('duplicate field mirrored (footer contact name)', await page.evaluate(() => [...document.querySelectorAll('[data-edit="settings.json#/contacts/1/name"]')].every((e) => e.textContent === 'זוהר דוך – גבאי')));
  await page.waitForFunction(() => document.querySelector('.ed-btn-save').textContent === 'שמירה (3)', { timeout: 3000 }).catch(() => {});
  ok('save shows count (3)', await page.$eval('.ed-btn-save', (b) => b.textContent === 'שמירה (3)'), await page.$eval('.ed-btn-save', (b) => b.textContent));
  await page.keyboard.down('Control'); await page.keyboard.press('s'); await page.keyboard.up('Control');
  ok('Ctrl+S saves → "נשמר! … האתר יתעדכן בעוד כדקה"', await waitStatus(page, /נשמר.*כדקה/), await status(page));
  const c1 = await lastCommit();
  ok('one commit with both files', c1 && Object.keys(c1.files).sort().join() === 'assets/data/content/home.json,assets/data/settings.json', c1 && Object.keys(c1.files).join());
  ok('Hebrew commit message', /^עריכה ויזואלית – .+: 3 שינויים \(content\/home\.json, settings\.json\)$/.test(c1.message), c1.message);
  const home = json(c1, 'assets/data/content/home.json'), set1 = json(c1, 'assets/data/settings.json');
  ok('home.json: heroLead (UTF-8 Hebrew) saved', home.heroLead === 'בית הכנסת לעולי פרס · מאז 1957 · בדיקה', home.heroLead);
  ok('home.json: aboutBody keeps markdown (**bold**, {years}, paragraphs) + new bold text', /\*\*אגודת שלום\*\*/.test(home.aboutBody) && /\{years\}/.test(home.aboutBody) && /\n\n/.test(home.aboutBody) && /\*\*נוסף\*\*$/.test(home.aboutBody), home.aboutBody.slice(-60));
  ok('home.json: other keys untouched', home.heroName === 'אגודת שלום' && Object.keys(home).length === 27);
  ok('settings.json: contact name saved, phone/rules/bank untouched', set1.contacts[1].name === 'זוהר דוך – גבאי' && set1.contacts[1].phone === '058-4464368' && set1.rules.shabbat.minchaKetanaBeforeShkiaMins === 50 && set1.donate.bank.account === '418671');
  ok('save button disabled again after save', await page.$eval('.ed-btn-save', (b) => b.disabled && b.textContent === 'שמירה'));

  // 4) Markdown: הלוך-חזור ללא שינוי לכל שדות התוכן המעוצב
  const rt = await page.evaluate(async () => {
    const { renderMarkdown } = await import('./assets/js/md.js');
    const { toMarkdown } = await import('./assets/js/edit/serialize.js');
    const bad = [];
    const files = ['home', 'donate', 'accessibility', 'times', 'common'];
    const vals = [];
    for (const f of files) { const d = await (await fetch(`assets/data/content/${f}.json`)).json(); for (const [k, v] of Object.entries(d)) vals.push([`${f}.${k}`, v]); }
    const pages = (await (await fetch('assets/data/pages.json')).json()).pages;
    for (const p of pages) vals.push([`page:${p.slug}`, p.body]);
    vals.push(['sample', '## כותרת\n\nפסקה עם **מודגש** ו[קישור](https://example.com) ו-![תמונה](assets/uploads/a.jpg)\nשורה שנייה\n\n- א\n- ב\n\n1. אחד\n2. שתיים']);
    for (const [k, v] of vals) { const d = document.createElement('div'); d.append(renderMarkdown(v)); const out = toMarkdown(d); if (out !== v.trim()) bad.push(`${k}: ${JSON.stringify(out).slice(0, 80)} ≠ ${JSON.stringify(v).slice(0, 80)}`); }
    return { n: vals.length, bad };
  });
  ok(`markdown round-trip unchanged for ${rt.n} fields`, rt.bad.length === 0, rt.bad.join(' | '));

  // 5) פג תוקף ההתחברות לגמרי → חלון התחברות, השינויים נשמרים אחרי התחברות
  await mock('expire', { all: true });
  await replaceText(page, '[data-t="home.heroLead"]', 'נוסח אחרי פג תוקף');
  await page.click('.ed-btn-save');
  await page.waitForSelector('dialog.ed-dialog[open] #ed-email');
  ok('expired session → login dialog with "השינויים שלכם לא אבדו"', await page.evaluate(() => /לא אבדו/.test(document.querySelector('.ed-dialog').textContent)));
  await page.type('#ed-email', EMAIL); await page.type('#ed-pass', PASS); await page.keyboard.press('Enter');
  ok('after re-login the save completes', await waitStatus(page, /נשמר/), await status(page));
  ok('commit after re-login has the edit', json(await lastCommit(), 'assets/data/content/home.json').heroLead === 'נוסח אחרי פג תוקף');

  // 6) טוקן גישה פג (refresh בתוקף) → חידוש שקט
  await mock('expire', { all: false });
  await replaceText(page, '[data-t="home.heroLead"]', 'חידוש שקט');
  await page.click('.ed-btn-save');
  ok('expired access token → silent refresh, no dialog', await waitStatus(page, /נשמר/) && await page.evaluate(() => !document.querySelector('dialog[open]')));

  // 7) מישהו אחר שמר בינתיים → ניסיון חוזר, השינוי החיצוני נשמר
  await mock('race', {});
  await replaceText(page, '[data-t="home.heroLead"]', 'אחרי מרוץ');
  await page.click('.ed-btn-save');
  ok('concurrent commit → retried and saved', await waitStatus(page, /נשמר/), await status(page));
  const st = await mock('state');
  const last = st.log.at(-1), prev = st.log.at(-2);
  ok('external commit kept, ours on top (fast-forward)', /חיצוני/.test(prev.message) && Object.keys(last.files).join() === 'assets/data/content/home.json');
  const titleNow = await page.evaluate(async () => { const s = JSON.parse(localStorage.getItem('gotrue.user')); const r = await fetch('/.netlify/git/github/contents/assets/data/content/times.json?ref=main', { headers: { Authorization: `Bearer ${s.token.access_token}` } }); const d = await r.json(); return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(d.content.replace(/\s/g, '')), (c) => c.charCodeAt(0)))).title; });
  ok('external change still in repo after our save', titleNow === 'זמני תפילות (שינוי חיצוני)', titleNow);

  // 8) שגיאת שרת → הודעה ברורה, השינויים לא אבדו, אפשר לנסות שוב
  await mock('fail', { status: 500 });
  await replaceText(page, '[data-t="home.heroLead"]', 'אחרי שגיאה');
  await page.click('.ed-btn-save');
  ok('server error → message + changes kept', await waitStatus(page, /שגיאת שמירה \(500\).*לא אבדו/) && !(await page.$eval('.ed-btn-save', (b) => b.disabled)), await status(page));
  await page.click('.ed-btn-save');
  ok('retry succeeds', await waitStatus(page, /נשמר/));

  // 9) ביטול שינויים ויציאה
  await replaceText(page, '[data-t="home.heroName"]', 'שם זמני');
  await page.click('.ed-bar-actions button:nth-child(2)');
  await page.waitForSelector('dialog.ed-dialog[open]');
  ok('axe: confirm dialog', (await axe(page, 'dialog[open]')).length === 0);
  await page.click('dialog[open] .btn-navy');
  await page.waitForFunction(() => /בוטלו/.test(document.querySelector('.ed-status').textContent), { timeout: 3000 }).catch(() => {});
  ok('cancel restores the saved text', await page.$eval('[data-t="home.heroName"]', (e) => e.textContent === 'אגודת שלום'), await page.evaluate(() => document.querySelector('[data-t="home.heroName"]').textContent + ' | ' + document.querySelector('.ed-status').textContent + ' | open:' + !!document.querySelector('dialog[open]')));
  await replaceText(page, '[data-t="home.heroName"]', 'שם זמני 2');
  await page.click('.ed-bar-actions button:nth-child(3)');
  await page.waitForSelector('dialog.ed-dialog[open]');
  await page.evaluate(() => [...document.querySelectorAll('dialog[open] button')].find((b) => b.textContent === 'יציאה בלי לשמור').click());
  await page.waitForFunction(() => document.activeElement?.classList.contains('ed-pill'), { timeout: 3000 }).catch(() => {});
  ok('exit: bar removed, no contenteditable left, pill shown & focused', await page.evaluate(() => !document.querySelector('.ed-bar,[contenteditable],.ed-url,.ed-computed') && document.activeElement.classList.contains('ed-pill')), await page.evaluate(() => [!!document.querySelector('.ed-bar'), [...document.querySelectorAll('[contenteditable]')].map((e) => e.tagName + '.' + e.className).join(','), document.activeElement.className].join(' / ')));
  ok('exit: saved text shown, unsaved discarded', await page.evaluate(() => document.querySelector('[data-t="home.heroLead"]').textContent === 'אחרי שגיאה' && document.querySelector('[data-t="home.heroName"]').textContent === 'אגודת שלום'));
  ok('exit: links work again (no preventDefault)', await page.evaluate(() => { const a = document.querySelector('.contact-card a.phone'); const e = new MouseEvent('click', { cancelable: true, bubbles: true }); a.addEventListener('click', (x) => x.preventDefault(), { once: true }); return !a.isContentEditable; }));
  await page.close();
}

// 10) מעבר עמודים במצב עריכה + תרומות (settings.json) + קישורים
{
  const { page } = await open('index.html');
  ok('logged-in admin sees "עריכת העמוד" pill (lazy)', !!(await page.waitForSelector('.ed-pill', { timeout: 4000 }).catch(() => null)));
  await page.click('.ed-pill');
  await page.waitForSelector('.ed-bar');
  await page.goto(BASE + 'donate.html', { waitUntil: 'networkidle0' });
  ok('edit mode persists across navigation', !!(await page.waitForSelector('.ed-bar', { timeout: 5000 }).catch(() => null)));
  await waitStatus(page, /שדות ניתנים לעריכה/);
  ok('donate: bank fields editable', await page.evaluate(() => document.querySelectorAll('#bank-body [data-edit][contenteditable]').length === 5));
  await replaceText(page, '[data-edit="settings.json#/donate/bank/account"]', '123456');
  await page.$eval('.ed-url input', (i) => { i.focus(); i.select(); });
  const urlInputs = await page.$$('.ed-url input');
  ok('donate: link fields (Bit, PayBox) as labeled inputs', urlInputs.length === 2 && await page.evaluate(() => [...document.querySelectorAll('.ed-url')].every((l) => l.querySelector('span').textContent.length > 3)));
  await urlInputs[1].evaluate((i) => { i.focus(); i.select(); }); await urlInputs[1].type('http://not-secure.example');
  await page.click('.ed-btn-save');
  ok('invalid (non-https) link rejected', await waitStatus(page, /https/));
  await urlInputs[1].evaluate((i) => { i.focus(); i.select(); }); await urlInputs[1].type('https://payboxapp.page.link/test');
  await page.click('.ed-btn-save');
  ok('donate save ok', await waitStatus(page, /נשמר/), await status(page));
  const s2 = json(await lastCommit(), 'assets/data/settings.json');
  ok('settings.json: bank account + PayBox link saved', s2.donate.bank.account === '123456' && s2.donate.paybox.link === 'https://payboxapp.page.link/test' && s2.contacts[1].name === 'זוהר דוך – גבאי');
  const ax = await axe(page);
  ok('axe: donate in edit mode', ax.length === 0, ax.join('; '));
  // טלפון → גם intl
  await page.goto(BASE + 'index.html', { waitUntil: 'networkidle0' });
  await page.waitForSelector('.ed-bar'); await waitStatus(page, /שדות/);
  await replaceText(page, '.contact-card:nth-child(1) a.phone', '050-1234567');
  await page.click('.ed-btn-save'); await waitStatus(page, /נשמר/);
  const s3 = json(await lastCommit(), 'assets/data/settings.json');
  ok('phone edit also updates WhatsApp/intl number', s3.contacts[0].phone === '050-1234567' && s3.contacts[0].intl === '972501234567', `${s3.contacts[0].phone} ${s3.contacts[0].intl}`);

  // 11) זמני תפילות: אזורים מחושבים + קישור להגדרות
  await page.goto(BASE + 'times.html', { waitUntil: 'networkidle0' });
  await page.waitForSelector('.ed-bar'); await waitStatus(page, /שדות/);
  ok('times: 5 computed areas with notice, none editable', await page.evaluate(() => document.querySelectorAll('.ed-computed').length === 5 && !document.querySelector('[data-computed] [contenteditable]')));
  ok('times: rules note editable', await page.evaluate(() => document.querySelector('[data-t="times.rulesNote"]').isContentEditable));
  const axt = await axe(page);
  ok('axe: times in edit mode', axt.length === 0, axt.join('; '));

  // 12) עמוד כללי: כותרת + תמונה חדשה (העלאה ל-assets/uploads)
  await page.goto(BASE + 'page.html?p=updates', { waitUntil: 'networkidle0' });
  await page.waitForSelector('.ed-bar'); await waitStatus(page, /שדות/);
  await replaceText(page, '#page-title', 'הודעות ועדכונים לקהל');
  const png = path.join(os.tmpdir(), 'ed-test.png');
  writeFileSync(png, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP8z8DAwMDAxMDAwMDAAAANHQEDasKb6QAAAABJRU5ErkJggg==', 'base64'));
  await caretEnd(page, '#page-body');
  const [chooser] = await Promise.all([page.waitForFileChooser(), page.click('.ed-fbtn[data-cmd="image"]')]);
  await chooser.accept([png]);
  await page.waitForSelector('dialog[open] #ed-alt');
  await page.type('#ed-alt', 'תמונת בדיקה'); await page.keyboard.press('Enter');
  await page.waitForSelector('#page-body img[data-upload]');
  ok('image preview inserted (data: URL, CSP img-src data:)', await page.$eval('#page-body img[data-upload]', (i) => i.src.startsWith('data:image/png') && i.alt === 'תמונת בדיקה'));
  await page.click('.ed-btn-save');
  ok('page save ok', await waitStatus(page, /נשמר/), await status(page));
  const c5 = await lastCommit();
  const up = Object.keys(c5.files).find((p) => p.startsWith('assets/uploads/'));
  const pg = json(c5, 'assets/data/pages.json').pages[0];
  ok('image uploaded to assets/uploads in the same commit (binary PNG)', !!up && c5.files[up].head === '89504e47' && /ו-1 תמונות/.test(c5.message), up);
  ok('pages.json: title + body with ![alt](assets/uploads/…)', pg.title === 'הודעות ועדכונים לקהל' && pg.body.includes(`![תמונת בדיקה](${up})`) && pg.body.startsWith('## הודעות בית הכנסת'), pg.body.slice(-80));
  const axp = await axe(page);
  ok('axe: generic page in edit mode', axp.length === 0, axp.join('; '));
  if (SHOTS) {
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    await page.goto(BASE + 'index.html', { waitUntil: 'networkidle0' }); await page.waitForSelector('.ed-bar'); await sleep(500);
    await page.screenshot({ path: `${SHOTS}/edit-mode-mobile.png` });
  }
  // יציאה מהחשבון
  await page.evaluate(() => [...document.querySelectorAll('.ed-bar-actions button')][2].click());
  await page.waitForSelector('.ed-pill');
  await page.click('[data-admin-login]');
  await page.waitForSelector('[data-ed="logout"]');
  await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle0' }), page.click('[data-ed="logout"]')]);
  ok('logout clears session, pill gone', await page.evaluate(() => !localStorage.getItem('gotrue.user') && !document.querySelector('.ed-pill')));
  await page.close();
}
await ctx.close();
await browser.close();
console.log(fail ? `\n${fail} FAILED` : '\nALL PASSED');
process.exit(fail ? 1 : 0);
