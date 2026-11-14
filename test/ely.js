'use strict';
// Тесты Ely.by: вход (в т.ч. 2FA), обновление токена, authlib-injector, командная строка запуска.
// Сеть подменена, никуда не ходим. Запуск: node test/ely.js
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dxl-ely-'));
const P = require('../main/lib/paths');
P.init(path.join(tmp, 'game'));
const store = require('../main/lib/store');
store.init(path.join(tmp, 'data'));
const http = require('../main/lib/http');
const accounts = require('../main/lib/accounts');
const authlib = require('../main/lib/authlib');
const launch = require('../main/lib/launch');

const UUID = '0123456789abcdef0123456789abcdef';
const DASHED = '01234567-89ab-cdef-0123-456789abcdef';
const err = (status, body) => Object.assign(new Error('HTTP ' + status), { status, body });

// --- поддельный authserver.ely.by
const calls = [];
let validToken = 'tok-1';
let refreshFails = false;
let down = false;
http.json = async (url, o = {}) => {
  calls.push([url, o.body]);
  const b = o.body || {};
  if (down) throw new Error('ECONNRESET');
  if (url === 'https://authserver.ely.by/auth/authenticate') {
    if (b.username === 'twofa' && !String(b.password).includes(':')) throw err(401, { error: 'ForbiddenOperationException', errorMessage: 'Account protected with two factor auth.' });
    if (b.username === 'twofa' && b.password === 'secret:123456') return { accessToken: validToken, clientToken: b.clientToken, selectedProfile: { id: UUID, name: 'ElyPlayer' } };
    if (b.username === 'player' && b.password === 'secret') return { accessToken: validToken, clientToken: b.clientToken, selectedProfile: { id: UUID, name: 'ElyPlayer' } };
    throw err(401, { error: 'ForbiddenOperationException', errorMessage: 'Invalid credentials. Invalid email or password.' });
  }
  if (url === 'https://authserver.ely.by/auth/validate') {
    if (b.accessToken === validToken) return null;
    throw err(401, { error: 'ForbiddenOperationException', errorMessage: 'Token expired.' });
  }
  if (url === 'https://authserver.ely.by/auth/refresh') {
    if (refreshFails) throw err(401, { error: 'ForbiddenOperationException', errorMessage: 'Invalid token.' });
    validToken = 'tok-2';
    return { accessToken: 'tok-2', clientToken: b.clientToken };
  }
  throw new Error('нет фикстуры json: ' + url);
};

