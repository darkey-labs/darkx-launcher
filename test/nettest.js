// Проверка сетевого слоя на электроновском net (Chromium) против локального сервера. Запуск: electron test/nettest.js
const { app } = require('electron');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
app.commandLine.appendSwitch('no-sandbox');
const lib = require('../main/lib/http');
const big = Buffer.alloc(3 * 1024 * 1024, 7);
const srv = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    if (req.url === '/json') { res.setHeader('Content-Type', 'application/json'); return res.end('{"a":1}'); }
    if (req.url === '/echo') { res.setHeader('Content-Type', 'application/json'); return res.end(JSON.stringify({ ct: req.headers['content-type'], ua: req.headers['user-agent'], body })); }
    if (req.url === '/redir') { res.statusCode = 302; res.setHeader('Location', '/file'); return res.end(); }
    if (req.url === '/file') { res.setHeader('ETag', '"abc"'); res.setHeader('Content-Length', big.length); return req.method === 'HEAD' ? res.end() : res.end(big); }
    if (req.url === '/err') { res.statusCode = 400; res.setHeader('Content-Type', 'application/json'); return res.end('{"error":"authorization_pending"}'); }
    res.statusCode = 404; res.end('no');
  });
});
app.whenReady().then(() => srv.listen(0, '127.0.0.1', async () => {
  const base = 'http://127.0.0.1:' + srv.address().port;
  let code = 0;
  const t = async (n, f) => { try { await f(); console.log('  ok   ' + n); } catch (e) { code = 1; console.log('  FAIL ' + n + ' ' + (e.stack || e)); } };
  await t('использует electron.net', async () => assert.ok(require('electron').net && app.isReady()));
  await t('json GET', async () => assert.deepStrictEqual(await lib.json(base + '/json'), { a: 1 }));
  await t('json POST (форма и JSON, свой User-Agent)', async () => {
    const a = await lib.json(base + '/echo', { form: true, body: { x: '1', y: 'a b' } });
    assert.strictEqual(a.body, 'x=1&y=a+b');
    assert.ok(a.ct.includes('x-www-form-urlencoded'));
    const b = await lib.json(base + '/echo', { body: { k: 2 } });
    assert.strictEqual(b.body, '{"k":2}');
    assert.ok(b.ua.startsWith('DarkXLauncher'), b.ua);
  });
  await t('ошибка 400 с телом', async () => {
    await assert.rejects(() => lib.json(base + '/err'), (e) => e.status === 400 && e.body.error === 'authorization_pending');
  });
  await t('HEAD и заголовки', async () => {
    const r = await lib.request(base + '/file', { method: 'HEAD' });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.headers.etag, '"abc"');
  });
  await t('скачивание с редиректом, размером и sha1', async () => {
    const d = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'nt-')), 'a', 'f.bin');
    let n = 0;
    const sha = await new Promise((r) => r(require('crypto').createHash('sha1').update(big).digest('hex')));
    await lib.download(base + '/redir', d, { sha1: sha, size: big.length, onBytes: (x) => { n += x; } });
    assert.strictEqual(fs.statSync(d).size, big.length);
    assert.strictEqual(n, big.length);
    assert.ok(!fs.existsSync(d + '.part'));
  });
  await t('404 при скачивании → ошибка после повторов', async () => {
    await assert.rejects(() => lib.download(base + '/nope', path.join(os.tmpdir(), 'nt404.bin')), /HTTP 404/);
  });
  await t('недоступный хост → быстрая ошибка', async () => {
    await assert.rejects(() => lib.json('http://127.0.0.1:1/x', { timeout: 3000 }));
  });
  console.log(code ? 'есть ошибки' : 'сеть (electron.net): все проверки прошли');
  srv.close();
  app.exit(code);
}));
