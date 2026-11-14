'use strict';
// Чтение метаданных модов из .jar (Fabric, Quilt, Forge, NeoForge), вытаскивание иконки (icon.png),
// автора и версии, а также умная распаковка архивов с модами с проверкой совместимости.
const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');

const metaCache = new Map();

const MC_VER_RE = /(?:^|[^\d.])(1\.\d{1,2}(?:\.\d{1,2})?)(?![\d.])/g;

function cleanJsonString(raw) {
  return String(raw || '')
    .replace(/^\uFEFF/, '')
    .replace(/\r\n/g, '\n');
}

function parseManifestMf(text) {
  const out = {};
  const lines = String(text || '').replace(/\r\n/g, '\n').split('\n');
  let curKey = null;
  for (const line of lines) {
    if (!line) continue;
    if (line.startsWith(' ') && curKey) {
      out[curKey] += line.slice(1);
      continue;
    }
    const idx = line.indexOf(':');
    if (idx > 0) {
      curKey = line.slice(0, idx).trim();
      out[curKey] = line.slice(idx + 1).trim();
    }
  }
  return out;
}

function formatAuthors(raw) {
  if (!raw) return '';
  if (typeof raw === 'string') return raw.trim();
  if (Array.isArray(raw)) {
    const names = raw
      .map((x) => {
        if (!x) return '';
        if (typeof x === 'string') return x.trim();
        if (typeof x === 'object' && x.name) return String(x.name).trim();
        return '';
      })
      .filter(Boolean);
    return names.slice(0, 3).join(', ');
  }
  if (typeof raw === 'object') {
    return Object.keys(raw).slice(0, 3).join(', ');
  }
  return '';
}

function pickIconPath(iconField, modId) {
  if (!iconField) {
    return modId ? 'assets/' + modId + '/icon.png' : 'icon.png';
  }
  if (typeof iconField === 'string') return iconField.replace(/^\/+/, '');
  if (typeof iconField === 'object') {
    const keys = Object.keys(iconField).sort((a, b) => Number(b) - Number(a));
    if (keys.length && typeof iconField[keys[0]] === 'string') {
      return iconField[keys[0]].replace(/^\/+/, '');
    }
  }
  return modId ? 'assets/' + modId + '/icon.png' : 'icon.png';
}

function extractIconDataUrl(zip, preferredPath) {
  const candidates = [];
  if (preferredPath) candidates.push(String(preferredPath).replace(/^\/+/, ''));
  candidates.push('icon.png', 'logo.png', 'pack.png');

  for (const cand of candidates) {
    if (!cand) continue;
    const entry = zip.getEntry(cand);
    if (entry && !entry.isDirectory) {
      try {
        const buf = entry.getData();
        if (buf && buf.length > 0 && buf.length < 2 * 1024 * 1024) {
          const ext = path.extname(cand).toLowerCase();
          const mime = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : ext === '.webp' ? 'image/webp' : 'image/png';
          return 'data:' + mime + ';base64,' + buf.toString('base64');
        }
      } catch (_) {}
    }
  }

  // Попробуем найти любую assets/*/icon.png внутри jar
  try {
    for (const e of zip.getEntries()) {
      if (!e.isDirectory && /^assets\/[^/]+\/(icon|logo)\.png$/i.test(e.entryName)) {
        const buf = e.getData();
        if (buf && buf.length > 0 && buf.length < 2 * 1024 * 1024) {
          return 'data:image/png;base64,' + buf.toString('base64');
        }
      }
    }
  } catch (_) {}

  return null;
}

