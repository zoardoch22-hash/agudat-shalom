// קישורי הזמנה/שחזור של Netlify Identity מגיעים לדף הבית – מעבירים לדף קביעת הסיסמה.
// (ללא טעינת סקריפט צד שלישי בעמודי האתר הציבוריים)
(function () {
  var h = location.hash || '';
  if (/(invite|recovery|confirmation)_token=/.test(h)) {
    location.replace('admin/set-password.html' + h);
  } else if (/email_change_token=/.test(h)) {
    location.replace('admin/' + h);
  }
})();
