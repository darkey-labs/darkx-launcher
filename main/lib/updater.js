'use strict';
// Обновление самого лаунчера «по воздуху»: берём последний релиз из GitHub (launcherRepo),
// качаем установщик (NSIS) или portable-exe, проверяем размер и sha256, затем маленький .bat
// ждёт выхода лаунчера, ставит новую версию и запускает её.
const fs = require('fs');
const path = require('path');
const http = require('./http');
const releases = require('./releases');

const SEMVER = /(\d+)\.(\d+)\.(\d+)(?:\.(\d+))?/;

function parseVer(s) {
  const m = SEMVER.exec(String(s || ''));
  return m ? [1, 2, 3, 4].map((i) => Number(m[i] || 0)) : null;
}

/** 1, 0 или -1. Непонятная версия считается самой старой. */
function cmp(a, b) {
  const x = parseVer(a), y = parseVer(b);
  if (!x || !y) return x ? 1 : y ? -1 : 0;
  for (let i = 0; i < 4; i++) if (x[i] !== y[i]) return x[i] > y[i] ? 1 : -1;
  return 0;
}

function repoOf(cfg) {
  const r = cfg && cfg.launcherRepo;
  return r && /^[\w.-]+\/[\w.-]+$/.test(r) ? r : null;
}

const isPortable = (env = process.env) => !!env.PORTABLE_EXECUTABLE_FILE;

/**
 * Нужный файл из релиза. Имена бывают «Setup»/«Portable» или стандартные от electron-builder
 * («DarkX Launcher 1.0.1.exe» — portable, «… Setup 1.0.1.exe» — установщик; GitHub меняет пробелы на точки).
 */
function pickAsset(assets, { portable, arch }) {
  const exes = (assets || []).filter((a) => /\.exe$/i.test(a.name || '') && a.browser_download_url);
  const setups = exes.filter((a) => /setup/i.test(a.name));
  if (portable) return exes.find((a) => /portable/i.test(a.name)) || exes.find((a) => !/setup/i.test(a.name)) || null;
  return setups.find((a) => new RegExp('[-_.]' + arch + '(?![\\w])', 'i').test(a.name)) || setups.find((a) => !/ia32|x64|arm64/i.test(a.name)) || setups[0] || null;
}

let current = null; // последний результат проверки

/** Проверка релиза. Возвращает {current, latest, available, ...}. */
async function check(cfg, currentVersion, opts = {}) {
  const repo = repoOf(cfg);
  if (!repo) throw new Error('Не задан репозиторий лаунчера (launcherRepo в launcher.config.json)');
  let rel;
  try {
    rel = await http.json('https://api.github.com/repos/' + repo + '/releases/latest', {
      headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' }
    });
  } catch (e) {
    if (e.status === 404) throw new Error('В репозитории ' + repo + ' ещё нет релизов лаунчера');
    throw e;
  }
  const version = (parseVer(rel.tag_name) || parseVer(rel.name) || []).slice(0, 3).join('.') || null;
  const info = { repo, current: currentVersion, latest: version, available: false, portable: opts.portable === undefined ? isPortable() : opts.portable, canInstall: !!opts.canInstall };
  if (!version) throw new Error('В релизе ' + (rel.tag_name || '?') + ' не найден номер версии');
  const asset = pickAsset(rel.assets, { portable: info.portable, arch: opts.arch || process.arch });
  const parsed = releases.parse(rel);
  Object.assign(info, {
    available: cmp(version, currentVersion) > 0,
    headline: String(parsed.headline || '').replace(/^(launcher|лаунчер)\s*[-–—:|·•,.]*\s*/i, '').trim(),
    blocks: parsed.blocks,
    date: parsed.date,
    page: rel.html_url,
    asset: asset ? { name: asset.name, url: asset.browser_download_url, size: asset.size || 0, sha256: /^sha256:([0-9a-f]{64})$/i.exec(asset.digest || '') ? asset.digest.slice(7).toLowerCase() : null } : null
  });
  if (info.available && !asset) info.note = 'В релизе нет файла ' + (info.portable ? 'portable' : 'установщика') + ' под эту систему';
  current = info;
  return info;
}

