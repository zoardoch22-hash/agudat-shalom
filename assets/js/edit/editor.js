// מצב עריכה ויזואלית: עורכים את הטקסטים במקום, ושומרים commit אחד דרך Git Gateway.
// כל אלמנט שניתן לעריכה מסומן ב-data-edit="<קובץ ב-assets/data>#<JSON Pointer>"
// ו-data-edit-type="text" (ברירת מחדל) | "md" (טקסט מעוצב) | "url" (קישור, נערך בשדה נלווה).
import { h, askLogin, stopFlag, showPill } from './boot.js';
import { AuthError } from './auth.js';
import { readJSON, commitChanges, GatewayError, bytesToBase64 } from './gitgateway.js';
import { toMarkdown, toPlain, parseBinding, getAt, setAt } from './serialize.js';
import { renderMarkdown, safeHref } from '../md.js';
import { loadConfig } from '../config.js';

const ADMIN = new URL('../../../admin/', import.meta.url).href;
const RULES_LINK = `${ADMIN}#/collections/settings/entries/settings`;
const MAX_IMG = 1600;

let active = false, saving = false;
let fields = [];
const uploads = new Map(); // path -> base64
let ui = {};
let richField = null, savedRange = null;
let cleanup = [];
let savedAny = false;

const on = (target, ev, fn, opts) => { target.addEventListener(ev, fn, opts); cleanup.push(() => target.removeEventListener(ev, fn, opts)); };
const fieldOf = (node) => { const el = node?.closest?.('[data-edit]'); return el ? fields.find((f) => f.el === el) : null; };
const pageName = () => (document.querySelector('h1')?.textContent || document.title.split(' – ')[0] || '').trim();

function setStatus(msg, kind = '') {
  ui.status.textContent = msg;
  ui.status.className = `ed-status${kind ? ` is-${kind}` : ''}`;
}

/* ---------- ערך נוכחי של שדה ---------- */
function valueOf(f) {
  if (f.type === 'md') return toMarkdown(f.el);
  if (f.type === 'url') return f.input.value.trim();
  return toPlain(f.el);
}
function show(f, raw) {
  if (f.type === 'md') f.el.replaceChildren(renderMarkdown(raw));
  else if (f.type === 'url') f.input.value = raw;
  else f.el.textContent = raw;
}

/* ---------- סרגל העריכה ---------- */
function buildBar() {
  const btn = (label, attrs = {}) => h('button', { type: 'button', class: 'ed-btn', ...attrs }, label);
  ui.save = btn('שמירה', { class: 'ed-btn ed-btn-save', disabled: true, 'aria-keyshortcuts': 'Control+S' });
  ui.cancel = btn('ביטול שינויים', { disabled: true });
  ui.exit = btn('יציאה ממצב עריכה');
  ui.status = h('p', { class: 'ed-status', role: 'status', 'aria-live': 'polite' });
  const fb = (label, cmd, extra = {}) => h('button', { type: 'button', class: 'ed-fbtn', 'data-cmd': cmd, 'aria-disabled': 'true', ...extra }, label);
  ui.fmt = h('div', { class: 'ed-fmt', role: 'toolbar', 'aria-label': 'עיצוב טקסט (בתוכן מעוצב)' },
    fb('מודגש', 'bold', { 'aria-keyshortcuts': 'Control+B' }), fb('כותרת', 'heading'), fb('רשימה', 'list'), fb('קישור', 'link'), fb('תמונה', 'image'));
  ui.file = h('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp,image/gif', class: 'ed-file', tabindex: '-1', 'aria-hidden': 'true' });
  ui.bar = h('div', { class: 'ed-bar ed-ui', role: 'region', 'aria-label': 'סרגל מצב עריכה' },
    h('div', { class: 'ed-bar-row' },
      h('p', { class: 'ed-title' }, h('strong', { text: 'מצב עריכה' }), h('span', { class: 'ed-sub', text: ' · לחצו על טקסט מסומן כדי לשנות אותו' })),
      h('div', { class: 'ed-bar-actions' }, ui.save, ui.cancel, ui.exit)),
    h('div', { class: 'ed-bar-row' }, ui.fmt, ui.status),
    ui.file);
  ui.hint = h('p', { id: 'ed-hint', class: 'sr-only', text: 'שדה הניתן לעריכה – הקלידו כדי לשנות. Ctrl+S לשמירה, Escape לסיום. בתוכן מעוצב: Alt+F10 לכפתורי העיצוב.' });
  const skip = document.querySelector('.skip');
  (skip ? skip.after(ui.bar) : document.body.prepend(ui.bar));
  ui.bar.append(ui.hint);
  const ro = new ResizeObserver(() => document.documentElement.style.setProperty('--ed-bar-h', `${ui.bar.offsetHeight}px`));
  ro.observe(ui.bar); cleanup.push(() => ro.disconnect());

  on(ui.save, 'click', save);
  on(ui.cancel, 'click', cancelAll);
  on(ui.exit, 'click', exit);
  on(ui.fmt, 'mousedown', (e) => { if (e.target.closest('.ed-fbtn')) e.preventDefault(); }); // שומר את הבחירה בטקסט
  on(ui.fmt, 'click', (e) => { const b = e.target.closest('.ed-fbtn'); if (b) format(b.dataset.cmd); });
  on(ui.fmt, 'keydown', (e) => {
    const bs = [...ui.fmt.querySelectorAll('.ed-fbtn')];
    const i = bs.indexOf(document.activeElement);
    if (e.key === 'Escape' && richField) { e.preventDefault(); e.stopPropagation(); restoreRange(); }
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); bs[(i + (e.key === 'ArrowLeft' ? 1 : -1) + bs.length) % bs.length].focus(); }
  });
}

