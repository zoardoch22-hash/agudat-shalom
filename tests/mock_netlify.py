"""מדמה מקומי של Netlify Identity (GoTrue) ו-Git Gateway – לבדיקות מצב העריכה בלבד.
המאגר המדומה מתחיל מהקבצים שבתיקייה, והשינויים נשמרים בזיכרון בלבד (לא נכתבים לדיסק).
נקודות בדיקה: GET /__mock/state, POST /__mock/reset | /__mock/expire {"all":bool} | /__mock/race | /__mock/fail {"status":500}"""
import base64, hashlib, json, os, secrets, threading, time, urllib.parse

EMAIL = os.environ.get('MOCK_EMAIL', 'admin@example.test')
PASSWORD = os.environ.get('MOCK_PASSWORD', 'test-pass-123')
USER = {'id': 'mock-user-1', 'aud': '', 'role': '', 'email': EMAIL, 'confirmed_at': '2026-01-01T00:00:00Z',
        'app_metadata': {'provider': 'email', 'roles': ['admin']}, 'user_metadata': {'full_name': 'מנהל האתר'}}
lock = threading.Lock()
S = {}

def reset():
    S.clear()
    S.update(access={}, refresh={}, blobs={}, trees={'t0': {}}, commits={'c0': {'tree': 't0', 'parents': [], 'message': 'initial'}},
             head='c0', log=[], race=False, fail=None, n=0, ttl=3600,
             password=PASSWORD, used_tokens=set())
reset()

def b64url(b): return base64.urlsafe_b64encode(b).rstrip(b'=').decode()
def blob_sha(data): return hashlib.sha1(b'blob %d\0' % len(data) + data).hexdigest()
def nid(prefix):
    S['n'] += 1
    return f'{prefix}{S["n"]:04d}' + secrets.token_hex(8)

def read(tree, path):
    t = S['trees'][tree]
    if path in t: return S['blobs'][t[path]]
    if path.startswith('/') or '..' in path.split('/'): return None
    return open(path, 'rb').read() if os.path.isfile(path) else None

def issue():
    exp = int(time.time()) + S['ttl']
    payload = {'sub': USER['id'], 'email': EMAIL, 'exp': exp, 'app_metadata': USER['app_metadata'], 'jti': secrets.token_hex(6)}
    access = f"{b64url(json.dumps({'alg': 'HS256', 'typ': 'JWT'}).encode())}.{b64url(json.dumps(payload).encode())}.mock"
    refresh = secrets.token_hex(12)
    S['access'][access] = exp
    S['refresh'][refresh] = True
    return {'access_token': access, 'token_type': 'bearer', 'expires_in': S['ttl'], 'refresh_token': refresh}

def commit_files(sha):
    """הקבצים ששונו ב-commit לעומת ההורה"""
    c = S['commits'][sha]
    parent = S['commits'][c['parents'][0]]['tree'] if c['parents'] else 't0'
    t, p = S['trees'][c['tree']], S['trees'][parent]
    out = {}
    for path, b in t.items():
        if p.get(path) != b:
            data = S['blobs'][b]
            try: out[path] = data.decode('utf-8') if not path.startswith('assets/uploads/') else {'binary': len(data), 'head': data[:4].hex()}
            except UnicodeDecodeError: out[path] = {'binary': len(data)}
    return out

def external_commit():
    """מישהו אחר שמר בינתיים (למשל דרך מערכת הניהול)"""
    path = 'assets/data/content/times.json'
    data = json.loads(read(S['commits'][S['head']]['tree'], path))
    data['title'] = 'זמני תפילות (שינוי חיצוני)'
    raw = (json.dumps(data, ensure_ascii=False, indent=2) + '\n').encode()
    b = blob_sha(raw); S['blobs'][b] = raw
    t = nid('t'); S['trees'][t] = {**S['trees'][S['commits'][S['head']]['tree']], path: b}
    c = nid('c'); S['commits'][c] = {'tree': t, 'parents': [S['head']], 'message': 'שינוי חיצוני (מערכת הניהול)'}
    S['head'] = c
    S['log'].append({'sha': c, 'message': S['commits'][c]['message'], 'files': commit_files(c)})