function parseTomlMods(rawToml, defaultLoader) {
  const text = String(rawToml || '').replace(/\r\n/g, '\n');
  const getVal = (key) => {
    const re = new RegExp('^\\s*' + key + '\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\')', 'm');
    const m = re.exec(text);
    return m ? (m[1] !== undefined ? m[1] : m[2]).trim() : '';
  };
  const modId = getVal('modId');
  const name = getVal('displayName') || modId;
  const version = getVal('version');
  const author = getVal('authors');
  const logoFile = getVal('logoFile');
  const description = getVal('description');

  // Ищем зависимость от minecraft или loader в [[dependencies...]]
  let mcDep = '';
  let loader = defaultLoader || 'forge';
  const blocks = text.split(/\[\[\s*dependencies[^\]]*\]\]/i).slice(1);
  for (const blk of blocks) {
    const mId = /^\s*modId\s*=\s*["']([^"']+)["']/m.exec(blk);
    const vRange = /^\s*versionRange\s*=\s*["']([^"']+)["']/m.exec(blk);
    if (!mId) continue;
    const target = mId[1].trim().toLowerCase();
    if (target === 'minecraft' && vRange) mcDep = vRange[1].trim();
    if (target === 'neoforge') loader = 'neoforge';
    if (target === 'forge' && !defaultLoader) loader = 'forge';
  }

  return { id: modId, name, version, author, logoFile, description, mcDep, loader };
}

function guessFromFileName(fileName) {
  const base = path.basename(String(fileName || ''), '.jar');
  let loader = '';
  if (/(?:^|[-_+.\s])neoforge(?:[-_+.\s]|$)/i.test(base)) loader = 'neoforge';
  else if (/(?:^|[-_+.\s])forge(?:[-_+.\s]|$)/i.test(base)) loader = 'forge';
  else if (/(?:^|[-_+.\s])fabric(?:[-_+.\s]|$)/i.test(base)) loader = 'fabric';
  else if (/(?:^|[-_+.\s])quilt(?:[-_+.\s]|$)/i.test(base)) loader = 'quilt';

  let mc = '';
  const mcTag = /(?:mc|minecraft|for)[-_+]?(1\.\d{1,2}(?:\.\d{1,2})?)/i.exec(base);
  if (mcTag) {
    mc = mcTag[1];
  } else {
    const matches = [...base.matchAll(MC_VER_RE)].map((m) => m[1]);
    const validMc = matches.find((v) => /^1\.(7|8|9|1\d|2\d)(\.\d{1,2})?$/.test(v));
    if (validMc) mc = validMc;
  }

  // Пытаемся достать версию мода из имени файла
  let version = '';
  const withoutMc = mc ? base.replace(new RegExp('(?:mc|minecraft)?[-_+]?' + mc.replace(/\./g, '\\.'), 'ig'), '') : base;
  const verMatch = /[-_+]v?(\d+\.\d+(?:\.\d+)?(?:[-+][0-9A-Za-z.]+)?)/i.exec(withoutMc);
  if (verMatch) version = verMatch[1];

  const cleanTitle = base
    .replace(/[-_+](fabric|forge|neoforge|quilt|mc\d[\d.]*)/ig, ' ')
    .replace(/[-_+]v?\d+\.\d+[\w.+~-]*/g, '')
    .replace(/[-_]+/g, ' ')
    .trim();

  return {
    title: cleanTitle || base,
    version,
    loader,
    mc
  };
}

/**
 * Читает метаданные мода из открытого AdmZip или буфера.
 */
