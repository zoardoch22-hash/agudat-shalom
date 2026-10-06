// שמירה למאגר GitHub דרך Netlify Git Gateway (אותו מקור: /.netlify/git/github) עם ה-JWT של Identity.
// קריאה: GET contents/<path>?ref=… (base64 + sha). כתיבה: commit אחד לכל שמירה דרך Git Data API
// (blobs → tree → commit → עדכון ref), עם ניסיון חוזר אם מישהו אחר שמר בינתיים (השינויים מוחלים מחדש על הגרסה העדכנית).
import { authFetch, AuthError } from './auth.js';

export const GATEWAY = '/.netlify/git/github';
export const BRANCH = 'main'; // כמו backend.branch ב-admin/config.yml

export class GatewayError extends Error {
  constructor(msg, status) { super(msg); this.name = 'GatewayError'; this.status = status; }
}

/* ---------- base64 עם UTF-8 (עברית) ---------- */
export function bytesToBase64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
export const utf8ToBase64 = (str) => bytesToBase64(new TextEncoder().encode(str));
export function base64ToUtf8(b64) {
  const bin = atob(String(b64).replace(/\s/g, ''));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

async function api(path, opts = {}) {
  let res;
  try {
    res = await authFetch(`${GATEWAY}/${path}`, {
      ...opts, headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
      body: opts.body ? JSON.stringify(opts.body) : undefined, cache: 'no-store',
    });
  } catch (e) {
    if (e instanceof AuthError) throw e;
    throw new GatewayError('אין חיבור לשרת. בדקו את החיבור לאינטרנט ונסו שוב.', 0);
  }
  if (res.status === 403) throw new GatewayError('אין למשתמש הרשאה לשמור שינויים באתר.', 403);
  if (!res.ok) throw new GatewayError(`שגיאת שמירה (${res.status}).`, res.status);
  return res.status === 204 ? null : res.json();
}

const encPath = (p) => p.split('/').map(encodeURIComponent).join('/');

/** קובץ מהמאגר: { text, sha } או null אם לא קיים */
export async function readFile(path, ref = BRANCH) {
  try {
    const d = await api(`contents/${encPath(path)}?ref=${encodeURIComponent(ref)}`);
    return { text: base64ToUtf8(d.content || ''), sha: d.sha };
  } catch (e) {
    if (e instanceof GatewayError && e.status === 404) return null;
    throw e;
  }
}
export async function readJSON(path, ref = BRANCH) {
  const f = await readFile(path, ref);
  if (!f) return null;
  return { data: JSON.parse(f.text), text: f.text, sha: f.sha };
}

/**
 * commit אחד:
 *  jsonEdits: { 'assets/data/x.json': (data) => void }  – פונקציה שמשנה את ה-JSON העדכני מהמאגר
 *  uploads:   [{ path, base64 }]                         – קבצים בינאריים (תמונות)
 * מחזיר { commit, files } או null אם אין מה לשמור.
 */
export async function commitChanges({ jsonEdits = {}, uploads = [], message }) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const ref = await api(`git/refs/heads/${BRANCH}`);
    const head = ref.object.sha;
    const base = await api(`git/commits/${head}`);
    const entries = [];
    for (const [path, edit] of Object.entries(jsonEdits)) {
      const cur = await readFile(path, head);
      const data = cur ? JSON.parse(cur.text) : {};
      edit(data);
      const nl = !cur || cur.text.endsWith('\n') ? '\n' : '';
      const text = JSON.stringify(data, null, 2) + nl;
      if (cur && text === cur.text) continue;
      const blob = await api('git/blobs', { method: 'POST', body: { content: utf8ToBase64(text), encoding: 'base64' } });
      entries.push({ path, mode: '100644', type: 'blob', sha: blob.sha });
    }
    for (const u of uploads) {
      const blob = await api('git/blobs', { method: 'POST', body: { content: u.base64, encoding: 'base64' } });
      entries.push({ path: u.path, mode: '100644', type: 'blob', sha: blob.sha });
    }
    if (!entries.length) return null;
    const tree = await api('git/trees', { method: 'POST', body: { base_tree: base.tree.sha, tree: entries } });
    const commit = await api('git/commits', { method: 'POST', body: { message, tree: tree.sha, parents: [head] } });
    try {
      await api(`git/refs/heads/${BRANCH}`, { method: 'PATCH', body: { sha: commit.sha, force: false } });
      return { commit: commit.sha, files: entries.map((e) => e.path) };
    } catch (e) {
      // 422/409 = הענף התקדם בינתיים (שמירה אחרת) – מנסים שוב על הגרסה העדכנית
      if (!(e instanceof GatewayError) || ![409, 422].includes(e.status) || attempt === 3) throw e;
    }
  }
  return null;
}
