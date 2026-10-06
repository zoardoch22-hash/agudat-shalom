// בדיקת חישוב הזמנים: node tests/schedule.test.mjs
// משתמש בעותק המקומי של hebcal (assets/vendor) ובנתוני לוח המאור (assets/data/maor-tel-aviv.json) – אין צורך בהתקנה.
import { readFileSync } from 'node:fs';
import * as hc from '../assets/vendor/hebcal-core.min.js';
import { CONFIG } from '../assets/js/config.js';
import { computeDay, nextShabbatYmd, roundToTenRule, zonedDate, fmtTime, addDays, ymdKey } from '../assets/js/schedule.js';

const MAOR = JSON.parse(readFileSync(new URL('../assets/data/maor-tel-aviv.json', import.meta.url), 'utf8'));
const TZ = 'Asia/Jerusalem';
let fail = 0;
const eq = (name, got, want) => {
  const ok = got === want;
  if (!ok) fail++;
  console.log(`${ok ? '✓' : '✗'} ${name}: ${got}${ok ? '' : ` (expected ${want})`}`);
};
const show = (d) => {
  console.log(`\n=== ${d.key} ${d.dayName} | ${d.hebrewDate} | ${d.seasonLabel}${d.parasha ? ' | ' + d.parasha : ''}${d.holidays.length ? ' | ' + d.holidays.join(', ') : ''} | ${d.sourceLabel}`);
  console.log(`  נץ ${d.zmanim.sunriseStr} | שקיעה ${d.zmanim.sunsetStr} | צאת ${d.zmanim.tzeitStr}${d.zmanim.candleStr ? ' | הדלקת נרות ' + d.zmanim.candleStr : ''}${d.zmanim.rtStr ? ' | ר"ת ' + d.zmanim.rtStr : ''}`);
  for (const p of d.prayers) console.log(`  ${p.label}: ${p.time}${p.note ? ' (' + p.note + ')' : ''}`);
  for (const l of d.lessons) console.log(`  ${l.label}: ${l.time || l.after}`);
  for (const n of d.notes) console.log(`  * ${n}`);
  if (d.kollel) console.log(`  כולל: ${d.kollel.start}-${d.kollel.end}`);
};
const day = (y, m, d, maor = MAOR) => computeDay(hc, CONFIG, { y, m, d }, undefined, maor);
const P = (d, k) => d.prayers.find((p) => p.key === k)?.time;
const Lsn = (d, k) => d.lessons.find((p) => p.key === k)?.time;

eq('source label', CONFIG.zmanimSource.label, 'לפי לוח המאור – אופק תל אביב');

// 1) נתוני לוח המאור – כיסוי רציף
const keys = Object.keys(MAOR.days).sort();
eq('maor data starts by 2026-10-04', keys[0] <= '2026-10-04', true);
eq('maor data reaches 2027-12-31', keys[keys.length - 1] >= '2027-12-31', true);
let gaps = 0, missingCandle = [], missingHavdalah = [];
for (let k = keys[0], i = 0; k <= keys[keys.length - 1]; i++) {
  if (!MAOR.days[k]?.sunrise || !MAOR.days[k]?.sunset) gaps++;
  const [y, m, d] = k.split('-').map(Number);
  const r = day(y, m, d);
  if (r.isErev && !MAOR.days[k]?.candle) missingCandle.push(k);
  if (r.zmanim.hasHavdalah && !MAOR.days[k]?.havdalah) missingHavdalah.push(k);
  k = ymdKey(addDays({ y, m, d }, 1));
}
eq('no missing days in maor data', gaps, 0);
eq('every erev Shabbat/chag has maor candle lighting', missingCandle.join(',') || 'none', 'none');
// 3.10.2027 (יום ב׳ של ראש השנה, אחרי שבת): תיבת הלוח נותנת רק את צאת השבת – צאת החג מחושב = שקיעה + 31
eq('every Shabbat/chag exit has maor havdalah (except RH 2027 day 2)', missingHavdalah.join(',') || 'none', '2027-10-03');

// 2) השוואה לדף הסרוק של לוח המאור (4–10 באוקטובר 2026), עמודת ת"א: עלות/זריחה/שקיעה/צאה"כ
const SCAN = {
  4: ['05:24', '06:42', '18:23', '18:37'], 5: ['05:25', '06:42', '18:21', '18:36'], 6: ['05:26', '06:43', '18:20', '18:34'],
  7: ['05:27', '06:44', '18:19', '18:33'], 8: ['05:27', '06:45', '18:18', '18:32'], 9: ['05:28', '06:45', '18:16', '18:30'],
  10: ['05:29', '06:46', '18:15', '18:29'],
};
for (const [d, [alot, netz, shkia, tzeit]] of Object.entries(SCAN)) {
  const r = day(2026, 10, +d);
  eq(`scan ${d}.10 עלות/נץ/שקיעה`, `${r.zmanim.alotStr} ${r.zmanim.sunriseStr} ${r.zmanim.sunsetStr}`, `${alot} ${netz} ${shkia}`);
  if (+d !== 10) eq(`scan ${d}.10 צאת הכוכבים`, r.zmanim.tzeitStr, tzeit);
  eq(`scan ${d}.10 source`, r.source, 'maor');
}