def handle(h, method):
    """מחזיר True אם הבקשה טופלה ע"י המדמה"""
    url = urllib.parse.urlsplit(h.path)
    path, q = url.path, urllib.parse.parse_qs(url.query)
    if not (path.startswith('/.netlify/') or path.startswith('/__mock/')): return False
    n = int(h.headers.get('Content-Length') or 0)
    raw = h.rfile.read(n) if n else b''
    def send(code, obj=None):
        body = b'' if obj is None else json.dumps(obj, ensure_ascii=False).encode()
        h.send_response(code)
        h.send_header('Content-Type', 'application/json; charset=utf-8'); h.send_header('Cache-Control', 'no-store')
        h.send_header('Content-Length', str(len(body))); h.end_headers(); h.wfile.write(body)
        return True
    def body(): return json.loads(raw or b'{}')
    def authed():
        a = h.headers.get('Authorization', '')
        tok = a[7:] if a.startswith('Bearer ') else ''
        return tok in S['access'] and S['access'][tok] > time.time()
    with lock:
        # ----- נקודות בדיקה -----
        if path == '/__mock/state': return send(200, {'head': S['head'], 'log': S['log']})
        if path == '/__mock/reset': reset(); return send(200, {'ok': True})
        if path == '/__mock/expire':
            S['access'].clear()
            if body().get('all'): S['refresh'].clear()
            return send(200, {'ok': True})
        if path == '/__mock/race': S['race'] = True; return send(200, {'ok': True})
        if path == '/__mock/fail': S['fail'] = int(body().get('status', 500)); return send(200, {'ok': True})
        # ----- Identity -----
        if path == '/.netlify/identity/token' and method == 'POST':
            f = urllib.parse.parse_qs(raw.decode())
            g = (f.get('grant_type') or [''])[0]
            if g == 'password':
                if (f.get('username') or [''])[0].lower() == EMAIL and (f.get('password') or [''])[0] == S.get('password', PASSWORD): return send(200, issue())
                return send(400, {'error': 'invalid_grant', 'error_description': 'Invalid Password'})
            if g == 'refresh_token':
                r = (f.get('refresh_token') or [''])[0]
                if S['refresh'].pop(r, None): return send(200, issue())
                return send(400, {'error': 'invalid_grant', 'error_description': 'Invalid Refresh Token'})
            return send(400, {'error': 'unsupported_grant_type'})
        if path == '/.netlify/identity/verify' and method == 'POST':
            d = body()
            typ = (d.get('type') or '').strip()
            tok = (d.get('token') or '').strip()
            pw = d.get('password') or ''
            # GoTrue accepts signup|recovery; invite is aliased to signup (gotrue-js acceptInvite).
            if typ == 'invite': typ = 'signup'
            if typ not in ('signup', 'recovery'):
                return send(422, {'msg': 'Verify requires a verification type'})
            if not tok:
                return send(422, {'msg': 'Verify requires a token'})
            if tok == 'expired-token' or tok in S['used_tokens']:
                return send(422, {'msg': 'Recovery token expired' if typ == 'recovery' else 'Confirmation token expired'})
            if tok in ('invalid-token', 'missing'):
                return send(404, {'msg': 'User not found'})
            # טוקנים תקינים לבדיקה: valid-recovery / valid-invite / valid-confirm (או כל מחרוזת אחרת שאינה expired/invalid)
            if pw and len(pw) < 6:
                return send(422, {'msg': 'Password too short'})
            if typ == 'signup' and not pw and tok.startswith('valid-invite'):
                return send(422, {'msg': 'Invited users must specify a password'})
            if pw:
                S['password'] = pw
            S['used_tokens'].add(tok)
            return send(200, issue())
        if path == '/.netlify/identity/user':
            if not authed(): return send(401, {'msg': 'Invalid token'})
            if method == 'PUT':
                d = body()
                if 'password' in d:
                    pw = d.get('password') or ''
                    if len(pw) < 6: return send(422, {'msg': 'Password too short'})
                    S['password'] = pw
                return send(200, USER)
            return send(200, USER)
        if path == '/.netlify/identity/logout': return send(204)
        if path == '/.netlify/identity/settings': return send(200, {'external': {}, 'disable_signup': True, 'autoconfirm': False})
        # ----- Git Gateway -----
        G = '/.netlify/git/github/'
        if not path.startswith(G): return send(404, {'message': 'Not Found'})
        if not authed(): return send(401, {'msg': 'Invalid token'})
        p = urllib.parse.unquote(path[len(G):])
        if method != 'GET' and S['fail']:
            code, S['fail'] = S['fail'], None
            return send(code, {'message': 'mock failure'})
        if p.startswith('contents/') and method == 'GET':
            ref = (q.get('ref') or ['main'])[0]
            c = S['head'] if ref == 'main' else ref
            if c not in S['commits']: return send(404, {'message': 'No commit found for the ref'})
            fp = p[len('contents/'):]
            data = read(S['commits'][c]['tree'], fp)
            if data is None: return send(404, {'message': 'Not Found'})
            b = base64.b64encode(data).decode()
            return send(200, {'type': 'file', 'encoding': 'base64', 'path': fp, 'name': fp.split('/')[-1], 'size': len(data),
                              'sha': blob_sha(data), 'content': '\n'.join(b[i:i + 60] for i in range(0, len(b), 60)) + '\n'})
        if p == 'git/refs/heads/main' and method == 'GET':
            return send(200, {'ref': 'refs/heads/main', 'object': {'sha': S['head'], 'type': 'commit'}})
        if p.startswith('git/commits/') and method == 'GET':
            c = S['commits'].get(p.split('/')[-1])
            return send(200, {'sha': p.split('/')[-1], 'tree': {'sha': c['tree']}, 'message': c['message'], 'parents': [{'sha': x} for x in c['parents']]}) if c else send(404, {'message': 'Not Found'})
        if p == 'git/blobs' and method == 'POST':
            d = body()
            data = base64.b64decode(d['content']) if d.get('encoding') == 'base64' else d['content'].encode()
            b = blob_sha(data); S['blobs'][b] = data
            return send(201, {'sha': b})
        if p == 'git/trees' and method == 'POST':
            d = body()
            if d.get('base_tree') not in S['trees']: return send(422, {'message': 'Invalid base_tree'})
            t = dict(S['trees'][d['base_tree']])
            for e in d['tree']:
                if e['sha'] not in S['blobs']: return send(422, {'message': 'Invalid blob sha'})
                t[e['path']] = e['sha']
            tid = nid('t'); S['trees'][tid] = t
            return send(201, {'sha': tid})
        if p == 'git/commits' and method == 'POST':
            d = body()
            if d.get('tree') not in S['trees']: return send(422, {'message': 'Invalid tree'})
            cid = nid('c'); S['commits'][cid] = {'tree': d['tree'], 'parents': d.get('parents', []), 'message': d.get('message', '')}
            return send(201, {'sha': cid})
        if p == 'git/refs/heads/main' and method == 'PATCH':
            d = body()
            if S['race']:
                S['race'] = False; external_commit()
                return send(422, {'message': 'Update is not a fast forward'})
            c = S['commits'].get(d.get('sha'))
            if not c: return send(422, {'message': 'Object does not exist'})
            if not d.get('force') and c['parents'][:1] != [S['head']]: return send(422, {'message': 'Update is not a fast forward'})
            S['head'] = d['sha']
            S['log'].append({'sha': d['sha'], 'message': c['message'], 'files': commit_files(d['sha'])})
            return send(200, {'ref': 'refs/heads/main', 'object': {'sha': d['sha'], 'type': 'commit'}})
        return send(404, {'message': f'mock: unsupported {method} {p}'})
