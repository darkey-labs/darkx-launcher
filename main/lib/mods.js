'use strict';
// Моды сборки: Fabric API (Modrinth) и клиент DarkX (по прямой ссылке из настроек).
const fs = require('fs');
const path = require('path');
const http = require('./http');

const MODRINTH = 'https://api.modrinth.com/v2';

/** Последняя версия Fabric API под нужную версию игры. */
async function fabricApiFile(mc) {
  const q = '?loaders=' + encodeURIComponent('["fabric"]') + '&game_versions=' + encodeURIComponent('["' + mc + '"]');
  const vers = await http.json(MODRINTH + '/project/fabric-api/version' + q);
  if (!vers.length) throw new Error('Для Minecraft ' + mc + ' нет Fabric API на Modrinth');
  const files = vers[0].files;
  const f = files.find((x) => x.primary) || files[0];
  return { url: f.url, filename: f.filename, sha1: f.hashes && f.hashes.sha1, size: f.size };
}

async function ensureFabricApi(modsDir, mc, emit) {
  fs.mkdirSync(modsDir, { recursive: true });
  const f = await fabricApiFile(mc);
  const dest = path.join(modsDir, f.filename);
  if (fs.existsSync(dest) && fs.statSync(dest).size === f.size) return f.filename;
  for (const n of fs.readdirSync(modsDir)) {
    if (/^fabric-api-.*\.jar$/i.test(n) && n !== f.filename) fs.unlinkSync(path.join(modsDir, n)); // старая версия
  }
  await http.download(f.url, dest, { sha1: f.sha1, size: f.size, onBytes: () => emit && emit() });
  return f.filename;
}

/**
 * Клиент DarkX по прямой ссылке. Перекачивается, если на сервере изменился ETag/размер.
 * Возвращает {status: 'skipped'|'installed'|'updated'|'unchanged', file}.
 */
async function ensureClient(modsDir, url, fileName) {
  if (!url) return { status: 'skipped' };
  fs.mkdirSync(modsDir, { recursive: true });
  const dest = path.join(modsDir, fileName);
  const metaFile = path.join(modsDir, '.darkx-client.json');
  let meta = {};
  try { meta = JSON.parse(fs.readFileSync(metaFile, 'utf8')); } catch (_) { /* первый раз */ }

  let tag = '';
  try {
    const h = await http.request(url, { method: 'HEAD' });
    if (h.status < 400) tag = [h.headers.etag, h.headers['content-length'], h.headers['last-modified']].join('|');
  } catch (_) { /* HEAD не поддерживается — решаем по наличию файла */ }

  const exists = fs.existsSync(dest);
  if (exists && meta.url === url && tag && meta.tag === tag) return { status: 'unchanged', file: fileName };
  if (exists && meta.url === url && !tag) return { status: 'unchanged', file: fileName };

  await http.download(url, dest);
  fs.writeFileSync(metaFile, JSON.stringify({ url, tag }));
  return { status: exists ? 'updated' : 'installed', file: fileName };
}

module.exports = { fabricApiFile, ensureFabricApi, ensureClient };