// 3) היום – שלישי 6.10.2026 (חול, קיץ)
const today = day(2026, 10, 6); show(today);
eq('today season', today.season, 'summer');
eq('today hebrew date', today.hebrewDate, 'כ״ה תשרי תשפ״ז');
eq('netz = 06:43 (maor visible sunrise)', today.zmanim.sunriseStr, '06:43');
eq('shacharit = netz − 40', P(today, 'shacharit'), '06:03');
eq('mincha gedola summer weekday', P(today, 'minchaG'), '13:15');
eq('mincha ketana = shkia − 25', P(today, 'minchaK'), '17:55');
eq('arvit = shkia', P(today, 'arvit'), '18:20');
eq('lesson before mincha (summer)', Lsn(today, 'lessonBefore'), '16:55');

// 4) ערב שבת 9.10.2026 – בראשית
const fri = day(2026, 10, 9); show(fri);
eq('friday candle lighting (maor) 17:56', fri.zmanim.candleStr, '17:56');
eq('friday candle = 20 min before shkia', fri.zmanim.candleMinsBeforeSunset, 20);
eq('friday shacharit = netz − 40', P(fri, 'shacharit'), '06:05');
eq('friday mincha gedola summer', P(fri, 'minchaG'), '13:15');
eq('friday mincha ketana = shkia − 40 (no rounding)', P(fri, 'minchaK'), '17:36');
eq('friday kabbalat shabbat = shkia − 15', P(fri, 'kabbalat'), '18:01');
eq('friday has no weekday arvit', P(fri, 'arvit'), undefined);

// 5) שבת 10.10.2026 – בראשית
const sh = day(2026, 10, 10); show(sh);
eq('next shabbat of 6.10', ymdKey(nextShabbatYmd({ y: 2026, m: 10, d: 6 })), '2026-10-10');
eq('parasha', sh.parasha, 'פרשת בראשית');
eq('shabbat shacharit', P(sh, 'shacharit'), '08:00');
eq('shabbat mincha gedola summer', P(sh, 'minchaG'), '13:15');
eq('shabbat mincha ketana = 18:15 − 50 = 17:25 (digit 5 stays)', P(sh, 'minchaK'), '17:25');
eq('shabbat lesson = rounded mincha − 60', Lsn(sh, 'lessonShabbat'), '16:25');
eq('motzash arvit = maor tzeit shabbat 18:46', P(sh, 'arvit'), '18:46');
eq('shabbat tzeit 18:46 / ר"ת 19:26', `${sh.zmanim.tzeitStr} ${sh.zmanim.rtStr}`, '18:46 19:26');

// 6) כלל העיגול (מנחה קטנה בשבת)
const R = (hhmm) => fmtTime(roundToTenRule(zonedDate({ y: 2026, m: 10, d: 10 }, hhmm, TZ)), TZ);
const ROUND = { '17:30': '17:30', '17:31': '17:30', '17:34': '17:30', '17:35': '17:35', '17:36': '17:40', '17:39': '17:40', '17:56': '18:00', '16:44': '16:40', '16:45': '16:45', '16:47': '16:50' };
for (const [i, o] of Object.entries(ROUND)) eq(`round ${i}`, R(i), o);
// דוגמת בוט קבלת שבת: שבת 3.10.2026, שקיעה 18:24 → 17:34 → 17:30, שיעור 16:30, ערבית 18:55
const sh3 = day(2026, 10, 3);
eq('bot example 3.10: mincha 17:30, lesson 16:30, arvit 18:55', `${P(sh3, 'minchaK')} ${Lsn(sh3, 'lessonShabbat')} ${P(sh3, 'arvit')}`, '17:30 16:30 18:55');

// 7) חורף: ערב שבת 25.12.2026 ושבת 26.12.2026 (ויגש)
const wf = day(2026, 12, 25); show(wf);
eq('winter friday: candle (maor) / mincha gedola 12:30 / mincha 16:03 / kabbalat 16:28', `${wf.zmanim.candleStr} ${P(wf, 'minchaG')} ${P(wf, 'minchaK')} ${P(wf, 'kabbalat')}`, '16:23 12:30 16:03 16:28');
const ws = day(2026, 12, 26); show(ws);
eq('winter shabbat: mincha gedola 12:45', P(ws, 'minchaG'), '12:45');
eq('winter shabbat: 16:44 − 50 = 15:54 → 15:50, lesson 14:50, arvit 17:15', `${P(ws, 'minchaK')} ${Lsn(ws, 'lessonShabbat')} ${P(ws, 'arvit')}`, '15:50 14:50 17:15');
const ww = day(2027, 1, 13); show(ww);
eq('winter weekday: mincha gedola 12:30, kollel 09:30-12:30, wednesday lesson', `${P(ww, 'minchaG')} ${ww.kollel.start}-${ww.kollel.end} ${!!ww.lessons.find((l) => l.key === 'wednesday')}`, '12:30 09:30-12:30 true');

