'use strict';
// Экспорт и импорт сборок DarkX (все моды, ресурспаки, шейдеры и конфиги):
// 1) По коду DarkX Network (DX-XXXXXX): Modrinth-файлы резолвятся по SHA-1, кастомные — упаковываются в бандл.
// 2) Автономный файл .dxpack (ZIP): работает без интернета и без ограничений на размер.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const AdmZip = require('adm-zip');
const http = require('./http');
const P = require('./paths');

const MODRINTH_HASH_URL = 'https://api.modrinth.com/v2/version_files';
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const ALLOWED_TOP_DIRS = new Set(['mods', 'resourcepacks', 'shaderpacks', 'config']);
const ALLOWED_ROOT_FILES = new Set(['options.txt']);
const ALLOWED_DOWNLOAD_HOSTS = new Set([
  'cdn.modrinth.com',
  'files.catbox.moe',
  'litter.catbox.moe',
  'tmpfiles.org',
  'github.com',
  'objects.githubusercontent.com',
  'release-assets.githubusercontent.com'
]);
const MAX_INLINE_BUNDLE_BYTES = 180 * 1024; // 180 КБ резервно в Firebase, если внешние хосты недоступны
const MAX_UPLOAD_BUNDLE_BYTES = 190 * 1024 * 1024; // 190 МБ лимит Catbox

function normalizeFirebase(url) {
  const s = String(url || '').trim().replace(/\/+$/, '');
  return s.startsWith('https://') ? s : '';
}

function cleanCode(raw) {
  let s = String(raw || '').trim().toUpperCase().replace(/[^A-Z0-9-]/g, '');
  if (s.startsWith('DX-')) s = s.slice(3);
  else if (s.startsWith('DX') && s.length > 6) s = s.slice(2);
  s = s.replace(/-/g, '');
  if (!/^[A-Z0-9]{6,10}$/.test(s)) throw new Error('Неверный формат кода сборки (пример: DX-A7K9M2)');
  return s;
}

function formatCode(clean) {
  return 'DX-' + clean;
}

function randomCode() {
  const bytes = crypto.randomBytes(6);
  let out = '';
  for (let i = 0; i < 6; i++) out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return out;
}

function isManagedDarkxJar(inst, relPath) {
  if (!inst || !inst.darkx) return false;
  const base = path.basename(relPath).toLowerCase();
  return /^darkx-visuals-.*\.jar$/i.test(base);
}

/** Рекурсивно собирает файлы из подпапки с относительными POSIX-путями. */
function walkFiles(baseDir, relPrefix, filterFn) {
  const out = [];
  if (!fs.existsSync(baseDir)) return out;
  const stack = [''];
  while (stack.length) {
    const cur = stack.pop();
    const full = cur ? path.join(baseDir, cur) : baseDir;
    let entries;
    try { entries = fs.readdirSync(full, { withFileTypes: true }); } catch (_) { continue; }
    for (const e of entries) {
      if (e.name === '.DS_Store' || e.name === 'Thumbs.db' || e.name.endsWith('.part')) continue;
      const sub = cur ? cur + '/' + e.name : e.name;
      const abs = path.join(baseDir, sub);
      if (e.isDirectory()) {
        stack.push(sub);
      } else if (e.isFile()) {
        const rel = relPrefix + '/' + sub;
        if (filterFn && !filterFn(rel, e.name)) continue;
        let size = 0;
        try { size = fs.statSync(abs).size; } catch (_) {}
        out.push({ abs, rel, name: e.name, size });
      }
    }
  }
  return out;
}

