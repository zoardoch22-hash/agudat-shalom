// קוד משותף לכל העמודים: תפריט, פרטי קשר מתוך ההגדרות, העתקה ללוח.
import { loadConfig, isPlaceholder } from './config.js';
import { renderMarkdown } from './md.js';
import { initA11y } from './a11y.js';

/** יצירת אלמנט בטוחה (textContent בלבד – ללא innerHTML לתוכן מההגדרות) */
export function el(tag, attrs = {}, ...children) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'text') n.textContent = v;
    else n.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c != null) n.append(c.nodeType ? c : document.createTextNode(String(c)));
  return n;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
const ICONS = {
  phone: 'M6.6 10.8a15.1 15.1 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1-.25 11.4 11.4 0 0 0 3.6.57 1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.45.57 3.57a1 1 0 0 1-.25 1z',
  wa: 'M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm0 18.2a8.2 8.2 0 0 1-4.2-1.15l-.3-.18-3 .78.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2zm4.5-6.1c-.25-.12-1.46-.72-1.69-.8-.23-.08-.39-.12-.56.12-.16.25-.64.8-.79.97-.14.16-.29.18-.54.06a6.7 6.7 0 0 1-3.32-2.9c-.25-.43.25-.4.72-1.33.08-.16.04-.3-.02-.43-.06-.12-.56-1.34-.76-1.84-.2-.48-.4-.41-.56-.42h-.48a.92.92 0 0 0-.66.31 2.8 2.8 0 0 0-.87 2.07 4.85 4.85 0 0 0 1.02 2.58 11.1 11.1 0 0 0 4.25 3.75c1.58.68 2.2.74 2.99.62.48-.07 1.46-.6 1.67-1.18.2-.58.2-1.08.14-1.18-.06-.1-.22-.16-.47-.29z',
  copy: 'M16 1H4a2 2 0 0 0-2 2v14h2V3h12V1zm3 4H8a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2zm0 16H8V7h11v14z',
  check: 'M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z',
  pin: 'M12 2a7 7 0 0 0-7 7c0 5.25 7 13 7 13s7-7.75 7-13a7 7 0 0 0-7-7zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5z',
};
export function icon(name) {
  const s = document.createElementNS(SVG_NS, 'svg');
  s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('aria-hidden', 'true'); s.setAttribute('fill', 'currentColor');
  const p = document.createElementNS(SVG_NS, 'path'); p.setAttribute('d', ICONS[name]); s.append(p);
  return s;
}

/* ---------- הודעה קופצת והעתקה ---------- */
let toastEl, toastTimer;
export function toast(msg) {
  if (!toastEl) { toastEl = el('div', { class: 'toast', role: 'status', 'aria-live': 'polite' }); document.body.append(toastEl); }
  toastEl.textContent = msg; toastEl.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2200);
}
export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch {
    const ta = el('textarea', { readonly: true, class: 'sr-copy' }); ta.value = text;
    ta.setAttribute('aria-hidden', 'true'); document.body.append(ta); ta.select();
    let ok = false; try { ok = document.execCommand('copy'); } catch { /* ignore */ }
    ta.remove(); return ok;
  }
}
export function copyButton(value, label = 'העתקה') {
  const b = el('button', { type: 'button', class: 'copy-btn', 'aria-label': `העתקת ${value}` }, icon('copy'), el('span', { text: label }));
  b.addEventListener('click', async () => {
    const ok = await copyText(value);
    toast(ok ? `הועתק: ${value}` : 'לא ניתן להעתיק – נא להעתיק ידנית');
    if (ok) { b.classList.add('done'); b.lastChild.textContent = 'הועתק'; setTimeout(() => { b.classList.remove('done'); b.lastChild.textContent = label; }, 1800); }
  });
  return b;
}

export const newWin = () => el('span', { class: 'sr-only', text: ' (נפתח בחלון חדש)' });
export const waLink = (intl) => `https://wa.me/${String(intl).replace(/\D/g, '')}`;
export const telLink = (phone) => `tel:${String(phone).replace(/[^\d+]/g, '')}`;

