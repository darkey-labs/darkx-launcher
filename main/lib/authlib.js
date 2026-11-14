'use strict';
// authlib-injector: Java-агент, который заставляет игру проверять сессию на стороннем сервере (Ely.by).
// Качаем свежий jar с официального сервиса (запасной вариант — зеркало BMCLAPI), проверяем sha256.
const fs = require('fs');
const crypto = require('crypto');
const P = require('./paths');
const http = require('./http');

const SOURCES = [
  'https://authlib-injector.yushi.moe/artifact/latest.json',
  'https://bmclapi2.bangbang93.com/mirrors/authlib-injector/artifact/latest.json'
];
const RECHECK_MS = 7 * 24 * 3600 * 1000;
const RETRY_MS = 24 * 3600 * 1000;

const jarPath = () => P.shared('cache', 'authlib-injector.jar');
const metaPath = () => P.shared('cache', 'authlib-injector.json');

function sha256File(file) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    fs.createReadStream(file).on('data', (d) => h.update(d)).on('end', () => resolve(h.digest('hex'))).on('error', reject);
  });
}

function readMeta() {
  try { return JSON.parse(fs.readFileSync(metaPath(), 'utf8')); } catch (_) { return null; }
}
function writeMeta(version, checkedAt) {
  fs.writeFileSync(metaPath(), JSON.stringify({ version, checkedAt: checkedAt || Date.now() }));
}

async function fetchFrom(src, have, cur) {
  const meta = await http.json(src);
  if (!meta || !/^https:\/\//.test(meta.download_url || '')) throw new Error('нет ссылки на authlib-injector');
  if (have && cur && cur.version === meta.version) { writeMeta(meta.version); return; } // версия та же — не качаем заново
  const want = meta.checksums && meta.checksums.sha256;
  if (!want) throw new Error('нет контрольной суммы authlib-injector');
  const jar = jarPath(), tmp = jar + '.new';
  await http.download(meta.download_url, tmp);
  if ((await sha256File(tmp)) !== String(want).toLowerCase()) {
    try { fs.unlinkSync(tmp); } catch (_) { /* уже нет */ }
    throw new Error('sha256 authlib-injector не совпал');
  }
  fs.renameSync(tmp, jar);
  writeMeta(meta.version);
}

/** Путь к актуальному authlib-injector.jar (скачает при первом запуске и раз в неделю проверит обновление). */
async function ensure() {
  const have = fs.existsSync(jarPath());
  const cur = readMeta();
  if (have && cur && Date.now() - cur.checkedAt < RECHECK_MS) return jarPath();
  let lastErr;
  for (const src of SOURCES) {
    try { await fetchFrom(src, have, cur); return jarPath(); } catch (e) { lastErr = e; }
  }
  if (have) { // обновить не вышло — играем со старым, следующая попытка через сутки
    writeMeta(cur ? cur.version : '', Date.now() - RECHECK_MS + RETRY_MS);
    return jarPath();
  }
  throw new Error('Не удалось скачать authlib-injector (нужен для Ely.by): ' + (lastErr ? lastErr.message : 'нет связи'));
}

module.exports = { ensure, jarPath, SOURCES };