function inspectJarZip(zip, fileName = '') {
  const fallback = guessFromFileName(fileName);
  let mf = {};
  const mfEntry = zip.getEntry('META-INF/MANIFEST.MF');
  if (mfEntry) {
    try { mf = parseManifestMf(zip.readAsText(mfEntry)); } catch (_) {}
  }
  const jarImplVer = mf['Implementation-Version'] || mf['Specification-Version'] || '';

  // 1. Fabric (fabric.mod.json)
  const fabEntry = zip.getEntry('fabric.mod.json');
  if (fabEntry) {
    try {
      const meta = JSON.parse(cleanJsonString(zip.readAsText(fabEntry)));
      const rawVer = String(meta.version || '').trim();
      const version = (!rawVer || rawVer === '${version}') ? (jarImplVer || fallback.version) : rawVer;
      const author = formatAuthors(meta.authors) || formatAuthors(meta.contributors) || mf['Implementation-Vendor'] || '';
      const iconPath = pickIconPath(meta.icon, meta.id);
      const iconDataUrl = extractIconDataUrl(zip, iconPath);
      const depends = meta.depends || {};
      const mcDep = depends.minecraft || fallback.mc || '';
      return {
        isMod: true,
        id: String(meta.id || fallback.title).toLowerCase(),
        name: String(meta.name || meta.id || fallback.title).trim(),
        version: String(version || '').trim(),
        author: String(author || '').trim(),
        description: String(meta.description || '').trim(),
        loader: 'fabric',
        mcDep,
        iconDataUrl
      };
    } catch (_) {}
  }

  // 2. Quilt (quilt.mod.json)
  const quiltEntry = zip.getEntry('quilt.mod.json');
  if (quiltEntry) {
    try {
      const raw = JSON.parse(cleanJsonString(zip.readAsText(quiltEntry)));
      const ql = raw.quilt_loader || {};
      const md = ql.metadata || {};
      const rawVer = String(ql.version || '').trim();
      const version = (!rawVer || rawVer === '${version}') ? (jarImplVer || fallback.version) : rawVer;
      const author = formatAuthors(md.contributors) || '';
      const iconPath = pickIconPath(md.icon, ql.id);
      const iconDataUrl = extractIconDataUrl(zip, iconPath);
      let mcDep = fallback.mc || '';
      if (Array.isArray(ql.depends)) {
        const mcObj = ql.depends.find((d) => d && (d.id === 'minecraft' || d === 'minecraft'));
        if (mcObj && mcObj.versions) mcDep = mcObj.versions;
      }
      return {
        isMod: true,
        id: String(ql.id || fallback.title).toLowerCase(),
        name: String(md.name || ql.id || fallback.title).trim(),
        version: String(version || '').trim(),
        author: String(author || '').trim(),
        description: String(md.description || '').trim(),
        loader: 'quilt',
        mcDep,
        iconDataUrl
      };
    } catch (_) {}
  }

  // 3. NeoForge / Forge (META-INF/neoforge.mods.toml или META-INF/mods.toml)
  const neoEntry = zip.getEntry('META-INF/neoforge.mods.toml');
  const forgeEntry = zip.getEntry('META-INF/mods.toml');
  if (neoEntry || forgeEntry) {
    try {
      const entry = neoEntry || forgeEntry;
      const defLoader = neoEntry ? 'neoforge' : 'forge';
      const parsed = parseTomlMods(zip.readAsText(entry), defLoader);
      const version = (!parsed.version || parsed.version.includes('${')) ? (jarImplVer || fallback.version) : parsed.version;
      const iconDataUrl = extractIconDataUrl(zip, parsed.logoFile);
      return {
        isMod: true,
        id: String(parsed.id || fallback.title).toLowerCase(),
        name: String(parsed.name || fallback.title).trim(),
        version: String(version || '').trim(),
        author: String(parsed.author || mf['Implementation-Vendor'] || '').trim(),
        description: String(parsed.description || '').trim(),
        loader: parsed.loader || defLoader,
        mcDep: parsed.mcDep || fallback.mc || '',
        iconDataUrl
      };
    } catch (_) {}
  }

  // 4. Legacy Forge (mcmod.info)
  const mcmodEntry = zip.getEntry('mcmod.info');
  if (mcmodEntry) {
    try {
      const raw = JSON.parse(cleanJsonString(zip.readAsText(mcmodEntry)));
      const list = Array.isArray(raw) ? raw : (raw && Array.isArray(raw.modList) ? raw.modList : []);
      const m = list[0] || {};
      const version = (!m.version || String(m.version).includes('${')) ? (jarImplVer || fallback.version) : m.version;
      const author = formatAuthors(m.authorList || m.authors);
      const iconDataUrl = extractIconDataUrl(zip, m.logoFile);
      return {
        isMod: true,
        id: String(m.modid || fallback.title).toLowerCase(),
        name: String(m.name || m.modid || fallback.title).trim(),
        version: String(version || '').trim(),
        author: String(author || '').trim(),
        description: String(m.description || '').trim(),
        loader: 'forge',
        mcDep: m.mcversion || fallback.mc || '',
        iconDataUrl
      };
    } catch (_) {}
  }

  // 5. Нераспознанный .jar — возвращаем данные из MANIFEST.MF и имени файла
  const iconDataUrl = extractIconDataUrl(zip, null);
  return {
    isMod: Boolean(fallback.loader),
    id: fallback.title.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    name: mf['Implementation-Title'] || mf['Specification-Title'] || fallback.title,
    version: jarImplVer || fallback.version || '',
    author: mf['Implementation-Vendor'] || mf['Specification-Vendor'] || '',
    description: '',
    loader: fallback.loader || 'unknown',
    mcDep: fallback.mc || '',
    iconDataUrl
  };
}