// 8) מעבר שעון
eq('DST last day (Sat 24.10.2026)', day(2026, 10, 24).season, 'summer');
eq('winter first day (Sun 25.10.2026) netz 05:57', `${day(2026, 10, 25).season} ${day(2026, 10, 25).zmanim.sunriseStr}`, 'winter 05:57');

// 9) חגים
const erevPesach = day(2027, 4, 21); show(erevPesach);
eq('erev Pesach: candle (maor) 18:55, mincha 18:35, arvit of chag 19:00', `${erevPesach.zmanim.candleStr} ${P(erevPesach, 'minchaK')} ${P(erevPesach, 'kabbalat')}`, '18:55 18:35 19:00');
const pesach = day(2027, 4, 22); show(pesach);
eq('Pesach I: shabbat-mode, arvit = maor exit 19:46', `${pesach.shabbatMode} ${P(pesach, 'arvit')}`, 'true 19:46');
const shavuot = day(2027, 6, 11); show(shavuot);
eq('Shavuot on Friday: morning as Shabbat, candle 19:28, mincha 19:08, kabbalat 19:33', `${P(shavuot, 'shacharit')} ${shavuot.zmanim.candleStr} ${P(shavuot, 'minchaK')} ${P(shavuot, 'kabbalat')}`, '08:00 19:28 19:08 19:33');
const rh1 = day(2027, 10, 2); show(rh1);
eq('RH I on Shabbat: arvit (2nd night) at maor exit 18:56', P(rh1, 'arvit'), '18:56');
const rh2 = day(2027, 10, 3); show(rh2);
eq('RH II exit = maor sunset + 31 (18:55)', P(rh2, 'arvit'), '18:55');
const erevYK = day(2027, 10, 10); show(erevYK);
eq('erev YK: candle (maor) 17:56 + note', `${erevYK.zmanim.candleStr} ${erevYK.notes.some((n) => n.includes('כל נדרי'))}`, '17:56 true');
const yk = day(2027, 10, 11); show(yk);
eq('YK: note, exit 18:45', `${yk.isYomKippur} ${yk.zmanim.tzeitStr}`, 'true 18:45');

// 10) גיבוי (ללא נתוני לוח המאור)
const out = day(2028, 3, 1); show(out);
eq('date outside data → calc + note', `${out.source} ${out.notes.some((n) => n.includes('משוערים'))}`, 'calc true');
eq('no maor file at all → calc', day(2026, 10, 6, null).source, 'calc');
// דיוק הגיבוי מול כל ימי הלוח
let n = 0, srOk = 0, ssOk = 0, srMax = 0, ssMax = 0;
for (const k of keys) {
  const [y, m, d] = k.split('-').map(Number);
  const c = day(y, m, d, null), M = MAOR.days[k];
  const dm = (a, b) => Math.abs((+a.slice(0, 2) * 60 + +a.slice(3)) - (+b.slice(0, 2) * 60 + +b.slice(3)));
  const a = dm(c.zmanim.sunriseStr, M.sunrise), b = dm(c.zmanim.sunsetStr, M.sunset);
  n++; if (!a) srOk++; if (!b) ssOk++; srMax = Math.max(srMax, a); ssMax = Math.max(ssMax, b);
}
console.log(`  גיבוי מול לוח המאור (${n} ימים): נץ זהה ${srOk} (${(100 * srOk / n).toFixed(1)}%), סטייה מרבית ${srMax} דק׳; שקיעה זהה ${ssOk} (${(100 * ssOk / n).toFixed(1)}%), סטייה מרבית ${ssMax} דק׳`);
eq('fallback max error ≤ 1 min (sunrise & sunset)', srMax <= 1 && ssMax <= 1, true);

// 11) ללא לוח המאור – החישוב הישן (hebcal גובה פני הים) היה נותן נץ 06:38 ביום 6.10.2026
const raw = new hc.Zmanim(new hc.Location(32.0853, 34.7818, true, TZ, 'Tel Aviv', 'IL'), new Date(2026, 9, 6), false).sunrise();
eq('old sea-level hebcal sunrise on 6.10.2026 was 06:37:57 (≈06:38)', fmtTime(raw, TZ, true), '06:37:57');


console.log(fail ? `\n${fail} FAILED` : '\nALL PASSED');
process.exit(fail ? 1 : 0);
