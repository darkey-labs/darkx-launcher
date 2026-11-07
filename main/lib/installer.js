'use strict';
// Установка всего нужного для запуска сборки: клиент, Fabric, библиотеки, ассеты, Java, моды.
const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');
const http = require('./http');
const P = require('./paths');
const V = require('./versions');
const java = require('./java');
const mods = require('./mods');
const releases = require('./releases');

const ASSET_HOST = 'https://resources.download.minecraft.net/';

const STEPS = ['Версия', 'Библиотеки', 'Ресурсы', 'Java', 'Моды'];

/** Скачивает список файлов [{path,url,sha1,size,dest}] с прогрессом по байтам. */
function aborted(signal) {
  if (signal && signal.aborted) {
    const e = new Error('Запуск отменён');
    e.code = 'ABORTED';
    throw e;
  }
}

async function downloadAll(files, emit, signal) {
  const total = files.reduce((s, f) => s + (f.size || 0), 0);
  let done = 0, lastEmit = 0;
  const tick = (n) => {
    done += n;
    const now = Date.now();
    if (emit && now - lastEmit > 120) { lastEmit = now; emit(done, total); }
  };
  await http.pool(files, 16, async (f) => {
    aborted(signal);
    if (fs.existsSync(f.dest) && (!f.size || fs.statSync(f.dest).size === f.size)) {
      tick(f.size || 0);
      return;
    }
    await http.download(f.url, f.dest, { sha1: f.sha1, size: f.size, onBytes: tick });
  });
  if (emit) emit(total, total);
}

function extractNatives(files, nativesDir) {
  fs.rmSync(nativesDir, { recursive: true, force: true });
  fs.mkdirSync(nativesDir, { recursive: true });
  for (const f of files.filter((x) => x.native)) {
    const zip = new AdmZip(f.dest);
    const exclude = (f.native.exclude || []).concat(['META-INF/']);
    for (const e of zip.getEntries()) {
      if (e.isDirectory || exclude.some((x) => e.entryName.startsWith(x))) continue;
      const out = path.join(nativesDir, path.basename(e.entryName));
      fs.writeFileSync(out, e.getData());
    }
  }
}

/**
 * Подготавливает сборку к запуску.
 * inst: {id, mc, fabric, loader?}; cfg: {javaPath, darkxClientUrl, darkxClientFile}
 * emit({step, steps, label, done, total}) — прогресс.
 * Возвращает {version, javaBin, libs, clientJar, nativesDir, instDir}.
 */
async function prepare(inst, cfg, emit, signal) {
  const say = (i, label, done, total) => emit && emit({ step: i + 1, steps: STEPS.length, name: STEPS[i], label, done: done || 0, total: total || 0 });
  const instDir = P.instance(inst.id);
  fs.mkdirSync(path.join(instDir, 'mods'), { recursive: true });

  // 1. версия + клиент
  say(0, 'Minecraft ' + inst.mc);
  const vanilla = await V.ensureVanillaJson(inst.mc);
  let versionId = inst.mc;
  if (inst.fabric) {
    const loader = inst.loader || (await V.latestLoader(inst.mc));
    say(0, 'Fabric Loader ' + loader);
    versionId = await V.installFabricProfile(inst.mc, loader);
  }
  const version = await V.resolve(versionId);
  const clientJar = P.versions(version.jarId, version.jarId + '.jar');
  const cl = vanilla.downloads && vanilla.downloads.client;
  if (!cl) throw new Error('В version.json нет клиента');
  await downloadAll([{ url: cl.url, sha1: cl.sha1, size: cl.size, dest: clientJar }], (d, t) => say(0, 'Клиент Minecraft', d, t), signal);

  // 2. библиотеки
  const libs = V.libraryFiles(version).map((l) => Object.assign(l, { dest: P.libraries(...l.path.split('/')) }));
  await downloadAll(libs, (d, t) => say(1, libs.length + ' файлов', d, t), signal);
  const nativesDir = P.instance(inst.id, 'natives');
  extractNatives(libs, nativesDir);

  // 3. ресурсы
  const ai = version.assetIndex;
  const indexFile = P.assets('indexes', ai.id + '.json');
  await downloadAll([{ url: ai.url, sha1: ai.sha1, size: ai.size, dest: indexFile }]);
  const index = JSON.parse(fs.readFileSync(indexFile, 'utf8'));
  const objs = Object.entries(index.objects).map(([name, o]) => ({
    name, size: o.size, sha1: o.hash,
    url: ASSET_HOST + o.hash.slice(0, 2) + '/' + o.hash,
    dest: P.assets('objects', o.hash.slice(0, 2), o.hash)
  }));
  await downloadAll(objs, (d, t) => say(2, objs.length + ' файлов', d, t), signal);
  if (index.virtual || index.map_to_resources) {
    const base = index.map_to_resources ? path.join(instDir, 'resources') : P.assets('virtual', ai.id);
    for (const o of objs) {
      const to = path.join(base, ...o.name.split('/'));
      if (!fs.existsSync(to)) {
        fs.mkdirSync(path.dirname(to), { recursive: true });
        fs.copyFileSync(o.dest, to);
      }
    }
  }

  aborted(signal);
  // 4. Java
  let javaBin;
  if (cfg.javaPath) {
    javaBin = cfg.javaPath;
    say(3, 'Своя Java: ' + javaBin);
  } else {
    const comp = (version.javaVersion && version.javaVersion.component) || 'jre-legacy';
    say(3, 'Java ' + ((version.javaVersion && version.javaVersion.majorVersion) || '8'));
    javaBin = await java.ensureRuntime(comp, (d, t) => say(3, 'Java ' + ((version.javaVersion && version.javaVersion.majorVersion) || ''), d, t));
  }

  aborted(signal);
  // 5. моды
  const modsDir = path.join(instDir, 'mods');
  const notes = [];
  if (inst.fabric) {
    say(4, 'Fabric API');
    notes.push('Fabric API: ' + (await mods.ensureFabricApi(modsDir, inst.mc)));
    if (inst.darkx !== false) {
      const supported = cfg.darkxMcVersions || [];
      if (supported.length && !supported.includes(inst.mc)) {
        notes.push('DarkX Visuals: нет сборки для ' + inst.mc + ' (есть: ' + supported.join(', ') + ')');
      } else {
        say(4, 'DarkX Visuals');
        // сначала самый свежий jar из релизов, зашитая ссылка из настроек — запасной вариант
        let latest = null;
        try { latest = await releases.clientAsset(cfg, inst.mc); } catch (_) { /* возьмём ссылку из настроек */ }
        const url = latest ? latest.url : cfg.darkxClientUrl;
        const r = await mods.ensureClient(modsDir, url, cfg.darkxClientFile || 'darkx-visuals.jar');
        notes.push(r.status === 'skipped' ? 'DarkX Visuals: ссылка не задана (Настройки)'
          : 'DarkX Visuals: ' + r.status + ' (' + (latest ? 'релиз ' + latest.tag : 'ссылка из настроек') + ')');
      }
    }
  }
  return { version, javaBin, libs, clientJar, nativesDir, instDir, notes };
}

module.exports = { prepare, downloadAll, extractNatives, STEPS, aborted };