function inspectJarBuffer(buf, fileName = '') {
  const zip = new AdmZip(buf);
  return inspectJarZip(zip, fileName);
}

function inspectJarFile(jarPath) {
  try {
    const st = fs.statSync(jarPath);
    const cacheKey = jarPath + '|' + st.size + '|' + st.mtimeMs;
    if (metaCache.has(cacheKey)) return metaCache.get(cacheKey);
    const zip = new AdmZip(jarPath);
    const info = inspectJarZip(zip, path.basename(jarPath));
    metaCache.set(cacheKey, info);
    return info;
  } catch (_) {
    const fb = guessFromFileName(jarPath);
    return {
      isMod: false,
      id: fb.title.toLowerCase(),
      name: fb.title,
      version: fb.version || '',
      author: '',
      description: '',
      loader: fb.loader || 'unknown',
      mcDep: fb.mc || '',
      iconDataUrl: null
    };
  }
}

// ============================================================ проверка совместимости версий и модлоадеров

function parseMcParts(ver) {
  const m = /(\d+)\.(\d+)(?:\.(\d+))?/.exec(String(ver || ''));
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3] || 0)];
}

function cmpMc(a, b) {
  const pa = parseMcParts(a);
  const pb = parseMcParts(b);
  if (!pa || !pb) return 0;
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] > pb[i] ? 1 : -1;
  }
  return 0;
}

function matchSingleMcExpr(expr, targetMc) {
  const s = String(expr || '').trim();
  if (!s || s === '*' || s === 'any') return true;
  const target = parseMcParts(targetMc);
  if (!target) return true;

  // Maven range: [1.21,1.22) или [1.21.4]
  if (/^[\[(].*[\])]$/.test(s)) {
    const incStart = s.startsWith('[');
    const incEnd = s.endsWith(']');
    const inner = s.slice(1, -1);
    if (!inner.includes(',')) {
      return cmpMc(targetMc, inner.trim()) === 0;
    }
    const [minStr, maxStr] = inner.split(',').map((x) => x.trim());
    if (minStr) {
      const c = cmpMc(targetMc, minStr);
      if (incStart ? c < 0 : c <= 0) return false;
    }
    if (maxStr) {
      const c = cmpMc(targetMc, maxStr);
      if (incEnd ? c > 0 : c >= 0) return false;
    }
    return true;
  }

  // Wildcard: 1.21.x или 1.21.*
  const wild = /^(\d+)\.(\d+)\.[xX*]$/.exec(s);
  if (wild) {
    return target[0] === Number(wild[1]) && target[1] === Number(wild[2]);
  }

  // Tilde ~1.21.4 или ~1.21
  if (s.startsWith('~')) {
    const base = s.slice(1).trim();
    const pb = parseMcParts(base);
    if (!pb) return true;
    return target[0] === pb[0] && target[1] === pb[1] && target[2] >= pb[2];
  }

  // Caret ^1.21.0
  if (s.startsWith('^')) {
    const base = s.slice(1).trim();
    const pb = parseMcParts(base);
    if (!pb) return true;
    return target[0] === pb[0] && cmpMc(targetMc, base) >= 0;
  }

  // Набор операторов через пробел: ">=1.21 <=1.21.4" или ">=1.21.4 <1.22"
  const tokens = s.split(/\s+/).filter(Boolean);
  if (tokens.length > 1 || /^[><=]/.test(s)) {
    for (const tok of tokens) {
      const m = /^(>=|<=|>|<|=)?\s*(\d+\.\d+(?:\.\d+)?)/.exec(tok);
      if (!m) continue;
      const op = m[1] || '=';
      const ver = m[2];
      const c = cmpMc(targetMc, ver);
      if (op === '>=' && c < 0) return false;
      if (op === '>' && c <= 0) return false;
      if (op === '<=' && c > 0) return false;
      if (op === '<' && c >= 0) return false;
      if (op === '=' && c !== 0) return false;
    }
    return true;
  }

  // Точное совпадение: "1.21.4"
  if (/^\d+\.\d+(?:\.\d+)?$/.test(s)) {
    return cmpMc(targetMc, s) === 0;
  }

  return true;
}

