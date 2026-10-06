#!/usr/bin/env python3
"""שרת בדיקה מקומי שמחיל את הכותרות מ-netlify.toml (כדי לבדוק את ה-CSP לפני העלאה).
שימוש: python3 tests/serve-with-headers.py [port] [--local-cms]   (מתוך תיקיית האתר)
--local-cms: לבדיקת Decap מקומית מול `npx decap-server` (פורט 8081) – מוסיף local_backend לתצורה בזמן ההגשה בלבד.
--mock-netlify: מדמה את Netlify Identity ו-Git Gateway (tests/mock_netlify.py) – לבדיקות מצב העריכה הוויזואלית."""
import http.server, sys, tomllib, fnmatch
LOCAL_CMS = '--local-cms' in sys.argv
MOCK = None
if '--mock-netlify' in sys.argv:
    import os; sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    import mock_netlify as MOCK
args = [a for a in sys.argv[1:] if not a.startswith('--')]
rules = tomllib.load(open('netlify.toml', 'rb')).get('headers', [])
class H(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        path = self.path.split('?')[0]
        merged = {}
        for r in rules:  # Netlify ממזג כללים תואמים
            if fnmatch.fnmatch(path, r['for']): merged.update(r['values'])
        for k, v in merged.items():
            if k == 'Strict-Transport-Security': continue  # לא רלוונטי ב-http מקומי
            if k == 'Content-Security-Policy':
                v = v.replace('; upgrade-insecure-requests', '')
                if LOCAL_CMS and path.startswith('/admin'): v = v.replace("connect-src 'self'", "connect-src 'self' http://localhost:8081")
            self.send_header(k, v)
        super().end_headers()
    def do_POST(self):
        if not (MOCK and MOCK.handle(self, 'POST')): self.send_error(405)
    def do_PUT(self):
        if not (MOCK and MOCK.handle(self, 'PUT')): self.send_error(405)
    def do_PATCH(self):
        if not (MOCK and MOCK.handle(self, 'PATCH')): self.send_error(405)
    def do_GET(self):
        if MOCK and MOCK.handle(self, 'GET'): return
        if LOCAL_CMS and self.path.split('?')[0] == '/admin/config.yml':
            body = (open('admin/config.yml', encoding='utf-8').read() + '\nlocal_backend: true\n').encode()
            self.send_response(200); self.send_header('Content-Type', 'text/yaml; charset=utf-8'); self.send_header('Content-Length', str(len(body)))
            self.end_headers(); self.wfile.write(body); return
        super().do_GET()
H.extensions_map['.js'] = 'text/javascript'
http.server.ThreadingHTTPServer(('127.0.0.1', int(args[0]) if args else 8080), H).serve_forever()