/* ---------- חלון שאלה כללי ---------- */
function ask({ title, body = [], buttons, focus }) {
  return new Promise((resolve) => {
    const d = h('dialog', { class: 'ed-dialog ed-ui', 'aria-labelledby': 'ed-ask-title' });
    const btns = buttons.map((b) => {
      const el = h('button', { type: b.submit ? 'submit' : 'button', class: `btn ${b.cls || 'btn-outline'}` }, b.label);
      if (!b.submit) el.addEventListener('click', () => { d.returnValue = b.value; d.close(); });
      return el;
    });
    const form = h('form', { class: 'ed-form', novalidate: true }, h('h2', { id: 'ed-ask-title', text: title }), ...body, h('div', { class: 'ed-actions' }, btns));
    form.addEventListener('submit', (e) => { e.preventDefault(); const b = buttons.find((x) => x.submit); if (b.validate && !b.validate()) return; d.returnValue = b.value; d.close(); });
    d.append(form);
    d.addEventListener('close', () => { const v = d.returnValue; d.remove(); resolve(v && v !== 'cancel' ? v : null); });
    document.body.append(d);
    d.returnValue = 'cancel';
    d.showModal();
    (focus || btns[0]).focus();
  });
}

/* ---------- כניסה למצב עריכה ---------- */
export async function enterEditMode() {
  if (active) return;
  active = true; savedAny = false; cleanup = []; uploads.clear();
  document.documentElement.classList.add('ed-on');
  buildBar();
  setStatus('טוען את הגרסה העדכנית של התוכן…');

  const els = [...document.querySelectorAll('[data-edit]')].filter((el) => !el.closest('.ed-ui'));
  fields = els.map((el) => {
    const { file, pointer } = parseBinding(el.dataset.edit);
    return { el, file, pointer, type: el.dataset.editType || 'text', orig: [...el.childNodes].map((n) => n.cloneNode(true)), wasHidden: el.hidden };
  });

  // הגרסה העדכנית מהמאגר (ייתכן שחדשה מהאתר הציבורי, אם שמרתם לפני פחות מדקה)
  const files = [...new Set(fields.map((f) => f.file))];
  const repo = {}, deployed = {};
  let repoOk = true;
  await Promise.all(files.map(async (p) => {
    deployed[p] = await fetch(new URL(`../../../${p}`, import.meta.url), { cache: 'no-cache' }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  }));
  for (const p of files) {
    try { repo[p] = (await readJSON(p))?.data ?? null; } catch (e) {
      if (e instanceof AuthError) {
        const s = await askLogin({ reason: 'פג תוקף ההתחברות. יש להתחבר שוב כדי לערוך.', chooser: false });
        if (!s) { teardown(); return; }
        try { repo[p] = (await readJSON(p))?.data ?? null; } catch { repoOk = false; }
      } else repoOk = false;
    }
  }

  let newer = false;
  for (const f of fields) {
    const src = repo[f.file] ?? deployed[f.file];
    let raw = src ? getAt(src, f.pointer) : undefined;
    if (deployed[f.file] && repo[f.file] && getAt(deployed[f.file], f.pointer) !== getAt(repo[f.file], f.pointer)) newer = true;
    if (typeof raw !== 'string') raw = raw == null ? (f.type === 'md' ? toMarkdown(f.el) : f.type === 'url' ? '' : toPlain(f.el)) : String(raw);
    f.raw = raw; f.startRaw = raw;
    if (f.type === 'url') {
      f.input = h('input', { type: 'url', dir: 'ltr', class: 'ed-url-input', placeholder: 'https://…' });
      f.wrap = h('label', { class: 'ed-url ed-ui' }, h('span', { text: f.el.dataset.editLabel || 'קישור' }), f.input);
      f.el.after(f.wrap);
    } else {
      f.el.hidden = false;
      try { f.el.contentEditable = f.type === 'md' ? 'true' : 'plaintext-only'; } catch { f.el.contentEditable = 'true'; }
      f.el.spellcheck = true;
      f.el.setAttribute('aria-describedby', 'ed-hint');
      if (f.el.dataset.editLabel) f.el.setAttribute('data-ed-ph', f.el.dataset.editLabel);
      f.el.classList.add('ed-field');
      if (f.type === 'md') f.el.classList.add('ed-rich');
    }
    show(f, raw);
    if (f.type === 'md') f.el.querySelectorAll('img').forEach((i) => i.setAttribute('tabindex', '0'));
    f.baseline = valueOf(f);
  }

  // אזורים מחושבים (זמני תפילות) – לא נערכים ישירות
  for (const c of document.querySelectorAll('[data-computed]')) {
    c.classList.add('ed-computed-area');
    c.before(h('p', { class: 'ed-computed ed-ui' }, 'הזמנים מחושבים אוטומטית (לוח המאור + כללי התפילות) ואינם נערכים כאן. ',
      h('a', { href: RULES_LINK }, 'לשינוי כללי זמני התפילות – הגדרות במערכת הניהול')));
  }

  on(document, 'input', onInput, true);
  on(document, 'click', onClick, true);
  on(document, 'keydown', onKey, true);
  on(document, 'paste', onPaste, true);
  on(document, 'drop', (e) => { if (fieldOf(e.target)) e.preventDefault(); }, true);
  on(document, 'focusin', onFocus, true);
  on(document, 'selectionchange', () => {
    const sel = document.getSelection();
    if (richField && sel.rangeCount && richField.el.contains(sel.anchorNode)) savedRange = sel.getRangeAt(0).cloneRange();
  });
  on(window, 'beforeunload', (e) => { if (dirty().length) { e.preventDefault(); e.returnValue = ''; } });
  on(ui.file, 'change', onFile);

  const msg = `${fields.length} שדות ניתנים לעריכה בעמוד זה. לחצו על טקסט מסומן, שנו ושמרו.`;
  if (!repoOk) setStatus(`לא ניתן היה לטעון את הגרסה מהמאגר – מוצגת הגרסה שבאתר. ${msg}`, 'warn');
  else if (newer) setStatus(`מוצגת הגרסה האחרונה שנשמרה (האתר הציבורי עוד מתעדכן). ${msg}`, 'warn');
  else setStatus(msg);
  if (fields.some((f) => /\{years\}/.test(f.raw))) ui.status.append(h('span', { class: 'ed-sub', text: ' ‏{years} = מספר השנים מאז הקמת בית הכנסת (מתעדכן לבד).' }));
}

/* ---------- אירועים ---------- */
let rafId = 0;
function onInput(e) {
  const f = fieldOf(e.target);
  if (!f && !e.target.closest?.('.ed-url')) return;
  // אותו שדה מופיע פעמיים בעמוד (למשל טלפון בכרטיס ובכותרת התחתונה) – מעדכנים גם את העותק
  if (f && f.type === 'text') for (const o of fields) if (o !== f && o.file === f.file && o.pointer === f.pointer && o.type === 'text') o.el.textContent = toPlain(f.el);
  cancelAnimationFrame(rafId);
  rafId = requestAnimationFrame(updateDirty);
}
function dirty() { return fields.filter((f) => valueOf(f) !== f.baseline); }
// מספר השדות ששונו (שדה שמופיע פעמיים בעמוד נספר פעם אחת)
const countOf = (list) => new Set(list.map((f) => `${f.file}#${f.pointer}`)).size;
function updateDirty() {
  const d = dirty();
  for (const f of fields) (f.wrap || f.el).classList.toggle('ed-dirty', d.includes(f));
  ui.save.disabled = saving || !d.length;
  ui.cancel.disabled = saving || !d.length;
  ui.save.textContent = d.length ? `שמירה (${countOf(d)})` : 'שמירה';
  return d;
}

function onClick(e) {
  if (e.target.closest('.ed-ui')) return;
  const f = fieldOf(e.target);
  const a = e.target.closest('a');
  if (f && f.type !== 'url' && a) e.preventDefault(); // קישור בתוך שדה (או שדה שהוא קישור) – עורכים, לא מנווטים
  if (f && f.type === 'md' && e.target.tagName === 'IMG') { e.preventDefault(); imageDialog(f, e.target); }
}

function onKey(e) {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); save(); return; }
  const f = fieldOf(e.target);
  if (!f || f.type === 'url') return;
  if (e.key === 'Enter' && f.type === 'text') e.preventDefault();
  if (e.key === 'Escape') { e.preventDefault(); f.el.blur(); ui.save.disabled ? ui.exit.focus() : ui.save.focus(); }
  if (f.type === 'md' && (e.ctrlKey || e.metaKey) && ['b', 'i', 'u'].includes(e.key.toLowerCase())) {
    e.preventDefault();
    if (e.key.toLowerCase() === 'b') format('bold');
  }
  if (f.type === 'md' && e.target.tagName === 'IMG' && e.key === 'Enter') { e.preventDefault(); imageDialog(f, e.target); }
  if (f.type === 'md' && e.altKey && e.key === 'F10') { e.preventDefault(); ui.fmt.querySelector('.ed-fbtn').focus(); }
}