function formatMcDep(mcDep) {
  if (!mcDep) return '';
  if (Array.isArray(mcDep)) return mcDep.join(' / ');
  return String(mcDep);
}

/**
 * Проверяет, подходит ли зависимость мода по версии Minecraft к targetMc.
 */
function isMcVersionCompatible(mcDep, targetMc, fileName = '') {
  if (!targetMc) return { ok: true, expected: '' };

  // Если в имени файла явно написано "+mc1.20.1" или "-1.20.1", а в манифесте стоит широкое ">=1.20",
  // проверяем также явный тег из названия файла, если он однозначно указывает на другую минорную ветку.
  const fb = guessFromFileName(fileName);

  if (Array.isArray(mcDep)) {
    const ok = mcDep.some((item) => matchSingleMcExpr(item, targetMc));
    return { ok, expected: formatMcDep(mcDep) };
  }

  const depStr = String(mcDep || '').trim();
  if (depStr) {
    // Встречается "1.21.1 || 1.21.4"
    const orParts = depStr.split(/\s*\|\|\s*/);
    const ok = orParts.some((part) => matchSingleMcExpr(part, targetMc));
    if (!ok) return { ok: false, expected: depStr };
    // Если в манифесте написано просто ">=1.16", но в имени файла чётко указана другая версия (например 1.20.1 vs 1.21.4)
    if (fb.mc && /^\d+\.\d+(\.\d+)?$/.test(fb.mc) && /^[>~^]/.test(depStr)) {
      const pFile = parseMcParts(fb.mc);
      const pTarget = parseMcParts(targetMc);
      if (pFile && pTarget && (pFile[0] !== pTarget[0] || pFile[1] !== pTarget[1])) {
        return { ok: false, expected: fb.mc };
      }
    }
    return { ok: true, expected: depStr };
  }

  if (fb.mc) {
    const ok = matchSingleMcExpr(fb.mc, targetMc);
    return { ok, expected: fb.mc };
  }

  return { ok: true, expected: '' };
}

function normalizeInstLoader(inst) {
  if (!inst) return 'fabric';
  const orig = String(inst.loaderOrigin || '').toLowerCase();
  if (orig === 'forge') return 'forge';
  if (orig === 'neoforge') return 'neoforge';
  if (inst.fabric || orig === 'dx' || orig === 'fabric') return 'fabric';
  return 'vanilla';
}

const LOADER_TITLE = {
  fabric: 'Fabric',
  quilt: 'Quilt',
  forge: 'Forge',
  neoforge: 'NeoForge',
  vanilla: 'Vanilla',
  unknown: 'Неизвестный'
};

function isLoaderCompatible(modLoader, instLoader) {
  if (instLoader === 'vanilla') return false;
  if (!modLoader || modLoader === 'unknown') return true;
  if (instLoader === 'fabric') return modLoader === 'fabric';
  if (instLoader === 'forge') return modLoader === 'forge';
  if (instLoader === 'neoforge') return modLoader === 'neoforge';
  return modLoader === instLoader;
}

