'use strict';
// Версии Minecraft/Fabric, слияние version.json (inheritsFrom), правила, библиотеки, аргументы запуска.
const fs = require('fs');
const path = require('path');
const http = require('./http');
const P = require('./paths');

const MANIFEST_URL = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json';
const FABRIC_META = 'https://meta.fabricmc.net/v2';

// ------------------------------------------------------------------ платформа

function osName(platform = process.platform) {
  return platform === 'win32' ? 'windows' : platform === 'darwin' ? 'osx' : 'linux';
}

function archName(arch = process.arch) {
  return arch === 'ia32' ? 'x86' : arch === 'x64' ? 'x86_64' : arch; // arm64 остаётся arm64
}

function archMatches(ruleArch, arch = process.arch) {
  if (ruleArch === 'x86') return arch === 'ia32';
  if (ruleArch === 'x86_64' || ruleArch === 'amd64') return arch === 'x64';
  if (ruleArch === 'aarch64' || ruleArch === 'arm64') return arch === 'arm64';
  return ruleArch === arch;
}

/** Правила Mojang: список {action, os?, features?}. Без правил — разрешено. */
function allowed(rules, env = {}) {
  if (!rules || !rules.length) return true;
  const plat = env.platform || process.platform, arch = env.arch || process.arch;
  const features = env.features || {};
  let ok = false;
  for (const r of rules) {
    let match = true;
    if (r.os) {
      if (r.os.name && r.os.name !== osName(plat)) match = false;
      if (r.os.arch && !archMatches(r.os.arch, arch)) match = false;
    }
    if (r.features) {
      for (const k of Object.keys(r.features)) if (!!features[k] !== !!r.features[k]) match = false;
    }
    if (match) ok = r.action === 'allow';
  }
  return ok;
}

// ----------------------------------------------------------------- манифесты

async function manifest() {
  return http.json(MANIFEST_URL);
}

/** Релизы Minecraft + пометка «есть Fabric». */
async function listVersions() {
  const [m, fabric] = await Promise.all([manifest(), http.json(FABRIC_META + '/versions/game').catch(() => [])]);
  const fab = new Set(fabric.map((v) => v.version));
  return m.versions.filter((v) => v.type === 'release').map((v) => ({ id: v.id, fabric: fab.has(v.id), releaseTime: v.releaseTime }));
}

async function fabricLoaders(mc) {
  const arr = await http.json(FABRIC_META + '/versions/loader/' + encodeURIComponent(mc));
  return arr.map((e) => ({ version: e.loader.version, stable: !!e.loader.stable }));
}

async function latestLoader(mc) {
  const l = await fabricLoaders(mc);
  if (!l.length) throw new Error('Для Minecraft ' + mc + ' нет Fabric Loader');
  return (l.find((x) => x.stable) || l[0]).version;
}

/** Сохраняет профиль Fabric (version.json с inheritsFrom) и возвращает его id. */
async function installFabricProfile(mc, loader) {
  const prof = await http.json(FABRIC_META + '/versions/loader/' + encodeURIComponent(mc) + '/' + encodeURIComponent(loader) + '/profile/json');
  const dir = P.versions(prof.id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, prof.id + '.json'), JSON.stringify(prof, null, 2));
  return prof.id;
}

/** Скачивает version.json ванильной версии (если ещё нет) и возвращает его. */
async function ensureVanillaJson(mc) {
  const f = P.versions(mc, mc + '.json');
  if (fs.existsSync(f)) {
    try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (_) { /* перекачаем */ }
  }
  const m = await manifest();
  const entry = m.versions.find((v) => v.id === mc);
  if (!entry) throw new Error('Версия ' + mc + ' не найдена в манифесте Mojang');
  const data = await http.json(entry.url);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, JSON.stringify(data, null, 2));
  return data;
}

// -------------------------------------------------------------- слияние версий

function libKey(name) {
  const p = String(name).split(':');
  return p.slice(0, 2).join(':') + (p[3] ? ':' + p[3] : ''); // group:artifact[:classifier]
}

/** Склеивает дочерний version.json с родителем (inheritsFrom). Чистая функция. */
function merge(child, parent) {
  const out = Object.assign({}, parent, child);
  out.id = child.id;
  const seen = new Set();
  out.libraries = [];
  for (const l of [].concat(child.libraries || [], parent.libraries || [])) {
    const k = libKey(l.name);
    if (seen.has(k)) continue;
    seen.add(k);
    out.libraries.push(l);
  }
  if (child.arguments || parent.arguments) {
    out.arguments = {
      jvm: [].concat((parent.arguments || {}).jvm || [], (child.arguments || {}).jvm || []),
      game: [].concat((parent.arguments || {}).game || [], (child.arguments || {}).game || [])
    };
  }
  out.assetIndex = child.assetIndex || parent.assetIndex;
  out.assets = child.assets || parent.assets;
  out.downloads = child.downloads || parent.downloads;
  out.javaVersion = child.javaVersion || parent.javaVersion;
  out.type = child.type || parent.type;
  out.jarId = parent.jarId || parent.id; // имя клиентского jar
  return out;
}