function onPaste(e) {
  const f = fieldOf(e.target);
  if (!f || f.type === 'url') return;
  e.preventDefault();
  let text = e.clipboardData?.getData('text/plain') || '';
  if (f.type === 'text') text = text.replace(/\s*\n\s*/g, ' ');
  document.execCommand('insertText', false, text);
}

function onFocus(e) {
  const t = e.target;
  if (t.closest?.('.ed-dialog')) return;
  const f = fieldOf(t);
  if (f && f.type === 'md') richField = f;
  else if (!t.closest?.('.ed-bar')) richField = null; // מעבר לסרגל (כפתורי העיצוב) שומר את השדה האחרון
  ui.fmt.querySelectorAll('.ed-fbtn').forEach((b) => b.setAttribute('aria-disabled', String(!richField)));
}

/* ---------- עיצוב בתוכן מעוצב ---------- */
function restoreRange() {
  const el = richField.el;
  el.focus();
  const sel = document.getSelection();
  sel.removeAllRanges();
  if (savedRange && el.contains(savedRange.startContainer)) sel.addRange(savedRange);
  else { const r = document.createRange(); r.selectNodeContents(el); r.collapse(false); sel.addRange(r); }
  return sel;
}
function blockOf(node, root) {
  let n = node.nodeType === 3 ? node.parentNode : node;
  while (n && n !== root && !/^(P|H[1-6]|LI|DIV)$/.test(n.tagName)) n = n.parentNode;
  return n && n !== root ? n : null;
}
async function format(cmd) {
  if (!richField) { setStatus('כדי לעצב, בחרו קודם תוכן מעוצב (פסקאות) בעמוד.', 'warn'); return; }
  const sel = restoreRange();
  if (cmd === 'bold') document.execCommand('bold');
  else if (cmd === 'list') document.execCommand('insertUnorderedList');
  else if (cmd === 'heading') {
    const b = blockOf(sel.anchorNode, richField.el);
    document.execCommand('formatBlock', false, b && /^H/.test(b.tagName) ? '<p>' : '<h2>');
  } else if (cmd === 'link') await linkDialog(sel);
  else if (cmd === 'image') { ui.file.value = ''; ui.file._target = null; ui.file.click(); }
  updateDirty();
}

