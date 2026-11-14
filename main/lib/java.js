'use strict';
// Java-рантайм Mojang (тот же, что ставит официальный лаунчер) — скачивается автоматически.
const fs = require('fs');
const path = require('path');
const http = require('./http');
const P = require('./paths');

const ALL = 'https://launchermeta.mojang.com/v1/products/java-runtime/2ec0cc96c44e5a76b9c8b7c39df7210883d12871/all.json';

function platformKey(platform = process.platform, arch = process.arch) {
  if (platform === 'win32') return arch === 'arm64' ? 'windows-arm64' : arch === 'ia32' ? 'windows-x86' : 'windows-x64';
  if (platform === 'darwin') return arch === 'arm64' ? 'mac-os-arm64' : 'mac-os';
  return arch === 'ia32' ? 'linux-i386' : 'linux';
}

function javaBin(dir) {
  if (process.platform === 'win32') return path.join(dir, 'bin', 'java.exe');
  if (process.platform === 'darwin') return path.join(dir, 'jre.bundle', 'Contents', 'Home', 'bin', 'java');
  return path.join(dir, 'bin', 'java');
}

/** Возвращает путь к java для компонента (например, java-runtime-delta), скачивая при необходимости. */
async function ensureRuntime(component, emit) {
  const key = platformKey();
  const dir = P.runtime(component, key);
  const marker = path.join(dir, '.installed');
  const bin = javaBin(dir);
  if (fs.existsSync(marker) && fs.existsSync(bin)) return bin;

  const all = await http.json(ALL);
  const entry = ((all[key] || {})[component] || [])[0];
  if (!entry) throw new Error('У Mojang нет Java «' + component + '» для платформы ' + key + '. Укажи свою Java в настройках.');
  const mf = await http.json(entry.manifest.url);

  const files = [];
  const links = [];
  for (const [rel, f] of Object.entries(mf.files)) {
    const dest = path.join(dir, rel);
    if (f.type === 'directory') fs.mkdirSync(dest, { recursive: true });
    else if (f.type === 'file') files.push({ dest, f });
    else if (f.type === 'link') links.push({ dest, target: f.target });
  }
  const total = files.reduce((s, x) => s + x.f.downloads.raw.size, 0);
  let done = 0;
  await http.pool(files, 12, async ({ dest, f }) => {
    const raw = f.downloads.raw;
    if (fs.existsSync(dest) && fs.statSync(dest).size === raw.size) {
      done += raw.size;
    } else {
      await http.download(raw.url, dest, { sha1: raw.sha1, size: raw.size, onBytes: (n) => { done += n; } });
    }
    if (f.executable && process.platform !== 'win32') fs.chmodSync(dest, 0o755);
    emit && emit(done, total);
  });
  if (process.platform !== 'win32') {
    for (const l of links) {
      try {
        fs.mkdirSync(path.dirname(l.dest), { recursive: true });
        fs.rmSync(l.dest, { force: true });
        fs.symlinkSync(l.target, l.dest);
      } catch (_) { /* не критично */ }
    }
  }
  if (!fs.existsSync(bin)) throw new Error('Java установилась, но не найден ' + bin);
  fs.writeFileSync(marker, entry.version.name);
  return bin;
}

module.exports = { ensureRuntime, platformKey, javaBin };