/**
 * Умная распаковка архива с модами (.zip / .mrpack) в папку mods выбранной сборки.
 * Анализирует каждый .jar в архиве: проверяет модлоадер и версию Minecraft.
 * Совместимые моды распаковывает в modsDir, а несовместимые возвращает в списке rejected.
 */
function unpackModsArchive(archivePath, inst, modsDir, onModUnpacked) {
  if (!archivePath || !fs.existsSync(archivePath)) {
    throw new Error('Архив не найден');
  }
  const instLoader = normalizeInstLoader(inst);
  const instMc = String((inst && inst.mc) || '');
  fs.mkdirSync(modsDir, { recursive: true });

  let zip;
  try {
    zip = new AdmZip(archivePath);
  } catch (e) {
    throw new Error('Не удалось открыть архив: ' + (e.message || String(e)));
  }

  const entries = zip.getEntries().filter((e) => {
    if (e.isDirectory) return false;
    const name = path.basename(e.entryName);
    if (!name || name.startsWith('.') || e.entryName.includes('__MACOSX/')) return false;
    if (!/\.jar$/i.test(name)) return false;
    if (/-(sources|dev|javadoc)\.jar$/i.test(name)) return false;
    return true;
  });

  if (!entries.length) {
    return {
      total: 0,
      unpacked: [],
      rejected: []
    };
  }

  const unpacked = [];
  const rejected = [];

  for (const entry of entries) {
    const fileName = path.basename(entry.entryName);
    let buf;
    try {
      buf = entry.getData();
    } catch (_) {
      rejected.push({
        file: fileName,
        name: fileName,
        loader: 'unknown',
        mc: '',
        reason: 'Повреждённый файл внутри архива'
      });
      continue;
    }

    let meta;
    try {
      meta = inspectJarBuffer(buf, fileName);
    } catch (_) {
      rejected.push({
        file: fileName,
        name: fileName,
        loader: 'unknown',
        mc: '',
        reason: 'Не является корректным .jar файлом мода'
      });
      continue;
    }

    if (instLoader === 'vanilla') {
      rejected.push({
        file: fileName,
        name: meta.name || fileName,
        version: meta.version || '',
        author: meta.author || '',
        loader: LOADER_TITLE[meta.loader] || meta.loader,
        mc: formatMcDep(meta.mcDep),
        reason: 'В сборке установлен Vanilla (без модлоадера)'
      });
      continue;
    }

    if (!isLoaderCompatible(meta.loader, instLoader)) {
      rejected.push({
        file: fileName,
        name: meta.name || fileName,
        version: meta.version || '',
        author: meta.author || '',
        loader: LOADER_TITLE[meta.loader] || meta.loader,
        mc: formatMcDep(meta.mcDep),
        reason: 'Мод для ' + (LOADER_TITLE[meta.loader] || meta.loader) + ', а сборка на ' + (LOADER_TITLE[instLoader] || instLoader)
      });
      continue;
    }

    const mcCheck = isMcVersionCompatible(meta.mcDep, instMc, fileName);
    if (!mcCheck.ok) {
      rejected.push({
        file: fileName,
        name: meta.name || fileName,
        version: meta.version || '',
        author: meta.author || '',
        loader: LOADER_TITLE[meta.loader] || meta.loader,
        mc: mcCheck.expected,
        reason: 'Для Minecraft ' + mcCheck.expected + ' (в сборке ' + instMc + ')'
      });
      continue;
    }

    const dest = path.join(modsDir, fileName);
    fs.writeFileSync(dest, buf);
    const item = {
      file: fileName,
      id: meta.id || fileName,
      name: meta.name || fileName,
      version: meta.version || '',
      author: meta.author || '',
      loader: meta.loader,
      iconDataUrl: meta.iconDataUrl || null
    };
    unpacked.push(item);
    if (onModUnpacked) onModUnpacked(item);
  }

  return {
    total: entries.length,
    unpacked,
    rejected
  };
}

module.exports = {
  inspectJarBuffer,
  inspectJarFile,
  isMcVersionCompatible,
  isLoaderCompatible,
  normalizeInstLoader,
  unpackModsArchive,
  guessFromFileName
};
