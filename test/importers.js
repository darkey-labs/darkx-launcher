'use strict';
// Тесты переноса сборок на синтетических папках «чужих» лаунчеров.
if (process.platform !== 'linux' && !process.env.DXL_FORCE_TESTS) { console.log('Тесты импорта рассчитаны на Linux — пропущены.'); process.exit(0); }
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const AdmZip = require('adm-zip');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dxl-imp-'));
process.env.HOME = path.join(tmp, 'home');
process.env.XDG_DATA_HOME = path.join(tmp, 'home', '.local', 'share');
delete process.env.APPDATA;
const importers = require('../main/lib/importers');
const { home, data } = require('./fixtures').build(tmp);
const w = (f, text) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, typeof text === 'string' ? text : JSON.stringify(text)); };
const fabricJar = (f, mc) => {
  const z = new AdmZip();
  z.addFile('fabric.mod.json', Buffer.from(JSON.stringify({ id: 'x', depends: { minecraft: '~' + mc } })));
  fs.mkdirSync(path.dirname(f), { recursive: true });
  z.writeZip(f);
};

(async () => {
  const results = [];
  const t = (n, f) => results.push([n, f]);

  t('Prism: версия, Fabric, память, миры', async () => {
    const l = await importers.detect('prism');
    const s = l.find((x) => x.name === 'Мой выживач');
    assert.ok(s);
    assert.deepStrictEqual([s.mc, s.loader, s.loaderVersion, s.memoryMb, s.mods, s.saves], ['1.21.4', 'fabric', '0.16.10', 6144, 1, 1]);
    const f = l.find((x) => x.name === 'ForgePack');
    assert.deepStrictEqual([f.mc, f.loader, f.mods], ['1.20.1', 'forge', 1]);
  });

  t('MultiMC: те же форматы, отдельная папка', async () => {
    assert.deepStrictEqual(await importers.detect('multimc'), []);
    fs.cpSync(path.join(data, 'PrismLauncher'), path.join(data, 'MultiMC'), { recursive: true });
    const l = await importers.detect('multimc');
    assert.strictEqual(l.length, 2);
    assert.ok(l.every((x) => x.source === 'multimc'));
  });

  t('CurseForge: minecraftinstance.json', async () => {
    const l = await importers.detect('curseforge');
    assert.deepStrictEqual([l[0].name, l[0].mc, l[0].loader, l[0].loaderVersion, l[0].memoryMb], ['Pack CF', '1.20.4', 'fabric', '0.15.7', 5000]);
  });

  t('ATLauncher: Forge', async () => {
    const l = await importers.detect('atlauncher');
    assert.deepStrictEqual([l[0].name, l[0].mc, l[0].loader], ['AllTheMods', '1.19.2', 'forge']);
  });

  t('GDLauncher: определение по содержимому json, игра в instance/', async () => {
    const l = await importers.detect('gdlauncher');
    assert.strictEqual(l.length, 1);
    assert.deepStrictEqual([l[0].name, l[0].mc, l[0].loader], ['GD сборка', '1.21.1', 'fabric']);
    assert.ok(l[0].gameDir.endsWith(path.join('abc123', 'instance')));
    assert.strictEqual(l[0].saves, 1);
  });

  t('Modrinth App: app.db + запасной вариант по модам', async () => {
    const l = await importers.detect('modrinth');
    const a = l.find((x) => x.key === 'modrinth:Fabulously Optimized');
    assert.deepStrictEqual([a.mc, a.loader, a.loaderVersion, a.memoryMb, a.mcGuessed], ['1.21.11', 'fabric', '0.17.3', 8192, false]);
    const b = l.find((x) => x.key === 'modrinth:NoDb');
    assert.deepStrictEqual([b.mc, b.loader, b.mcGuessed], ['1.21.8', 'fabric', true]);
  });

  t('Lunar: только миры, ресурспаки и настройки', async () => {
    const [it] = await importers.detect('lunar');
    assert.deepStrictEqual(it.only.includes('saves'), true);
    const out = path.join(tmp, 'lunar-out');
    await importers.copyGame(it, out, {});
    assert.ok(fs.existsSync(path.join(out, 'saves', 'LW', 'level.dat')) && fs.existsSync(path.join(out, 'servers.dat')));
    assert.ok(!fs.existsSync(path.join(out, 'versions')), 'versions не переносится');
  });

  t('copyGame: пропускает logs и служебные файлы, прогресс, отмена', async () => {
    const [it] = (await importers.detect('prism')).filter((x) => x.name === 'Мой выживач');
    const out = path.join(tmp, 'out1');
    const ticks = [];
    const r = await importers.copyGame(it, out, { onProgress: (d, n) => ticks.push([d, n]) });
    assert.ok(fs.existsSync(path.join(out, 'mods', 'sodium.jar')) && fs.existsSync(path.join(out, 'options.txt')));
    assert.ok(!fs.existsSync(path.join(out, 'logs')));
    assert.strictEqual(r.files, 3);
    assert.deepStrictEqual(ticks[ticks.length - 1], [3, 3]);
    const ac = new AbortController(); ac.abort();
    await assert.rejects(() => importers.copyGame(it, path.join(tmp, 'out2'), { signal: ac.signal }), (e) => e.code === 'ABORTED');
  });

  t('copyGame noMods: моды Forge не переносятся', async () => {
    const f = (await importers.detect('prism')).find((x) => x.name === 'ForgePack');
    const out = path.join(tmp, 'out3');
    await importers.copyGame(f, out, { noMods: true });
    assert.ok(!fs.existsSync(path.join(out, 'mods')) && fs.existsSync(path.join(out, 'saves', 'W', 'level.dat')));
  });

  t('своя папка: корень лаунчера и обычная .minecraft', async () => {
    const a = await importers.detectFolder(path.join(data, 'PrismLauncher'));
    assert.ok(a.some((x) => x.name === 'Мой выживач'));
    const lone = path.join(tmp, 'loose'); w(path.join(lone, 'options.txt'), 'x'); fabricJar(path.join(lone, 'mods', 'q.jar'), '1.21.5');
    const b = await importers.detectFolder(lone);
    assert.deepStrictEqual([b.length, b[0].source, b[0].mc, b[0].loader], [1, 'folder', '1.21.5', 'fabric']);
    assert.deepStrictEqual(await importers.detectFolder(path.join(tmp, 'nothing')), []);
  });

  t('sniff: версия по ключу, а не по любому числу', () => {
    const r = importers.sniff({ java: { version: '21.0.3' }, loader: { type: 'neoforge', version: '21.1.172' }, minecraft: { version: '1.21.1' } });
    assert.deepStrictEqual([r.mc, r.loader], ['1.21.1', 'neoforge']);
  });

  t('summary: счётчики по лаунчерам', async () => {
    const s = await importers.summary();
    assert.deepStrictEqual([s.prism, s.curseforge, s.atlauncher, s.gdlauncher, s.modrinth, s.lunar, s.dawn], [2, 1, 1, 1, 2, 1, 0]);
  });

  let fail = 0;
  for (const [n, f] of results) { try { await f(); console.log('  ok   ' + n); } catch (e) { fail++; console.log('  FAIL ' + n + '\n       ' + (e.stack || e).toString().split('\n').slice(0, 4).join('\n       ')); } }
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(fail ? fail + ' тест(ов) упало' : 'тесты импорта прошли');
  process.exit(fail ? 1 : 0);
})();
