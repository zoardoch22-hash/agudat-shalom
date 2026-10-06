/**
 * חישוב לוח הזמנים היומי – לוגיקה טהורה (ללא DOM), כך שניתן לבדוק אותה גם ב-Node.
 * הפונקציות מקבלות את ספריית @hebcal/core כפרמטר (hc).
 */

const MIN = 60 * 1000;

/* ---------- עזרי תאריך / אזור זמן ---------- */

/** התאריך הנוכחי (שנה/חודש/יום) באזור הזמן הנתון */
export function ymdInTz(date, tz) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' })
      .formatToParts(date).map((x) => [x.type, x.value]));
  return { y: +p.year, m: +p.month, d: +p.day };
}

export function addDays(ymd, n) {
  const t = new Date(Date.UTC(ymd.y, ymd.m - 1, ymd.d + n));
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
}

export const ymdKey = (o) => `${o.y}-${String(o.m).padStart(2, '0')}-${String(o.d).padStart(2, '0')}`;

/** הפרש אזור הזמן (בדקות) ברגע נתון */
export function tzOffsetMinutes(date, tz) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).formatToParts(date).map((x) => [x.type, x.value]));
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second);
  return Math.round((asUtc - Math.floor(date.getTime() / 1000) * 1000) / MIN);
}

/** שעה מקומית (HH:MM) בתאריך נתון באזור הזמן -> Date */
export function zonedDate(ymd, hhmm, tz) {
  const [h, mi] = hhmm.split(':').map(Number);
  const guess = Date.UTC(ymd.y, ymd.m - 1, ymd.d, h, mi);
  let off = tzOffsetMinutes(new Date(guess), tz);
  let res = new Date(guess - off * MIN);
  const off2 = tzOffsetMinutes(res, tz);
  if (off2 !== off) res = new Date(guess - off2 * MIN);
  return res;
}

export const floorMin = (d) => new Date(Math.floor(d.getTime() / MIN) * MIN);
export const ceilMin = (d) => new Date(Math.ceil(d.getTime() / MIN) * MIN);
const minus = (d, mins) => new Date(d.getTime() - mins * MIN);

export function fmtTime(date, tz, seconds = false) {
  return new Intl.DateTimeFormat('he-IL', {
    timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    ...(seconds ? { second: '2-digit' } : {}),
  }).format(date);
}

/** קיץ = שעון קיץ ישראלי בתוקף (נבדק בצהרי היום) */
export function isSummer(ymd, cfg) {
  if (cfg.season === 'summer') return true;
  if (cfg.season === 'winter') return false;
  const tz = cfg.location.tzid;
  const noon = new Date(Date.UTC(ymd.y, ymd.m - 1, ymd.d, 10, 0));
  const jan = new Date(Date.UTC(ymd.y, 0, 1, 10, 0));
  return tzOffsetMinutes(noon, tz) > tzOffsetMinutes(jan, tz);
}

const DAY_NAMES = ['יום ראשון', 'יום שני', 'יום שלישי', 'יום רביעי', 'יום חמישי', 'יום שישי', 'שבת קודש'];

/* ---------- חישוב יום ---------- */

export function makeLocation(hc, cfg) {
  const L = cfg.location;
  return new hc.Location(L.latitude, L.longitude, true, L.tzid, L.hebcalCity || L.name, 'IL', undefined, L.elevation || 0);
}

/**
 * עיגול מנחה קטנה של שבת (והשיעור שלפניה) לעשרות דקות:
 * ספרת דקות 0–4 – מטה לעשרת, 5 – נשאר, 6–9 – מעלה לעשרת הבאה.
 */
export function roundToTenRule(date) {
  const d = floorMin(date);
  const digit = Math.round(d.getTime() / MIN) % 10; // אזורי הזמן בישראל בשעות שלמות – הספרה זהה לשעון המקומי
  if (digit === 5) return d;
  return new Date(d.getTime() + (digit <= 4 ? -digit : 10 - digit) * MIN);
}

/**
 * חישוב משוער (גיבוי) כשאין נתון מלוח המאור לתאריך:
 * hebcal בגובה פני הים + תיקון "זריחה נראית" (לכל חצי חודש) ותיקון שקיעה (לכל חודש) שכוילו מול נתוני לוח המאור לתל אביב, הדלקת נרות = שקיעה − 20, צאת שבת = שקיעה + 31 (כמו בלוח המאור).
 */
