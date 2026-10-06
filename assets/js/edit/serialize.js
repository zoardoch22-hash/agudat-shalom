// המרת תוכן שנערך (DOM) חזרה ל-Markdown המצומצם של האתר (ראו assets/js/md.js),
// ועזרי נתיב (JSON Pointer) לשדות בקובצי הנתונים.

const BLOCK = new Set(['P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'UL', 'OL', 'LI', 'BLOCKQUOTE', 'SECTION', 'ARTICLE']);

function inline(node) {
  let out = '';
  for (const n of node.childNodes) {
    if (n.nodeType === 3) { out += n.nodeValue.replace(/\u00a0/g, ' ').replace(/[ \t\r\n]+/g, ' '); continue; }
    if (n.nodeType !== 1) continue;
    const tag = n.tagName;
    if (n.classList.contains('sr-only') || n.classList.contains('ed-ui')) continue;
    if (tag === 'BR') { out += '\n'; continue; }
    if (tag === 'IMG') {
      const src = n.dataset.upload || n.getAttribute('src') || '';
      if (src && !/^data:/i.test(src)) out += `![${(n.getAttribute('alt') || '').replace(/[[\]]/g, '')}](${src})`;
      continue;
    }
    const inner = inline(n);
    if (tag === 'STRONG' || tag === 'B') {
      const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(inner.replace(/\*\*/g, ''));
      out += m[2] ? `${m[1]}**${m[2]}**${m[3]}` : inner;
    } else if (tag === 'A' && n.getAttribute('href')) {
      const text = inner.replace(/\*\*/g, '').trim();
      out += text ? `[${text.replace(/[[\]]/g, '')}](${n.getAttribute('href').replace(/\s/g, '%20')})` : '';
    } else out += inner;
  }
  return out;
}

const cleanLines = (s) => s.split('\n').map((l) => l.trim()).filter((l, i, a) => l || (i > 0 && i < a.length - 1)).join('\n').trim();

function blocks(root, out) {
  let buf = null; // רצף של צמתים inline ברמה העליונה = פסקה
  const flush = () => { if (buf) { const t = cleanLines(inline(buf)); if (t) out.push(t); buf = null; } };
  for (const n of [...root.childNodes]) {
    const isBlock = n.nodeType === 1 && BLOCK.has(n.tagName) && !n.classList.contains('ed-ui');
    if (!isBlock) {
      if (n.nodeType === 1 && n.classList.contains('ed-ui')) continue;
      if (!buf) buf = document.createElement('div');
      buf.append(n.cloneNode(true));
      continue;
    }
    flush();
    const tag = n.tagName;
    if (/^H[1-6]$/.test(tag)) {
      const lvl = Math.min(4, Math.max(2, +tag[1]));
      const t = inline(n).replace(/\n/g, ' ').trim();
      if (t) out.push(`${'#'.repeat(lvl)} ${t}`);
    } else if (tag === 'UL' || tag === 'OL') {
      const items = [...n.children].filter((li) => li.tagName === 'LI')
        .map((li) => inline(li).replace(/\n+/g, ' ').trim()).filter(Boolean);
      if (items.length) out.push(items.map((t, i) => (tag === 'OL' ? `${i + 1}. ${t}` : `- ${t}`)).join('\n'));
    } else if ([...n.children].some((c) => BLOCK.has(c.tagName))) {
      blocks(n, out); // div שמכיל בלוקים
    } else {
      const t = cleanLines(inline(n));
      if (t) out.push(t);
    }
  }
  flush();
}

/** DOM של שדה מעוצב → Markdown */
export function toMarkdown(root) {
  const out = [];
  blocks(root, out);
  return out.join('\n\n');
}

/** שדה טקסט פשוט → מחרוזת בשורה אחת */
export const toPlain = (el) => (el.innerText ?? el.textContent).replace(/\u00a0/g, ' ').replace(/\s*\n\s*/g, ' ').replace(/[ \t]+/g, ' ').trim();

/* ---------- נתיבים: "content/home.json#/heroLead", "pages.json#/pages/[slug=updates]/body" ---------- */
export function parseBinding(b) {
  const [file, pointer = ''] = String(b).split('#');
  return { file: `assets/data/${file}`, pointer };
}
const segs = (pointer) => pointer.split('/').slice(1).map((s) => s.replace(/~1/g, '/').replace(/~0/g, '~'));
function step(obj, seg) {
  if (obj == null) return undefined;
  const m = /^\[([^=\]]+)=([^\]]*)\]$/.exec(seg);
  if (m && Array.isArray(obj)) return obj.find((x) => x && String(x[m[1]]) === m[2]);
  return obj[seg];
}
export function getAt(obj, pointer) {
  let cur = obj;
  for (const s of segs(pointer)) cur = step(cur, s);
  return cur;
}
export function setAt(obj, pointer, value) {
  const ss = segs(pointer);
  let cur = obj;
  for (let i = 0; i < ss.length - 1; i++) {
    let next = step(cur, ss[i]);
    if (next == null) {
      if (/^\[/.test(ss[i])) throw new Error(`לא נמצא הפריט ${ss[i]}`);
      next = /^\d+$/.test(ss[i + 1]) ? [] : {};
      cur[ss[i]] = next;
    }
    cur = next;
  }
  const last = ss[ss.length - 1];
  if (/^\[/.test(last)) throw new Error('נתיב לא חוקי');
  cur[last] = value;
}
