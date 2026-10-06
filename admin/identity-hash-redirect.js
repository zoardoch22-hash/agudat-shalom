// אם מישהו הגיע ל-/admin עם טוקן שחזור/הזמנה – מעבירים לדף קביעת הסיסמה.
(function () {
  var h = location.hash || '';
  if (/(invite|recovery|confirmation)_token=/.test(h)) {
    location.replace('set-password.html' + h);
  }
})();
