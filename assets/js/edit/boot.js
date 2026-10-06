// נקודת הכניסה למצב העריכה – נטען רק אחרי לחיצה על "כניסת מנהל" או כשיש התחברות מנהל שמורה.
// מבקרים רגילים לא טוענים את הקובץ הזה כלל.
import { getSession, login, logout, AuthError } from './auth.js';

const FLAG = 'agudat-edit-mode';
let cssLoaded;
export function loadCss() {
  if (!cssLoaded) {
    cssLoaded = new Promise((resolve) => {
      const l = document.createElement('link');
      l.rel = 'stylesheet'; l.href = new URL('../../css/edit.css', import.meta.url).href;
      l.onload = resolve; l.onerror = resolve;
      document.head.append(l);
    });
  }
  return cssLoaded;
}

function h(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') n.className = v; else if (k === 'text') n.textContent = v; else n.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c != null) n.append(c.nodeType ? c : document.createTextNode(String(c)));
  return n;
}
export { h };

const adminHref = () => new URL('../../../admin/', import.meta.url).href;

/* ---------- חלון התחברות / בחירה ---------- */
let dlg;
function buildDialog() {
  dlg = h('dialog', { class: 'ed-dialog ed-ui', 'aria-labelledby': 'ed-login-title' });
  document.body.append(dlg);
  dlg.addEventListener('close', () => { dlg._resolve?.(null); });
  return dlg;
}

/**
 * פותח את חלון ההתחברות. reason – הודעה (למשל "פג תוקף ההתחברות").
 * מחזיר את ההתחברות, או null אם בוטל.
 */
export async function askLogin({ reason = '', chooser = true } = {}) {
  await loadCss();
  const d = dlg || buildDialog();
  const s = getSession();
  return new Promise((resolve) => {
    d._resolve = (v) => { d._resolve = null; resolve(v); };
    if (s && chooser && !reason) renderChooser(d, s); else renderLogin(d, reason, chooser);
    if (!d.open) d.showModal();
  });
}

function renderLogin(d, reason, chooser) {
  const err = h('p', { class: 'ed-error', role: 'alert', id: 'ed-login-err' });
  const email = h('input', { type: 'email', id: 'ed-email', name: 'email', autocomplete: 'username', required: true, dir: 'ltr', 'aria-describedby': 'ed-login-err' });
  const pass = h('input', { type: 'password', id: 'ed-pass', name: 'password', autocomplete: 'current-password', required: true, dir: 'ltr', 'aria-describedby': 'ed-login-err' });
  const submit = h('button', { type: 'submit', class: 'btn btn-navy' }, 'כניסה');
  const cancel = h('button', { type: 'button', class: 'btn btn-outline', 'data-ed': 'cancel' }, 'ביטול');
  const form = h('form', { class: 'ed-form', novalidate: true },
    h('h2', { id: 'ed-login-title', text: 'כניסת מנהל' }),
    reason ? h('p', { class: 'ed-note', text: reason }) : h('p', { class: 'ed-note', text: 'התחברות עם חשבון המנהל של האתר (Netlify Identity).' }),
    h('label', { for: 'ed-email' }, 'אימייל'), email,
    h('label', { for: 'ed-pass' }, 'סיסמה'), pass,
    err,
    h('div', { class: 'ed-actions' }, submit, cancel),
    h('p', { class: 'ed-small' }, 'שכחתם סיסמה או קיבלתם הזמנה? ', h('a', { href: adminHref() }, 'דרך מערכת הניהול')));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    err.textContent = '';
    if (!email.value.trim() || !pass.value) { err.textContent = 'יש למלא אימייל וסיסמה.'; (email.value.trim() ? pass : email).focus(); return; }
    submit.disabled = true; submit.textContent = 'מתחבר…';
    try {
      const s = await login(email.value, pass.value);
      pass.value = '';
      if (chooser && !reason) renderChooser(d, s, true);
      else { const r = d._resolve; d._resolve = null; d.close(); r?.(s); }
    } catch (ex) {
      err.textContent = ex instanceof AuthError ? ex.message : 'ההתחברות נכשלה. נסו שוב.';
      pass.focus(); pass.select();
    } finally { submit.disabled = false; submit.textContent = 'כניסה'; }
  });
  cancel.addEventListener('click', () => d.close());
  d.replaceChildren(form);
  setTimeout(() => email.focus(), 0);
}

function renderChooser(d, s, fresh = false) {
  const visual = h('button', { type: 'button', class: 'btn btn-gold', 'data-ed': 'visual' }, 'עריכה ויזואלית של האתר');
  const cms = h('a', { class: 'btn btn-navy', href: adminHref() }, 'מערכת הניהול המלאה');
  const out = h('button', { type: 'button', class: 'btn btn-outline', 'data-ed': 'logout' }, 'התנתקות');
  const close = h('button', { type: 'button', class: 'btn btn-outline', 'data-ed': 'close' }, 'סגירה');
  d.replaceChildren(h('div', { class: 'ed-form' },
    h('h2', { id: 'ed-login-title', text: fresh ? 'התחברתם בהצלחה' : 'כניסת מנהל' }),
    h('p', { class: 'ed-note' }, 'מחובר/ת: ', h('bdi', { text: s.email || '' })),
    h('p', { class: 'ed-small', text: 'עריכה ויזואלית: לוחצים על טקסט באתר, משנים ושומרים. מערכת הניהול: כל ההגדרות, עמודים חדשים וקבצים.' }),
    h('div', { class: 'ed-actions ed-actions-col' }, visual, cms, out, close)));
  visual.addEventListener('click', () => { const r = d._resolve; d._resolve = null; d.close(); r?.(s); startEditing(); });
  out.addEventListener('click', async () => { await logout(); stopFlag(); const r = d._resolve; d._resolve = null; d.close(); r?.(null); location.reload(); });
  close.addEventListener('click', () => d.close());
  setTimeout(() => visual.focus(), 0);
}

/* ---------- כפתור "עריכת העמוד" למנהל מחובר ---------- */
let pill;
export async function showPill() {
  if (pill || !getSession()) return;
  await loadCss();
  pill = h('button', { type: 'button', class: 'ed-pill ed-ui' }, h('span', { 'aria-hidden': 'true', text: '✎ ' }), 'עריכת העמוד');
  pill.addEventListener('click', startEditing);
  document.body.append(pill);
}
export const hidePill = () => { pill?.remove(); pill = null; };

export const stopFlag = () => { try { sessionStorage.removeItem(FLAG); } catch { /* ignore */ } };
export const flagOn = () => { try { return sessionStorage.getItem(FLAG) === '1'; } catch { return false; } };

export async function startEditing() {
  if (!getSession()) { const s = await askLogin({ chooser: false }); if (!s) return; }
  try { sessionStorage.setItem(FLAG, '1'); } catch { /* ignore */ }
  hidePill();
  await loadCss();
  const { enterEditMode } = await import('./editor.js');
  await enterEditMode();
}

/** נקרא מ-main.js */
export async function init({ openLogin = false } = {}) {
  const wantEdit = new URLSearchParams(location.search).has('edit') || flagOn();
  if (openLogin) {
    const s = await askLogin();
    if (s && !flagOn()) showPill();
    return;
  }
  if (!getSession()) return;
  if (wantEdit) startEditing(); else showPill();
}
