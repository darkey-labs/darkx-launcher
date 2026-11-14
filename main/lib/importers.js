'use strict';
// Перенос сборок из других лаунчеров: поиск папок, чтение версии/загрузчика и копирование игровых файлов.
// Что именно лежит у каждого лаунчера — описано рядом со сканером. Если формат неизвестен или изменился,
// версию пробуем определить по модам, а при неудаче пользователь выбирает её сам.
const fs = require('fs');
const path = require('path');
const os = require('os');
const AdmZip = require('adm-zip');

// версии Minecraft: 1.21.11 и новые «годовые» вроде 26.1 (у NeoForge тоже три числа, поэтому в sniff см. strong/weak)
const MC_OLD = /^1\.\d{1,2}(\.\d{1,2})?$/;
const MC_FULL = /^(1\.\d{1,2}(\.\d{1,2})?|2\d\.\d{1,2}(\.\d{1,2})?)$/;
const MC_ANY = /(?:^|[^\d.])((?:1|2\d)\.\d{1,2}(?:\.\d{1,2})?)(?![\d.]*\d)/;

// ============================================================ пути и файлы

const home = () => os.homedir();

function appData() {
  if (process.env.APPDATA) return process.env.APPDATA;
  if (process.platform === 'darwin') return path.join(home(), 'Library', 'Application Support');
  return process.env.XDG_DATA_HOME || path.join(home(), '.local', 'share');
}

function dotMinecraft() {
  if (process.platform === 'win32') return path.join(appData(), '.minecraft');
  if (process.platform === 'darwin') return path.join(appData(), 'minecraft');
  return path.join(home(), '.minecraft');
}

const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch (_) { return false; } };
const isFile = (p) => { try { return fs.statSync(p).isFile(); } catch (_) { return false; } };

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); } catch (_) { return null; }
}

function subdirs(dir) {
  try { return fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name); } catch (_) { return []; }
}

/** Дочерняя папка без учёта регистра (ATLauncher и др. на Linux называют их по-разному). */
function child(dir, name) {
  const hit = (fs.existsSync(dir) ? fs.readdirSync(dir) : []).find((n) => n.toLowerCase() === name.toLowerCase());
  return hit ? path.join(dir, hit) : path.join(dir, name);
}