/** Считает количество и размер модов, ресурспаков, шейдеров и конфигов в сборке. */
function inspectInstance(inst) {
  const root = P.instance(inst.id);
  const mods = walkFiles(path.join(root, 'mods'), 'mods', (rel, name) =>
    (/\.(jar|jar\.disabled)$/i.test(name)) && !isManagedDarkxJar(inst, rel)
  );
  // Ресурспаки: считаем топ-уровневые элементы (zip или распакованная папка) для отображения пользователю,
  // а для упаковки сохраняем все файлы внутри resourcepacks/
  const rpDir = path.join(root, 'resourcepacks');
  let rpItems = 0;
  if (fs.existsSync(rpDir)) {
    try {
      rpItems = fs.readdirSync(rpDir).filter((n) => !n.startsWith('.') && n !== 'Thumbs.db').length;
    } catch (_) {}
  }
  const rpFiles = walkFiles(rpDir, 'resourcepacks');

  const spDir = path.join(root, 'shaderpacks');
  let spItems = 0;
  if (fs.existsSync(spDir)) {
    try {
      spItems = fs.readdirSync(spDir).filter((n) => !n.startsWith('.') && n !== 'Thumbs.db').length;
    } catch (_) {}
  }
  const spFiles = walkFiles(spDir, 'shaderpacks');

  const cfgFiles = walkFiles(path.join(root, 'config'), 'config');
  const optFile = path.join(root, 'options.txt');
  if (fs.existsSync(optFile)) {
    try {
      const st = fs.statSync(optFile);
      if (st.isFile()) cfgFiles.push({ abs: optFile, rel: 'options.txt', name: 'options.txt', size: st.size });
    } catch (_) {}
  }

  const sum = (arr) => arr.reduce((a, x) => a + x.size, 0);
  return {
    mods: { count: mods.length, bytes: sum(mods), files: mods },
    resourcepacks: { count: rpItems, fileCount: rpFiles.length, bytes: sum(rpFiles), files: rpFiles },
    shaderpacks: { count: spItems, fileCount: spFiles.length, bytes: sum(spFiles), files: spFiles },
    configs: { count: cfgFiles.length, bytes: sum(cfgFiles), files: cfgFiles }
  };
}

function publicStats(info) {
  return {
    modsCount: info.mods.count,
    modsBytes: info.mods.bytes,
    rpCount: info.resourcepacks.count,
    rpBytes: info.resourcepacks.bytes,
    spCount: info.shaderpacks.count,
    spBytes: info.shaderpacks.bytes,
    cfgCount: info.configs.count,
    cfgBytes: info.configs.bytes
  };
}

function collectSelected(info, opts = {}) {
  const incMods = opts.mods !== false;
  const incRp = opts.resourcepacks !== false;
  const incSp = !!opts.shaderpacks;
  const incCfg = !!opts.configs;
  const files = [];
  if (incMods) files.push(...info.mods.files);
  if (incRp) files.push(...info.resourcepacks.files);
  if (incSp) files.push(...info.shaderpacks.files);
  if (incCfg) files.push(...info.configs.files);
  return {
    files,
    counts: {
      mods: incMods ? info.mods.count : 0,
      resourcepacks: incRp ? info.resourcepacks.count : 0,
      shaderpacks: incSp ? info.shaderpacks.count : 0,
      configs: incCfg ? info.configs.count : 0
    }
  };
}

function safeTargetPath(instDir, rawRel) {
  const rel = String(rawRel || '').replace(/\\/g, '/').replace(/^\/+/, '');
  if (!rel || rel.includes('..') || rel.includes('\0') || /^[a-zA-Z]:/.test(rel)) {
    throw new Error('Небезопасный путь в архиве сборки: ' + rawRel);
  }
  const parts = rel.split('/');
  const top = parts[0];
  if (parts.length === 1) {
    if (!ALLOWED_ROOT_FILES.has(top)) return null;
  } else {
    if (!ALLOWED_TOP_DIRS.has(top)) return null;
  }
  const base = path.resolve(instDir);
  const full = path.resolve(base, rel);
  if (full !== base && !full.startsWith(base + path.sep)) {
    throw new Error('Попытка выхода за пределы папки сборки: ' + rawRel);
  }
  return full;
}

function assertAllowedDownloadUrl(rawUrl) {
  let u;
  try { u = new URL(String(rawUrl || '')); } catch (_) {
    throw new Error('Некорректный адрес файла в сборке');
  }
  if (u.protocol !== 'https:') throw new Error('Разрешены только HTTPS-ссылки для загрузки сборки');
  if (!ALLOWED_DOWNLOAD_HOSTS.has(u.hostname.toLowerCase())) {
    throw new Error('Неизвестный хост файла сборки: ' + u.hostname);
  }
  return u.toString();
}

function buildManifest(inst, author, counts) {
  return {
    format: 1,
    name: String(inst.name || 'Сборка').slice(0, 64),
    mc: String(inst.mc || '1.21.11').slice(0, 32),
    loader: String(inst.loaderOrigin || (inst.darkx ? 'dx' : inst.fabric ? 'fabric' : 'vanilla')).slice(0, 24),
    fabric: !!inst.fabric,
    darkx: !!inst.darkx,
    author: String(author || '').slice(0, 24),
    counts,
    t: Date.now()
  };
}