export const FALLBACK = {
  // תיקון הנץ בשניות, לכל חצי חודש (1–15, 16–סוף): ינואר א׳, ינואר ב׳, ... דצמבר ב׳ – "זריחה נראית" של לוח המאור
  sunriseOffsetSec: [315, 320, 315, 300, 278, 245, 235, 230, 230, 211, 203, 198, 196, 215, 238, 235, 239, 266, 289, 308, 332, 312, 313, 317],
  // תיקון השקיעה בשניות לכל חודש (ינואר..דצמבר)
  sunsetOffsetSec: [26, 15, 11, 6, -2, -1, -4, -2, -4, 6, 19, 25],
  // צאת הכוכבים (חול) = שקיעה + דקות, לכל חודש
  tzeitMins: [13, 13, 14, 16, 17, 17, 17, 16, 15, 14, 13, 12],
  candleMins: 20,
  havdalahMins: 31,
};

/** נץ/שקיעה משוערים: hebcal בגובה פני הים + תיקון, מעוגל למעלה לדקה (כפי שמתקבל בלוח המאור) */
export function fallbackZmanim(zm, ymd) {
  const half = (ymd.m - 1) * 2 + (ymd.d > 15 ? 1 : 0);
  const sunrise = ceilMin(new Date(zm.sunrise().getTime() + FALLBACK.sunriseOffsetSec[half] * 1000));
  const sunset = ceilMin(new Date(zm.sunset().getTime() + FALLBACK.sunsetOffsetSec[ymd.m - 1] * 1000));
  const tzeit = new Date(sunset.getTime() + FALLBACK.tzeitMins[ymd.m - 1] * MIN);
  return { sunrise, sunset, tzeit };
}

/**
 * מחזיר את כל נתוני היום: תאריך עברי, זמני היום ותפילות.
 * @param hc    מודול @hebcal/core
 * @param cfg   CONFIG
 * @param ymd   {y,m,d} – תאריך אזרחי (לפי שעון ישראל)
 * @param loc   hc.Location (אופציונלי)
 * @param maor  נתוני לוח המאור (assets/data/maor-tel-aviv.json) – אם קיימים לתאריך, הנץ/השקיעה/הדלקת הנרות/צאת השבת נלקחים מהם
 */
