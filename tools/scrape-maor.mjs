#!/usr/bin/env node
/**
 * הורדת זמני "לוח המאור" (ישיבת אור החיים) – אופק תל אביב – לקובץ נתונים סטטי של האתר.
 *
 *   node tools/scrape-maor.mjs --from 2026-10-04 --to 2027-12-31
 *
 * אפשרויות:
 *   --from / --to   טווח תאריכים (כולל). ברירת מחדל: היום עד 31.12 של השנה הבאה.
 *   --out           קובץ הפלט (ברירת מחדל assets/data/maor-tel-aviv.json). ימים קיימים נשמרים וממוזגים.
 *   --cache         תיקיית מטמון של הדפים שנותחו (ברירת מחדל ~/.cache/maor-tel-aviv) – הרצה חוזרת לא מורידה שוב.
 *   --delay         השהיה בין בקשות במילישניות (ברירת מחדל 400). הבקשות נשלחות אחת-אחת.
 *   --refresh       להתעלם מהמטמון ולהוריד מחדש.
 *   --build-only    רק לבנות את קובץ הפלט מהמטמון, בלי הורדה.
 *
 * מקור: https://maor.orhachaim.org/?cal_day=DD&cal_month=MM&cal_year=YYYY&cal_city=IL-Tel%20Aviv
 * מכל דף נלקחים: עלות השחר, הנץ (זריחה), שקיעה, צאת הכוכבים, ותיבת "זמני השבת/חג"
 * (הדלקת נרות / צאת שבת / צאת ר"ת של השבת או החג הקרובים).
 * הדלקת הנרות נרשמת ביום שבו היא חלה, וצאת השבת/החג ור"ת – ביום שבו השבת/החג יוצאים.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = Object.fromEntries(process.argv.slice(2).reduce((a, x, i, arr) => {
  if (x.startsWith('--')) a.push([x.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true]);
  return a;
}, []));

const pad = (n) => String(n).padStart(2, '0');
const key = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const parseKey = (k) => new Date(`${k}T00:00:00Z`);
const addDays = (k, n) => { const d = parseKey(k); d.setUTCDate(d.getUTCDate() + n); return key(d); };
const todayIL = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(new Date());

const FROM = args.from || todayIL;
const TO = args.to || `${+todayIL.slice(0, 4) + 1}-12-31`;
const OUT = path.resolve(ROOT, args.out || 'assets/data/maor-tel-aviv.json');
const CACHE = path.resolve(args.cache || path.join(os.homedir(), '.cache', 'maor-tel-aviv'));
const DELAY = +(args.delay ?? 400);
const CITY = 'IL-Tel Aviv';
const SOURCE = 'https://maor.orhachaim.org/?cal_city=IL-Tel%20Aviv';

export const pageUrl = (k) => {
  const [y, m, d] = k.split('-');
  return `https://maor.orhachaim.org/?cal_day=${d}&cal_month=${m}&cal_year=${y}&cal_city=${encodeURIComponent(CITY)}`;
};

const decode = (s) => s.replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&#8221;|&#8220;/g, '"')
  .replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').trim();
/** "6:43" -> "06:43" */
const hhmm = (s) => { const m = /^(\d{1,2}):(\d{2})$/.exec(String(s || '').trim()); return m ? `${pad(m[1])}:${m[2]}` : null; };