/* ---------- תפריט ---------- */
function initNav() {
  const btn = document.querySelector('.nav-toggle');
  const nav = document.getElementById('site-nav');
  if (!btn || !nav) return;
  btn.addEventListener('click', () => {
    const open = nav.classList.toggle('open');
    btn.setAttribute('aria-expanded', String(open));
  });
  nav.addEventListener('click', (e) => { if (e.target.closest('a')) { nav.classList.remove('open'); btn.setAttribute('aria-expanded', 'false'); } });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { nav.classList.remove('open'); btn.setAttribute('aria-expanded', 'false'); } });
}

/* ---------- פרטי קשר בכותרת התחתונה ובעמודים ---------- */
function fillCommon(cfg) {
  document.querySelectorAll('[data-cfg="address"]').forEach((n) => {
    n.textContent = cfg.address;
    n.dataset.edit = 'settings.json#/address'; n.dataset.editLabel = 'כתובת בית הכנסת';
    n.classList.toggle('placeholder', isPlaceholder(cfg.address));
  });
  document.querySelectorAll('[data-cfg="years"]').forEach((n) => { n.textContent = String(new Date().getFullYear() - cfg.foundedYear); });
  document.querySelectorAll('[data-cfg="year"]').forEach((n) => { n.textContent = String(new Date().getFullYear()); });

  document.querySelectorAll('[data-cfg="footer-contacts"]').forEach((ul) => {
    ul.replaceChildren(...cfg.contacts.map((c, i) => el('li', {},
      el('span', { 'data-edit': `settings.json#/contacts/${i}/name`, 'data-edit-label': 'שם איש קשר', text: c.name }), ': ',
      el('a', { href: telLink(c.phone), class: 'ltr', text: c.phone, 'data-edit': `settings.json#/contacts/${i}/phone`, 'data-edit-label': 'טלפון' }),
      c.whatsapp ? [' · ', el('a', { href: waLink(c.intl), rel: 'noopener', target: '_blank' }, 'וואטסאפ', newWin())] : null)));
  });

  document.querySelectorAll('[data-cfg="contact-cards"]').forEach((box) => {
    box.replaceChildren(...cfg.contacts.map((c, i) => el('div', { class: 'card accent contact-card' },
      el('h3', { text: c.name, 'data-edit': `settings.json#/contacts/${i}/name`, 'data-edit-label': 'שם איש קשר' }),
      el('p', { class: 'muted small', text: c.role || '', hidden: !c.role, 'data-edit': `settings.json#/contacts/${i}/role`, 'data-edit-label': 'תפקיד' }),
      el('a', { class: 'phone', href: telLink(c.phone), text: c.phone, 'data-edit': `settings.json#/contacts/${i}/phone`, 'data-edit-label': 'טלפון' }),
      el('div', { class: 'actions' },
        el('a', { class: 'btn btn-navy btn-sm', href: telLink(c.phone) }, icon('phone'), 'חיוג'),
        c.whatsapp ? el('a', { class: 'btn btn-wa btn-sm', href: waLink(c.intl), target: '_blank', rel: 'noopener' }, icon('wa'), 'וואטסאפ', newWin()) : null))));
  });

  document.querySelectorAll('[data-cfg="maps"]').forEach((box) => {
    if (!cfg.mapsQuery || isPlaceholder(cfg.mapsQuery)) { box.hidden = true; return; }
    const q = encodeURIComponent(cfg.mapsQuery);
    box.replaceChildren(
      el('a', { class: 'btn btn-outline btn-sm', href: `https://www.google.com/maps/search/?api=1&query=${q}`, target: '_blank', rel: 'noopener' }, icon('pin'), 'Google Maps', newWin()),
      el('a', { class: 'btn btn-outline btn-sm', href: `https://waze.com/ul?q=${q}`, target: '_blank', rel: 'noopener' }, icon('pin'), 'Waze', newWin()));
    box.hidden = false;
  });

  const wa = cfg.contacts.find((c) => c.whatsapp);
  if (wa && !document.querySelector('.wa-float')) {
    (document.querySelector('.site-footer') || document.body).append(el('a', { class: 'wa-float', href: waLink(wa.intl), target: '_blank', rel: 'noopener', 'aria-label': `שליחת הודעת וואטסאפ ל${wa.name} (נפתח בחלון חדש)` }, icon('wa')));
  }
}