// ============================================================ экспорт в .dxpack

async function exportFile(inst, destPath, author, opts = {}, emit = () => {}) {
  emit({ phase: 'scan', text: 'Сканируем файлы сборки…', pct: 5 });
  const info = inspectInstance(inst);
  const { files, counts } = collectSelected(info, opts);

  const zip = new AdmZip();
  const manifest = buildManifest(inst, author, counts);
  zip.addFile('dxpack.json', Buffer.from(JSON.stringify(manifest, null, 2), 'utf8'));

  if (inst.icon && String(inst.icon).startsWith('data:image/')) {
    zip.addFile('meta/icon.txt', Buffer.from(String(inst.icon), 'utf8'));
  }
  if (inst.banner && String(inst.banner).startsWith('data:image/')) {
    zip.addFile('meta/banner.txt', Buffer.from(String(inst.banner), 'utf8'));
  }

  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    const pct = 10 + Math.round(((i + 1) / Math.max(1, files.length)) * 75);
    emit({ phase: 'pack', text: 'Упаковка: ' + f.name, pct });
    const entryDir = path.posix.dirname('files/' + f.rel);
    zip.addLocalFile(f.abs, entryDir, path.posix.basename(f.rel));
  }

  emit({ phase: 'write', text: 'Сохраняем архив .dxpack…', pct: 92 });
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  zip.writeZip(destPath);
  const size = fs.statSync(destPath).size;
  emit({ phase: 'done', text: 'Готово!', pct: 100 });
  return { path: destPath, size, counts };
}

// ============================================================ загрузка бандла в облако

function buildMultipart(fields, fileField, fileName, fileBuf) {
  const boundary = '----DarkXPack' + crypto.randomBytes(8).toString('hex');
  const parts = [];
  for (const [k, v] of Object.entries(fields || {})) {
    parts.push(Buffer.from(
      '--' + boundary + '\r\n'
      + 'Content-Disposition: form-data; name="' + k + '"\r\n\r\n'
      + String(v) + '\r\n', 'utf8'
    ));
  }
  parts.push(Buffer.from(
    '--' + boundary + '\r\n'
    + 'Content-Disposition: form-data; name="' + fileField + '"; filename="' + fileName + '"\r\n'
    + 'Content-Type: application/zip\r\n\r\n', 'utf8'
  ));
  parts.push(fileBuf);
  parts.push(Buffer.from('\r\n--' + boundary + '--\r\n', 'utf8'));
  return {
    contentType: 'multipart/form-data; boundary=' + boundary,
    body: Buffer.concat(parts)
  };
}

async function uploadBundleBuffer(buf) {
  if (buf.length > MAX_UPLOAD_BUNDLE_BYTES) {
    throw new Error('Кастомные файлы сборки больше 190 МБ — используй сохранение в файл .dxpack');
  }
  const errors = [];

  // 1) Catbox.moe (постоянное хранение до 200 МБ)
  try {
    const mp = buildMultipart({ reqtype: 'fileupload' }, 'fileToUpload', 'darkx-bundle.zip', buf);
    const r = await http.request('https://catbox.moe/user/api.php', {
      method: 'POST',
      headers: { 'Content-Type': mp.contentType },
      body: mp.body,
      timeout: 120000
    });
    const txt = r.body.toString('utf8').trim();
    if (r.status === 200 && /^https:\/\/files\.catbox\.moe\/[A-Za-z0-9._-]+$/.test(txt)) {
      return { url: txt, host: 'catbox.moe' };
    }
    errors.push('catbox: HTTP ' + r.status);
  } catch (e) { errors.push('catbox: ' + e.message); }

  // 2) Litterbox (резерв 72ч)
  try {
    const mp = buildMultipart({ reqtype: 'fileupload', time: '72h' }, 'fileToUpload', 'darkx-bundle.zip', buf);
    const r = await http.request('https://litterbox.catbox.moe/resources/internals/api.php', {
      method: 'POST',
      headers: { 'Content-Type': mp.contentType },
      body: mp.body,
      timeout: 120000
    });
    const txt = r.body.toString('utf8').trim();
    if (r.status === 200 && /^https:\/\/litter\.catbox\.moe\/[A-Za-z0-9._-]+$/.test(txt)) {
      return { url: txt, host: 'litterbox (72ч)' };
    }
    errors.push('litterbox: HTTP ' + r.status);
  } catch (e) { errors.push('litterbox: ' + e.message); }

  // 3) tmpfiles.org (резерв)
  try {
    const mp = buildMultipart({}, 'file', 'darkx-bundle.zip', buf);
    const r = await http.request('https://tmpfiles.org/api/v1/upload', {
      method: 'POST',
      headers: { 'Content-Type': mp.contentType },
      body: mp.body,
      timeout: 120000
    });
    const json = JSON.parse(r.body.toString('utf8'));
    const raw = json && json.data && json.data.url ? String(json.data.url) : '';
    const m = raw.match(/^https?:\/\/tmpfiles\.org\/(\d+\/.+)$/i);
    if (m) return { url: 'https://tmpfiles.org/dl/' + m[1], host: 'tmpfiles.org' };
    errors.push('tmpfiles: bad response');
  } catch (e) { errors.push('tmpfiles: ' + e.message); }

  // 4) Если архив крошечный (например только конфиги) — встраиваем прямо в запись
  if (buf.length <= MAX_INLINE_BUNDLE_BYTES) {
    return { inlineB64: buf.toString('base64'), host: 'darkx-inline' };
  }
  throw new Error('Не удалось загрузить кастомные файлы (' + errors.join('; ') + '). Сохрани сборку как .dxpack.');
}

