// התחברות מנהל מול Netlify Identity (GoTrue) – בקשות לאותו מקור בלבד (/.netlify/identity), ללא סקריפט צד שלישי.
// ההתחברות נשמרת ב-localStorage במפתח "gotrue.user" – אותו פורמט של netlify-identity-widget,
// כך שמי שמחובר למערכת הניהול (/admin) מחובר גם לעריכה הוויזואלית, ולהפך.

export const IDENTITY = '/.netlify/identity';
const KEY = 'gotrue.user';

export class AuthError extends Error {
  constructor(msg, code) { super(msg); this.name = 'AuthError'; this.code = code; }
}

export function getSession() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || 'null');
    return s && s.token && s.token.access_token ? s : null;
  } catch { return null; }
}
const save = (s) => { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* ignore */ } };
export function clearSession() { try { localStorage.removeItem(KEY); } catch { /* ignore */ } }

/** expires_at מתוך ה-JWT (כמו gotrue-js), או מ-expires_in */
function tokenDetails(t) {
  let exp = Date.now() + (Number(t.expires_in) || 3600) * 1000;
  try {
    const b = t.access_token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const claims = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(b), (c) => c.charCodeAt(0))));
    if (claims.exp) exp = claims.exp * 1000;
  } catch { /* טוקן לא-JWT – משתמשים ב-expires_in */ }
  return { access_token: t.access_token, token_type: t.token_type || 'bearer', expires_in: t.expires_in, refresh_token: t.refresh_token, expires_at: exp };
}

async function tokenRequest(params) {
  let res;
  try {
    res = await fetch(`${IDENTITY}/token`, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(params).toString(), credentials: 'same-origin',
    });
  } catch { throw new AuthError('אין חיבור לשרת. בדקו את החיבור לאינטרנט ונסו שוב.', 'network'); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const d = `${data.error_description || data.msg || data.error || ''}`;
    if (res.status === 400 || res.status === 401) {
      if (/confirm/i.test(d)) throw new AuthError('כתובת האימייל עדיין לא אושרה. יש לאשר את ההזמנה מהמייל.', 'unconfirmed');
      throw new AuthError(params.grant_type === 'password' ? 'האימייל או הסיסמה שגויים.' : 'פג תוקף ההתחברות. יש להתחבר מחדש.', 'invalid');
    }
    throw new AuthError(`שגיאת התחברות (${res.status}). נסו שוב בעוד רגע.`, 'server');
  }
  return data;
}

async function fetchUser(access) {
  const res = await fetch(`${IDENTITY}/user`, { headers: { Authorization: `Bearer ${access}` } });
  if (!res.ok) throw new AuthError('לא ניתן לאמת את המשתמש.', 'invalid');
  return res.json();
}

export async function login(email, password) {
  const t = await tokenRequest({ grant_type: 'password', username: String(email).trim(), password });
  const user = await fetchUser(t.access_token);
  const s = { ...user, url: `${location.origin}${IDENTITY}`, token: tokenDetails(t) };
  save(s);
  return s;
}

async function refresh(s) {
  if (!s?.token?.refresh_token) throw new AuthError('פג תוקף ההתחברות. יש להתחבר מחדש.', 'expired');
  try {
    const t = await tokenRequest({ grant_type: 'refresh_token', refresh_token: s.token.refresh_token });
    const ns = { ...s, token: tokenDetails(t) };
    save(ns);
    return ns.token.access_token;
  } catch (e) {
    if (e.code !== 'network') clearSession();
    throw new AuthError(e.code === 'network' ? e.message : 'פג תוקף ההתחברות. יש להתחבר מחדש.', e.code === 'network' ? 'network' : 'expired');
  }
}

/** טוקן גישה בתוקף (מתחדש אוטומטית דקה לפני שפג) */
export async function jwt(force = false) {
  const s = getSession();
  if (!s) throw new AuthError('יש להתחבר כמנהל.', 'expired');
  if (force || !s.token.expires_at || s.token.expires_at - 60000 < Date.now()) return refresh(s);
  return s.token.access_token;
}

/** fetch מאומת: אם השרת מחזיר 401 – חידוש אחד ונסיון חוזר, ואחר כך AuthError */
export async function authFetch(url, opts = {}) {
  const go = async (token) => fetch(url, { ...opts, headers: { ...(opts.headers || {}), Authorization: `Bearer ${token}` } });
  let res = await go(await jwt());
  if (res.status === 401) res = await go(await jwt(true));
  if (res.status === 401) { clearSession(); throw new AuthError('פג תוקף ההתחברות. יש להתחבר מחדש.', 'expired'); }
  return res;
}

export async function logout() {
  const s = getSession();
  if (s) fetch(`${IDENTITY}/logout`, { method: 'POST', headers: { Authorization: `Bearer ${s.token.access_token}` } }).catch(() => {});
  clearSession();
}
