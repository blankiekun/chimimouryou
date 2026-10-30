"""Tests for account/service.py (standard library only). Run from the repo root:
python3 -m unittest discover -s server/tests
"""
import json
import os
import sys
import tempfile
import threading
import unittest
import unittest.mock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'account'))
import service  # noqa: E402

TEMPLATE = os.path.join(os.path.dirname(__file__), '..', 'nginx-ebook-reader.conf.template')


class AccountServiceTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        # Tests point these at the temp folder; put them back so later test files see the real defaults.
        for name in ('DATA_DIR', 'STATE_DIR', 'SHARED_SYNC_DIR', 'UPDATE_DIR', 'INTERNAL_TOKEN_FILE', 'db'):
            self.addCleanup(setattr, service, name, getattr(service, name, None))
        service.DATA_DIR = os.path.join(self.tmp.name, 'data')
        service.STATE_DIR = self.tmp.name
        service.db = service.Database(os.path.join(self.tmp.name, 'accounts.db'))
        self.addCleanup(service.db.connection.close)

    def test_password_round_trip(self):
        stored = service.hash_password('correct horse')
        self.assertEqual(service.verify_password('correct horse', stored), (True, False))
        self.assertFalse(service.verify_password('wrong', stored)[0])

    def test_rehash_on_old_parameters(self):
        old = service.hash_password('pw')
        weaker = old.replace(f'${service.SCRYPT_N}$', '$16384$', 1)
        self.assertTrue(service.verify_password('x', weaker)[1])

    def test_new_password_rules(self):
        with self.assertRaises(service.ApiError):
            service.check_new_password('short', 'user')
        with self.assertRaises(service.ApiError):
            service.check_new_password('username', 'username')
        service.check_new_password('long enough', 'user')

    def test_lockout_after_allowed_failures(self):
        keys = service.throttle_keys('Alice', '10.0.0.1')
        self.assertEqual(keys[0], 'userip:alice@10.0.0.1')
        for _ in range(service.THROTTLE_RULES['userip'] - 1):
            service.record_failure(keys)
        service.check_throttle(keys)  # not locked yet
        service.record_failure(keys)
        with self.assertRaises(service.ApiError) as raised:
            service.check_throttle(keys)
        self.assertEqual(raised.exception.status, 429)
        service.clear_failures(keys)
        service.check_throttle(keys)

    def test_guesses_elsewhere_dont_lock_the_owner_out(self):
        for _ in range(service.THROTTLE_RULES['userip']):
            service.record_failure(service.throttle_keys('alice', '203.0.113.9'))
        with self.assertRaises(service.ApiError):
            service.check_throttle(service.throttle_keys('alice', '203.0.113.9'))
        service.check_throttle(service.throttle_keys('alice', '192.168.1.20'))

    def test_concurrent_failures_are_all_counted(self):
        keys = ['user:race']
        threads = [threading.Thread(target=service.record_failure, args=(keys,)) for _ in range(40)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()
        failures = service.db.query('SELECT failures FROM login_throttle WHERE key = ?', ('user:race',))
        self.assertEqual(failures[0]['failures'], 40)

    def test_initial_admin_until_first_sign_in_and_password_change(self):
        record = service.ensure_initial_admin()
        user = service.find_user('admin')
        self.assertTrue(user['is_admin'])
        self.assertTrue(service.verify_password(record['password'], user['password_hash'])[0])
        self.assertIn(record['password'], service.initial_admin_banner(record))
        self.assertEqual(oct(os.stat(service.initial_admin_path()).st_mode & 0o777), '0o600')
        # Restarting keeps the same account and password.
        self.assertEqual(service.ensure_initial_admin(), record)

        service.initial_admin_signed_in(user['id'])
        self.assertEqual(service.initial_admin_banner(service.initial_admin()), '')
        self.assertTrue(service.initial_admin()['signedIn'])
        service.set_password(user['id'], 'a new long password', 'admin')
        self.assertIsNone(service.initial_admin())

    def test_no_initial_admin_when_accounts_exist(self):
        service.create_user('alice', 'long enough', admin=True)
        self.assertIsNone(service.ensure_initial_admin())
        self.assertIsNone(service.find_user('admin'))

    def test_update_state(self):
        service.UPDATE_DIR = self.tmp.name
        self.assertEqual(service.update_state(),
                         {'status': None, 'engineStatus': None, 'updater': '', 'requested': False})
        with open(os.path.join(self.tmp.name, 'updater'), 'w') as f:
            f.write('owner/repo\n')
        with open(os.path.join(self.tmp.name, 'status.json'), 'w') as f:
            f.write('{"state": "done", "ref": "abcdef1"}')
        self.assertEqual(service.update_state()['updater'], 'owner/repo')
        self.assertEqual(service.update_state()['status']['state'], 'done')
        with open(os.path.join(self.tmp.name, 'engine-status.json'), 'w') as f:
            f.write('{"state": "failed", "ref": "v0.23.0"}')
        state = service.update_state()
        self.assertEqual((state['status']['ref'], state['engineStatus']['ref']), ('abcdef1', 'v0.23.0'))
        # An older updater's engine install in status.json is the engine's status.
        os.remove(os.path.join(self.tmp.name, 'engine-status.json'))
        with open(os.path.join(self.tmp.name, 'status.json'), 'w') as f:
            f.write('{"state": "running", "ref": "v0.22.0"}')
        state = service.update_state()
        self.assertIsNone(state['status'])
        self.assertEqual(state['engineStatus']['ref'], 'v0.22.0')

    def test_update_requests(self):
        service.UPDATE_DIR = self.tmp.name
        with open(os.path.join(self.tmp.name, 'updater'), 'w') as f:
            f.write('owner/repo\n')
        request_path = os.path.join(self.tmp.name, 'request.json')

        def post(body):
            handler = object.__new__(service.Handler)
            handler.require_admin = lambda: None
            handler.read_json = lambda: body
            return handler.post_admin_update()

        for bad in ({'ref': 'main'}, {'engine': 'v1;rm'}, {'engine': ''}):
            with self.assertRaises(service.ApiError):
                post(bad)
        post({'engine': 'v0.11.0'})
        with open(request_path) as f:
            self.assertEqual(json.load(f)['engine'], 'v0.11.0')
        # One request at a time.
        with self.assertRaises(service.ApiError):
            post({'ref': 'abcdef1'})
        os.remove(request_path)
        post({'ref': 'abcdef1'})
        with open(request_path) as f:
            self.assertNotIn('engine', json.load(f))

    def test_auth_status(self):
        reader = {'is_admin': 0, 'permissions': ''}
        importer = {'is_admin': 0, 'permissions': 'import'}
        admin = {'is_admin': 1, 'permissions': ''}
        status = service.auth_status
        self.assertEqual(status(None, '', False, 'GET', True), 401)
        self.assertEqual(status(reader, '', False, 'PUT', False), 200)
        # Shared data: reads need an account, a trusted network or public reads.
        self.assertEqual(status(None, 'shared', True, 'GET', False), 401)
        self.assertEqual(status(None, 'shared', True, 'GET', False, True), 200)
        self.assertEqual(status(None, 'shared', True, 'GET', True), 200)
        self.assertEqual(status(reader, 'shared', True, 'GET', False), 200)
        # Writes need an account or a trusted network.
        self.assertEqual(status(None, 'shared', True, 'PUT', False, True), 401)
        self.assertEqual(status(None, 'shared', True, 'PUT', False), 401)
        self.assertEqual(status(None, 'shared', True, 'DELETE', True), 200)
        self.assertEqual(status(reader, 'shared', True, 'MOVE', False), 200)
        # Permissions: a trusted network doesn't help, and an unknown method counts as a write.
        self.assertEqual(status(None, 'series', True, 'GET', True), 200)
        self.assertEqual(status(None, 'series', True, 'PUT', True), 401)
        self.assertEqual(status(reader, 'series', True, '', True), 403)
        self.assertEqual(status(importer, 'import', False, 'POST', False), 200)
        self.assertEqual(status(importer, 'series', True, 'PUT', False), 403)
        self.assertEqual(status(importer, 'admin', False, 'GET', False), 403)
        self.assertEqual(status(admin, 'difficulty', True, 'POST', False), 200)
        self.assertEqual(status(admin, 'admin', False, 'GET', False), 200)

    def test_shared_folder_and_upload_folder_are_protected(self):
        allowed = service.shared_write_allowed
        for uri in ('/calibre/sync/', '/calibre/sync', '/calibre/sync//', '/calibre/sync/x/..', '/calibre/sync/%2e/'):
            self.assertFalse(allowed('DELETE', uri, None), uri)
            self.assertTrue(allowed('PROPFIND', uri, None), uri)
        self.assertFalse(allowed('MKCOL', '/calibre/sync/', None))
        for method in ('GET', 'PUT', 'DELETE'):
            self.assertFalse(allowed(method, '/calibre/sync/.tmp/0000000001', None))
            self.assertFalse(allowed(method, '/calibre/sync/%2Etmp/', None))
        # A book's own folder and files stay deletable ("Delete selected books").
        self.assertTrue(allowed('DELETE', '/calibre/sync/%E6%9C%AC/', None))
        self.assertTrue(allowed('PUT', '/calibre/sync/%E6%9C%AC/progress_1.json', None))
        self.assertTrue(allowed('DELETE', '/calibre/catalog.json', None))  # not this location
        # nginx merges slashes; '//calibre/…' is not a host.
        for uri in ('//calibre/sync/', '//calibre//sync//', '/calibre//sync/', '//calibre/sync/?x://y'):
            self.assertFalse(allowed('DELETE', uri, None), uri)
        self.assertFalse(allowed('PUT', '//calibre/sync/.tmp/0000000001', None))
        self.assertFalse(allowed('MOVE', '//calibre/sync/x.json', 'https://h/calibre/sync/series.json'))
        self.assertFalse(allowed('MOVE', '//calibre/sync/x.json', 'https://h//calibre//sync/series.json'))

    def test_shared_moves_only_rename_within_a_folder(self):
        allowed = service.shared_write_allowed
        source = '/calibre/sync/%E6%9C%AC/progress_1.json'
        self.assertTrue(allowed('MOVE', source, 'https://h/calibre/sync/%E6%9C%AC/progress_2.json'))
        self.assertTrue(allowed('MOVE', '/calibre/sync/goals_1.json', 'https://h/calibre/sync/goals_2.json'))
        for destination in (None, '',
                            'https://h/calibre/sync/series.json', 'https://h/calibre/sync/series.json?',
                            'https://h/calibre/sync/%73eries.json', 'https://h/calibre/sync/metadata.json#',
                            'https://h/calibre/sync/other/progress_2.json', 'https://h/calibre/sync/x.json',
                            'https://h/abcdefghijklmseries.json', 'https://h/calibre/sync/%E6%9C%AC/../x.json',
                            'https://h/calibre/sync/%E6%9C%AC/progress_2.json?'):
            self.assertFalse(allowed('MOVE', source, destination), destination)
        self.assertFalse(allowed('MOVE', '/calibre/sync/x.json', 'https://h/calibre/sync/series.json?'))
        self.assertFalse(allowed('MOVE', '/calibre/sync/x.json', 'https://h/calibre/sync/metadata.json'))
        self.assertFalse(allowed('MOVE', '/calibre/sync/%E6%9C%AC/', 'https://h/calibre/sync/other/'))
        # Two Destination headers, joined by nginx: dav moves to the first.
        self.assertFalse(allowed('MOVE', '/calibre/sync/x.json', 'https://h/calibre/sync/series.json, https://h/calibre/sync/y.json'))
        self.assertFalse(allowed('MOVE', '/calibre/sync/x.json', 'https://h/calibre/sync/y,z.json'))

    def test_plain_http_is_off_by_default_and_when_allowed(self):
        self.assertFalse(service.ALLOW_HTTP)
        self.assertEqual(service.request_scheme('https'), 'https')
        self.assertIsNone(service.request_scheme('http'))
        self.assertIsNone(service.request_scheme(None))
        self.assertEqual(service.session_cookie_name('https'), service.COOKIE)
        self.assertIsNone(service.session_cookie_name('http'))
        service.ALLOW_HTTP = True
        try:
            self.assertEqual(service.request_scheme('http'), 'http')
            self.assertIsNone(service.request_scheme('ftp'))
            self.assertIsNone(service.request_scheme(None))
            self.assertEqual(service.session_cookie_name('http'), service.HTTP_COOKIE)
            # The HTTP cookie never counts on HTTPS, where a planted one could fix a session.
            self.assertEqual(service.session_cookie_name('https'), service.COOKIE)
            self.assertIsNone(service.session_cookie_name(None))
        finally:
            service.ALLOW_HTTP = False

    # Catches nginx's write check letting uploads through on a full disk (the service has no quotas),
    # or refusing reads there too.
    def test_disk_full_refuses_writes_not_reads(self):
        service.SHARED_SYNC_DIR = self.tmp.name
        call = self.serve()
        service.create_user('alice', 'long enough')
        cookie = f'{service.COOKIE}={service.create_session(service.find_user("alice")["id"])}'

        def check(path, method):
            return call('GET', path, Cookie=cookie, X_Original_Method=method,
                        X_Original_URI='/calibre/sync/x/progress_1.json')[0]

        self.assertEqual((check('auth/shared/writes', 'PUT'), check('auth', 'PUT')), (200, 200))
        with unittest.mock.patch.object(service, 'MIN_FREE_BYTES', 1 << 62):
            self.assertEqual((check('auth/shared/writes', 'PUT'), check('auth', 'PUT')), (403, 403))
            self.assertEqual((check('auth/shared/writes', 'GET'), check('auth', 'GET')), (200, 200))

    def test_permissions(self):
        user_id = service.create_user('carol', 'long enough')
        service.set_permissions(user_id, ['series', 'import'])
        carol = service.find_user('carol')
        self.assertEqual(service.public_user(carol)['permissions'], ['import', 'series'])
        self.assertTrue(service.has_permission(carol, 'import'))
        self.assertFalse(service.has_permission(carol, 'difficulty'))
        self.assertFalse(service.has_permission(carol, 'admin'))
        for bad in (['admin'], ['nope'], 'import'):
            with self.assertRaises(service.ApiError):
                service.set_permissions(user_id, bad)
        service.set_permissions(user_id, [])
        self.assertEqual(service.public_user(service.find_user('carol'))['permissions'], [])

    # Catches nginx and the service drifting apart: an auth_request location proxying to a path the
    # service has no route for answers 404, which nginx turns into a 500 on every protected request.
    def test_every_nginx_auth_check_has_a_route(self):
        import re
        with open(TEMPLATE) as f:
            template = f.read()
        paths = re.findall(r'location = /_account_\w+ \{[^}]*?proxy_pass http://\$account_upstream/(\S+);', template)
        self.assertGreaterEqual(len(paths), 7)
        for path in paths:
            self.assertIn(('GET', path), service.Handler.ROUTES)
        self.assertNotIn(('GET', 'auth/anything'), service.Handler.ROUTES)

    def test_create_user_and_admin_rules(self):
        service.create_user('Root', 'long enough', admin=True)
        root = service.find_user('root')
        self.assertTrue(service.public_user(root)['admin'])
        self.assertTrue(os.path.isdir(os.path.join(service.DATA_DIR, root['id'], service.SYNC_PATH)))
        with self.assertRaises(service.ApiError) as raised:
            service.create_user('root', 'other password')
        self.assertEqual(raised.exception.status, 409)
        with self.assertRaises(service.ApiError):
            service.create_user('x', 'long enough')
        demote = 'UPDATE users SET is_admin = 0 WHERE id = ?'
        with self.assertRaises(service.ApiError):
            service.keep_an_admin(root, 'remove', 'DELETE FROM users WHERE id = ?')
        service.create_user('second', 'long enough', admin=True)
        service.keep_an_admin(service.find_user('second'), 'demote', demote)  # root is still an admin
        self.assertFalse(service.find_user('second')['is_admin'])
        # The count is read in the same transaction, not from the (now stale) row passed in.
        with self.assertRaises(service.ApiError):
            service.keep_an_admin(root, 'demote', demote)
        self.assertTrue(service.find_user('root')['is_admin'])

    def test_set_password_signs_out(self):
        user_id = service.create_user('bob', 'long enough')
        token = service.create_session(user_id)
        service.set_password(user_id, 'new password', 'bob')
        self.assertIsNone(service.session_user(token))
        self.assertTrue(service.verify_password('new password', service.find_user('bob')['password_hash'])[0])

    # Catches a flipped comparison or an idle timer that never refreshes: active readers signed out
    # after 30 days, idle tokens (a lost phone) never expiring, or the 180-day cap not holding.
    def test_sessions_expire_when_idle_and_at_the_maximum_age(self):
        day = 86400
        t0 = 1_800_000_000
        user_id = service.create_user('alice', 'long enough')

        def at(seconds, call, *args):
            with unittest.mock.patch.object(service.time, 'time', return_value=t0 + seconds):
                return call(*args)

        def last_seen(token):
            return service.db.query('SELECT last_seen FROM sessions WHERE token_hash = ?',
                                    (service.token_hash(token),))[0]['last_seen']

        cookie = at(0, service.create_session, user_id)
        token = at(0, service.create_session, user_id, 'token', 'https://app.example')
        # last_seen is written at most every LAST_SEEN_WRITE_INTERVAL, not on every request.
        self.assertIsNotNone(at(service.LAST_SEEN_WRITE_INTERVAL, service.session_user, cookie))
        self.assertEqual(last_seen(cookie), t0)
        self.assertIsNotNone(at(service.LAST_SEEN_WRITE_INTERVAL + 1, service.session_user, cookie))
        self.assertEqual(last_seen(cookie), t0 + service.LAST_SEEN_WRITE_INTERVAL + 1)
        # Idle for just over 30 days: the token is gone; the cookie, used meanwhile, is not.
        idle = service.SESSION_IDLE_SECONDS
        self.assertIsNotNone(at(idle - day, service.session_user, cookie))
        self.assertIsNone(at(idle + 1, service.session_user, token))
        self.assertEqual(service.db.query('SELECT count(*) AS n FROM sessions WHERE kind = ?', ('token',))[0]['n'], 0)
        # Used every 20 days, the cookie still ends at 180 days.
        for when in range(idle - day + 20 * day, service.SESSION_MAX_SECONDS, 20 * day):
            self.assertIsNotNone(at(when, service.session_user, cookie), when // day)
        self.assertIsNotNone(at(service.SESSION_MAX_SECONDS, service.session_user, cookie))
        self.assertIsNone(at(service.SESSION_MAX_SECONDS + 1, service.session_user, cookie))
        self.assertIsNone(at(1, service.session_user, cookie))  # deleted, not just refused

    # Catches a removed account whose cookie or app token keeps working (sessions not cascaded with the
    # user, e.g. foreign_keys off), and an admin removing their own account.
    def test_removing_an_account_ends_its_sessions_and_tokens(self):
        call = self.serve()
        service.create_user('boss', 'long enough', admin=True)
        service.create_user('alice', 'long enough')
        own_site = 'https://books.example'
        boss = f'{service.COOKIE}={service.create_session(service.find_user("boss")["id"])}'
        alice_cookie = f'{service.COOKIE}={service.create_session(service.find_user("alice")["id"])}'
        alice_bearer = f"Bearer {call('POST', 'token', self.ALICE, Origin=self.APP)[1]['token']}"
        self.assertEqual(call('GET', 'me', Cookie=alice_cookie)[0], 200)
        self.assertEqual(call('GET', 'me', Origin=self.APP, Authorization=alice_bearer)[0], 200)
        self.assertEqual(call('POST', 'admin/remove', {'username': 'boss'}, Cookie=boss, Origin=own_site)[0], 409)
        self.assertEqual(call('POST', 'admin/remove', {'username': 'alice'}, Cookie=boss, Origin=own_site)[0], 200)
        self.assertEqual(call('GET', 'me', Cookie=alice_cookie)[0], 401)
        self.assertEqual(call('GET', 'me', Origin=self.APP, Authorization=alice_bearer)[0], 401)
        self.assertEqual(call('GET', 'auth/shared/writes', Authorization=alice_bearer, X_Original_Method='PUT',
                              X_Original_URI='/calibre/sync/x/progress_1.json')[0], 401)
        self.assertEqual([row['username'] for row in service.db.query(
            'SELECT users.username FROM sessions JOIN users ON users.id = sessions.user_id')], ['boss'])
        self.assertEqual(service.db.query('SELECT count(*) AS n FROM sessions')[0]['n'], 1)

    def test_only_nginx_may_call(self):
        import urllib.error
        import urllib.request
        from http.server import ThreadingHTTPServer
        service.INTERNAL_TOKEN_FILE = os.path.join(self.tmp.name, 'internal-token')
        server = ThreadingHTTPServer(('127.0.0.1', 0), service.Handler)
        threading.Thread(target=server.serve_forever, kwargs={'poll_interval': 0.01}, daemon=True).start()

        def status(token, path='/config'):
            request = urllib.request.Request(f'http://127.0.0.1:{server.server_port}{path}',
                                             headers={'X-Internal-Token': token})
            try:
                with urllib.request.urlopen(request) as response:
                    return response.status
            except urllib.error.HTTPError as error:
                return error.code

        try:
            self.assertEqual(status('c0ffee'), 403)  # no token file: refuse everything
            with open(service.INTERNAL_TOKEN_FILE, 'w') as f:
                f.write('c0ffee\n')
            self.assertEqual(status(''), 403)
            self.assertEqual(status('c0ffe'), 403)
            self.assertEqual(status('c0ffee'), 200)
            # A trailing slash would get around nginx's exact location (its rate limit for login).
            self.assertEqual(status('c0ffee', '/config/'), 404)
        finally:
            server.shutdown()
            server.server_close()

    def test_auth_response_says_whether_admin(self):
        service.create_user('boss', 'long enough', admin=True)
        reader_id = service.create_user('reader', 'long enough')
        service.set_permissions(reader_id, ['import'])

        class Request:
            def __init__(self, token):
                self.headers = {'Cookie': f'{service.COOKIE}={token}', 'X-Original-Method': 'POST'}

            session_token = service.Handler.session_token
            bearer_token = service.Handler.bearer_token

        for name, admin in (('boss', '1'), ('reader', '0')):
            token = service.create_session(service.find_user(name)['id'])
            status, _, headers = service.Handler.get_auth(Request(token), 'import')
            self.assertEqual((status, headers['X-Account-Admin']), (200, admin))

    def serve(self, cors_origins=('https://app.example',)):
        """Runs the service as nginx sees it; returns call(method, path, body, **headers) -> (status, json, headers)."""
        import urllib.error
        import urllib.request
        from http.server import ThreadingHTTPServer
        service.INTERNAL_TOKEN_FILE = os.path.join(self.tmp.name, 'internal-token')
        with open(service.INTERNAL_TOKEN_FILE, 'w') as f:
            f.write('c0ffee\n')
        original = service.CORS_ORIGINS
        service.CORS_ORIGINS = set(cors_origins)
        server = ThreadingHTTPServer(('127.0.0.1', 0), service.Handler)
        threading.Thread(target=server.serve_forever, kwargs={'poll_interval': 0.01}, daemon=True).start()

        def stop():
            server.shutdown()
            server.server_close()
            service.CORS_ORIGINS = original
        self.addCleanup(stop)

        def call(method, path, body=None, **headers):
            headers = {'X-Internal-Token': 'c0ffee', 'Host': 'books.example', 'X-Forwarded-Proto': 'https',
                       'X-Real-IP': '203.0.113.5', **{k.replace('_', '-'): v for k, v in headers.items()}}
            headers = {k: v for k, v in headers.items() if v is not None}
            data = json.dumps(body).encode() if body is not None else (b'' if method == 'POST' else None)
            request = urllib.request.Request(f'http://127.0.0.1:{server.server_port}/{path}', data=data,
                                             headers=headers, method=method)
            try:
                with urllib.request.urlopen(request) as response:
                    return response.status, json.loads(response.read() or b'null'), response.headers
            except urllib.error.HTTPError as error:
                return error.code, json.loads(error.read() or b'null'), error.headers
        return call

    APP = 'https://app.example'
    ALICE = {'username': 'alice', 'password': 'long enough'}

    def test_token_issue_use_revoke(self):
        call = self.serve()
        service.create_user('alice', 'long enough')
        status, body, _ = call('POST', 'token', {**self.ALICE, 'label': 'Phone'}, Origin=self.APP)
        self.assertEqual(status, 200)
        token = body['token']
        bearer = f'Bearer {token}'
        self.assertEqual(body['user']['username'], 'alice')
        # Used from the app's origin: the API and nginx's auth checks.
        self.assertEqual(call('GET', 'me', Origin=self.APP, Authorization=bearer)[1]['user']['username'], 'alice')
        status, _, headers = call('GET', 'auth/shared/writes', Origin=self.APP, Authorization=bearer,
                                  X_Original_Method='PUT', X_Original_URI='/calibre/sync/x/progress_1.json')
        self.assertEqual((status, headers['X-Account-Id']), (200, service.find_user('alice')['id']))
        # Never over plain HTTP, never for admin checks.
        self.assertEqual(call('GET', 'me', Authorization=bearer, X_Forwarded_Proto='http')[0], 401)
        # The Devices list, and revoking.
        tokens = call('GET', 'tokens', Origin=self.APP, Authorization=bearer)[1]['tokens']
        self.assertEqual([(t['client'], t['label']) for t in tokens], [(self.APP, 'Phone')])
        self.assertNotIn(token, json.dumps(tokens))
        self.assertEqual(call('POST', 'token/revoke', Origin=self.APP, Authorization=bearer)[0], 200)
        self.assertEqual(call('GET', 'me', Origin=self.APP, Authorization=bearer)[0], 401)

        # A native app (no Origin) names itself; tokens/revoke by id.
        self.assertEqual(call('POST', 'token', self.ALICE)[0], 400)
        token = call('POST', 'token', {**self.ALICE, 'client': 'Desktop app'})[1]['token']
        token_id = call('GET', 'tokens', Authorization=f'Bearer {token}')[1]['tokens'][0]['id']
        self.assertEqual(call('POST', 'tokens/revoke', {'id': token_id}, Authorization=f'Bearer {token}')[0], 200)
        self.assertIsNone(service.session_user(token))

    def test_admins_list_everyones_tokens_only_from_their_own_page(self):
        call = self.serve()
        service.create_user('boss', 'long enough', admin=True)
        service.create_user('alice', 'long enough')
        alice_token = call('POST', 'token', self.ALICE, Origin=self.APP)[1]['token']
        boss_token = call('POST', 'token', {'username': 'boss', 'password': 'long enough'}, Origin=self.APP)[1]['token']
        cookie = f'{service.COOKIE}={service.create_session(service.find_user("boss")["id"])}'
        self.assertEqual(len(call('GET', 'tokens', Cookie=cookie)[1]['tokens']), 2)
        self.assertEqual(len(call('GET', 'tokens', Origin=self.APP, Authorization=f'Bearer {boss_token}')[1]['tokens']), 1)
        # Alice can't revoke the admin's; a token never reaches the admin API.
        boss_id = call('GET', 'tokens', Origin=self.APP, Authorization=f'Bearer {boss_token}')[1]['tokens'][0]['id']
        self.assertEqual(call('POST', 'tokens/revoke', {'id': boss_id}, Origin=self.APP,
                              Authorization=f'Bearer {alice_token}')[0], 404)
        self.assertEqual(call('GET', 'admin/users', Origin=self.APP, Authorization=f'Bearer {boss_token}')[0], 403)
        self.assertEqual(call('GET', 'admin/users', Authorization=f'Bearer {boss_token}')[0], 403)
        self.assertEqual(call('GET', 'admin/users', Cookie=cookie)[0], 200)
        # nginx's admin checks either, and other services don't see an admin.
        self.assertEqual(call('GET', 'auth/admin', Authorization=f'Bearer {boss_token}')[0], 403)
        self.assertEqual(call('GET', 'auth/admin', Cookie=cookie)[0], 200)
        status, _, headers = call('GET', 'auth/import', Authorization=f'Bearer {boss_token}', X_Original_Method='POST')
        self.assertEqual((status, headers['X-Account-Admin']), (200, '0'))

    def test_token_as_cookie_never_administers(self):
        call = self.serve()
        service.create_user('boss', 'long enough', admin=True)
        token = call('POST', 'token', {'username': 'boss', 'password': 'long enough'}, Origin=self.APP)[1]['token']
        cookie = f'{service.COOKIE}={token}'
        self.assertEqual(call('GET', 'me', Cookie=cookie)[0], 200)
        self.assertEqual(call('GET', 'admin/users', Cookie=cookie)[0], 403)
        self.assertEqual(call('POST', 'admin/add', {'username': 'mallory', 'password': 'long enough'},
                              Cookie=cookie, Origin='https://books.example')[0], 403)
        self.assertEqual(call('GET', 'auth/admin', Cookie=cookie)[0], 403)
        status, _, headers = call('GET', 'auth/import', Cookie=cookie, X_Original_Method='POST')
        self.assertEqual((status, headers['X-Account-Admin']), (200, '0'))
        self.assertEqual(len(call('GET', 'tokens', Cookie=cookie)[1]['tokens']), 1)  # its own only

    def test_throttle_rechecked_once_a_hash_slot_is_taken(self):
        stored = service.hash_password('long enough')
        keys = service.throttle_keys('alice', '10.0.0.1')
        for _ in range(service.THROTTLE_RULES['userip']):
            service.record_failure(keys)
        # A guess that passed the first check while others held the slots is stopped before scrypt.
        with self.assertRaises(service.ApiError) as raised:
            service.verify_password('guess', stored, lambda: service.check_throttle(keys))
        self.assertEqual(raised.exception.status, 429)

    def test_token_refusals(self):
        call = self.serve()
        service.create_user('alice', 'long enough')
        status, body, _ = call('POST', 'token', self.ALICE, Origin='https://evil.example')
        self.assertEqual(status, 403)
        self.assertIn("doesn't allow apps", body['error'])
        self.assertEqual(call('POST', 'token', self.ALICE, Origin='http://app.example')[0], 403)
        self.assertEqual(call('POST', 'token', self.ALICE, Origin=self.APP, X_Forwarded_Proto='http')[0], 403)
        # Not even with ALLOW_HTTP_ACCOUNTS.
        service.ALLOW_HTTP = True
        try:
            self.assertEqual(call('POST', 'token', self.ALICE, Origin=self.APP, X_Forwarded_Proto='http')[0], 403)
        finally:
            service.ALLOW_HTTP = False
        # The server's own page signs in with the cookie, not a token; the app can't use login.
        self.assertEqual(call('POST', 'token', self.ALICE, Origin='https://books.example')[0], 403)
        self.assertEqual(call('POST', 'login', self.ALICE, Origin=self.APP)[0], 403)

    def test_desktop_loopback_origin(self):
        # https origins, and http only on loopback with a port (the desktop app).
        self.assertEqual(service.parse_cors_origins(
            'https://app.example http://127.0.0.1:41917 http://localhost:41917 http://app.example '
            'http://127.0.0.1 http://127.0.0.2:41917 http://127.0.0.1.evil.example:41917 '
            'http://127.0.0.1:41917/ https://app.example/path'),
            {'https://app.example', 'http://127.0.0.1:41917', 'http://localhost:41917'})
        desktop = 'http://127.0.0.1:41917'
        call = self.serve((self.APP, desktop))
        service.create_user('alice', 'long enough')
        status, body, _ = call('POST', 'token', self.ALICE, Origin=desktop)
        self.assertEqual(status, 200)
        bearer = f"Bearer {body['token']}"
        self.assertEqual(call('GET', 'me', Origin=desktop, Authorization=bearer)[1]['user']['username'], 'alice')
        # The server itself stays HTTPS-only, and tokens never administer.
        self.assertEqual(call('POST', 'token', self.ALICE, Origin=desktop, X_Forwarded_Proto='http')[0], 403)
        self.assertEqual(call('POST', 'token', self.ALICE, Origin='http://127.0.0.1:41918')[0], 403)

    def test_token_off_without_cors_origins(self):
        call = self.serve(cors_origins=())
        service.create_user('alice', 'long enough')
        self.assertEqual(call('POST', 'token', self.ALICE, Origin=self.APP)[0], 403)
        self.assertEqual(call('POST', 'token', {**self.ALICE, 'client': 'app'})[0], 403)
        token = service.create_session(service.find_user('alice')['id'], 'token', self.APP)
        self.assertEqual(call('GET', 'me', Authorization=f'Bearer {token}')[0], 401)

    def test_token_sign_in_is_throttled_like_login(self):
        call = self.serve()
        service.create_user('alice', 'long enough')
        wrong = {'username': 'alice', 'password': 'wrong password'}
        for _ in range(service.THROTTLE_RULES['userip']):
            self.assertEqual(call('POST', 'token', wrong, Origin=self.APP)[0], 401)
        status, _, headers = call('POST', 'token', self.ALICE, Origin=self.APP)
        self.assertEqual(status, 429)
        self.assertIn('Retry-After', headers)
        # Shared with login: the same account and address are locked there too.
        self.assertEqual(call('POST', 'login', self.ALICE, Origin='https://books.example')[0], 429)

    def test_cookie_sign_in_unchanged(self):
        call = self.serve()
        service.create_user('alice', 'long enough')
        status, _, headers = call('POST', 'login', self.ALICE, Origin='https://books.example')
        self.assertEqual(status, 200)
        cookie = headers['Set-Cookie'].split(';')[0]
        token = cookie.split('=', 1)[1]
        self.assertIn('Secure; HttpOnly; SameSite=Strict', headers['Set-Cookie'])
        self.assertEqual(service.session_user(token)['username'], 'alice')
        status, body, _ = call('GET', 'me', Cookie=cookie)
        self.assertEqual((status, body['user']['username']), (200, 'alice'))
        self.assertEqual(call('GET', 'tokens', Cookie=cookie)[1], {'tokens': []})
        # Another bearer (the Audiobookshelf plugin's, proxied by nginx) leaves the cookie in charge.
        self.assertEqual(call('GET', 'auth', Cookie=cookie, Authorization='Bearer abs-token')[0], 200)
        # From another site, the cookie doesn't count.
        self.assertEqual(call('GET', 'me', Cookie=cookie, Origin=self.APP)[0], 401)
        self.assertEqual(call('POST', 'logout', Cookie=cookie, Origin='https://books.example')[0], 200)
        self.assertEqual(call('GET', 'me', Cookie=cookie)[0], 401)
        self.assertIsNone(service.session_user(token))

    def test_trusted_network_pass_is_same_origin_only(self):
        status = service.auth_status
        self.assertEqual(status(None, 'shared', True, 'PUT', True), 200)
        self.assertEqual(status(None, 'shared', True, 'PUT', True, cross_origin=True), 401)
        self.assertEqual(status(None, 'shared', True, 'GET', True, cross_origin=True), 401)
        self.assertEqual(status(None, 'series', True, 'GET', True, cross_origin=True), 401)
        self.assertEqual(status({'is_admin': 1, 'permissions': ''}, 'admin', False, 'GET', False,
                                cross_origin=True), 403)
        # Off without CORS_ORIGINS: nothing changes for servers that don't opt in.
        self.assertFalse(service.is_cross_origin({'Origin': self.APP, 'Host': 'books.example', 'X-Forwarded-Proto': 'https'}))
        call = self.serve()
        headers = {'X_Original_Method': 'PUT', 'X_Trusted_Network': '1',
                   'X_Original_URI': '/calibre/sync/x/progress_1.json'}
        self.assertEqual(call('GET', 'auth/shared/writes', Origin='https://books.example', **headers)[0], 200)
        self.assertEqual(call('GET', 'auth/shared/writes', Origin=self.APP, **headers)[0], 401)
        self.assertEqual(call('GET', 'auth/shared/writes', Origin='null', **headers)[0], 401)
        self.assertTrue(service.is_cross_origin({'Origin': self.APP, 'Host': 'books.example', 'X-Forwarded-Proto': 'https'}))
        self.assertFalse(service.is_cross_origin({'Host': 'books.example', 'X-Forwarded-Proto': 'https'}))

    def test_old_database_gets_token_columns(self):
        path = os.path.join(self.tmp.name, 'old-sessions.db')
        old = service.sqlite3.connect(path)
        old.execute('CREATE TABLE sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, '
                    'created INTEGER NOT NULL, last_seen INTEGER NOT NULL)')
        old.execute("INSERT INTO sessions VALUES ('h', 'u1', 0, 0)")
        old.commit()
        old.close()
        migrated = service.Database(path)
        row = migrated.query('SELECT kind, client, label FROM sessions')[0]
        self.assertEqual(tuple(row), ('cookie', '', ''))
        migrated.connection.close()

    def test_old_database_gets_admin_column(self):
        path = os.path.join(self.tmp.name, 'old.db')
        old = service.sqlite3.connect(path)
        old.execute('CREATE TABLE users (id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, '
                    'password_hash TEXT NOT NULL, created INTEGER NOT NULL, password_changed INTEGER NOT NULL)')
        old.execute("INSERT INTO users VALUES ('u1', 'alice', 'x', 0, 0)")
        old.commit()
        old.close()
        migrated = service.Database(path)
        row = migrated.query('SELECT is_admin, permissions FROM users')[0]
        self.assertEqual((row['is_admin'], row['permissions']), (0, ''))
        migrated.connection.close()


if __name__ == '__main__':
    unittest.main()
