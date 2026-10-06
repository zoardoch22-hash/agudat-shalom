// תבנית לעמודים כלליים שנוצרים במערכת הניהול: page.html?p=<slug>
import { ready, pagesData, el } from './main.js';
import { renderMarkdown, safeSrc } from './md.js';

const slug = new URLSearchParams(location.search).get('p') || '';
const $ = (id) => document.getElementById(id);

Promise.all([pagesData, ready]).then(([pages]) => {
  const page = pages.find((p) => p && p.slug === slug && p.title);
  if (!page) {
    document.title = 'הדף לא נמצא – אגודת שלום';
    document.head.append(el('meta', { name: 'robots', content: 'noindex' }));
    $('page-title').textContent = 'הדף לא נמצא';
    $('page-lead').textContent = '';
    $('page-body').replaceChildren(el('p', {}, 'ייתכן שהקישור שגוי או שהדף הוסר. ', el('a', { href: 'index.html', text: 'חזרה לדף הבית' })));
    return;
  }
  document.title = `${page.title} – בית הכנסת אגודת שלום`;
  if (page.description) document.querySelector('meta[name="description"]')?.setAttribute('content', page.description);
  $('page-title').textContent = page.title;
  $('page-lead').textContent = page.description || '';
  $('page-lead').hidden = !page.description;
  $('page-body').replaceChildren(renderMarkdown(page.body || ''));
  // מיפוי לעריכה ויזואלית (לפי slug – עמיד לשינוי סדר העמודים)
  const ptr = `pages.json#/pages/[slug=${page.slug}]`;
  $('page-title').dataset.edit = `${ptr}/title`; $('page-title').dataset.editLabel = 'כותרת העמוד';
  $('page-lead').dataset.edit = `${ptr}/description`; $('page-lead').dataset.editLabel = 'תיאור קצר (אופציונלי)';
  $('page-body').dataset.edit = `${ptr}/body`; $('page-body').dataset.editType = 'md';
  const files = (page.files || []).filter((f) => f && safeSrc(f.file));
  if (files.length) {
    $('page-files').replaceChildren(el('h2', { text: 'קבצים להורדה' }),
      el('ul', { class: 'files' }, files.map((f) => el('li', {}, el('a', { href: safeSrc(f.file), download: true }, f.title || f.file.split('/').pop())))));
  }
});