async function linkDialog(sel) {
  const range = sel.rangeCount ? sel.getRangeAt(0).cloneRange() : null;
  const selected = range ? range.toString() : '';
  const url = h('input', { type: 'text', id: 'ed-link-url', dir: 'ltr', placeholder: 'https://… או times.html או tel:…' });
  const text = h('input', { type: 'text', id: 'ed-link-text', value: selected });
  const err = h('p', { class: 'ed-error', role: 'alert' });
  const v = await ask({
    title: 'הוספת קישור',
    body: [h('label', { for: 'ed-link-url' }, 'כתובת הקישור'), url, h('label', { for: 'ed-link-text' }, 'טקסט הקישור'), text, err],
    buttons: [{ label: 'הוספה', value: 'ok', submit: true, cls: 'btn-navy', validate: () => {
      if (!safeHref(url.value)) { err.textContent = 'כתובת לא תקינה. מותר: https://, mailto:, tel: או קישור פנימי.'; url.focus(); return false; }
      if (!text.value.trim()) { err.textContent = 'יש למלא טקסט לקישור.'; text.focus(); return false; }
      return true;
    } }, { label: 'ביטול', value: 'cancel' }],
    focus: url,
  });
  if (!v) return;
  const s = restoreRange();
  if (range) { s.removeAllRanges(); s.addRange(range); }
  const a = h('a', { href: url.value.trim() }, text.value.trim());
  const r = s.getRangeAt(0);
  r.deleteContents(); r.insertNode(a);
  r.setStartAfter(a); r.collapse(true); s.removeAllRanges(); s.addRange(r);
}