/** ניתוח דף יומי של לוח המאור */
export function parsePage(html) {
  const out = { zmanim: {}, shabbat: {}, parasha: null, pageDate: null };
  const dm = /or-hachiem-times-date">[^<]*?\/\s*(\d{4}-\d{2}-\d{2})/.exec(html);
  out.pageDate = dm && dm[1];
  // זמני היום (תיבות label/time)
  const re = /orhachim-zman-label[^>]*>([^<]+)<\/span>\s*<span[^>]*orhachim-zman-time[^>]*>([^<]+)</g;
  for (let m; (m = re.exec(html));) { const k = decode(m[1]); if (!(k in out.zmanim)) out.zmanim[k] = decode(m[2]); }
  // עלות השחר / צאת הכוכבים מופיעים בהערת HTML בדף
  const a = /\[עה(?:"|&quot;)ש\]\s*=>\s*([\d:]+)/.exec(html); if (a) out.zmanim['עלות השחר'] = a[1];
  const t = /\[צאת-הכוכבים\]\s*=>\s*([\d:]+)/.exec(html); if (t) out.zmanim['צאת הכוכבים'] = t[1];
  // תיבת זמני השבת/חג
  const p = /class="orh-parasha">([^<]*)</.exec(html); out.parasha = p ? decode(p[1]) : null;
  const sre = /shabbot-times-desc">([^<]+)<\/td>\s*<td class="shabbot-times-time">([^<]+)</g;
  for (let m; (m = sre.exec(html));) out.shabbat[decode(m[1])] = decode(m[2]);
  return out;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function fetchDay(k) {
  const file = path.join(CACHE, `${k}.json`);
  if (!args.refresh && fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  let lastErr;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const res = await fetch(pageUrl(k), { headers: { 'User-Agent': 'agudat-shalom-site maor scraper (zmanim for synagogue website)' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const parsed = parsePage(await res.text());
      if (parsed.pageDate !== k) throw new Error(`page date ${parsed.pageDate} != ${k}`);
      if (!parsed.zmanim['הנץ החמה'] || !parsed.zmanim['שקיעה']) throw new Error('missing sunrise/sunset');
      const rec = { date: k, url: pageUrl(k), fetchedAt: new Date().toISOString(), ...parsed };
      fs.writeFileSync(file, JSON.stringify(rec));
      await sleep(DELAY);
      return rec;
    } catch (e) { lastErr = e; await sleep(2000 * attempt); }
  }
  console.error(`✗ ${k}: ${lastErr}`);
  return null;
}

/**
 * בניית הרשומה היומית מהדפים שנותחו.
 * תיבת "זמני השבת/חג" בכל דף מציגה את השבת הקרובה (ובשבת עצמה – כבר את השבת הבאה),
 * ולכן: הדלקת הנרות נלקחת מדף ערב השבת/החג עצמו, וצאת השבת/החג ור"ת – מדף ערב השבת/החג שפתח את אותה שבת/חג.
 * אילו ימים הם ערב/צאת נקבע לפי @hebcal/core (מנהג ארץ ישראל). כל ערך נבדק מול השקיעה של לוח המאור
 * (הדלקה ≈ שקיעה − 20, צאת ≈ שקיעה + 20..45); ערך שאינו מתאים לא נרשם (והאתר יחשב משקיעת הלוח).
 */
export function buildDays(recs, hc, log = console.warn) {
  const days = {};
  const keys = Object.keys(recs).sort();
  const toMin = (t) => { const m = /^(\d{2}):(\d{2})$/.exec(t || ''); return m ? +m[1] * 60 + +m[2] : null; };
  for (const k of keys) {
    const z = recs[k].zmanim;
    days[k] = { alot: hhmm(z['עלות השחר']), sunrise: hhmm(z['הנץ החמה']), sunset: hhmm(z['שקיעה']), tzeit: hhmm(z['צאת הכוכבים']) };
  }
  const loc = new hc.Location(32.0853, 34.7818, true, 'Asia/Jerusalem', 'Tel Aviv', 'IL');
  const evs = (k) => {
    const [y, m, d] = k.split('-').map(Number);
    const dt = new Date(y, m - 1, d);
    const out = { candle: null, havdalah: null };
    for (const e of hc.HebrewCalendar.calendar({ start: dt, end: dt, location: loc, il: true, candlelighting: true, noModern: true })) {
      if (e.getDesc() === 'Candle lighting') out.candle = e.eventTime;
      if (e.getDesc() === 'Havdalah') out.havdalah = e.eventTime;
    }
    // הדלקה "אחרי צאת" (ליל חג שני / חג במוצאי שבת) מזוהה לפי שעה מאוחרת מהשקיעה
    const sunset = toMin(days[k]?.sunset);
    const hm = (t) => { const p = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jerusalem', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(t); return toMin(p); };
    out.erev = !!out.candle && sunset != null && hm(out.candle) < sunset;
    out.candleAfterTzeit = !!out.candle && !out.erev;
    return out;
  };
  const W = (k, name) => hhmm(recs[k]?.shabbat?.[name]);
  for (const k of keys) {
    const e = evs(k);
    const ss = toMin(days[k].sunset);
    if (e.erev) {
      const c = W(k, 'הדלקת נרות');
      if (c && Math.abs(ss - 20 - toMin(c)) <= 1) days[k].candle = c;
      else log(`! ${k}: ערב שבת/חג – הדלקת נרות בתיבה ${c} לא תואמת שקיעה ${days[k].sunset} − 20`);
    }
    if (e.havdalah || e.candleAfterTzeit) {
      // ערב השבת/החג שפתח את הרצף
      let erev = null;
      // אם בדרך יש יציאה קודמת (למשל שבת שאחריה חג – הדלקה אחרי צאת), הערך בתיבה שייך ליציאה הקודמת;
      // ליציאה הסופית אין אז ערך בתיבה, והאתר יחשב שקיעה + 31 כמנהג הלוח.
      for (let i = 1; i <= 3; i++) {
        const p = addDays(k, -i); if (!recs[p]) break;
        const ep = evs(p);
        if (ep.erev) { erev = p; break; }
        if (ep.candleAfterTzeit) break;
      }
      const end = erev && W(erev, 'צאת שבת'), rt = erev && W(erev, 'צאת ר"ת');
      const diff = end != null ? toMin(end) - ss : null;
      if (end && diff >= 20 && diff <= 45) {
        days[k].havdalah = end;
        if (rt) days[k].rt = rt;
      } else if (erev) log(`! ${k}: צאת שבת/חג – בתיבה (${erev}) ${end} לא תואם שקיעה ${days[k].sunset}`);
      else log(`i ${k}: אין ערך צאת בתיבת לוח המאור (חג שאחרי שבת / חסר דף ערב) – האתר יחשב שקיעה + 31`);
    }
  }
  return days;
}

async function main() {
  fs.mkdirSync(CACHE, { recursive: true });
  const recs = {};
  // המטמון כולו משמש לבנייה (כך שגם טווחים קודמים נשמרים)
  for (const f of fs.readdirSync(CACHE)) if (/^\d{4}-\d{2}-\d{2}\.json$/.test(f)) {
    const r = JSON.parse(fs.readFileSync(path.join(CACHE, f), 'utf8')); recs[r.date] = r;
  }
  if (!args['build-only']) {
    let n = 0;
    for (let k = FROM; k <= TO; k = addDays(k, 1)) {
      const r = await fetchDay(k);
      if (r) recs[k] = r;
      if (++n % 25 === 0) console.log(`${k} נץ ${r?.zmanim['הנץ החמה']} שקיעה ${r?.zmanim['שקיעה']}`);
    }
  }
  let existing = {};
  if (fs.existsSync(OUT)) try { existing = JSON.parse(fs.readFileSync(OUT, 'utf8')).days || {}; } catch {}
  const hc = await import('../assets/vendor/hebcal-core.min.js');
  const days = { ...existing, ...buildDays(recs, hc) };
  const ks = Object.keys(days).sort();
  const data = {
    source: SOURCE, city: CITY, name: 'לוח המאור – ישיבת אור החיים – אופק תל אביב',
    note: 'נץ = זריחה נראית לפי לוח המאור. נוצר ע"י tools/scrape-maor.mjs',
    generatedAt: new Date().toISOString(), from: ks[0], to: ks[ks.length - 1],
    days: Object.fromEntries(ks.map((k) => [k, days[k]])),
  };
  fs.writeFileSync(OUT, JSON.stringify(data, null, 0).replace(/("\d{4}-\d{2}-\d{2}":)/g, '\n$1') + '\n');
  console.log(`נשמר ${OUT}: ${ks.length} ימים, ${data.from} – ${data.to}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