async function resolveModrinthBySha1(candidates, emit) {
  const resolved = new Map();
  if (!candidates.length) return resolved;
  const hashed = [];
  for (let i = 0; i < candidates.length; i++) {
    const f = candidates[i];
    emit({ phase: 'hash', text: 'Проверяем в Modrinth: ' + f.name, pct: 8 + Math.round(((i + 1) / candidates.length) * 28) });
    const sha1 = await http.sha1File(f.abs);
    hashed.push({ file: f, sha1 });
  }
  const CHUNK = 100;
  for (let i = 0; i < hashed.length; i += CHUNK) {
    const part = hashed.slice(i, i + CHUNK);
    try {
      const data = await http.json(MODRINTH_HASH_URL, {
        method: 'POST',
        body: { hashes: part.map((x) => x.sha1), algorithm: 'sha1' },
        timeout: 25000
      });
      if (data && typeof data === 'object') {
        for (const item of part) {
          const ver = data[item.sha1];
          if (!ver || !Array.isArray(ver.files)) continue;
          const match = ver.files.find((x) => x.hashes && x.hashes.sha1 === item.sha1) || ver.files[0];
          if (match && match.url && /^https:\/\/cdn\.modrinth\.com\//i.test(match.url)) {
            resolved.set(item.file.rel, {
              rel: item.file.rel,
              url: match.url,
              sha1: item.sha1,
              size: item.file.size
            });
          }
        }
      }
    } catch (_) {
      // если Modrinth временно недоступен — файлы просто попадут в бандл
    }
  }
  return resolved;
}