/* ---------- תוכן הניתן לעריכה (assets/data/content/*.json) ---------- */
const dataUrl = (p) => new URL(`../data/${p}`, import.meta.url);
export const getJSON = (p) => fetch(dataUrl(p), { cache: 'no-cache' }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
const PAGE = document.body.dataset.page || '';
const CONTENT_PAGES = ['home', 'donate', 'times', 'accessibility'];
export const content = Promise.all([getJSON('content/common.json'), CONTENT_PAGES.includes(PAGE) ? getJSON(`content/${PAGE}.json`) : null])
  .then(([common, page]) => ({ common: common || {}, [PAGE]: page || {} }));
export const pagesData = getJSON('pages.json').then((d) => (Array.isArray(d?.pages) ? d.pages : []));

function applyContent(c, cfg) {
  const years = String(new Date().getFullYear() - cfg.foundedYear);
  const get = (key) => { const [pg, k] = key.split('.'); const v = c[pg]?.[k]; return typeof v === 'string' && v.trim() ? v.replaceAll('{years}', years) : null; };
  // מיפוי לעריכה ויזואלית: "page.key" → assets/data/content/<page>.json, שדה key
  const bind = (n, key, type) => { const [pg, k] = key.split('.'); n.dataset.edit = `content/${pg}.json#/${k}`; if (type) n.dataset.editType = type; };
  document.querySelectorAll('[data-t]').forEach((n) => {
    bind(n, n.dataset.t);
    const v = get(n.dataset.t);
    if (v == null) return;
    n.textContent = v;
    if (n.hasAttribute('data-t-tel')) n.href = telLink(v);
    n.classList.toggle('placeholder', isPlaceholder(v));
  });
  document.querySelectorAll('[data-t-wa]').forEach((n) => {
    const v = get(n.dataset.tWa);
    if (v) n.href = waLink(v.replace(/\D/g, '').replace(/^0/, '972'));
  });
  document.querySelectorAll('[data-md]').forEach((n) => { bind(n, n.dataset.md, 'md'); const v = get(n.dataset.md); if (v != null) n.replaceChildren(renderMarkdown(v)); });
}

/* ---------- עמודים כלליים מהמערכת: הוספה אוטומטית לתפריט ---------- */
export const pageHref = (slug) => `page.html?p=${encodeURIComponent(slug)}`;
function addPagesToNav(pages) {
  const cur = PAGE === 'page' ? new URLSearchParams(location.search).get('p') : null;
  const navPages = pages.filter((p) => p && p.nav && p.slug && p.title).sort((a, b) => (a.order ?? 99) - (b.order ?? 99));
  for (const ul of document.querySelectorAll('[data-nav]')) {
    ul.querySelectorAll('[data-generated]').forEach((n) => n.remove());
    const before = ul.dataset.nav === 'main' ? ul.lastElementChild : ul.querySelector('a[href="accessibility.html"]')?.parentElement;
    for (const p of navPages) {
      const li = el('li', { 'data-generated': true }, el('a', { href: pageHref(p.slug), 'aria-current': p.slug === cur ? 'page' : null, text: p.title }));
      ul.insertBefore(li, before || null);
    }
  }
}

export const ready = loadConfig().then(async (cfg) => {
  fillCommon(cfg);
  applyContent(await content, cfg);
  return cfg;
});
pagesData.then(addPagesToNav);
initNav();
initA11y();

/* ---------- כניסת מנהל / מצב עריכה ---------- */
// קוד העריכה נטען רק בלחיצה על "כניסת מנהל" או כשיש התחברות מנהל שמורה בדפדפן – מבקרים רגילים לא טוענים אותו.
const loadEditor = () => import('./edit/boot.js');
document.addEventListener('click', (e) => {
  const a = e.target.closest?.('[data-admin-login]');
  if (!a) return;
  e.preventDefault();
  loadEditor().then((m) => m.init({ openLogin: true })).catch(() => { location.href = a.href; });
});
let hasAdminSession = false;
try { hasAdminSession = !!localStorage.getItem('gotrue.user'); } catch { /* localStorage חסום */ }
if (hasAdminSession) Promise.all([ready, pagesData]).then(() => setTimeout(() => loadEditor().then((m) => m.init()).catch(() => {}), 0));