/** Загружает версию с диска и разворачивает inheritsFrom (при необходимости докачивает родителя). */
async function resolve(id, { online = true } = {}) {
  const f = P.versions(id, id + '.json');
  const v = JSON.parse(fs.readFileSync(f, 'utf8'));
  if (!v.inheritsFrom) {
    v.jarId = v.jarId || v.id;
    return v;
  }
  let parent;
  const pf = P.versions(v.inheritsFrom, v.inheritsFrom + '.json');
  if (fs.existsSync(pf)) parent = await resolve(v.inheritsFrom);
  else if (online) {
    await ensureVanillaJson(v.inheritsFrom);
    parent = await resolve(v.inheritsFrom);
  } else throw new Error('Нет файла версии ' + v.inheritsFrom);
  return merge(v, parent);
}

// ---------------------------------------------------------------- библиотеки

function mavenPath(name) {
  const [group, artifact, version, classifier] = name.split(':');
  const ext = (version || '').includes('@') ? version.split('@')[1] : 'jar';
  const ver = (version || '').split('@')[0];
  const file = artifact + '-' + ver + (classifier ? '-' + classifier.split('@')[0] : '') + '.' + ext;
  return group.split('.').join('/') + '/' + artifact + '/' + ver + '/' + file;
}

/**
 * Список файлов библиотек для запуска.
 * Возвращает [{path, url, sha1, size, native?:{exclude}}], где native — старые natives-классификаторы (нужна распаковка).
 */
function libraryFiles(version, env = {}) {
  const out = [];
  const osn = osName(env.platform);
  for (const lib of version.libraries || []) {
    if (!allowed(lib.rules, env)) continue;
    const dl = lib.downloads || {};
    if (lib.natives && lib.natives[osn]) {
      const cls = lib.natives[osn].replace('${arch}', (env.arch || process.arch) === 'ia32' ? '32' : '64');
      const a = (dl.classifiers || {})[cls];
      if (a) out.push({ path: a.path, url: a.url, sha1: a.sha1, size: a.size, native: lib.extract || {} });
      // у старых версий основной артефакт может быть рядом — он добавится ниже
    }
    if (dl.artifact) {
      out.push({ path: dl.artifact.path, url: dl.artifact.url, sha1: dl.artifact.sha1, size: dl.artifact.size });
    } else if (!lib.natives) {
      const p = mavenPath(lib.name);
      const base = (lib.url || 'https://libraries.minecraft.net/').replace(/\/?$/, '/');
      out.push({ path: p, url: base + p });
    }
  }
  return out;
}

// ------------------------------------------------------------------- аргументы

function expandArgs(list, vars, env = {}) {
  const out = [];
  for (const a of list || []) {
    if (typeof a === 'string') {
      out.push(a);
    } else if (a && allowed(a.rules, env)) {
      out.push(...(Array.isArray(a.value) ? a.value : [a.value]));
    }
  }
  return out.map((s) => s.replace(/\$\{([^}]+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m)));
}

/** Собирает argv Java: [...jvm, mainClass, ...game]. */
function buildArgs(version, vars, env = {}) {
  let jvm, game;
  if (version.arguments) {
    jvm = expandArgs(version.arguments.jvm, vars, env);
    game = expandArgs(version.arguments.game, vars, env);
  } else {
    jvm = expandArgs(['-Djava.library.path=${natives_directory}', '-cp', '${classpath}'], vars, env);
    game = String(version.minecraftArguments || '').split(/\s+/).filter(Boolean)
      .map((s) => s.replace(/\$\{([^}]+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m)));
  }
  if (!jvm.includes('-cp') && !jvm.includes('-classpath')) jvm.push('-cp', vars.classpath);
  return { jvm, mainClass: version.mainClass, game };
}

/** Детерминированный UUID оффлайн-игрока (как у сервера в offline-mode). */
function offlineUuid(name) {
  const h = require('crypto').createHash('md5').update('OfflinePlayer:' + name).digest();
  h[6] = (h[6] & 0x0f) | 0x30;
  h[8] = (h[8] & 0x3f) | 0x80;
  const x = h.toString('hex');
  return x.slice(0, 8) + '-' + x.slice(8, 12) + '-' + x.slice(12, 16) + '-' + x.slice(16, 20) + '-' + x.slice(20);
}

module.exports = {
  osName, archName, allowed, manifest, listVersions, fabricLoaders, latestLoader, installFabricProfile,
  ensureVanillaJson, merge, resolve, libraryFiles, mavenPath, expandArgs, buildArgs, offlineUuid
};
