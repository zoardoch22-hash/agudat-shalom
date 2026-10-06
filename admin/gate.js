// שער בחירה ב-/admin: עריכה ויזואלית מול מערכת הניהול (Decap).
// לא משנה את זרימת ההתחברות של Identity/Decap; אחרי התחברות מציג בחירה פעם אחת בסשן.
(function () {
  var CMS_FLAG = 'agudat-admin-cms';
  var USER_KEY = 'gotrue.user';
  var VISUAL_HREF = '../index.html?edit=1';

  var root = null;
  var hint = null;
  var primaryBtn = null;
  var cmsBtn = null;
  var userEl = null;
  var lastFocused = null;

  function wantsCms() {
    try {
      if (new URLSearchParams(location.search).has('cms')) return true;
      if (sessionStorage.getItem(CMS_FLAG) === '1') return true;
    } catch (e) { /* ignore */ }
    return false;
  }

  function markCms() {
    try { sessionStorage.setItem(CMS_FLAG, '1'); } catch (e) { /* ignore */ }
    try {
      var u = new URL(location.href);
      if (!u.searchParams.has('cms')) {
        u.searchParams.set('cms', '1');
        history.replaceState(null, '', u.pathname + u.search + u.hash);
      }
    } catch (e) { /* ignore */ }
  }

  function readStoredUser() {
    try {
      var s = JSON.parse(localStorage.getItem(USER_KEY) || 'null');
      return s && s.token && s.token.access_token ? s : null;
    } catch (e) {
      return null;
    }
  }

  function identityUser() {
    try {
      if (window.netlifyIdentity && typeof netlifyIdentity.currentUser === 'function') {
        return netlifyIdentity.currentUser() || null;
      }
    } catch (e) { /* ignore */ }
    return null;
  }

  function currentUser() {
    return identityUser() || readStoredUser();
  }

  function userEmail(u) {
    if (!u) return '';
    return String(u.email || (u.user_metadata && u.user_metadata.email) || '').trim();
  }

  function ensureDom() {
    if (root) return;

    root = document.createElement('div');
    root.id = 'ag-gate';
    root.className = 'ag-gate';
    root.hidden = true;
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-labelledby', 'ag-gate-title');

    root.innerHTML =
      '<div class="ag-gate-card">' +
        '<div class="ag-gate-brand">' +
          '<img src="../assets/img/emblem.svg" alt="" width="40" height="40">' +
          '<span>אגודת שלום</span>' +
        '</div>' +
        '<h1 id="ag-gate-title">בחרו אופן עריכה</h1>' +
        '<p class="ag-gate-user">מחובר/ת: <bdi id="ag-gate-email"></bdi></p>' +
        '<p class="ag-gate-explain">' +
          'עריכה ויזואלית: רואים את האתר האמיתי, לוחצים על טקסט ומשנים במקום. ' +
          'מערכת הניהול המלאה: כל ההגדרות, עמודים חדשים, קבצים ותוכן מתקדם (Decap CMS).' +
        '</p>' +
        '<div class="ag-gate-actions">' +
          '<a class="ag-gate-btn ag-gate-btn-primary" id="ag-gate-visual" href="' + VISUAL_HREF + '">' +
            'עריכה ויזואלית של האתר' +
          '</a>' +
          '<button type="button" class="ag-gate-btn ag-gate-btn-secondary" id="ag-gate-cms">' +
            'מערכת הניהול המלאה' +
          '</button>' +
        '</div>' +
        '<p class="ag-gate-note">אפשר לחזור לכאן בכל עת מ־/admin. אם בחרתם במערכת הניהול בסשן הזה – לא נחסום אתכם שוב.</p>' +
      '</div>';

    hint = document.createElement('div');
    hint.id = 'ag-gate-hint';
    hint.className = 'ag-gate-hint';
    hint.hidden = true;
    hint.innerHTML =
      '<a href="' + VISUAL_HREF + '">עריכה ויזואלית של האתר</a>' +
      '<span class="ag-gate-hint-text">רואים את האתר, לוחצים על טקסט ומשנים. אחרי התחברות תופיע גם בחירה כאן.</span>';

    document.body.appendChild(root);
    document.body.appendChild(hint);

    primaryBtn = document.getElementById('ag-gate-visual');
    cmsBtn = document.getElementById('ag-gate-cms');
    userEl = document.getElementById('ag-gate-email');

    cmsBtn.addEventListener('click', function () {
      enterCms();
    });

    root.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape') {
        ev.preventDefault();
        enterCms();
        return;
      }
      if (ev.key !== 'Tab') return;
      var focusables = root.querySelectorAll('a[href], button:not([disabled])');
      if (!focusables.length) return;
      var first = focusables[0];
      var last = focusables[focusables.length - 1];
      if (ev.shiftKey && document.activeElement === first) {
        ev.preventDefault();
        last.focus();
      } else if (!ev.shiftKey && document.activeElement === last) {
        ev.preventDefault();
        first.focus();
      }
    });
  }

  function showChooser(user) {
    ensureDom();
    hint.hidden = true;
    userEl.textContent = userEmail(user) || 'מנהל/ת';
    root.hidden = false;
    document.documentElement.classList.add('ag-gate-open');
    lastFocused = document.activeElement;
    try { primaryBtn.focus(); } catch (e) { /* ignore */ }
  }

  function hideChooser() {
    if (!root) return;
    root.hidden = true;
    document.documentElement.classList.remove('ag-gate-open');
    if (lastFocused && typeof lastFocused.focus === 'function') {
      try { lastFocused.focus(); } catch (e) { /* ignore */ }
    }
    lastFocused = null;
  }

  function showHint() {
    ensureDom();
    if (!root.hidden) return;
    hint.hidden = false;
  }

  function hideHint() {
    if (hint) hint.hidden = true;
  }

  function enterCms() {
    markCms();
    hideChooser();
    hideHint();
  }

  function sync() {
    var user = currentUser();
    if (user && !wantsCms()) {
      showChooser(user);
      return;
    }
    hideChooser();
    if (!user && !wantsCms()) showHint();
    else hideHint();
  }

  function bindIdentity() {
    var ni = window.netlifyIdentity;
    if (!ni || typeof ni.on !== 'function' || ni.__agGateBound) return;
    ni.__agGateBound = true;
    ni.on('init', function (user) {
      if (user && !wantsCms()) showChooser(user);
      else sync();
    });
    ni.on('login', function (user) {
      if (!wantsCms()) showChooser(user || currentUser());
    });
    ni.on('logout', function () {
      try { sessionStorage.removeItem(CMS_FLAG); } catch (e) { /* ignore */ }
      hideChooser();
      showHint();
    });
  }

  function boot() {
    ensureDom();
    bindIdentity();
    sync();
    // Identity/Decap עשויים לאתחל מעט אחרינו
    var n = 0;
    var t = setInterval(function () {
      bindIdentity();
      sync();
      n += 1;
      if (n >= 20 || (window.netlifyIdentity && window.netlifyIdentity.__agGateBound && (currentUser() || n >= 8))) {
        clearInterval(t);
      }
    }, 250);
  }

  // אם ה־body כבר קיים (סקריפט באמצע ה־body) – מציגים מיד כדי לכסות את Decap בלי הבזק.
  if (document.body) {
    boot();
  } else if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
