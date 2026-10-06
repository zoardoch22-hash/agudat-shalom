// קביעת סיסמה מטוקן Netlify Identity (recovery / invite / confirmation) דרך GoTrue.
(function () {
  var IDENTITY = '/.netlify/identity';
  var KEY = 'gotrue.user';
  var MIN = 8;

  var form = document.getElementById('sp-form');
  var missing = document.getElementById('sp-missing');
  var success = document.getElementById('sp-success');
  var msg = document.getElementById('sp-msg');
  var missingDetail = document.getElementById('sp-missing-detail');
  var missingText = document.getElementById('sp-missing-text');
  var passEl = document.getElementById('sp-pass');
  var pass2El = document.getElementById('sp-pass2');
  var submitBtn = document.getElementById('sp-submit');
  var titleEl = document.getElementById('sp-title');
  var leadEl = document.getElementById('sp-lead');

  function parseToken() {
    var h = (location.hash || '').replace(/^#\/?/, '');
    var m = h.match(/(recovery|invite|confirmation)_token=([^&]+)/i);
    if (!m) return null;
    var kind = m[1].toLowerCase();
    var token = decodeURIComponent(m[2]);
    // GoTrue: recovery → recovery; invite+confirmation → signup (acceptInvite / confirm).
    // הערת התאמה: gotrue-js שולח type:"signup" גם להזמנה (לא "invite").
    var type = kind === 'recovery' ? 'recovery' : 'signup';
    return { kind: kind, type: type, token: token };
  }

  function showMsg(text, kind) {
    msg.textContent = text || '';
    msg.setAttribute('data-kind', kind || '');
    msg.setAttribute('role', kind === 'error' ? 'alert' : 'status');
  }

  function showMissing(detail, lead) {
    form.hidden = true;
    success.hidden = true;
    missing.hidden = false;
    if (lead) missingText.textContent = lead;
    missingDetail.textContent = detail || '';
    var focusable = missing.querySelector('a.btn') || missing;
    try { focusable.focus(); } catch (e) { /* ignore */ }
  }

  function showSuccess() {
    form.hidden = true;
    missing.hidden = true;
    success.hidden = false;
    try { document.getElementById('sp-go-admin').focus(); } catch (e) { /* ignore */ }
  }

  function tokenDetails(t) {
    var exp = Date.now() + (Number(t.expires_in) || 3600) * 1000;
    try {
      var b = t.access_token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      var claims = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(b), function (c) { return c.charCodeAt(0); })));
      if (claims.exp) exp = claims.exp * 1000;
    } catch (e) { /* טוקן לא-JWT */ }
    return {
      access_token: t.access_token,
      token_type: t.token_type || 'bearer',
      expires_in: t.expires_in,
      refresh_token: t.refresh_token,
      expires_at: exp
    };
  }

  function saveSession(user, tokenResp) {
    var s = Object.assign({}, user, {
      url: location.origin + IDENTITY,
      token: tokenDetails(tokenResp)
    });
    try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) { /* ignore */ }
    return s;
  }

  function hebrewError(status, data) {
    var d = String((data && (data.msg || data.error_description || data.error)) || '');
    if (/expired|פג/i.test(d) || status === 422 && /token/i.test(d)) {
      return 'הקישור פג תוקף או שכבר נוצל. יש לבקש איפוס סיסמה חדש ממסך ההתחברות.';
    }
    if (status === 404 || /not found|invalid/i.test(d)) {
      return 'הקישור אינו תקף. יש לבקש איפוס סיסמה חדש ממסך ההתחברות.';
    }
    if (status === 422 && /password/i.test(d)) {
      return 'הסיסמה אינה עומדת בדרישות. נסו סיסמה אחרת (לפחות 8 תווים).';
    }
    return 'לא ניתן לשמור את הסיסמה כרגע (' + status + '). נסו שוב בעוד רגע.';
  }

  async function verifyAndSet(info, password) {
    var res;
    try {
      res = await fetch(IDENTITY + '/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ type: info.type, token: info.token, password: password })
      });
    } catch (e) {
      throw new Error('אין חיבור לשרת. בדקו את החיבור לאינטרנט ונסו שוב.');
    }
    var data = await res.json().catch(function () { return {}; });
    if (!res.ok) {
      var err = new Error(hebrewError(res.status, data));
      err.code = /expired/i.test(String(data.msg || data.error_description || '')) ? 'expired' : 'verify';
      err.status = res.status;
      throw err;
    }
    if (!data.access_token) {
      throw new Error('תשובת השרת לא תקינה. נסו שוב.');
    }

    // בשחזור סיסמה GoTrue מאמת את הטוקן אך לא תמיד שומר את הסיסמה ב-/verify –
    // מעדכנים דרך PUT /user (כמו הווידג'ט הרשמי אחרי recover).
    if (info.type === 'recovery') {
      var up;
      try {
        up = await fetch(IDENTITY + '/user', {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer ' + data.access_token
          },
          credentials: 'same-origin',
          body: JSON.stringify({ password: password })
        });
      } catch (e) {
        throw new Error('אין חיבור לשרת. בדקו את החיבור לאינטרנט ונסו שוב.');
      }
      if (!up.ok) {
        var upData = await up.json().catch(function () { return {}; });
        throw new Error(hebrewError(up.status, upData));
      }
    }

    var userRes = await fetch(IDENTITY + '/user', {
      headers: { Authorization: 'Bearer ' + data.access_token },
      credentials: 'same-origin'
    });
    if (!userRes.ok) {
      throw new Error('הסיסמה נקבעה אך לא ניתן לטעון את פרטי המשתמש. התחברו ידנית.');
    }
    var user = await userRes.json();
    saveSession(user, data);
  }

  var info = parseToken();
  if (!info || !info.token) {
    showMissing(
      '',
      'לא נמצא קישור תקף לקביעת סיסמה בכתובת. אם קיבלתם מייל לאיפוס סיסמה – פתחו את הקישור מהמייל מחדש, או בקשו איפוס חדש ממסך ההתחברות.'
    );
    return;
  }

  if (info.kind === 'invite') {
    titleEl.textContent = 'קביעת סיסמה להזמנה';
    leadEl.textContent = 'השלימו את ההזמנה לחשבון הניהול על ידי בחירת סיסמה.';
  } else if (info.kind === 'confirmation') {
    titleEl.textContent = 'אישור חשבון וקביעת סיסמה';
    leadEl.textContent = 'אשרו את החשבון ובחרו סיסמה להתחברות.';
  }

  try { passEl.focus(); } catch (e) { /* ignore */ }

  form.addEventListener('submit', function (ev) {
    ev.preventDefault();
    showMsg('', '');
    var p1 = passEl.value;
    var p2 = pass2El.value;
    if (!p1 || !p2) {
      showMsg('יש למלא את שני שדות הסיסמה.', 'error');
      (!p1 ? passEl : pass2El).focus();
      return;
    }
    if (p1.length < MIN) {
      showMsg('הסיסמה חייבת להכיל לפחות 8 תווים.', 'error');
      passEl.focus();
      return;
    }
    if (p1 !== p2) {
      showMsg('הסיסמאות אינן תואמות.', 'error');
      pass2El.focus();
      return;
    }

    submitBtn.disabled = true;
    showMsg('שומרים…', '');
    verifyAndSet(info, p1).then(function () {
      // מנקים את הטוקן מהכתובת כדי שלא יישלח שוב
      try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { /* ignore */ }
      showSuccess();
    }).catch(function (err) {
      submitBtn.disabled = false;
      if (err && (err.code === 'expired' || err.status === 404 || err.status === 422)) {
        showMissing(err.message || '', 'הקישור לקביעת הסיסמה פג תוקף או שכבר נוצל. יש לבקש איפוס סיסמה חדש ממסך ההתחברות (שכחתי סיסמה).');
        return;
      }
      showMsg((err && err.message) || 'שגיאה לא צפויה. נסו שוב.', 'error');
    });
  });
})();