(async () => {
  const results = [];
  const t = (name, fn) => results.push([name, fn]);

  t('вход: ник+пароль → аккаунт ely с UUID через дефисы, токены зашифрованы, пароль не хранится', async () => {
    const a = await accounts.elyLogin('player', 'secret');
    assert.strictEqual(a.type, 'ely');
    assert.strictEqual(a.name, 'ElyPlayer');
    assert.strictEqual(a.uuid, DASHED);
    assert.ok(a.accessToken.startsWith('p:') && a.clientToken.startsWith('p:'));
    const saved = JSON.stringify(accounts.list());
    assert.ok(!saved.includes('secret'), 'пароль не должен попасть в хранилище');
    assert.ok(!saved.includes('tok-1'), 'токен в открытом виде не хранится');
    const sent = calls[calls.length - 1][1];
    assert.strictEqual(sent.requestUser, true);
    assert.ok(/^[0-9a-f-]{36}$/.test(sent.clientToken));
  });

  t('повторный вход под тем же UUID обновляет аккаунт, а не плодит дубли', async () => {
    await accounts.elyLogin('player', 'secret');
    assert.strictEqual(accounts.list().filter((a) => a.type === 'ely').length, 1);
  });

  t('неверный пароль — понятная ошибка', async () => {
    await assert.rejects(() => accounts.elyLogin('player', 'bad'), /Неверный логин или пароль/);
    await assert.rejects(() => accounts.elyLogin('', ''), /Введи ник или e-mail/);
  });

  t('2FA: сначала ELY_2FA, затем пароль уходит как «пароль:код»', async () => {
    await assert.rejects(() => accounts.elyLogin('twofa', 'secret'), (e) => e.code === 'ELY_2FA');
    const a = await accounts.elyLogin('twofa', 'secret', ' 123 456 ');
    assert.strictEqual(a.name, 'ElyPlayer');
    assert.strictEqual(calls[calls.length - 1][1].password, 'secret:123456');
    await assert.rejects(() => accounts.elyLogin('twofa', 'secret', '000000'), /Неверный пароль или код/);
  });

  t('ensureFresh: токен жив → validate, без refresh', async () => {
    const acc = accounts.list().find((a) => a.type === 'ely');
    calls.length = 0;
    assert.strictEqual(await accounts.ensureFresh(acc, ''), 'tok-1');
    assert.deepStrictEqual(calls.map((c) => c[0].split('/').pop()), ['validate']);
  });

  t('ensureFresh: токен протух → refresh, новый токен сохранён', async () => {
    const acc = accounts.list().find((a) => a.type === 'ely');
    validToken = 'other';
    calls.length = 0;
    assert.strictEqual(await accounts.ensureFresh(acc, ''), 'tok-2');
    assert.deepStrictEqual(calls.map((c) => c[0].split('/').pop()), ['validate', 'refresh']);
    assert.ok(/^[0-9a-f-]{36}$/.test(calls[1][1].clientToken), 'clientToken расшифрован перед отправкой');
    assert.strictEqual(await accounts.ensureFresh(acc, ''), 'tok-2');
  });

  t('ensureFresh: refresh отклонён → просим войти заново (ELY_RELOGIN)', async () => {
    const acc = accounts.list().find((a) => a.type === 'ely');
    validToken = 'other2';
    refreshFails = true;
    await assert.rejects(() => accounts.ensureFresh(acc, ''), (e) => e.code === 'ELY_RELOGIN' && /войди/.test(e.message));
    refreshFails = false;
  });

  t('ensureFresh: Ely.by недоступен → запуск не блокируем, отдаём сохранённый токен', async () => {
    const acc = accounts.list().find((a) => a.type === 'ely');
    down = true;
    assert.strictEqual(await accounts.ensureFresh(acc, ''), 'tok-2');
    down = false;
  });

  // ------------------------------------------------------------ authlib-injector
  const jarBytes = Buffer.from('authlib-injector-jar');
  const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
  let latest = { version: '1.2.9', download_url: 'https://example.test/authlib-injector-1.2.9.jar', checksums: { sha256: sha(jarBytes) } };
  const dl = [];
  const origJson = http.json;
  http.download = async (url, dest) => {
    dl.push(url);
    if (!url.includes('authlib-injector')) throw new Error('нет фикстуры: ' + url);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, url.includes('broken') ? Buffer.from('xxx') : jarBytes);
  };
  const withAuthlibJson = (fn) => {
    http.json = async (url, o) => (authlib.SOURCES.includes(url) ? fn(url) : origJson(url, o));
  };

  t('authlib-injector: скачивает, проверяет sha256, потом использует кэш', async () => {
    withAuthlibJson(() => latest);
    const jar = await authlib.ensure();
    assert.strictEqual(jar, authlib.jarPath());
    assert.ok(fs.readFileSync(jar).equals(jarBytes));
    assert.strictEqual(dl.length, 1);
    await authlib.ensure(); // свежий кэш — без сети
    assert.strictEqual(dl.length, 1);
  });

  t('authlib-injector: плохая сумма → пробуем зеркало, временный файл удалён', async () => {
    fs.writeFileSync(authlib.jarPath().replace(/\.jar$/, '.json'), JSON.stringify({ version: '1.0.0', checkedAt: 0 })); // кэш устарел
    withAuthlibJson((url) => (url === authlib.SOURCES[0]
      ? { version: '1.3.0', download_url: 'https://example.test/authlib-injector-broken.jar', checksums: { sha256: sha(jarBytes) } }
      : { version: '1.3.0', download_url: 'https://mirror.test/authlib-injector-1.3.0.jar', checksums: { sha256: sha(jarBytes) } }));
    const before = dl.length;
    await authlib.ensure();
    assert.deepStrictEqual(dl.slice(before), ['https://example.test/authlib-injector-broken.jar', 'https://mirror.test/authlib-injector-1.3.0.jar']);
    assert.ok(fs.readFileSync(authlib.jarPath()).equals(jarBytes));
    assert.ok(!fs.existsSync(authlib.jarPath() + '.new'), 'временный файл убран');
  });

  t('authlib-injector: сети нет, но jar уже есть → играем со старым', async () => {
    fs.writeFileSync(authlib.jarPath().replace(/\.jar$/, '.json'), JSON.stringify({ version: '1.0.0', checkedAt: 0 }));
    withAuthlibJson(() => { throw new Error('ECONNRESET'); });
    assert.strictEqual(await authlib.ensure(), authlib.jarPath());
  });

  t('authlib-injector: сети нет и jar нет → ошибка с пояснением', async () => {
    fs.unlinkSync(authlib.jarPath());
    fs.unlinkSync(authlib.jarPath().replace(/\.jar$/, '.json'));
    withAuthlibJson(() => { throw new Error('ECONNRESET'); });
    await assert.rejects(() => authlib.ensure(), /Не удалось скачать authlib-injector/);
  });

  t('authlib-injector: нет контрольной суммы → не ставим', async () => {
    withAuthlibJson(() => ({ version: '1.4.0', download_url: 'https://example.test/authlib-injector-1.4.0.jar' }));
    await assert.rejects(() => authlib.ensure(), /Не удалось скачать/);
    assert.ok(!fs.existsSync(authlib.jarPath()));
  });

  // ------------------------------------------------------------ командная строка
  const prep = {
    version: { id: 'v', mainClass: 'M', assets: '1', arguments: { jvm: ['-cp', '${classpath}'], game: ['--username', '${auth_player_name}', '--userType', '${user_type}', '--accessToken', '${auth_access_token}'] } },
    libs: [], clientJar: '/c.jar', instDir: '/i', nativesDir: '/n', javaBin: 'java'
  };

  t('команда: для ely добавляется -javaagent до главного класса, userType=mojang', () => {
    const acc = { type: 'ely', name: 'ElyPlayer', uuid: DASHED };
    const jar = '/home/me/DarkX Launcher/authlib-injector.jar';
    const c = launch.command(prep, acc, 'tok', {}, {}, '1.0.0', null, { authlib: { jar, api: accounts.ELY_API } });
    const i = c.args.indexOf('-javaagent:' + jar + '=https://authserver.ely.by/api/authlib-injector');
    assert.ok(i >= 0, 'агент в аргументах');
    assert.ok(i < c.args.indexOf('M'), 'агент стоит до главного класса');
    assert.ok(c.args.includes('-Dauthlibinjector.noLogFile'));
    assert.strictEqual(c.args[c.args.indexOf('--userType') + 1], 'mojang');
  });

  t('команда: ely без authlib — ошибка; у offline/microsoft агента нет', () => {
    assert.throws(() => launch.command(prep, { type: 'ely', name: 'E', uuid: DASHED }, 't', {}, {}, '1.0.0'), /authlib-injector/);
    for (const type of ['offline', 'microsoft']) {
      const c = launch.command(prep, { type, name: 'N', uuid: DASHED }, 't', {}, {}, '1.0.0');
      assert.ok(!c.args.some((a) => a.startsWith('-javaagent')), type);
    }
    assert.strictEqual(launch.command(prep, { type: 'microsoft', name: 'N', uuid: DASHED }, 't', {}, {}, '1.0.0').args.includes('msa'), true);
    assert.strictEqual(launch.command(prep, { type: 'offline', name: 'N', uuid: DASHED }, 't', {}, {}, '1.0.0').args.includes('legacy'), true);
  });

  let fail = 0;
  for (const [name, fn] of results) {
    try { await fn(); console.log('  ok   ' + name); } catch (e) { fail++; console.log('  FAIL ' + name + '\n       ' + (e.stack || e).toString().split('\n').slice(0, 4).join('\n       ')); }
  }
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(fail ? fail + ' тест(ов) Ely.by упало' : 'тесты Ely.by прошли');
  process.exit(fail ? 1 : 0);
})();