function parseIni(text) {
  const out = {};
  for (const line of String(text).split(/\r?\n/)) {
    const m = line.match(/^\s*([^#;=\[][^=]*?)\s*=\s*(.*?)\s*$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

function countJars(dir) {
  try { return fs.readdirSync(dir).filter((n) => /\.jar(\.disabled)?$/i.test(n)).length; } catch (_) { return 0; }
}

function looksLikeGameDir(dir) {
  return ['mods', 'saves', 'resourcepacks', 'options.txt', 'config'].some((n) => fs.existsSync(path.join(dir, n)));
}

function gameDirIn(dir, names) {
  for (const n of names) {
    const d = path.join(dir, n);
    if (isDir(d)) return d;
  }
  return dir;
}

// ============================================================ определение загрузчика

function loaderOf(s) {
  const t = String(s || '').toLowerCase();
  if (t.startsWith('neoforge') || t === 'neo_forge') return 'neoforge';
  if (t.startsWith('forge') || t === 'minecraftforge') return 'forge';
  if (t.startsWith('fabric')) return 'fabric';
  if (t.startsWith('quilt')) return 'quilt';
  if (t === 'vanilla') return 'vanilla';
  return '';
}

/** Обходит произвольный JSON и ищет версию Minecraft и загрузчик по значениям — для лаунчеров с неизвестной схемой. */
function sniff(json) {
  let strong = '', weak = '', loader = '', loaderVersion = '', name = '';
  const walk = (o, key, depth) => {
    if (o == null || depth > 8) return;
    if (typeof o === 'string') {
      if (!strong && MC_FULL.test(o) && /minecraft|mcversion|mc_version|gameversion|game_version|^mc$/i.test(key)) strong = o;
      if (!weak && MC_OLD.test(o) && /version|release|game|^id$/i.test(key)) weak = o;
      const l = loaderOf(o);
      if (!loader && l && /loader|type|name/i.test(key)) loader = l;
      if (!name && /^name$/i.test(key) && o) name = o;
    } else if (Array.isArray(o)) {
      o.forEach((v) => walk(v, key, depth + 1));
    } else if (typeof o === 'object') {
      for (const [k, v] of Object.entries(o)) walk(v, k, depth + 1);
    }
  };
  walk(json, '', 0);
  return { mc: strong || weak, loader, loaderVersion, name };
}

/** Версия и загрузчик по самим модам (fabric.mod.json → depends.minecraft). */
function inferFromMods(gameDir) {
  const modsDir = path.join(gameDir, 'mods');
  let jars = [];
  try { jars = fs.readdirSync(modsDir).filter((n) => /\.jar$/i.test(n)).slice(0, 12); } catch (_) { return {}; }
  const out = {};
  for (const j of jars) {
    try {
      const zip = new AdmZip(path.join(modsDir, j));
      if (zip.getEntry('fabric.mod.json')) {
        out.loader = out.loader || 'fabric';
        const meta = JSON.parse(zip.readAsText('fabric.mod.json').replace(/^\uFEFF/, ''));
        const dep = meta.depends && meta.depends.minecraft;
        const first = Array.isArray(dep) ? dep[0] : dep;
        const m = String(first || '').match(MC_ANY);
        if (m && !out.mc) out.mc = m[1];
      } else if (zip.getEntry('META-INF/neoforge.mods.toml')) out.loader = out.loader || 'neoforge';
      else if (zip.getEntry('META-INF/mods.toml')) out.loader = out.loader || 'forge';
      else if (zip.getEntry('quilt.mod.json')) out.loader = out.loader || 'quilt';
      if (out.mc && out.loader) break;
    } catch (_) { /* битый jar — пропускаем */ }
  }
  return out;
}

function makeItem(source, o) {
  const dir = o.gameDir;
  let { mc, loader } = o;
  let guessed = false;
  if (!mc || !loader) {
    const g = inferFromMods(dir);
    if (!mc && g.mc) { mc = g.mc; guessed = true; }
    if (!loader && g.loader) loader = g.loader;
  }
  return {
    key: source + ':' + o.key,
    source,
    name: o.name || path.basename(o.key),
    mc: mc || '',
    mcGuessed: guessed,
    loader: loader || 'vanilla',
    loaderVersion: o.loaderVersion || '',
    gameDir: dir,
    memoryMb: o.memoryMb || 0,
    only: o.only || null,
    mods: countJars(path.join(dir, 'mods')),
    saves: subdirs(path.join(dir, 'saves')).length,
    note: o.note || ''
  };
}

// ============================================================ сканеры

/** Prism Launcher и MultiMC: instances/<имя>/instance.cfg + mmc-pack.json, игра в .minecraft (или minecraft). */
function scanMmc(source, roots) {
  const out = [];
  for (const root of roots) {
    const idir = child(root, 'instances');
    for (const name of subdirs(idir)) {
      if (name.startsWith('.') || name.startsWith('_')) continue;
      const dir = path.join(idir, name);
      const cfgFile = path.join(dir, 'instance.cfg');
      if (!isFile(cfgFile)) continue;
      const cfg = parseIni(fs.readFileSync(cfgFile, 'utf8'));
      const pack = readJson(path.join(dir, 'mmc-pack.json')) || {};
      let mc = '', loader = '', lv = '';
      for (const c of pack.components || []) {
        if (c.uid === 'net.minecraft') mc = c.version || '';
        else if (c.uid === 'net.fabricmc.fabric-loader') { loader = 'fabric'; lv = c.version || ''; }
        else if (c.uid === 'org.quiltmc.quilt-loader') { loader = 'quilt'; lv = c.version || ''; }
        else if (c.uid === 'net.neoforged') { loader = 'neoforge'; lv = c.version || ''; }
        else if (c.uid === 'net.minecraftforge') { loader = 'forge'; lv = c.version || ''; }
      }
      out.push(makeItem(source, {
        key: name, name: cfg.name || name, mc, loader: loader || (mc ? 'vanilla' : ''), loaderVersion: lv,
        gameDir: gameDirIn(dir, ['.minecraft', 'minecraft']),
        memoryMb: cfg.OverrideMemory === 'true' ? Number(cfg.MaxMemAlloc) || 0 : 0
      }));
    }
  }
  return out;
}

function prismRoots() {
  const r = [path.join(appData(), 'PrismLauncher')];
  if (process.platform === 'win32') r.push(path.join(home(), 'scoop', 'persist', 'prismlauncher'));
  if (process.platform === 'linux') r.push(path.join(home(), '.var', 'app', 'org.prismlauncher.PrismLauncher', 'data', 'PrismLauncher'));
  return r;
}

function multimcRoots() {
  const r = [path.join(appData(), 'MultiMC'), path.join(home(), 'MultiMC'), path.join(home(), 'Desktop', 'MultiMC'), path.join(home(), 'Downloads', 'MultiMC')];
  if (process.platform === 'win32') r.push('C:\\MultiMC', 'D:\\MultiMC');
  return r;
}

/** CurseForge (Overwolf): папка Instances, в каждой — minecraftinstance.json; игра лежит прямо в папке сборки. */
function scanCurseForge(roots) {
  const out = [];
  for (const root of roots) {
    for (const name of subdirs(root)) {
      const dir = path.join(root, name);
      const j = readJson(path.join(dir, 'minecraftinstance.json'));
      if (!j) continue;
      const base = (j.baseModLoader && j.baseModLoader.name) || '';
      const mc = j.gameVersion || (j.baseModLoader && j.baseModLoader.minecraftVersion) || '';
      out.push(makeItem('curseforge', {
        key: name, name: j.name || name, mc, loader: base ? loaderOf(base) : 'vanilla',
        loaderVersion: (base.match(/^[a-z]+-(\d+(?:\.\d+)*)/i) || [])[1] || '', gameDir: dir, memoryMb: Number(j.allocatedMemory) || 0
      }));
    }
  }
  return out;
}

function curseForgeRoots() {
  const r = [path.join(home(), 'curseforge', 'minecraft', 'Instances'), path.join(home(), 'Documents', 'curseforge', 'minecraft', 'Instances')];
  if (process.platform === 'win32') r.push('C:\\curseforge\\minecraft\\Instances');
  return r;
}

/** ATLauncher: instances/<имя>/instance.json (launcher.name, launcher.loaderVersion), игра в самой папке. */
function scanAtLauncher(roots) {
  const out = [];
  for (const root of roots) {
    const idir = child(root, 'instances');
    for (const name of subdirs(idir)) {
      const dir = path.join(idir, name);
      const j = readJson(path.join(dir, 'instance.json'));
      if (!j) continue;
      const l = j.launcher || {};
      const lv = l.loaderVersion || {};
      const s = sniff(j);
      const mc = MC_OLD.test(String(j.id || '')) ? j.id : (l.minecraftVersion || s.mc || '');
      out.push(makeItem('atlauncher', {
        key: name, name: l.name || name, mc, loader: lv.type ? loaderOf(lv.type) : (s.loader || 'vanilla'),
        loaderVersion: lv.version || '', gameDir: dir
      }));
    }
  }
  return out;
}

function atLauncherRoots() {
  const r = [path.join(appData(), 'ATLauncher'), path.join(home(), 'ATLauncher')];
  if (process.platform === 'win32') r.push('C:\\ATLauncher');
  return r;
}

/** GDLauncher: Carbon — instances/<имя>/instance.json, игра в подпапке instance; legacy — config.json, игра в самой папке. */
function scanGdLauncher(roots) {
  const out = [];
  for (const root of roots) {
    const idir = child(root, 'instances');
    for (const name of subdirs(idir)) {
      const dir = path.join(idir, name);
      const carbon = readJson(path.join(dir, 'instance.json'));
      const legacy = carbon ? null : readJson(path.join(dir, 'config.json'));
      const j = carbon || legacy;
      if (!j) continue;
      let s = sniff(j);
      if (legacy && legacy.loader) {
        s = { mc: legacy.loader.mcVersion || s.mc, loader: loaderOf(legacy.loader.loaderType) || s.loader, loaderVersion: legacy.loader.loaderVersion || '', name: s.name };
      }
      out.push(makeItem('gdlauncher', {
        key: name, name: (j && j.name) || s.name || name, mc: s.mc, loader: s.loader || (s.mc ? 'vanilla' : ''),
        loaderVersion: s.loaderVersion, gameDir: carbon ? gameDirIn(dir, ['instance']) : dir
      }));
    }
  }
  return out;
}

function gdLauncherRoots() {
  const a = appData();
  return [path.join(a, 'gdlauncher_carbon', 'data'), path.join(a, 'gdlauncher_carbon'), path.join(a, 'gdlauncher_next')];
}

/** Dawn / Feather: формат нигде не описан, поэтому ищем по общим признакам (json с версией + папка игры). */
function scanGeneric(source, roots, jsonNames) {
  const out = [];
  for (const root of roots) {
    for (const base of [child(root, 'instances'), child(root, 'profiles'), root]) {
      for (const name of subdirs(base)) {
        const dir = path.join(base, name);
        let j = null;
        for (const f of jsonNames) { j = readJson(path.join(dir, f)); if (j) break; }
        const gdir = gameDirIn(dir, ['.minecraft', 'minecraft', 'game', 'instance']);
        if (!j && !looksLikeGameDir(gdir)) continue;
        const s = sniff(j || {});
        out.push(makeItem(source, { key: name, name: s.name || name, mc: s.mc, loader: s.loader, gameDir: gdir }));
      }
      if (out.length) break;
    }
  }
  return out;
}

function dawnRoots() {
  const a = appData(), h = home();
  return [path.join(a, 'Dawn'), path.join(a, 'dawn-launcher'), path.join(a, 'DawnLauncher'), path.join(a, 'Dawn Launcher'),
    path.join(a, 'feather-launcher'), path.join(a, 'Feather Launcher'), path.join(a, '.feather'), path.join(a, 'feather'), path.join(h, '.dawn'), path.join(h, '.feather')];
}

/** Modrinth App: profiles/<папка> — это и есть игра; версия и загрузчик — в app.db (SQLite, таблица profiles). */
async function modrinthRows(file) {
  if (!isFile(file)) return {};
  try {
    const initSqlJs = require('sql.js');
    const SQL = await initSqlJs({ locateFile: (f) => path.join(path.dirname(require.resolve('sql.js')), f) });
    const db = new SQL.Database(fs.readFileSync(file));
    const res = db.exec('SELECT * FROM profiles');
    db.close();
    if (!res.length) return {};
    const cols = res[0].columns.map((c) => c.toLowerCase());
    const map = {};
    for (const row of res[0].values) {
      const o = {};
      cols.forEach((c, i) => { o[c] = row[i]; });
      if (o.path != null) map[String(o.path)] = o;
    }
    return map;
  } catch (_) {
    return {};
  }
}

function modrinthRoots() {
  if (process.platform === 'darwin') return [path.join(appData(), 'com.modrinth.theseus'), path.join(appData(), 'ModrinthApp')];
  return [path.join(appData(), 'ModrinthApp'), path.join(appData(), 'com.modrinth.theseus')];
}

async function scanModrinth(roots) {
  const out = [];
  for (const root of roots) {
    const pdir = path.join(root, 'profiles');
    if (!isDir(pdir)) continue;
    const rows = await modrinthRows(path.join(root, 'app.db'));
    for (const name of subdirs(pdir)) {
      const r = rows[name] || {};
      out.push(makeItem('modrinth', {
        key: name, name: r.name || name, mc: r.game_version || '', loader: loaderOf(r.mod_loader) || '',
        loaderVersion: r.mod_loader_version || '', gameDir: path.join(pdir, name), memoryMb: Number(r.memory) || 0
      }));
    }
  }
  return out;
}

/** Lunar Client играет в обычной .minecraft: переносим миры, ресурспаки, настройки и серверы (его собственные моды — внутри клиента). */
function scanLunar() {
  const mc = dotMinecraft();
  if (!isDir(mc)) return [];
  return [makeItem('lunar', {
    key: '.minecraft', name: 'Lunar Client', mc: '', loader: 'vanilla', gameDir: mc,
    only: ['saves', 'resourcepacks', 'shaderpacks', 'options.txt', 'servers.dat', 'screenshots'],
    note: 'Миры, ресурспаки, настройки и список серверов из .minecraft'
  })];
}

// ============================================================ публичное

const LAUNCHERS = [
  { id: 'modrinth', name: 'Modrinth App', note: 'Профили из папки ModrinthApp' },
  { id: 'curseforge', name: 'CurseForge', note: 'Папка curseforge\\minecraft\\Instances' },
  { id: 'prism', name: 'Prism Launcher', note: 'Папка PrismLauncher\\instances' },
  { id: 'atlauncher', name: 'ATLauncher', note: 'Папка ATLauncher\\instances' },
  { id: 'dawn', name: 'Dawn (Feather)', note: 'Определяется по общим признакам' },
  { id: 'multimc', name: 'MultiMC', note: 'Папка MultiMC\\instances' },
  { id: 'gdlauncher', name: 'GDLauncher', note: 'Carbon и старый GDLauncher' },
  { id: 'lunar', name: 'Lunar Client', note: 'Миры и настройки из .minecraft' }
];

/** Собирает сборки лаунчера id. extra — папка, которую выбрал пользователь вручную (добавляется к стандартным). */
async function detect(id, extra) {
  const ex = extra ? [extra] : [];
  switch (id) {
    case 'modrinth': return scanModrinth(ex.concat(modrinthRoots()));
    case 'curseforge': return scanCurseForge(ex.concat(ex.map((e) => path.join(e, 'Instances')), curseForgeRoots()));
    case 'prism': return scanMmc('prism', ex.concat(prismRoots()));
    case 'multimc': return scanMmc('multimc', ex.concat(multimcRoots()));
    case 'atlauncher': return scanAtLauncher(ex.concat(atLauncherRoots()));
    case 'gdlauncher': return scanGdLauncher(ex.concat(gdLauncherRoots()));
    case 'dawn': return scanGeneric('dawn', ex.concat(dawnRoots()), ['instance.json', 'config.json', 'profile.json', 'manifest.json', 'meta.json']);
    case 'lunar': return scanLunar();
    default: throw new Error('Неизвестный лаунчер');
  }
}

/** Папка «как есть»: пробуем как корень любого из лаунчеров, потом как обычную игровую папку. */
async function detectFolder(dir) {
  const found = [];
  for (const l of LAUNCHERS) {
    if (l.id === 'lunar') continue;
    try { found.push(...(await detect(l.id, dir)).filter((it) => it.gameDir.startsWith(dir))); } catch (_) { /* не тот формат */ }
  }
  const seen = new Set();
  const uniq = found.filter((it) => (seen.has(it.gameDir) ? false : seen.add(it.gameDir)));
  if (uniq.length) return uniq;
  const gdir = gameDirIn(dir, ['.minecraft', 'minecraft']);
  if (!looksLikeGameDir(gdir)) return [];
  return [makeItem('folder', { key: path.basename(dir), name: path.basename(dir), mc: '', loader: '', gameDir: gdir })];
}

/** Количество найденных сборок по каждому лаунчеру — для плиток мастера. */
async function summary() {
  const out = {};
  for (const l of LAUNCHERS) {
    try { out[l.id] = (await detect(l.id)).length; } catch (_) { out[l.id] = 0; }
  }
  return out;
}

// ============================================================ копирование

const SKIP_TOP = new Set(['logs', 'crash-reports', '.fabric', '.mixin.out', 'natives', 'libraries', 'versions', 'assets', 'cache', '.cache',
  'webcache2', 'minecraftinstance.json', 'instance.json', 'packinfo.json', 'mmc-pack.json', 'instance.cfg', 'profile.json', 'launcher_profiles.json',
  'launcher_accounts.json', 'launcher_log.txt', 'usercache.json', 'usernamecache.json', '.lunarclient', 'runtime', 'bin']);

function listFiles(root, item, noMods) {
  const files = [];
  const only = item.only ? new Set(item.only) : null;
  const walk = (dir, rel, top) => {
    let ents = [];
    try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
    for (const e of ents) {
      if (top) {
        if (only && !only.has(e.name)) continue;
        if (SKIP_TOP.has(e.name) || /^hs_err_pid/.test(e.name)) continue;
        if (noMods && (e.name === 'mods' || e.name === 'coremods')) continue;
      }
      const full = path.join(dir, e.name), r = rel ? rel + '/' + e.name : e.name;
      if (e.isDirectory()) walk(full, r, false);
      else if (e.isFile()) files.push({ from: full, rel: r, size: fs.statSync(full).size });
    }
  };
  walk(root, '', true);
  return files;
}

/**
 * Копирует игровые файлы сборки в destDir. noMods — не переносить моды (загрузчик не поддерживается).
 * onProgress(done, total) — по файлам; signal.aborted — отмена.
 */
async function copyGame(item, destDir, { noMods, onProgress, signal } = {}) {
  const files = listFiles(item.gameDir, item, noMods);
  fs.mkdirSync(destDir, { recursive: true });
  let done = 0, last = 0;
  const total = files.length;
  for (const f of files) {
    if (signal && signal.aborted) { const e = new Error('Перенос отменён'); e.code = 'ABORTED'; throw e; }
    const to = path.join(destDir, ...f.rel.split('/'));
    fs.mkdirSync(path.dirname(to), { recursive: true });
    await fs.promises.copyFile(f.from, to);
    done++;
    const now = Date.now();
    if (onProgress && now - last > 100) { last = now; onProgress(done, total); await new Promise((r) => setImmediate(r)); }
  }
  if (onProgress) onProgress(total, total);
  return { files: total, bytes: files.reduce((s, f) => s + f.size, 0) };
}

module.exports = { MC_OLD, LAUNCHERS, detect, detectFolder, summary, copyGame, listFiles, sniff, loaderOf, parseIni, inferFromMods, MC_FULL };