/** Публикует сборку в DarkX Network и возвращает короткий код DX-XXXXXX. */
async function publishCode(firebaseUrl, inst, author, opts = {}, emit = () => {}) {
  const base = normalizeFirebase(firebaseUrl);
  if (!base) throw new Error('DarkX Network не настроен (нет адреса базы)');

  emit({ phase: 'scan', text: 'Сканируем моды и ресурспаки…', pct: 4 });
  const info = inspectInstance(inst);
  const { files, counts } = collectSelected(info, opts);

  // Пробуем сопоставить .jar (mods) и .zip (resourcepacks/shaderpacks) с Modrinth по SHA-1
  const hashCandidates = files.filter((f) =>
    (f.rel.startsWith('mods/') && /\.jar$/i.test(f.name))
    || ((f.rel.startsWith('resourcepacks/') || f.rel.startsWith('shaderpacks/')) && /\.zip$/i.test(f.name))
  );
  const mrMap = await resolveModrinthBySha1(hashCandidates, emit);

  const mrFiles = [];
  const customFiles = [];
  for (const f of files) {
    const hit = mrMap.get(f.rel);
    if (hit) mrFiles.push(hit);
    else customFiles.push(f);
  }

  let bundleUrl = '';
  let bundleSha1 = '';
  let bundleSize = 0;
  let bundleB64 = '';
  let bundleHost = '';

  if (customFiles.length) {
    emit({ phase: 'bundle', text: 'Упаковываем кастомные файлы (' + customFiles.length + ')…', pct: 48 });
    const zip = new AdmZip();
    for (const f of customFiles) {
      const entryDir = path.posix.dirname('files/' + f.rel);
      zip.addLocalFile(f.abs, entryDir, path.posix.basename(f.rel));
    }
    const buf = zip.toBuffer();
    bundleSize = buf.length;
    bundleSha1 = crypto.createHash('sha1').update(buf).digest('hex');
    emit({ phase: 'upload', text: 'Загружаем кастомный пакет (' + (buf.length / 1048576).toFixed(1) + ' МБ)…', pct: 65 });
    const up = await uploadBundleBuffer(buf);
    if (up.url) bundleUrl = up.url;
    if (up.inlineB64) bundleB64 = up.inlineB64;
    bundleHost = up.host || '';
  }

  const manifest = buildManifest(inst, author, counts);
  manifest.mr = mrFiles;
  manifest.customCount = customFiles.length;
  if (bundleUrl) {
    manifest.bundleUrl = bundleUrl;
    manifest.bundleSha1 = bundleSha1;
    manifest.bundleSize = bundleSize;
  } else if (bundleB64) {
    manifest.bundleB64 = bundleB64;
    manifest.bundleSha1 = bundleSha1;
    manifest.bundleSize = bundleSize;
  }

  emit({ phase: 'publish', text: 'Регистрируем код в DarkX Network…', pct: 90 });
  let code = '';
  let lastErr = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    const candidate = randomCode();
    try {
      await http.json(base + '/darkx/packs/' + candidate + '.json', {
        method: 'PUT',
        body: manifest,
        timeout: 20000
      });
      code = candidate;
      break;
    } catch (e) {
      lastErr = e;
      if (e.status === 401 || e.status === 403) {
        const err = new Error('В базе Firebase ещё не включён раздел /darkx/packs — обнови firebase-rules.json или сохрани сборку в .dxpack');
        err.code = 'FIREBASE_RULES';
        throw err;
      }
    }
  }
  if (!code) throw lastErr || new Error('Не удалось зарегистрировать код сборки');

  emit({ phase: 'done', text: 'Сборка опубликована!', pct: 100 });
  return {
    code: formatCode(code),
    counts,
    modrinthCount: mrFiles.length,
    customCount: customFiles.length,
    bundleHost
  };
}

// ============================================================ чтение и импорт

async function fetchCode(firebaseUrl, rawCode) {
  const base = normalizeFirebase(firebaseUrl);
  if (!base) throw new Error('DarkX Network не настроен (нет адреса базы)');
  const c = cleanCode(rawCode);
  let data;
  try {
    data = await http.json(base + '/darkx/packs/' + c + '.json', { timeout: 15000 });
  } catch (e) {
    if (e.status === 401 || e.status === 403) {
      throw new Error('Нет доступа к /darkx/packs в Firebase — обнови правила firebase-rules.json');
    }
    throw e;
  }
  if (!data || typeof data !== 'object' || !data.name || !data.mc) {
    throw new Error('Сборка с кодом ' + formatCode(c) + ' не найдена');
  }
  return {
    code: formatCode(c),
    name: String(data.name).slice(0, 64),
    mc: String(data.mc).slice(0, 32),
    loader: String(data.loader || (data.darkx ? 'dx' : data.fabric ? 'fabric' : 'vanilla')),
    fabric: !!data.fabric,
    darkx: !!data.darkx,
    author: String(data.author || ''),
    counts: data.counts || { mods: (data.mr || []).length, resourcepacks: 0, shaderpacks: 0, configs: 0 },
    modrinthCount: Array.isArray(data.mr) ? data.mr.length : 0,
    customCount: Number(data.customCount) || 0,
    bundleSize: Number(data.bundleSize) || 0,
    createdAt: Number(data.t) || 0,
    _raw: data
  };
}

function inspectFile(filePath) {
  if (!filePath || !fs.existsSync(filePath)) throw new Error('Файл сборки не найден');
  const zip = new AdmZip(filePath);
  const entry = zip.getEntry('dxpack.json');
  if (!entry) throw new Error('Это не файл сборки DarkX (нет dxpack.json)');
  const data = JSON.parse(entry.getData().toString('utf8'));
  if (!data || !data.name || !data.mc) throw new Error('Повреждённый манифест dxpack.json');
  return {
    filePath,
    size: fs.statSync(filePath).size,
    name: String(data.name).slice(0, 64),
    mc: String(data.mc).slice(0, 32),
    loader: String(data.loader || (data.darkx ? 'dx' : data.fabric ? 'fabric' : 'vanilla')),
    fabric: !!data.fabric,
    darkx: !!data.darkx,
    author: String(data.author || ''),
    counts: data.counts || { mods: 0, resourcepacks: 0, shaderpacks: 0, configs: 0 },
    createdAt: Number(data.t) || 0
  };
}

