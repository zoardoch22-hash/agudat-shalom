/**
 * ==========================================================
 *  הגדרות האתר – בית הכנסת אגודת שלום
 *  כל הפרטים שעשויים להשתנות נמצאים כאן, במקום אחד.
 *  ערך שמתחיל ב-"[" נחשב "ממלא מקום" – הכפתור המתאים יוצג
 *  כ"יעודכן בקרוב" עד שיוזן ערך אמיתי.
 * ==========================================================
 */
export const CONFIG = {
  name: 'בית הכנסת אגודת שלום',
  shortName: 'אגודת שלום',
  tagline: 'בית הכנסת לעולי פרס',
  foundedYear: 1957,

  // כתובת בית הכנסת. mapsQuery – טקסט לחיפוש בגוגל מפות / Waze (ריק = ללא כפתורי ניווט)
  address: '[כתובת תתעדכן]',
  mapsQuery: '',

  contacts: [
    { name: 'הרב אליהו שליט"א', role: 'רב בית הכנסת', phone: '054-8444083', intl: '972548444083', whatsapp: false },
    { name: 'זוהר דוך', role: 'גבאות ומידע', phone: '058-4464368', intl: '972584464368', whatsapp: true },
  ],

  donate: {
    bit: {
      phone: '[יעודכן]',   // מספר הטלפון לתרומה בביט, למשל '050-0000000'
      link: '',            // אופציונלי: קישור תשלום ביט (אם קיים)
    },
    paybox: {
      link: '[יעודכן]',    // קישור לקבוצת/דף תשלום PayBox, למשל 'https://payboxapp.page.link/...'
    },
    bank: {
      bankName: 'בנק הפועלים',
      bankNumber: '12',
      branch: '771',
      account: '418671',
      beneficiary: 'בית הכנסת אגודת שלום',
    },
  },

  // מקור הזמנים: לוח המאור (ישיבת אור החיים) – אופק תל אביב.
  // הנץ (זריחה נראית), השקיעה, הדלקת הנרות וצאת השבת/החג נלקחים מ-assets/data/maor-tel-aviv.json
  // (נוצר ע"י tools/scrape-maor.mjs). לתאריך שאין בו נתון – חישוב משוער מכויל (ראו schedule.js) עם הערה.
  zmanimSource: {
    label: 'לפי לוח המאור – אופק תל אביב',
    url: 'https://maor.orhachaim.org/?cal_city=IL-Tel%20Aviv',
  },

  // מיקום לחישוב התאריך העברי/החגים ולחישוב הגיבוי (תל אביב)
  location: {
    name: 'תל אביב',        // שם לתצוגה
    hebcalCity: 'Tel Aviv', // שם העיר באנגלית לפי hebcal
    latitude: 32.0853,
    longitude: 34.7818,
    elevation: 0,
    useElevation: false,   // הגיבוי: hebcal בגובה פני הים + תיקון "זריחה נראית" של לוח המאור
    tzid: 'Asia/Jerusalem',
    // הדלקת הנרות נלקחת מלוח המאור (20 דק' לפני השקיעה בתל אביב). הערך כאן משפיע רק על hebcal ולא על התצוגה.
    candleLightingMins: null,
  },

  // 'auto' = קיץ כששעון הקיץ הישראלי בתוקף; אפשר לקבוע ידנית 'summer' או 'winter'
  season: 'auto',

  // ביום טוב יוצג סדר התפילות של שבת (חוץ מיום כיפור – לפי הודעה)
  yomTovAsShabbat: true,

  rules: {
    weekday: {
      shacharitBeforeNetzMins: 40,
      minchaGedola: { summer: '13:15', winter: '12:30' },
      minchaKetanaBeforeShkiaMins: 25,
      lessonBeforeMinchaMins: 60,      // קיץ: שיעור שעה לפני מנחה (קטנה)
    },
    // ערב שבת (וערב חג): מנחה גדולה ושחרית כבחול
    friday: {
      minchaKetanaBeforeShkiaMins: 40, // ללא עיגול
      kabbalatShabbatBeforeShkiaMins: 15,
    },
    shabbat: {
      shacharit: '08:00',
      shacharitNote: 'מהודו',
      minchaGedola: { summer: '13:15', winter: '12:45' },
      minchaKetanaBeforeShkiaMins: 50, // ואז עיגול: ספרה 0–4 מטה, 5 נשאר, 6–9 מעלה
      lessonBeforeMinchaKetanaMins: 60, // שעה לפני מנחה קטנה המעוגלת
      lessonTeacher: 'הרב אליהו דוך שליט"א',
    },
  },

  kollel: {
    title: 'כולל בוקר לגיל השלישי ולכל מאן דבעי',
    summer: { start: '10:00', end: '13:00' },
    winter: { start: '09:30', end: '12:30' },
    days: [0, 1, 2, 3, 4, 5], // 0=ראשון ... 5=שישי (לא ביום טוב)
  },
};

/**
 * ערכים שנערכים דרך ממשק הניהול (/admin) נשמרים ב-assets/data/settings.json
 * ודורסים את ברירות המחדל שלמעלה. אם הקובץ חסר – משתמשים ב-CONFIG כפי שהוא.
 */
const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
function merge(base, over) {
  const out = Array.isArray(base) ? [...base] : { ...base };
  for (const [k, v] of Object.entries(over || {})) {
    // ערך ריק/ממלא-מקום ב-settings.json לא דורס ערך אמיתי שהוזן ב-config.js
    if (typeof v === 'string' && typeof base[k] === 'string' && isPlaceholder(v) && !isPlaceholder(base[k])) continue;
    out[k] = isObj(v) && isObj(base[k]) ? merge(base[k], v) : v;
  }
  return out;
}
let loaded;
export function loadConfig() {
  if (!loaded) {
    loaded = fetch(new URL('../data/settings.json', import.meta.url), { cache: 'no-cache' })
      .then((r) => (r.ok ? r.json() : {}))
      .catch(() => ({}))
      .then((over) => merge(CONFIG, over));
  }
  return loaded;
}

export const isPlaceholder = (v) => !v || String(v).trim().startsWith('[');
