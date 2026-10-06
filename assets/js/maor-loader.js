// נתוני "לוח המאור" – אופק תל אביב (קובץ סטטי מהאתר עצמו; נוצר ע"י tools/scrape-maor.mjs).
// הדפדפן לא יכול לפנות ישירות לאתר לוח המאור (CSP/CORS), ולכן הנתונים מאוחסנים מקומית.
let p;
export function loadMaor() {
  if (!p) {
    p = fetch(new URL('../data/maor-tel-aviv.json', import.meta.url), { cache: 'no-cache' })
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null);
  }
  return p;
}