/* ---------- תמונות ---------- */
const readDataUrl = (blob) => new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = rej; fr.readAsDataURL(blob); });
const loadImg = (src) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });

async function prepareImage(file) {
  if (!/^image\/(jpeg|png|webp|gif)$/.test(file.type)) throw new Error('אפשר להעלות תמונות מסוג JPG, PNG, WEBP או GIF בלבד.');
  if (file.size > 15 * 1024 * 1024) throw new Error('התמונה גדולה מדי (מעל 15MB).');
  let dataUrl = await readDataUrl(file);
  let ext = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' }[file.type];
  if (file.type !== 'image/gif') {
    const img = await loadImg(dataUrl);
    if (img.naturalWidth > MAX_IMG || file.size > 1.5 * 1024 * 1024) {
      const k = Math.min(1, MAX_IMG / img.naturalWidth);
      const c = document.createElement('canvas');
      c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
      const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height);
      dataUrl = c.toDataURL('image/jpeg', 0.85); ext = 'jpg';
    }
  }
  const d = new Date();
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  const path = `assets/uploads/${stamp}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  uploads.set(path, dataUrl.split(',')[1]);
  return { dataUrl, path };
}

async function askAlt(current = '') {
  const alt = h('input', { type: 'text', id: 'ed-alt', value: current });
  const err = h('p', { class: 'ed-error', role: 'alert' });
  const v = await ask({
    title: 'תיאור התמונה',
    body: [h('p', { class: 'ed-small', text: 'תיאור קצר למי שלא רואה את התמונה (נדרש לנגישות).' }), h('label', { for: 'ed-alt' }, 'תיאור'), alt, err],
    buttons: [{ label: 'אישור', value: 'ok', submit: true, cls: 'btn-navy', validate: () => (alt.value.trim() ? true : (err.textContent = 'יש למלא תיאור.', alt.focus(), false)) }, { label: 'ביטול', value: 'cancel' }],
    focus: alt,
  });
  return v ? alt.value.trim() : null;
}

async function onFile() {
  const file = ui.file.files[0];
  if (!file || !richField) return;
  const target = ui.file._target;
  try {
    setStatus('מכין את התמונה…');
    const { dataUrl, path } = await prepareImage(file);
    if (target) { target.src = dataUrl; target.dataset.upload = path; }
    else {
      const alt = await askAlt('');
      if (alt == null) { uploads.delete(path); setStatus('הוספת התמונה בוטלה.'); return; }
      const img = h('img', { src: dataUrl, alt, 'data-upload': path, tabindex: '0' });
      const sel = restoreRange();
      const r = sel.getRangeAt(0);
      const block = blockOf(r.startContainer, richField.el);
      if (!block) { const p = h('p'); p.append(img); r.insertNode(p); } else { r.collapse(false); r.insertNode(img); }
    }
    setStatus('התמונה נוספה. היא תועלה לאתר בלחיצה על "שמירה".');
    updateDirty();
  } catch (e) { setStatus(e.message || 'לא ניתן לטעון את התמונה.', 'error'); }
}

async function imageDialog(f, img) {
  richField = f;
  const alt = h('input', { type: 'text', id: 'ed-img-alt', value: img.getAttribute('alt') || '' });
  const v = await ask({
    title: 'עריכת תמונה',
    body: [h('label', { for: 'ed-img-alt' }, 'תיאור התמונה (לנגישות)'), alt],
    buttons: [{ label: 'שמירת התיאור', value: 'ok', submit: true, cls: 'btn-navy' }, { label: 'החלפת התמונה', value: 'replace' }, { label: 'מחיקת התמונה', value: 'delete' }, { label: 'ביטול', value: 'cancel' }],
    focus: alt,
  });
  if (v === 'ok') img.setAttribute('alt', alt.value.trim());
  else if (v === 'delete') img.remove();
  else if (v === 'replace') { ui.file.value = ''; ui.file._target = img; ui.file.click(); }
  updateDirty();
}

/* ---------- שמירה ---------- */
function derive(pointer, value, data) {
  const m = /^\/contacts\/(\d+)\/phone$/.exec(pointer);
  if (m) { const d = value.replace(/\D/g, ''); if (/^0\d{8,9}$/.test(d)) setAt(data, `/contacts/${m[1]}/intl`, `972${d.slice(1)}`); }
}
const isPh = (v) => !v || /^\[[^\]]*\]$/.test(v.trim()); // ריק או ממלא מקום כמו [יעודכן]

async function save() {
  if (saving) return;
  const changes = updateDirty();
  if (!changes.length) { setStatus('אין שינויים לשמירה.'); return; }
  for (const f of changes) {
    if (f.type === 'url') {
      const v = valueOf(f);
      if (!isPh(v) && !/^https:\/\/\S+$/i.test(v)) { setStatus('קישור חייב להתחיל ב-https:// (או להישאר ריק).', 'error'); f.input.focus(); return; }
    }
  }
  const values = new Map(changes.map((f) => [f, valueOf(f)]));
  const jsonEdits = {};
  for (const f of changes) {
    const prev = jsonEdits[f.file];
    jsonEdits[f.file] = (data) => { prev?.(data); setAt(data, f.pointer, values.get(f)); derive(f.pointer, values.get(f), data); };
  }
  const used = new Set(changes.filter((f) => f.type === 'md').flatMap((f) => [...f.el.querySelectorAll('img[data-upload]')].map((i) => i.dataset.upload)));
  const ups = [...uploads].filter(([p]) => used.has(p)).map(([path, base64]) => ({ path, base64 }));
  const fileList = [...new Set(changes.map((f) => f.file.replace('assets/data/', '')))];
  const n = countOf(changes);
  const message = `עריכה ויזואלית – ${pageName()}: ${n === 1 ? 'שינוי אחד' : `${n} שינויים`}${ups.length ? ` ו-${ups.length} תמונות` : ''} (${fileList.join(', ')})`;

  saving = true; updateDirty();
  ui.bar.setAttribute('aria-busy', 'true');
  ui.save.textContent = 'שומר…';
  setStatus('שומר את השינויים…');
  try {
    const res = await commitChanges({ jsonEdits, uploads: ups, message });
    for (const f of changes) { f.baseline = values.get(f); f.raw = values.get(f); }
    for (const u of ups) uploads.delete(u.path);
    savedAny = true;
    setStatus(res ? 'נשמר! ✓ האתר יתעדכן בעוד כדקה.' : 'אין שינויים לשמירה – התוכן כבר זהה לגרסה השמורה.', 'ok');
  } catch (e) {
    if (e instanceof AuthError) {
      saving = false;
      const s = await askLogin({ reason: 'פג תוקף ההתחברות. יש להתחבר שוב כדי לשמור – השינויים שלכם לא אבדו.', chooser: false });
      ui.bar.removeAttribute('aria-busy');
      if (s) return save();
      setStatus('השינויים לא נשמרו (לא בוצעה התחברות). הם עדיין כאן – אפשר לנסות שוב.', 'error');
    } else {
      setStatus(`${e instanceof GatewayError ? e.message : 'השמירה נכשלה.'} השינויים לא אבדו – אפשר לנסות שוב.`, 'error');
    }
  } finally {
    saving = false;
    ui.bar.removeAttribute('aria-busy');
    updateDirty();
  }
}

/* ---------- ביטול / יציאה ---------- */
async function cancelAll() {
  const d = dirty();
  if (!d.length) return;
  const n = countOf(d);
  const v = await ask({ title: 'ביטול שינויים', body: [h('p', { text: `לבטל ${n === 1 ? 'שינוי אחד שלא נשמר' : `${n} שינויים שלא נשמרו`}?` })], buttons: [{ label: 'כן, לבטל', value: 'yes', cls: 'btn-navy' }, { label: 'המשך עריכה', value: 'cancel' }] });
  if (!v) return;
  for (const f of d) { show(f, f.raw); if (f.type === 'md') f.el.querySelectorAll('img').forEach((i) => i.setAttribute('tabindex', '0')); }
  uploads.clear();
  updateDirty();
  setStatus('השינויים בוטלו.');
  ui.exit.focus();
}

async function exit() {
  const d = dirty();
  if (d.length) {
    const v = await ask({ title: 'יש שינויים שלא נשמרו', body: [h('p', { text: 'מה לעשות עם השינויים?' })], buttons: [{ label: 'שמירה ויציאה', value: 'save', cls: 'btn-gold' }, { label: 'יציאה בלי לשמור', value: 'discard' }, { label: 'המשך עריכה', value: 'cancel' }] });
    if (!v) return;
    if (v === 'save') { await save(); if (dirty().length) return; }
  }
  await teardown();
  await showPill();
  document.querySelector('.ed-pill')?.focus();
}

async function teardown() {
  const cfg = await loadConfig().catch(() => ({ foundedYear: 1957 }));
  const years = String(new Date().getFullYear() - (cfg.foundedYear || 1957));
  for (const f of fields) {
    if (f.wrap) f.wrap.remove();
    if (f.type !== 'url') {
      f.el.removeAttribute('contenteditable'); f.el.removeAttribute('spellcheck'); f.el.removeAttribute('aria-describedby');
      f.el.removeAttribute('data-ed-ph');
      f.el.classList.remove('ed-field', 'ed-rich', 'ed-dirty');
      if (f.raw !== f.startRaw) { // נשמר במהלך העריכה – מציגים את הערך החדש
        const v = f.raw.replaceAll('{years}', years);
        if (f.type === 'md') f.el.replaceChildren(renderMarkdown(v)); else f.el.textContent = v;
      } else f.el.replaceChildren(...f.orig);
      f.el.hidden = f.wasHidden && !(f.raw && f.raw !== f.startRaw);
    }
  }
  document.querySelectorAll('.ed-computed').forEach((n) => n.remove());
  document.querySelectorAll('.ed-computed-area').forEach((n) => n.classList.remove('ed-computed-area'));
  cleanup.forEach((fn) => fn()); cleanup = [];
  ui.bar?.remove(); ui.hint?.remove();
  document.documentElement.classList.remove('ed-on');
  document.documentElement.style.removeProperty('--ed-bar-h');
  fields = []; richField = null; active = false;
  stopFlag();
}

export const isActive = () => active;