function sha256File(file) {
  return new Promise((resolve, reject) => {
    const h = require('crypto').createHash('sha256');
    fs.createReadStream(file).on('data', (d) => h.update(d)).on('end', () => resolve(h.digest('hex'))).on('error', reject);
  });
}

/** Скачать файл обновления в dir, проверить размер и sha256. */
async function download(info, dir, onProgress) {
  const a = info && info.asset;
  if (!a) throw new Error(info && info.note ? info.note : 'Нет файла обновления');
  // качаем только с GitHub: ссылка пришла из API, но лишний раз проверим
  const host = new URL(a.url).hostname;
  if (!/(^|\.)github\.com$|(^|\.)githubusercontent\.com$/.test(host)) throw new Error('Недоверенный адрес обновления: ' + host);
  const safe = path.basename(a.name).replace(/[^\w.\-]/g, '_');
  const dest = path.join(dir, safe);
  let done = 0;
  await http.download(a.url, dest, { size: a.size || undefined, onBytes: (n) => { done += n; if (onProgress) onProgress(Math.min(done, a.size || done), a.size || 0); } });
  if (a.sha256) {
    const got = await sha256File(dest);
    if (got !== a.sha256) { try { fs.unlinkSync(dest); } catch (_) { /* уже нет */ } throw new Error('Контрольная сумма обновления не совпала — файл не установлен'); }
  }
  return dest;
}

/** Текст .bat: все пути — через аргументы (так не страдают кириллические имена папок). */
function script(portable) {
  if (portable) {
    return [
      '@echo off', 'set n=0', ':retry', 'ping -n 2 127.0.0.1 >nul',
      'move /y "%~1" "%~2" >nul 2>&1', 'if not errorlevel 1 goto done',
      'set /a n+=1', 'if %n% lss 40 goto retry', 'exit /b 1',
      ':done', 'start "" "%~2"', '(goto) 2>nul & del "%~f0"', ''
    ].join('\r\n');
  }
  return [
    '@echo off', 'ping -n 3 127.0.0.1 >nul',
    'start "" /wait "%~1" /S', 'start "" "%~2"',
    '(goto) 2>nul & del "%~f0"', ''
  ].join('\r\n');
}

/** Аргументы для cmd.exe (запуск с windowsVerbatimArguments). */
function cmdArgs(bat, a, b) {
  return ['/d', '/s', '/c', '"' + ['"' + bat + '"', '"' + a + '"', '"' + b + '"'].join(' ') + '"'];
}

/**
 * Запускает установку и возвращает управление: после этого вызывающий должен закрыть приложение.
 * file — скачанный файл; target — что запускать после (portable: куда положить exe).
 */
function install(file, { portable, exe, dir, spawn = require('child_process').spawn }) {
  if (process.platform !== 'win32' && !process.env.DXL_FORCE_TESTS) throw new Error('Автообновление работает только в Windows');
  const bat = path.join(dir, 'apply-update.bat');
  fs.writeFileSync(bat, script(portable));
  const target = portable ? process.env.PORTABLE_EXECUTABLE_FILE : exe;
  const child = spawn('cmd.exe', cmdArgs(bat, file, target), { detached: true, stdio: 'ignore', windowsHide: true, windowsVerbatimArguments: true });
  if (child && child.unref) child.unref();
  return { bat, target };
}

/**
 * Ставить ли обновление само при запуске. Не ставим, если: выключено в настройках, это не установленная
 * сборка, нет файла, лаунчер занят (идёт установка/игра) или эту версию уже пробовали (защита от петли перезапусков).
 */
function shouldAutoInstall({ settings, info, canInstall, busy }) {
  return !!(settings.autoInstall !== false && canInstall && info && info.available && info.asset && !busy
    && settings.autoInstallTried !== info.latest);
}

module.exports = { shouldAutoInstall, check, download, install, cmp, parseVer, pickAsset, script, cmdArgs, repoOf, isPortable, get current() { return current; } };
