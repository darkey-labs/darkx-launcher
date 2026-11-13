'use strict';
// Тесты ядра на подменённой сети: полный цикл prepare → command → запуск (с поддельной java).
// Моки и поддельная java собраны под Linux (песочница), на Windows тесты не имеют смысла.
if (process.platform !== 'linux' && !process.env.DXL_FORCE_TESTS) {
  console.log('Тесты ядра рассчитаны на Linux — на этой системе пропущены.');
  process.exit(0);
}
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dxl-'));

const { hits, sha1, jsons, puts, firebase, makePng, skinA } = require('./mocknet');
const P = require('../main/lib/paths');
P.init(path.join(tmp, 'game'));
const V = require('../main/lib/versions');
const installer = require('../main/lib/installer');
const launch = require('../main/lib/launch');

(async () => {
  const results = [];
  const t = (name, fn) => results.push([name, fn]);

  t('offline UUID совпадает с эталоном', () => assert.strictEqual(V.offlineUuid('Notch'), 'b50ad385-829d-3141-a216-7e7d7539ba7f'));

  t('правила: os/arch/features', () => {
    assert.ok(V.allowed(undefined));
    assert.ok(!V.allowed([{ action: 'allow', os: { name: 'windows' } }], { platform: 'linux' }));
    assert.ok(V.allowed([{ action: 'allow' }, { action: 'disallow', os: { name: 'osx' } }], { platform: 'linux' }));
    assert.ok(!V.allowed([{ action: 'allow' }, { action: 'disallow', os: { name: 'osx' } }], { platform: 'darwin' }));
    assert.ok(V.allowed([{ action: 'allow', os: { name: 'windows', arch: 'x86' } }], { platform: 'win32', arch: 'ia32' }));
    assert.ok(!V.allowed([{ action: 'allow', os: { name: 'windows', arch: 'x86' } }], { platform: 'win32', arch: 'x64' }));
    assert.ok(!V.allowed([{ action: 'allow', features: { is_demo_user: true } }], {}));
  });

  t('список версий: только релизы, пометка Fabric', async () => {
    const l = await V.listVersions();
    assert.deepStrictEqual(l.map((x) => [x.id, x.fabric]), [['1.21.11', true]]);
  });

  let prep;
  t('prepare: ставит клиент, Fabric, библиотеки, ресурсы, Java, моды', async () => {
    const steps = [];
    prep = await installer.prepare({ id: 'darkx', mc: '1.21.11', fabric: true, darkx: true },
      { darkxClientUrl: 'mock://darkx', darkxClientFile: 'darkx-visuals.jar' }, (p) => steps.push(p.step));
    assert.deepStrictEqual([...new Set(steps)], [1, 2, 3, 4, 5]);
    assert.strictEqual(prep.version.id, 'fabric-loader-0.17.0-1.21.11'); // стабильный загрузчик выбран, а не 0.17.1
    assert.strictEqual(prep.version.mainClass, 'net.fabricmc.loader.impl.launch.knot.KnotClient');
    assert.ok(fs.existsSync(prep.clientJar) && prep.clientJar.endsWith(path.join('1.21.11', '1.21.11.jar')));
    const mods = fs.readdirSync(P.instance('darkx', 'mods')).filter((n) => !n.startsWith('.')).sort();
    assert.deepStrictEqual(mods, ['darkx-visuals.jar', 'fabric-api-0.141.6+1.21.11.jar']);
    assert.ok(fs.existsSync(path.join(prep.nativesDir, 'libnative.so')), 'natives распакованы');
    assert.ok(!fs.existsSync(path.join(prep.nativesDir, 'MANIFEST.MF')), 'META-INF пропущен');
    assert.ok(fs.statSync(prep.javaBin).mode & 0o111, 'java исполняемая');
    assert.ok(fs.existsSync(P.libraries('net', 'fabricmc', 'fabric-loader', '0.17.0', 'fabric-loader-0.17.0.jar')));
    assert.ok(!fs.existsSync(P.libraries('org', 'lwjgl', 'lwjgl', '3.3.3', 'lwjgl-3.3.3-natives-windows.jar')), 'windows-native не качается на linux');
    assert.deepStrictEqual(prep.notes.length, 2);
  });

  t('повторный prepare ничего не перекачивает', async () => {
    const before = hits.length;
    await installer.prepare({ id: 'darkx', mc: '1.21.11', fabric: true, darkx: true },
      { darkxClientUrl: 'mock://darkx', darkxClientFile: 'darkx-visuals.jar' }, () => {});
    const redownloaded = hits.slice(before).filter((u) => /^mock:\/\/(lib|client|asset|rt\/java|fapi|darkx)/.test(u));
    assert.deepStrictEqual(redownloaded, [], 'перекачано: ' + redownloaded.join(','));
  });

  t('команда запуска собрана верно', () => {
    const acc = { type: 'offline', name: 'Tester', uuid: V.offlineUuid('Tester') };
    const cmd = launch.command(prep, acc, '0', { memoryMb: 3072 }, {}, '1.0.0');
    const a = cmd.args;
    assert.strictEqual(a[0], '-Xmx3072M');
    assert.ok(a.includes('-Dminecraft.launcher.brand=DarkXLauncher'));
    assert.ok(!a.includes('-XstartOnFirstThread'), 'osx-аргумент отфильтрован');
    assert.ok(!a.includes('--demo'), 'demo-аргумент отфильтрован');
    assert.ok(a.includes('-DFabricMcEmu= net.minecraft.client.main.Main '), 'jvm-аргумент Fabric сохранён');
    const mc = a.indexOf('net.fabricmc.loader.impl.launch.knot.KnotClient');
    assert.ok(mc > a.indexOf('-cp'), 'mainClass после JVM-аргументов');
    assert.strictEqual(a[a.indexOf('--username') + 1], 'Tester');
    assert.strictEqual(a[a.indexOf('--uuid') + 1], V.offlineUuid('Tester').replace(/-/g, ''));
    assert.strictEqual(a[a.indexOf('--userType') + 1], 'legacy');
    assert.strictEqual(a[a.indexOf('--assetIndex') + 1], '17');
    const cp = a[a.indexOf('-cp') + 1].split(path.delimiter);
    assert.ok(cp.some((p) => p.endsWith('b-1.0.jar')) && cp.some((p) => p.endsWith('fabric-loader-0.17.0.jar')) && cp[cp.length - 1] === prep.clientJar);
    assert.ok(!cp.some((p) => p.includes('natives-linux.jar')), 'старые natives не в classpath');
    assert.ok(!a.some((x) => /\$\{/.test(x)), 'нерасшифрованных плейсхолдеров нет');
  });

  t('запуск процесса и потоковый лог', async () => {
    const acc = { type: 'offline', name: 'Tester', uuid: V.offlineUuid('Tester') };
    const cmd = launch.command(prep, acc, '0', {}, {}, '1.0.0');
    const lines = [];
    const code = await new Promise((res) => launch.run(cmd, { onLog: (l) => lines.push(l), onExit: res }));
    assert.strictEqual(code, 0);
    assert.ok(lines.some((l) => l.startsWith('JAVA-ARGS: -Xmx4096M')), lines.join('|'));
    assert.ok(fs.existsSync(P.shared('logs', 'latest.log')));
  });

  t('DarkX не ставится на версию без сборки', async () => {
    jsons['https://meta.fabricmc.net/v2/versions/game'] = [{ version: '1.21.11', stable: true }];
    const p = await installer.prepare({ id: 'darkx', mc: '1.21.11', fabric: true, darkx: true },
      { darkxClientUrl: 'mock://darkx', darkxClientFile: 'x.jar', darkxMcVersions: ['1.20.1'] }, () => {});
    assert.ok(p.notes.some((n) => n.includes('нет сборки для 1.21.11')), p.notes.join('|'));
    assert.ok(!fs.existsSync(P.instance('darkx', 'mods', 'x.jar')));
  });

  t('старый формат minecraftArguments', () => {
    const v = { mainClass: 'M', minecraftArguments: '--username ${auth_player_name} --version ${version_name}', libraries: [] };
    const a = V.buildArgs(v, { auth_player_name: 'X', version_name: 'old', natives_directory: '/n', classpath: 'cp' });
    assert.deepStrictEqual(a.game, ['--username', 'X', '--version', 'old']);
    assert.ok(a.jvm.includes('-Djava.library.path=/n') && a.jvm.includes('cp'));
  });

  t('слияние версий: дубликаты библиотек, аргументы', () => {
    const m = V.merge({ id: 'c', libraries: [{ name: 'a:b:2' }], arguments: { jvm: ['J2'], game: [] } },
      { id: 'p', libraries: [{ name: 'a:b:1' }, { name: 'x:y:1' }], arguments: { jvm: ['J1'], game: ['G'] }, assets: '5', mainClass: 'M' });
    assert.deepStrictEqual(m.libraries.map((l) => l.name), ['a:b:2', 'x:y:1']);
    assert.deepStrictEqual(m.arguments.jvm, ['J1', 'J2']);
    assert.strictEqual(m.jarId, 'p');
  });

  t('Microsoft: без Client ID — понятная ошибка', async () => {
    const accounts = require('../main/lib/accounts');
    await assert.rejects(() => accounts.deviceStart(''), (e) => e.code === 'NO_CLIENT_ID');
  });

  t('оффлайн-аккаунты: валидация и дубликаты', () => {
    const store = require('../main/lib/store');
    store.init(path.join(tmp, 'data'));
    const accounts = require('../main/lib/accounts');
    const a = accounts.addOffline('Tester_1');
    assert.strictEqual(a.uuid, V.offlineUuid('Tester_1'));
    assert.throws(() => accounts.addOffline('tester_1'), /уже есть/);
    assert.throws(() => accounts.addOffline('a'), /3–16/);
    assert.throws(() => accounts.addOffline('bad name'), /3–16/);
    accounts.remove(a.id);
    assert.strictEqual(accounts.list().length, 0);
  });


  // ------------------------------------------------------------ лента релизов
  t('релизы: версия из названия, заголовок, пункты; черновики пропущены; максимум 5', async () => {
    const releases = require('../main/lib/releases');
    const cfg = { releasesRepo: 'darkey-labs/darkx' };
    const list = await releases.latest(cfg, 5);
    assert.strictEqual(list.length, 5);
    assert.deepStrictEqual(list.map((r) => r.version), ['1.0.2', '1.0.1', '1.0.0', '0.8.0', '0.7.0']);
    assert.ok(/анимации/.test(list[0].headline), list[0].headline);
    assert.deepStrictEqual(list[0].blocks.filter((b) => b.type === 'li').map((b) => b.text),
      ['Анимации ClickGui, худа и уведомлений', 'Клиентские звуки с ревербом', 'Исправлен Near HUD']);
    assert.ok(!list[0].blocks.some((b) => /Full Changelog|Что нового/i.test(b.text)), 'служебные строки убраны');
    assert.strictEqual(list[1].headline, 'Друзья через сеть DarkX.'); // названия нет → заголовок из первого абзаца
    assert.deepStrictEqual(list[1].blocks.map((b) => b.type), ['li', 'li']);
    assert.strictEqual(list[2].version, '1.0.0'); // название пустое → версия из тега
    assert.ok(list[3].prerelease);
  });

  t('релизы: репозиторий берётся из ссылки на клиент', () => {
    const releases = require('../main/lib/releases');
    assert.strictEqual(releases.repoOf({ darkxClientUrl: 'https://github.com/darkey-labs/darkx/releases/download/1.21.11/x.jar' }), 'darkey-labs/darkx');
    assert.strictEqual(releases.repoOf({}), null);
  });

  // ------------------------------------------------------------ языки
  t('языки: словарь целый — 4 столбца, одинаковые {плейсхолдеры}, нет пустых переводов', () => {
    const I = require('../renderer/i18n');
    assert.ok(I.ROWS.length > 250);
    const ph = (x) => (x.match(/\{[0-9n]+\}/g) || []).sort().join();
    for (const row of I.ROWS) {
      assert.strictEqual(row.length, 4, row[0]);
      for (let i = 1; i < 4; i++) {
        assert.ok(row[i].trim().length, 'пустой перевод: ' + row[0]);
        assert.strictEqual(ph(row[i]), ph(row[0]), 'плейсхолдеры не совпали: ' + row[0] + ' → ' + row[i]);
      }
    }
    assert.deepStrictEqual(I.LANGS.map((l) => l[0]), ['ru', 'en', 'uk', 'be']);
  });

  t('языки: ru не трогает текст; en/uk/be переводят точные фразы и шаблоны (с вложенными переводами)', () => {
    const I = require('../renderer/i18n');
    I.setLang('ru');
    assert.strictEqual(I.T('Удалить «X»?'), 'Удалить «X»?');
    I.setLang('en');
    assert.strictEqual(I.T('Играть'), 'Play');
    assert.strictEqual(I.T('Удалить «Pack»?'), 'Delete "Pack"?');
    assert.strictEqual(I.T('Шаг 2 из 5 · Библиотеки'), 'Step 2 of 5 · Libraries');
    assert.strictEqual(I.T('Доступно обновление лаунчера 1.0.2'), 'Launcher update 1.0.2 is available', 'длинный шаблон важнее короткого');
    assert.strictEqual(I.T('Не удалось получить список версий: Сборка не найдена'), "Couldn't get the version list: Instance not found");
    assert.strictEqual(I.T('Привет, Sodium'), 'Привет, Sodium', 'неизвестное остаётся как есть');
    assert.strictEqual(I.T('Minecraft 1.21.11 · Fabric'), 'Minecraft 1.21.11 · Fabric');
    assert.strictEqual(I.T('Здарова!'), 'Hey!');
    assert.strictEqual(I.T('Найдено: 3'), 'Found: 3');
    assert.strictEqual(I.T('Копирую «Pack» (1 из 2)'), 'Copying "Pack" (1 of 2)');
    I.setLang('uk');
    assert.strictEqual(I.T('Настройки'), 'Налаштування');
    assert.strictEqual(I.T('12 файлов'), '12 файлів');
    I.setLang('be');
    assert.strictEqual(I.T('Настройки'), 'Налады');
    assert.strictEqual(I.T('Нет версии этого мода для Minecraft 1.21 (fabric)'), 'Няма версіі гэтага мода для Minecraft 1.21 (fabric)');
    I.setLang('xx');
    assert.strictEqual(I.getLang(), 'ru', 'неизвестный язык → ru');
  });

  t('языки: заголовки и советы переведены на все языки, заголовки без ника', () => {
    const I = require('../renderer/i18n');
    const g = require('../renderer/greet.js');
    const titles = Object.values(g.TITLES).flatMap((x) => (Array.isArray(x) ? x : Object.values(x).flat()));
    assert.ok(titles.length >= 25 && g.TIPS.length >= 20, 'мало текстов: ' + titles.length + '/' + g.TIPS.length);
    assert.ok(titles.every((x) => !x.includes('{n}')), 'ник в заголовках не нужен');
    for (const l of ['en', 'uk', 'be']) {
      I.setLang(l);
      for (const x of titles.concat(g.TIPS)) assert.ok(I.ROWS.some((r) => r[0] === x), 'нет строки в словаре «' + x + '»');
      if (l === 'en') for (const x of titles.concat(g.TIPS)) assert.notStrictEqual(I.T(x), x, 'не переведено «' + x + '»');
    }
    I.setLang('ru');
  });

  t('заголовки: праздники приоритетнее, ночью — ночные, первый запуск — приветствие', () => {
    const g = require('../renderer/greet.js');
    assert.deepStrictEqual(g.titlePool(false, new Date(2026, 0, 1, 12)), ['С новым годом!']);
    assert.deepStrictEqual(g.titlePool(true, new Date(2026, 9, 31, 12)), g.TITLES.first);
    assert.ok(g.titlePool(false, new Date(2026, 9, 28, 23, 30)).includes('Вам пора спать, не так ли?'));
    assert.ok(g.titlePool(false, new Date(2026, 9, 28, 13)).includes('Погнали?'));
  });

  t('обложки: у каждой сборки свои цвета, одинаковый id — одинаковая картинка', () => {
    const c = require('../renderer/cover.js');
    assert.strictEqual(c.coverSvg('a', false), c.coverSvg('a', false));
    assert.notStrictEqual(c.coverSvg('a', false), c.coverSvg('b', false));
    assert.ok(!/NaN|undefined/.test(c.coverSvg('darkx', true)));
  });

  t('быстрый вход: --quickPlayMultiplayer с 1.20, --server/--port раньше', () => {
    const base = { version: { id: 'x', assets: 'a', mainClass: 'Main', libraries: [], arguments: { game: [{ rules: [{ action: 'allow', features: { has_quick_plays_support: true } }], value: ['--quickPlayMultiplayer', '${quickPlayMultiplayer}'] }], jvm: [] } }, javaBin: 'java', instDir: '/tmp/i', nativesDir: '/tmp/n', libs: [], clientJar: '/tmp/c.jar' };
    const acc = { name: 'N', uuid: '11111111-2222-3333-4444-555555555555', type: 'offline' };
    const a = launch.command(base, acc, '0', { id: 'x' }, {}, '1.0.4', { host: 'mc.example.com', port: 25566 });
    const i = a.args.indexOf('--quickPlayMultiplayer');
    assert.ok(i > 0 && a.args[i + 1] === 'mc.example.com:25566', a.args.join(' '));
    assert.ok(!launch.command(base, acc, '0', { id: 'x' }, {}, '1.0.4', { host: 'mc.example.com', port: 25565 }).args.join(' ').includes(':25565'), 'порт по умолчанию не пишем');
    assert.ok(!launch.command(base, acc, '0', { id: 'x' }, {}, '1.0.4', null).args.includes('--quickPlayMultiplayer'));
    const old = JSON.parse(JSON.stringify(base)); old.version.arguments = undefined; old.version.minecraftArguments = '--username ${auth_player_name}';
    const o = launch.command(old, acc, '0', { id: 'x' }, {}, '1.0.4', { host: 'h', port: 25566 }).args.join(' ');
    assert.ok(o.includes('--server h --port 25566'), o);
  });

  t('ping: разбор адреса и пакеты', () => {
    const p = require('../main/lib/ping');
    assert.deepStrictEqual(p.parseAddress('mc.example.com'), { host: 'mc.example.com', port: 25565, explicitPort: false });
    assert.deepStrictEqual(p.parseAddress(' Play.Test.net:25566 '), { host: 'Play.Test.net', port: 25566, explicitPort: true });
    assert.strictEqual(p.parseAddress('bad host'), null);
    assert.strictEqual(p.parseAddress('x:99999'), null);
    assert.deepStrictEqual([...p.varint(300)], [0xac, 0x02]);
  });

  t('прерывание запуска: prepare останавливается с кодом ABORTED', async () => {
    const ac = new AbortController();
    ac.abort();
    await assert.rejects(() => installer.prepare({ id: 'abort-me', mc: '1.21.11', fabric: false }, {}, null, ac.signal), (e) => e.code === 'ABORTED');
  });

  // ------------------------------------------------------------ обновление лаунчера
  t('OTA: сравнение версий', () => {
    const u = require('../main/lib/updater');
    assert.strictEqual(u.cmp('1.0.1', '1.0.0'), 1);
    assert.strictEqual(u.cmp('v1.10.0', '1.9.9'), 1);
    assert.strictEqual(u.cmp('launcher-v1.0.0', '1.0.0'), 0);
    assert.strictEqual(u.cmp('0.9.9', '1.0.0'), -1);
  });

  t('OTA: релиз новее → установщик нужной архитектуры, sha256 и заметки', async () => {
    const u = require('../main/lib/updater');
    const i = await u.check({ launcherRepo: 'darkey-labs/darkx-launcher' }, '1.0.0', { portable: false, arch: 'x64', canInstall: true });
    assert.ok(i.available);
    assert.strictEqual(i.latest, '1.2.0');
    assert.strictEqual(i.asset.name, 'DarkX-Launcher-Setup-1.2.0-x64.exe');
    assert.ok(/^[0-9a-f]{64}$/.test(i.asset.sha256));
    assert.ok(i.blocks.some((b) => /Автообновление/.test(b.text)));
    const p = await u.check({ launcherRepo: 'darkey-labs/darkx-launcher' }, '1.0.0', { portable: true, arch: 'x64' });
    assert.strictEqual(p.asset.name, 'DarkX-Launcher-Portable-1.2.0.exe');
    const ia = await u.check({ launcherRepo: 'darkey-labs/darkx-launcher' }, '1.0.0', { portable: false, arch: 'ia32' });
    assert.strictEqual(ia.asset.name, 'DarkX-Launcher-Setup-1.2.0-ia32.exe');
  });

  t('OTA: имена файлов GitHub с точками (DarkX.Launcher.1.0.1.exe) тоже подходят', () => {
    const u = require('../main/lib/updater');
    const mk = (n) => ({ name: n, browser_download_url: 'https://github.com/x/y/releases/download/1.0.1/' + n });
    const assets = [mk('DarkX.Launcher.1.0.1.exe'), mk('DarkX.Launcher.Setup.1.0.1.exe')];
    assert.strictEqual(u.pickAsset(assets, { portable: true, arch: 'x64' }).name, 'DarkX.Launcher.1.0.1.exe');
    assert.strictEqual(u.pickAsset(assets, { portable: false, arch: 'x64' }).name, 'DarkX.Launcher.Setup.1.0.1.exe');
  });

  t('OTA: автоустановка — когда можно, а когда нет (защита от петли)', () => {
    const u = require('../main/lib/updater');
    const info = { available: true, latest: '1.0.2', asset: { name: 'x.exe' } };
    const ok = { settings: {}, info, canInstall: true, busy: false };
    assert.ok(u.shouldAutoInstall(ok));
    assert.ok(!u.shouldAutoInstall(Object.assign({}, ok, { settings: { autoInstall: false } })), 'выключено в настройках');
    assert.ok(!u.shouldAutoInstall(Object.assign({}, ok, { settings: { autoInstallTried: '1.0.2' } })), 'эту версию уже пробовали');
    assert.ok(u.shouldAutoInstall(Object.assign({}, ok, { settings: { autoInstallTried: '1.0.1' } })), 'новая версия — пробуем снова');
    assert.ok(!u.shouldAutoInstall(Object.assign({}, ok, { canInstall: false })), 'не установленная сборка');
    assert.ok(!u.shouldAutoInstall(Object.assign({}, ok, { busy: true })), 'идёт игра или установка');
    assert.ok(!u.shouldAutoInstall(Object.assign({}, ok, { info: Object.assign({}, info, { asset: null }) })), 'нет файла');
  });

  t('OTA: стандартные имена electron-builder (с точками вместо пробелов)', () => {
    const u = require('../main/lib/updater');
    const mk = (n) => ({ name: n, browser_download_url: 'https://github.com/x/y/releases/download/1.0.1/' + n });
    const assets = [mk('DarkX.Launcher.1.0.1.exe'), mk('DarkX.Launcher.Setup.1.0.1.exe'), mk('latest.yml')];
    assert.strictEqual(u.pickAsset(assets, { portable: true, arch: 'x64' }).name, 'DarkX.Launcher.1.0.1.exe');
    assert.strictEqual(u.pickAsset(assets, { portable: false, arch: 'x64' }).name, 'DarkX.Launcher.Setup.1.0.1.exe');
    assert.strictEqual(u.pickAsset([mk('a.zip')], { portable: false, arch: 'x64' }), null);
  });

  t('OTA: та же версия → обновления нет; репозиторий не задан → понятная ошибка', async () => {
    const u = require('../main/lib/updater');
    const i = await u.check({ launcherRepo: 'darkey-labs/darkx-launcher' }, '1.2.0', { portable: false, arch: 'x64' });
    assert.ok(!i.available);
    await assert.rejects(() => u.check({}, '1.0.0'), /launcherRepo/);
  });

  t('OTA: скачивание проверяет sha256, чужой хост и битый файл отклоняются', async () => {
    const u = require('../main/lib/updater');
    const dir = fs.mkdtempSync(path.join(tmp, 'upd-'));
    const info = await u.check({ launcherRepo: 'darkey-labs/darkx-launcher' }, '1.0.0', { portable: false, arch: 'x64' });
    let seen = 0;
    const file = await u.download(info, dir, (d) => { seen = d; });
    assert.strictEqual(fs.readFileSync(file, 'utf8'), 'setup-exe-bytes');
    assert.ok(seen > 0);
    await assert.rejects(() => u.download(Object.assign({}, info, { asset: Object.assign({}, info.asset, { url: 'https://evil.example/x.exe' }) }), dir), /Недоверенный/);
    await assert.rejects(() => u.download(Object.assign({}, info, { asset: Object.assign({}, info.asset, { sha256: 'a'.repeat(64) }) }), dir), /Контрольная сумма/);
    assert.ok(!fs.readdirSync(dir).some((f) => /evil/.test(f)));
  });

  t('OTA: скрипты установки и аргументы cmd.exe', () => {
    const u = require('../main/lib/updater');
    const inst = u.script(false), port = u.script(true);
    assert.ok(/start "" \/wait "%~1" \/S/.test(inst) && /start "" "%~2"/.test(inst));
    assert.ok(/move \/y "%~1" "%~2"/.test(port) && /goto retry/.test(port));
    assert.ok(!/[^\x00-\x7F]/.test(inst + port), 'в .bat только ASCII — пути идут аргументами');
    const a = u.cmdArgs('C:\\u\\a b\\x.bat', 'C:\\Users\\Иван\\s.exe', 'C:\\Apps\\DarkX Launcher.exe');
    assert.deepStrictEqual(a.slice(0, 3), ['/d', '/s', '/c']);
    assert.strictEqual(a[3], '""C:\\u\\a b\\x.bat" "C:\\Users\\Иван\\s.exe" "C:\\Apps\\DarkX Launcher.exe""');
  });

  t('OTA: install пишет .bat и запускает cmd отдельным процессом', () => {
    process.env.DXL_FORCE_TESTS = '1';
    const u = require('../main/lib/updater');
    const dir = fs.mkdtempSync(path.join(tmp, 'inst-'));
    let call = null;
    const r = u.install('/tmp/setup.exe', { portable: false, exe: '/opt/dxl.exe', dir, spawn: (cmd, args, o) => { call = { cmd, args, o }; return { unref() {} }; } });
    assert.strictEqual(call.cmd, 'cmd.exe');
    assert.ok(call.o.detached && call.o.windowsVerbatimArguments);
    assert.ok(fs.existsSync(r.bat));
    assert.strictEqual(r.target, '/opt/dxl.exe');
  });

  // ------------------------------------------------------------ моды
  t('моды: поиск Modrinth собирает фасеты (версия, fabric, категория, сторона)', async () => {
    const modhub = require('../main/lib/modhub');
    const r = await modhub.search({ source: 'modrinth', query: 'sod', categories: ['optimization'], client: true, server: false, mc: '1.21.11', loader: 'fabric', sort: 'downloads' });
    assert.strictEqual(r.hits.length, 1);
    assert.strictEqual(r.hits[0].title, 'Sodium');
    assert.deepStrictEqual(r.hits[0].categories, ['Оптимизация']);
    const url = hits.filter((u) => u.includes('/v2/search')).pop();
    const q = new URL(url).searchParams;
    assert.deepStrictEqual(JSON.parse(q.get('facets')), [['project_type:mod'], ['versions:1.21.11'], ['categories:fabric'], ['categories:optimization'], ['client_side:required', 'client_side:optional']]);
    assert.strictEqual(q.get('index'), 'downloads');
  });

  t('моды: CurseForge без ключа — понятная ошибка', async () => {
    const modhub = require('../main/lib/modhub');
    await assert.rejects(() => modhub.search({ source: 'curseforge' }, ''), (e) => e.code === 'NO_CF_KEY');
  });

  t('моды: CurseForge отвечает 403 — ошибка про ключ, а не голый HTTP', async () => {
    const modhub = require('../main/lib/modhub');
    const http = require('../main/lib/http');
    const real = http.json;
    http.json = async (url, o) => { if (/curseforge/.test(url)) { const e = new Error('HTTP 403 ' + url); e.status = 403; throw e; } return real(url, o); };
    try {
      await assert.rejects(() => modhub.search({ source: 'curseforge', mc: '1.21.11', loader: 'fabric' }, '"$2a$10$abc"'), (e) => e.code === 'CF_BAD_KEY' && /API-ключ/.test(e.message));
    } finally { http.json = real; }
  });

  t('моды: категории Modrinth — только моды, по-русски', async () => {
    const modhub = require('../main/lib/modhub');
    const c = await modhub.categories('modrinth');
    assert.deepStrictEqual(c.map((x) => x.id).sort(), ['decoration', 'optimization', 'utility']);
    assert.ok(c.find((x) => x.id === 'decoration').name === 'Декор');
  });

  t('моды: установка тянет обязательные зависимости, Fabric API не дублируется, реестр ведётся', async () => {
    const modhub = require('../main/lib/modhub');
    const inst = { id: 'darkx', name: 'DarkX', mc: '1.21.11', fabric: true };
    const steps = [];
    const done = await modhub.install(inst, { source: 'modrinth', id: 'AANobbMI', title: 'Sodium' }, '', (x) => steps.push(x));
    assert.deepStrictEqual(done.sort(), ['lib-1.0.jar', 'sodium-fabric-0.7.0+mc1.21.11.jar']);
    const mods = fs.readdirSync(P.instance('darkx', 'mods')).filter((n) => !n.startsWith('.')).sort();
    assert.ok(mods.includes('lib-1.0.jar') && mods.includes('sodium-fabric-0.7.0+mc1.21.11.jar') && mods.includes('fabric-api-0.141.6+1.21.11.jar'), mods.join(','));
    assert.strictEqual(mods.filter((n) => /^fabric-api/.test(n)).length, 1, 'Fabric API один');
    const inst2 = modhub.installed(inst);
    assert.deepStrictEqual(inst2.map((r) => [r.projectId, !!r.dep]), [['AANobbMI', false], ['dep-lib', true]]);
    assert.ok(steps.some((x) => x.startsWith('Зависимость')), steps.join('|'));
    // повтор — ничего не качает
    const before = hits.length;
    assert.deepStrictEqual(await modhub.install(inst, { source: 'modrinth', id: 'AANobbMI', title: 'Sodium' }, ''), []);
    assert.deepStrictEqual(hits.slice(before).filter((u) => /^mock:\/\/mr/.test(u)), []);
  });

  t('моды: удаление стирает файл и запись; без версии — понятная ошибка; без Fabric — отказ', async () => {
    const modhub = require('../main/lib/modhub');
    const inst = { id: 'darkx', name: 'DarkX', mc: '1.21.11', fabric: true };
    modhub.remove(inst, 'modrinth', 'AANobbMI');
    assert.ok(!fs.existsSync(P.instance('darkx', 'mods', 'sodium-fabric-0.7.0+mc1.21.11.jar')));
    assert.deepStrictEqual(modhub.installed(inst).map((r) => r.projectId), ['dep-lib']);
    await assert.rejects(() => modhub.install(inst, { source: 'modrinth', id: 'gvQqBUqZ', title: 'Lithium' }, ''), (e) => e.code === 'NO_VERSION');
    await assert.rejects(() => modhub.install({ id: 'v', name: 'Vanilla', mc: '1.21.11', fabric: false }, { source: 'modrinth', id: 'AANobbMI' }, ''), /нет Fabric/);
  });

  // ------------------------------------------------------------ скины
  t('скины: проверка PNG (размер, формат, вес)', () => {
    const skins = require('../main/lib/skins');
    assert.deepStrictEqual(skins.inspect(skinA), { w: 64, h: 64 });
    assert.throws(() => skins.inspect(Buffer.from('not a png at all, definitely not a png file here')), /не PNG/);
    assert.throws(() => skins.inspect(makePng(32, 32, () => [0, 0, 0, 255])), /64×64/);
    assert.deepStrictEqual(skins.inspect(makePng(64, 32, () => [0, 0, 0, 255])), { w: 64, h: 32 });
  });

  t('скины: по нику из Mojang, файл, дубликаты, удаление', async () => {
    const skins = require('../main/lib/skins');
    const it = await skins.fromNick('Notch');
    assert.strictEqual(it.name, 'Notch');
    assert.strictEqual(it.source, 'nick');
    assert.ok(it.data.startsWith('data:image/png;base64,'));
    await assert.rejects(() => skins.fromNick('Nobody_404'), /нет у Mojang/);
    await assert.rejects(() => skins.fromNick('a b'), /3–16/);
    const again = skins.add({ buf: skinA, name: 'Другой', model: 'slim', source: 'file' });
    assert.strictEqual(again.id, it.id, 'тот же PNG — одна запись');
    assert.strictEqual(skins.all().length, 1);
    skins.add({ buf: require('./mocknet').demoSkin(40), name: 'Второй', model: 'classic', source: 'file' });
    assert.strictEqual(skins.all().length, 2);
    skins.remove(skins.all()[0].id);
    assert.strictEqual(skins.all().length, 1);
  });

  t('скины: публикация в базу DarkX, чтение, снятие', async () => {
    const skins = require('../main/lib/skins');
    const id = skins.all()[0].id;
    const base = 'https://darkx-test.firebaseio.test/';
    await skins.publish(base, 'Tester_DX', id);
    const put = puts.find((x) => x[0] === 'PUT');
    assert.strictEqual(put[1], 'https://darkx-test.firebaseio.test/darkx/skins/tester_dx.json');
    assert.ok(firebase.tester_dx.png.length > 100 && firebase.tester_dx.model);
    const back = await skins.remote(base, 'TESTER_DX');
    assert.ok(back && back.data.startsWith('data:image/png;base64,'));
    await skins.unpublish(base, 'Tester_DX');
    assert.strictEqual(await skins.remote(base, 'Tester_DX'), null);
    await assert.rejects(() => skins.publish('', 'Tester_DX', id), /адрес сети/);
  });

  t('мод DarkX: ставится jar из самого свежего релиза под версию игры (имя файла везде одно)', async () => {
    const http = require('../main/lib/http');
    const releases = require('../main/lib/releases');
    const real = http.json;
    const rel = (tag, d, files) => ({ tag_name: tag, draft: false, published_at: d, assets: (files || ['darkx-visuals-1.0.0.jar']).map((n) => ({ name: n, size: 10, browser_download_url: 'https://github.com/darkey-labs/darkx/releases/download/' + tag + '/' + n })) });
    let list = [];
    http.json = async (url) => { if (/api\.github\.com\/repos\/darkey-labs\/darkx\/releases/.test(url)) { if (!list) throw new Error('offline'); return list; } return real(url); };
    const cfg = { releasesRepo: 'darkey-labs/darkx' };
    try {
      list = [rel('1.21.11', '2026-10-01T00:00:00Z'), rel('1.21.11-U9', '2026-10-28T00:00:00Z'), rel('1.21.11-U9-P1', '2026-10-30T00:00:00Z'),
        rel('1.21.11-U10', '2026-10-29T00:00:00Z', ['darkx-visuals-1.0.0-sources.jar']), rel('1.20.4-U1', '2026-11-04T00:00:00Z')];
      const a = await releases.clientAsset(cfg, '1.21.11');
      assert.strictEqual(a.tag, '1.21.11-U9-P1', 'порядок тегов не важен, нужен самый свежий по дате; чужая версия игры и sources.jar пропускаются');
      assert.ok(/\/1\.21\.11-U9-P1\/darkx-visuals-1\.0\.0\.jar$/.test(a.url));
      assert.strictEqual((await releases.clientAsset(cfg, '1.21.1')), null, '1.21.1 не должен цеплять 1.21.11');
      list = null;
      assert.strictEqual(await releases.clientAsset(cfg, '1.21.99'), null, 'без сети или без релиза — null, сработает ссылка из настроек');
    } finally { http.json = real; }
  });

  let fail = 0;
  for (const [name, fn] of results) {
    try { await fn(); console.log('  ok   ' + name); } catch (e) { fail++; console.log('  FAIL ' + name + '\n       ' + (e.stack || e).toString().split('\n').slice(0, 4).join('\n       ')); }
  }
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(fail ? fail + ' тест(ов) упало' : 'все тесты прошли');
  process.exit(fail ? 1 : 0);
})();