export function computeDay(hc, cfg, ymd, loc = makeLocation(hc, cfg), maor = null) {
  const tz = cfg.location.tzid;
  const L = cfg.location;
  const civil = new Date(ymd.y, ymd.m - 1, ymd.d); // hebcal משתמש בשדות התאריך המקומיים
  const dow = new Date(Date.UTC(ymd.y, ymd.m - 1, ymd.d)).getUTCDay();
  const hd = new hc.HDate(civil);
  const zm = new hc.Zmanim(loc, civil, !!L.useElevation);
  const summer = isSummer(ymd, cfg);
  const at = (hhmm) => zonedDate(ymd, hhmm, tz);
  const key = ymdKey(ymd);
  const M = (maor && maor.days && maor.days[key]) || null;
  const fromMaor = !!(M && M.sunrise && M.sunset);

  const calOpts = {
    start: civil, end: civil, location: loc, il: true,
    candlelighting: true, sedrot: true, noModern: true,
  };
  if (typeof L.candleLightingMins === 'number' && L.candleLightingMins > 0) calOpts.candleLightingMins = L.candleLightingMins;
  const events = hc.HebrewCalendar.calendar(calOpts);
  const F = hc.flags;

  // hebcal קובע רק *אילו* ימים הם ערב שבת/חג וצאת שבת/חג, ואת התאריך העברי/פרשה/חגים
  let hcCandle = null, hcHavdalah = null, parasha = null;
  const holidays = [];
  let isYomTov = false, isYomKippur = false, isErevYK = false;
  for (const e of events) {
    const desc = e.getDesc();
    const fl = e.getFlags();
    if (desc === 'Candle lighting') hcCandle = e.eventTime;
    else if (desc === 'Havdalah') hcHavdalah = e.eventTime;
    else if (fl & F.PARSHA_HASHAVUA) parasha = e.render('he-x-NoNikud');
    else {
      if (fl & F.CHAG) isYomTov = true;
      if (desc === 'Yom Kippur') isYomKippur = true;
      if (desc === 'Erev Yom Kippur') isErevYK = true;
      holidays.push(e.render('he-x-NoNikud'));
    }
  }

  // ---- זמני היום: לוח המאור, ובהיעדרו – חישוב משוער ----
  let sunrise, sunset, alot = null, tzeitStars, candle = null, tzeit, rt = null;
  const fb = fallbackZmanim(zm, ymd);
  if (fromMaor) {
    sunrise = at(M.sunrise);
    sunset = at(M.sunset);
    alot = M.alot ? at(M.alot) : null;
    tzeitStars = M.tzeit ? at(M.tzeit) : null;
  } else {
    ({ sunrise, sunset } = fb);
    tzeitStars = fb.tzeit;
  }
  const derivedHavdalah = () => new Date(sunset.getTime() + FALLBACK.havdalahMins * MIN);
  // הדלקת נרות: מלוח המאור; אם חסר (או ערב חג שאינו מופיע בתיבת השבת) – שקיעה − 20 כמנהג הלוח
  const candleAfterTzeit = hcCandle && hcCandle > sunset; // ליל יום טוב שני/מוצ"ש שהוא חג – הדלקה אחרי צאת
  if (hcCandle) {
    if (candleAfterTzeit) candle = fromMaor && M.havdalah ? at(M.havdalah) : derivedHavdalah();
    else candle = fromMaor && M.candle ? at(M.candle) : new Date(sunset.getTime() - FALLBACK.candleMins * MIN);
  }
  const hasHavdalah = !!hcHavdalah;
  if (hasHavdalah) {
    tzeit = fromMaor && M.havdalah ? at(M.havdalah) : derivedHavdalah();
    if (fromMaor && M.rt) rt = at(M.rt);
  } else if (candleAfterTzeit) {
    tzeit = candle; // צאת השבת/החג שאחריו חג נוסף
  } else {
    tzeit = tzeitStars || fb.tzeit;
  }

  const isShabbat = dow === 6;
  const shabbatMode = isShabbat || (isYomTov && cfg.yomTovAsShabbat && !isYomKippur);
  const isErev = !!hcCandle && !candleAfterTzeit && !isYomKippur; // ערב שבת / ערב חג (גם יום טוב שבערב שבת)
  const seasonKey = summer ? 'summer' : 'winter';

  const prayers = [];
  const lessons = [];
  const notes = [];

  const erevPrayers = (R) => {
    const isFri = dow === 5;
    const minchaK = minus(sunset, R.minchaKetanaBeforeShkiaMins);
    const kabbalat = minus(sunset, R.kabbalatShabbatBeforeShkiaMins);
    prayers.push({ key: 'minchaK', label: 'מנחה קטנה', date: minchaK, note: `${R.minchaKetanaBeforeShkiaMins} דק׳ לפני השקיעה` });
    prayers.push({ key: 'kabbalat', label: isFri ? 'קבלת שבת ותפילת ערבית' : 'ערבית של חג', date: kabbalat, note: `${R.kabbalatShabbatBeforeShkiaMins} דק׳ לפני השקיעה` });
  };

  if (isYomKippur) {
    notes.push('יום הכיפורים – סדר התפילות יפורסם בבית הכנסת.');
  } else if (shabbatMode) {
    const R = cfg.rules.shabbat;
    prayers.push({ key: 'shacharit', label: 'שחרית', date: at(R.shacharit), note: R.shacharitNote });
    prayers.push({ key: 'minchaG', label: 'מנחה גדולה', date: at(R.minchaGedola[seasonKey]) });
    if (isErev) {
      // יום טוב שחל בערב שבת: מנחה וקבלת שבת כבערב שבת
      erevPrayers(cfg.rules.friday);
    } else {
      const minchaK = roundToTenRule(minus(sunset, R.minchaKetanaBeforeShkiaMins));
      const lessonT = minus(minchaK, R.lessonBeforeMinchaKetanaMins);
      lessons.push({ key: 'lessonShabbat', label: `שיעור עם ${R.lessonTeacher}`, date: lessonT, note: 'שעה לפני מנחה קטנה' });
      prayers.push({ key: 'minchaK', label: 'מנחה קטנה', date: minchaK, note: `${R.minchaKetanaBeforeShkiaMins} דק׳ לפני השקיעה, בעיגול` });
      const exitNote = candleAfterTzeit ? 'בצאת השבת/החג' : (isShabbat ? 'בצאת השבת' : 'בצאת החג');
      prayers.push({ key: 'arvit', label: isShabbat && !candleAfterTzeit ? 'ערבית מוצאי שבת' : 'ערבית', date: tzeit, note: exitNote });
    }
  } else {
    const R = cfg.rules.weekday;
    const shacharit = minus(sunrise, R.shacharitBeforeNetzMins);
    prayers.push({ key: 'shacharit', label: 'שחרית', date: shacharit, note: `${R.shacharitBeforeNetzMins} דק׳ לפני הנץ` });
    prayers.push({ key: 'minchaG', label: 'מנחה גדולה', date: at(R.minchaGedola[seasonKey]) });
    if (isErev && isErevYK) {
      notes.push('ערב יום הכיפורים – מנחה וכל נדרי לפי הודעה בבית הכנסת.');
    } else if (isErev) {
      erevPrayers(cfg.rules.friday);
    } else {
      const minchaK = minus(sunset, R.minchaKetanaBeforeShkiaMins);
      if (summer) lessons.push({ key: 'lessonBefore', label: 'שיעור תורה', date: minus(minchaK, R.lessonBeforeMinchaMins), note: 'שעה לפני מנחה' });
      prayers.push({ key: 'minchaK', label: 'מנחה קטנה', date: minchaK, note: `${R.minchaKetanaBeforeShkiaMins} דק׳ לפני השקיעה` });
      if (!summer) lessons.push({ key: 'lessonAfterMincha', label: 'שיעור תורה (כשעה)', after: 'לאחר מנחה' });
      prayers.push({ key: 'arvit', label: 'ערבית', date: sunset, note: 'בשקיעה, ולאחריה שיעור' });
      lessons.push({ key: 'lessonAfterArvit', label: summer ? 'שיעור תורה' : 'שיעור תורה (כשעה)', after: 'לאחר ערבית' });
      if (dow === 3) lessons.push({ key: 'wednesday', label: 'שיעור הרב אליהו שליט"א – סעודה, שירים וניגונים', after: 'ביום רביעי', special: true });
    }
  }
  if (!fromMaor) notes.push('לתאריך זה אין עדיין נתונים מלוח המאור – הזמנים משוערים (חישוב) ועשויים לסטות בדקה-שתיים.');

  const k = cfg.kollel;
  const kollel = (!shabbatMode && !isYomKippur && k.days.includes(dow))
    ? { title: k.title, start: k[seasonKey].start, end: k[seasonKey].end } : null;

  const timeline = [...prayers, ...lessons.filter((l) => l.date)].sort((a, b) => a.date - b.date);
  for (const it of [...prayers, ...lessons]) if (it.date) it.time = fmtTime(it.date, tz);

  const src = cfg.zmanimSource || {};
  return {
    ymd, key, dow, dayName: DAY_NAMES[dow],
    gregLabel: new Intl.DateTimeFormat('he-IL', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
      .format(new Date(Date.UTC(ymd.y, ymd.m - 1, ymd.d))),
    hebrewDate: hd.renderGematriya(true),
    season: seasonKey, seasonLabel: summer ? 'שעון קיץ' : 'שעון חורף',
    isShabbat, isYomTov, isYomKippur, shabbatMode, isErev,
    parasha, holidays,
    source: fromMaor ? 'maor' : 'calc',
    sourceLabel: fromMaor ? (src.label || 'לפי לוח המאור – אופק תל אביב') : 'חישוב משוער (אין נתוני לוח המאור לתאריך זה)',
    zmanim: {
      alot, alotStr: alot ? fmtTime(alot, tz) : null,
      sunrise, sunset,
      sunriseStr: fmtTime(sunrise, tz), sunsetStr: fmtTime(sunset, tz),
      candle, candleStr: candle ? fmtTime(candle, tz) : null,
      candleMinsBeforeSunset: candle && !candleAfterTzeit ? Math.round((sunset - candle) / MIN) : null,
      tzeit, tzeitStr: fmtTime(tzeit, tz), hasHavdalah,
      rt, rtStr: rt ? fmtTime(rt, tz) : null,
    },
    prayers, lessons, notes, kollel, timeline,
  };
}

/** השבת הקרובה (היום אם היום שבת) */
export function nextShabbatYmd(ymd) {
  const dow = new Date(Date.UTC(ymd.y, ymd.m - 1, ymd.d)).getUTCDay();
  return addDays(ymd, (6 - dow + 7) % 7);
}

/** הפריט הבא בלוח (תפילה/שיעור) אחרי הרגע now */
export function nextItem(day, now) {
  return day.timeline.find((it) => it.date > now) || null;
}
