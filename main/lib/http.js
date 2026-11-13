'use strict';
// Минимальный HTTP-клиент на https (Node 16 из Electron 20 не имеет fetch).
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const UA = 'DarkXLauncher/1.0';

// В Electron ходим через сетевой стек Chromium (electron.net): он понимает системный прокси,
// VPN-прокси и сертификаты Windows. Вне Electron (тесты) — обычный https.
function electronNet() {
  if (!process.versions.electron) return null;
  try {
    const e = require('electron');
    return e && e.net && (e.app ? e.app.isReady() : true) ? e.net : null;
  } catch (_) { return null; }
}

function normHeaders(h) {
  const out = {};
  for (const k of Object.keys(h || {})) out[k.toLowerCase()] = Array.isArray(h[k]) ? h[k].join(', ') : h[k];
  return out;
}

function netRequest(net, url, opts) {
  return new Promise((resolve, reject) => {
    const headers = Object.assign({ 'User-Agent': UA, Accept: '*/*' }, opts.headers || {});
    let body = opts.body;
    if (body && typeof body === 'object' && !Buffer.isBuffer(body)) {
      if (opts.form) {
        body = new URLSearchParams(body).toString();
        headers['Content-Type'] = 'application/x-www-form-urlencoded';
      } else {
        body = JSON.stringify(body);
        headers['Content-Type'] = 'application/json';
      }
    }
    const req = net.request({ method: opts.method || (body ? 'POST' : 'GET'), url, redirect: 'follow' });
    for (const [k, v] of Object.entries(headers)) req.setHeader(k, v);
    let done = false;
    const end = (fn, v) => { if (!done) { done = true; clearTimeout(timer); fn(v); } };
    const timer = setTimeout(() => { req.abort(); end(reject, new Error('timeout ' + url)); }, opts.timeout || 30000);
    req.on('response', (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => end(resolve, { status: res.statusCode, headers: normHeaders(res.headers), body: Buffer.concat(chunks) }));
      res.on('error', (e) => end(reject, e));
    });
    req.on('error', (e) => end(reject, e));
    if (body) req.write(body);
    req.end();
  });
}

function netDownloadOnce(net, url, tmp, onBytes) {
  return new Promise((resolve, reject) => {
    const req = net.request({ method: 'GET', url, redirect: 'follow' });
    req.setHeader('User-Agent', UA);
    let done = false, timer, out;
    const end = (err) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (err) { try { req.abort(); } catch (_) { /* уже закрыт */ } if (out) out.destroy(); reject(err); }
      else out.end(resolve);
    };
    const arm = () => { clearTimeout(timer); timer = setTimeout(() => end(new Error('timeout ' + url)), 30000); };
    arm();
    req.on('response', (res) => {
      if (res.statusCode !== 200) return end(new Error('HTTP ' + res.statusCode + ' ' + url));
      out = fs.createWriteStream(tmp);
      out.on('error', end);
      res.on('data', (c) => { arm(); out.write(c); if (onBytes) onBytes(c.length); });
      res.on('end', () => end());
      res.on('error', end);
    });
    req.on('error', end);
    req.end();
  });
}

function pick(url) {
  return url.startsWith('https:') ? https : http;
}

/** Базовый запрос. Возвращает {status, headers, body:Buffer}. Следует редиректам. */
function request(url, opts = {}, redirects = 6) {
  const net = electronNet();
  if (net) return netRequest(net, url, opts);
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const headers = Object.assign({ 'User-Agent': UA, Accept: '*/*' }, opts.headers || {});
    let body = opts.body;
    if (body && typeof body === 'object' && !Buffer.isBuffer(body)) {
      if (opts.form) {
        body = new URLSearchParams(body).toString();
        headers['Content-Type'] = 'application/x-www-form-urlencoded';
      } else {
        body = JSON.stringify(body);
        headers['Content-Type'] = 'application/json';
      }
    }
    if (body) headers['Content-Length'] = Buffer.byteLength(body);
    const req = pick(url).request(u, { method: opts.method || (body ? 'POST' : 'GET'), headers }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects > 0) {
        res.resume();
        return resolve(request(new URL(res.headers.location, url).toString(), opts, redirects - 1));
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
      res.on('error', reject);
    });
    req.setTimeout(opts.timeout || 30000, () => req.destroy(new Error('timeout ' + url)));
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

/** JSON-запрос. Бросает ошибку при статусе >= 400 (с телом ответа в err.body). */
async function json(url, opts = {}) {
  const headers = Object.assign({ Accept: 'application/json' }, opts.headers || {});
  const r = await request(url, Object.assign({}, opts, { headers }));
  const text = r.body.toString('utf8');
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (_) { /* не JSON */ }
  if (r.status >= 400) {
    const err = new Error('HTTP ' + r.status + ' ' + url);
    err.status = r.status;
    err.body = data || text;
    throw err;
  }
  return data;
}

function sha1File(file) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha1');
    fs.createReadStream(file).on('data', (d) => h.update(d)).on('end', () => resolve(h.digest('hex'))).on('error', reject);
  });
}

/** Скачать в файл (через .part), проверить размер и sha1. До 3 попыток. */
async function download(url, dest, { sha1, size, onBytes } = {}) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  let lastErr;
  const net = electronNet();
  for (let attempt = 1; attempt <= 4; attempt++) {
    const tmp = dest + '.part';
    try {
      if (net) await netDownloadOnce(net, url, tmp, onBytes);
      else await new Promise((resolve, reject) => {
        const go = (u, left) => {
          const req = pick(u).get(u, { headers: { 'User-Agent': UA } }, (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && left > 0) {
              res.resume();
              return go(new URL(res.headers.location, u).toString(), left - 1);
            }
            if (res.statusCode !== 200) {
              res.resume();
              return reject(new Error('HTTP ' + res.statusCode + ' ' + u));
            }
            const out = fs.createWriteStream(tmp);
            res.on('data', (c) => onBytes && onBytes(c.length));
            res.pipe(out);
            out.on('finish', resolve);
            out.on('error', reject);
            res.on('error', reject);
          });
          req.setTimeout(30000, () => req.destroy(new Error('timeout ' + u)));
          req.on('error', reject);
        };
        go(url, 6);
      });
      const st = fs.statSync(tmp);
      if (size && st.size !== size) throw new Error('размер ' + st.size + ' ≠ ' + size + ' (' + path.basename(dest) + ')');
      if (sha1 && (await sha1File(tmp)) !== sha1.toLowerCase()) throw new Error('sha1 не совпал (' + path.basename(dest) + ')');
      fs.renameSync(tmp, dest);
      return;
    } catch (e) {
      lastErr = e;
      try { fs.unlinkSync(tmp); } catch (_) { /* нет файла */ }
      if (attempt < 4) await new Promise((r) => setTimeout(r, 600 * attempt));
    }
  }
  throw lastErr;
}

/** Выполнить задачи с ограничением параллелизма. */
async function pool(items, limit, worker) {
  let i = 0;
  const run = async () => {
    while (i < items.length) {
      const idx = i++;
      await worker(items[idx], idx);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
}

module.exports = { request, json, download, pool, sha1File, UA };
