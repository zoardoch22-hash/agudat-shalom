// עמוד זמני התפילות: חישוב חי בדפדפן לפי התאריך הנוכחי בשעון ישראל
import { ready, el } from './main.js';
import { loadHebcal } from './hebcal-loader.js';
import { loadMaor } from './maor-loader.js';
import { computeDay, ymdInTz, addDays, nextShabbatYmd, makeLocation } from './schedule.js';
import { renderDayList, dayChips, startClock } from './times-ui.js';

const $ = (id) => document.getElementById(id);

function zman(label, value) {
  return el('div', { class: 'zman' }, el('span', { text: label }), el('b', { text: value }));
}

async function init() {
  const cfg = await ready;
  const tz = cfg.location.tzid;
  let hc;
  try { hc = await loadHebcal(); } catch (e) {
    console.error(e);
    $('today-list').replaceChildren(el('p', { class: 'error-box', text: 'לא ניתן היה לטעון את מנוע חישוב הזמנים. נסו לרענן את העמוד.' }));
    return;
  }
  const maor = await loadMaor();
  const loc = makeLocation(hc, cfg);
  const day = (ymd) => computeDay(hc, cfg, ymd, loc, maor);

  let today, tomorrow;
  const renderAll = () => {
    const ymd = ymdInTz(new Date(), tz);
    today = day(ymd);
    tomorrow = day(addDays(ymd, 1));
    const now = new Date();

    $('hdate').textContent = today.hebrewDate;
    $('gdate').textContent = `${today.dayName} · ${today.gregLabel}`;
    $('chips').replaceChildren(...dayChips(today));
    $('today-title').textContent = today.shabbatMode ? (today.isShabbat ? 'סדר היום – שבת קודש' : 'סדר היום – יום טוב') : 'סדר היום';
    $('today-list').replaceChildren(...renderDayList(today, { now, tomorrow }));

    const z = today.zmanim;
    const zs = [zman('נץ החמה', z.sunriseStr), zman('שקיעה', z.sunsetStr)];
    if (z.candleStr) zs.push(zman('הדלקת נרות', z.candleStr));
    zs.push(zman(today.isShabbat ? 'צאת השבת' : (today.isYomTov ? 'צאת החג' : 'צאת הכוכבים'), z.tzeitStr));
    if (z.rtStr) zs.push(zman('צאת ר"ת', z.rtStr));
    $('zmanim').replaceChildren(...zs);
    $('zmanim-source').textContent = today.sourceLabel;

    // השבת הקרובה
    const shY = nextShabbatYmd(ymd);
    const sh = day(shY);
    const fri = day(addDays(shY, -1));
    $('loc-candle').textContent = String(fri.zmanim.candleMinsBeforeSunset ?? '—');
    $('shabbat-title').textContent = sh.parasha || sh.holidays[0] || 'שבת קודש';
    $('shabbat-date').textContent = `${sh.hebrewDate} · ${sh.gregLabel}`;
    $('shabbat-zmanim').replaceChildren(
      zman('הדלקת נרות (ערב שבת)', fri.zmanim.candleStr || '—'),
      zman('שקיעה בשבת', sh.zmanim.sunsetStr),
      zman('צאת השבת', sh.zmanim.tzeitStr));
    $('shabbat-list').replaceChildren(...renderDayList(sh, { now: sh.key === today.key ? now : null }));

    // תצוגת שבוע: היום + 6 הימים הבאים
    $('week').replaceChildren(...Array.from({ length: 7 }, (_, i) => {
      const d = i === 0 ? today : day(addDays(ymd, i));
      const cls = ['day-card', i === 0 ? 'is-today' : '', d.shabbatMode ? 'is-shabbat' : ''].filter(Boolean).join(' ');
      const sub = [`נץ ${d.zmanim.sunriseStr}`, `שקיעה ${d.zmanim.sunsetStr}`];
      if (d.zmanim.candleStr) sub.push(`הדלקת נרות ${d.zmanim.candleStr}`);
      if (d.isShabbat) sub.push(`צאת השבת ${d.zmanim.tzeitStr}`);
      return el('article', { class: cls },
        el('div', { class: 'dc-head' }, el('b', { text: i === 0 ? `היום · ${d.dayName}` : d.dayName }), el('span', { text: `${d.hebrewDate} · ${d.ymd.d}/${d.ymd.m}` })),
        el('div', { class: 'dc-body' },
          (d.parasha || d.holidays.length) ? el('div', { class: 'chips' }, [d.parasha, ...d.holidays].filter(Boolean).map((t) => el('span', { class: 'badge', text: t }))) : null,
          el('p', { class: 'sub', text: sub.join(' · ') }),
          ...renderDayList(d, { compact: true })));
    }));
    $('updated').textContent = new Intl.DateTimeFormat('he-IL', { timeZone: tz, dateStyle: 'short', timeStyle: 'medium' }).format(now);
  };
  renderAll();

  startClock(tz, (t, now, minuteChanged) => {
    $('clock').textContent = t;
    if (minuteChanged && today) $('today-list').replaceChildren(...renderDayList(today, { now, tomorrow }));
  }, renderAll); // בחצות (שעון ישראל) – חישוב מחדש של כל העמוד
}
init();
