// עמוד הבית: ווידג'ט זמני היום + הדגשת עונת הכולל/שיעורים
import { ready, el } from './main.js';
import { loadHebcal } from './hebcal-loader.js';
import { loadMaor } from './maor-loader.js';
import { computeDay, ymdInTz, isSummer, addDays } from './schedule.js';
import { renderDayList, dayChips, startClock } from './times-ui.js';

const box = document.getElementById('today-times');
const dateEl = document.getElementById('today-date');
const clockEl = document.getElementById('today-clock');

async function init() {
  const cfg = await ready;
  const tz = cfg.location.tzid;
  // הדגשת זמני הקיץ/החורף הרלוונטיים כעת
  const season = isSummer(ymdInTz(new Date(), tz), cfg) ? 'summer' : 'winter';
  document.querySelectorAll('[data-season]').forEach((n) => n.classList.toggle('on', n.dataset.season === season));
  document.querySelectorAll('[data-kollel]').forEach((n) => { const s = cfg.kollel[n.dataset.kollel]; n.textContent = `${s.start}–${s.end}`; });

  if (!box) return;
  let hc;
  try { hc = await loadHebcal(); } catch (e) {
    console.error(e); box.replaceChildren(el('p', { class: 'error-box', text: 'לא ניתן היה לטעון את מנוע הזמנים. נסו לרענן את העמוד.' })); return;
  }
  const maor = await loadMaor();
  const srcEl = document.getElementById('today-source');
  let day, tomorrow;
  const render = () => {
    const ymd = ymdInTz(new Date(), tz);
    day = computeDay(hc, cfg, ymd, undefined, maor);
    tomorrow = computeDay(hc, cfg, addDays(ymd, 1), undefined, maor);
    if (srcEl) srcEl.textContent = `זמני היום ${day.sourceLabel}`;
    dateEl.textContent = `${day.dayName} · ${day.hebrewDate} · ${day.gregLabel}`;
    box.replaceChildren(el('div', { class: 'chips' }, dayChips(day)), ...renderDayList(day, { now: new Date(), compact: true, tomorrow }));
  };
  render();
  startClock(tz, (t, now, minuteChanged) => { clockEl.textContent = t; if (minuteChanged && day) box.replaceChildren(el('div', { class: 'chips' }, dayChips(day)), ...renderDayList(day, { now, compact: true, tomorrow })); }, render);
}
init();