function extractFilesPrefix(zip, instDir, emit, pctStart, pctEnd) {
  const entries = zip.getEntries().filter((e) => !e.isDirectory && e.entryName.startsWith('files/'));
  let extracted = 0;
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    const rel = e.entryName.slice('files/'.length);
    const dest = safeTargetPath(instDir, rel);
    if (!dest) continue;
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, e.getData());
    extracted++;
    if (entries.length) {
      const pct = pctStart + Math.round(((i + 1) / entries.length) * (pctEnd - pctStart));
      emit({ phase: 'extract', text: 'Распаковка: ' + path.basename(dest), pct });
    }
  }
  return extracted;
}

async function importFromFile(filePath, instDir, emit = () => {}) {
  emit({ phase: 'read', text: 'Читаем файл .dxpack…', pct: 5 });
  const preview = inspectFile(filePath);
  const zip = new AdmZip(filePath);
  fs.mkdirSync(instDir, { recursive: true });

  let icon = null;
  let banner = null;
  const iconEntry = zip.getEntry('meta/icon.txt');
  if (iconEntry) {
    const v = iconEntry.getData().toString('utf8').trim();
    if (v.startsWith('data:image/') && v.length < 2 * 1024 * 1024) icon = v;
  }
  const bannerEntry = zip.getEntry('meta/banner.txt');
  if (bannerEntry) {
    const v = bannerEntry.getData().toString('utf8').trim();
    if (v.startsWith('data:image/') && v.length < 4 * 1024 * 1024) banner = v;
  }

  const extracted = extractFilesPrefix(zip, instDir, emit, 15, 96);
  emit({ phase: 'done', text: 'Сборка импортирована!', pct: 100 });
  return { preview, extracted, icon, banner };
}

async function importFromCode(firebaseUrl, rawCode, instDir, emit = () => {}) {
  emit({ phase: 'fetch', text: 'Загружаем описание сборки…', pct: 5 });
  const preview = await fetchCode(firebaseUrl, rawCode);
  const data = preview._raw;
  fs.mkdirSync(instDir, { recursive: true });

  const mrList = Array.isArray(data.mr) ? data.mr : [];
  let done = 0;
  let failed = 0;

  if (mrList.length) {
    await http.pool(mrList, 5, async (item) => {
      const dest = safeTargetPath(instDir, item.rel);
      if (!dest) return;
      const url = assertAllowedDownloadUrl(item.url);
      try {
        await http.download(url, dest, { sha1: item.sha1 || undefined });
      } catch (_) {
        failed++;
      } finally {
        done++;
        const pct = 10 + Math.round((done / mrList.length) * (data.bundleUrl || data.bundleB64 ? 50 : 85));
        emit({ phase: 'download', text: 'Скачиваем: ' + path.basename(dest) + ' (' + done + '/' + mrList.length + ')', pct });
      }
    });
  }

  let extracted = 0;
  if (data.bundleUrl) {
    const bundleUrl = assertAllowedDownloadUrl(data.bundleUrl);
    const tmpZip = path.join(instDir, '.dxpack-bundle.zip');
    try {
      emit({ phase: 'bundle', text: 'Скачиваем кастомные файлы и ресурспаки…', pct: 68 });
      await http.download(bundleUrl, tmpZip, { sha1: data.bundleSha1 || undefined });
      const zip = new AdmZip(tmpZip);
      extracted = extractFilesPrefix(zip, instDir, emit, 76, 97);
    } finally {
      try { fs.unlinkSync(tmpZip); } catch (_) {}
    }
  } else if (data.bundleB64) {
    emit({ phase: 'bundle', text: 'Распаковываем конфиги и файлы…', pct: 75 });
    const zip = new AdmZip(Buffer.from(String(data.bundleB64), 'base64'));
    extracted = extractFilesPrefix(zip, instDir, emit, 78, 97);
  }

  emit({ phase: 'done', text: 'Сборка готова!', pct: 100 });
  return { preview, downloaded: done - failed, failed, extracted };
}

module.exports = {
  inspectInstance,
  publicStats,
  exportFile,
  publishCode,
  fetchCode,
  inspectFile,
  importFromFile,
  importFromCode
};
