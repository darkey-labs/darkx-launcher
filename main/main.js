'use strict';
const { app, BrowserWindow, ipcMain, shell, safeStorage, session, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

app.setName('DarkXLauncher');
// Папка данных: %APPDATA%\DarkXLauncher (DXL_DATA — для тестов)
app.setPath('userData', process.env.DXL_DATA || path.join(app.getPath('appData'), 'DarkXLauncher'));

const store = require('./lib/store');
const P = require('./lib/paths');
const accounts = require('./lib/accounts');
const authlib = require('./lib/authlib');
const V = require('./lib/versions');
const installer = require('./lib/installer');
const launch = require('./lib/launch');
const releases = require('./lib/releases');
const modhub = require('./lib/modhub');
const skins = require('./lib/skins');
const updater = require('./lib/updater');
const ping = require('./lib/ping');
const importers = require('./lib/importers');
const I18N = require('../renderer/i18n');
const T = (x) => I18N.T(x);

// Параметры сборки (ссылка на клиент, ключ CurseForge, Azure Client ID, адрес базы) задаются только здесь,
// в UI их нет. launcher.local.json (не в git) переопределяет launcher.config.json — туда кладём ключи.
const CONFIG = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'launcher.config.json'), 'utf8'));
try {
  Object.assign(CONFIG, JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'launcher.local.json'), 'utf8')));
} catch (_) { /* файла нет — используем launcher.config.json */ }
const DEFAULT_SETTINGS = {
  accent: 'F97316',
  selectedAccount: null,
  selectedInstance: 'darkx',
  javaPath: '',
  memoryMb: 4096,
  jvmArgs: '',
  onLaunch: 'minimize', // minimize | keep | close
  proxy: '',
  modsInstance: null, // профиль, выбранный в правой панели «Модов»
  modsSource: 'modrinth',
  lang: 'ru', // язык интерфейса: ru | en | uk | be
  autoUpdate: true, // проверять обновления лаунчера при запуске
  autoInstall: true, // и ставить их сами (при запуске)
  autoInstallTried: '', // версия, которую уже пытались поставить сами (защита от петли)
  activeSkins: {}, // ник (lower) → id скина, опубликованного в сеть DarkX
  servers: [], // сервера для быстрого входа: {id, name, host, port, icon}
  selectedServer: null, // id сервера, на который заходим сразу после запуска (null — просто запуск)
  launchedBefore: false
};

let win = null;
let child = null;
let state = 'idle'; // idle | installing | running
let msSignal = null;
let versionsCache = null;
let firstRun = false;
let playAbort = null; // AbortController текущей подготовки к запуску
let importAbort = null;

function settings() { return store.load('settings', DEFAULT_SETTINGS); }
function instances() { return store.load('instances', []); }

/** Настройки с подстановкой значений по умолчанию из launcher.config.json. */
function effective() {
  const s = settings();
  return {
    javaPath: s.javaPath,
    memoryMb: s.memoryMb,
    jvmArgs: s.jvmArgs,
    msClientId: CONFIG.msClientId || '',
    darkxClientUrl: CONFIG.darkxClientUrl || '',
    darkxClientFile: CONFIG.darkxClientFile || 'darkx-visuals.jar',
    darkxMcVersions: CONFIG.darkxMcVersions || [],
    releasesRepo: CONFIG.releasesRepo || '',
    launcherRepo: CONFIG.launcherRepo || '',
    curseforgeKey: CONFIG.curseforgeKey || '',
    firebaseUrl: CONFIG.firebaseUrl || ''
  };
}

function send(ch, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(ch, payload);
}

function setState(s) {
  state = s;
  send('ev:state', { state });
}

function snapshot() {
  const s = settings();
  return {
    settings: s,
    effective: {
      msClientId: !!effective().msClientId,
      darkxClientUrl: !!effective().darkxClientUrl,
      curseforge: !!effective().curseforgeKey,
      firebase: !!effective().firebaseUrl
    },
    firstRun,
    accounts: accounts.list().map(accounts.publicView),
    instances: instances(),
    state,
    version: app.getVersion(),
    platform: process.platform + '-' + process.arch,
    root: P.root,
    defaultMc: CONFIG.defaultMcVersion,
    darkxVersions: CONFIG.darkxMcVersions || [],
    update: updater.current
  };
}

function boot() {
  store.init(app.getPath('userData'));
  I18N.setLang(settings().lang);
  P.init(path.join(app.getPath('userData'), 'game'));
  if (safeStorage && safeStorage.isEncryptionAvailable()) {
    accounts.setSealer({
      seal: (s) => 'e:' + safeStorage.encryptString(s).toString('base64'),
      open: (s) => (String(s).startsWith('e:')
        ? safeStorage.decryptString(Buffer.from(s.slice(2), 'base64'))
        : Buffer.from(String(s).slice(2), 'base64').toString('utf8'))
    });
  }
  const insts = instances();
  if (!insts.length) {
    insts.push({ id: 'darkx', name: 'DarkX ' + CONFIG.defaultMcVersion, mc: CONFIG.defaultMcVersion, fabric: true, darkx: true, memoryMb: 0, kind: 'standard' });
    store.save('instances');
  }
  for (const i of insts) if (!i.kind) i.kind = i.id === 'darkx' ? 'standard' : 'custom';
  const s = settings();
  if (!Array.isArray(s.servers)) s.servers = [];
  if (s.selectedServer && !s.servers.find((x) => x.id === s.selectedServer)) s.selectedServer = null;
  if (!s.selectedAccount && accounts.list().length) s.selectedAccount = accounts.list()[0].id;
  if (!insts.find((i) => i.id === s.selectedInstance)) s.selectedInstance = insts[0].id;
  if (s.modsInstance && !insts.find((i) => i.id === s.modsInstance)) s.modsInstance = null;
  firstRun = !s.launchedBefore;
  s.launchedBefore = true;
  store.save('settings');
}

function createWindow() {
  win = new BrowserWindow({
    width: 1180,
    height: 700,
    minWidth: 980,
    minHeight: 620,
    frame: false,
    backgroundColor: '#000000',
    title: 'DarkX Launcher',
    icon: path.join(__dirname, '..', 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  win.removeMenu();
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.on('closed', () => { win = null; });
  // проверка обновлений лаунчера через несколько секунд после старта; при включённой автоустановке сразу ставим
  setTimeout(() => {
    const s = settings();
    if (!s.autoUpdate || !effective().launcherRepo) return;
    if (s.autoInstallTried && updater.cmp(app.getVersion(), s.autoInstallTried) >= 0) { s.autoInstallTried = ''; store.save('settings'); }
    checkUpdate().then((i) => {
      if (!i.available) return;
      const auto = updater.shouldAutoInstall({ settings: s, info: i, canInstall: canSelfUpdate(), busy: state !== 'idle' || updating });
      send('ev:update', Object.assign({}, i, { auto }));
      if (!auto) return;
      s.autoInstallTried = i.latest;
      store.save('settings');
      runUpdateInstall(i).catch((e) => send('ev:update-error', { error: friendly(e.message || String(e)) }));
    }).catch(() => { /* нет сети или релизов — молчим */ });
  }, 4000);
}

// ======================================================================= IPC

/** Сетевые сбои — с подсказкой, что делать. */
function friendly(msg) {
  if (/ETIMEDOUT|ECONNRESET|ENOTFOUND|ECONNREFUSED|EAI_AGAIN|net::ERR_|timeout/i.test(msg)) {
    return msg + ' — нет связи с сервером. Проверь интернет или VPN, либо укажи прокси в Настройках → Сеть.';
  }
  return msg;
}

const handle = (name, fn) => ipcMain.handle(name, async (_e, ...args) => {
  try {
    return { ok: true, data: await fn(...args) };
  } catch (e) {
    return { ok: false, error: friendly(e.message || String(e)), code: e.code };
  }
});

/** Прокси для всех запросов лаунчера: свой из настроек или системный. */
function applyProxy() {
  const p = String(settings().proxy || '').trim();
  return session.defaultSession.setProxy(p ? { proxyRules: p } : { mode: 'system' });
}

handle('state', () => snapshot());

handle('win:min', () => win && win.minimize());
handle('win:max', () => { if (win) win.isMaximized() ? win.unmaximize() : win.maximize(); });
handle('win:close', () => win && win.close());

handle('external', (url) => {
  if (!/^https:\/\//.test(String(url))) throw new Error('Только https-ссылки');
  return shell.openExternal(url);
});

handle('settings:save', (patch) => {
  const s = settings();
  const allowed = Object.keys(DEFAULT_SETTINGS).filter((k) => !['activeSkins', 'launchedBefore', 'servers', 'selectedServer'].includes(k));
  for (const k of Object.keys(patch || {})) if (allowed.includes(k)) s[k] = patch[k];
  s.memoryMb = Math.max(512, Math.min(32768, Number(s.memoryMb) || 4096));
  store.save('settings');
  if ('lang' in (patch || {})) I18N.setLang(s.lang);
  if ('proxy' in (patch || {})) applyProxy();
  return snapshot();
});

// ---- аккаунты
handle('acc:offline', (name) => {
  const a = accounts.addOffline(name);
  const s = settings();
  s.selectedAccount = a.id;
  store.save('settings');
  return snapshot();
});

handle('acc:remove', (id) => {
  accounts.remove(id);
  const s = settings();
  if (s.selectedAccount === id) s.selectedAccount = (accounts.list()[0] || {}).id || null;
  store.save('settings');
  return snapshot();
});

handle('acc:select', (id) => {
  settings().selectedAccount = id;
  store.save('settings');
  return snapshot();
});

handle('acc:ms:start', async () => {
  if (msSignal) msSignal.cancelled = true;
  const clientId = effective().msClientId;
  const dev = await accounts.deviceStart(clientId);
  const signal = { cancelled: false };
  msSignal = signal;
  (async () => {
    try {
      const tokens = await accounts.devicePoll(clientId, dev, signal);
      const acc = await accounts.finishMicrosoft(tokens);
      const s = settings();
      s.selectedAccount = acc.id;
      store.save('settings');
      send('ev:ms', { done: true, state: snapshot() });
    } catch (e) {
      if (e.code !== 'CANCELLED') send('ev:ms', { error: e.message });
    }
  })();
  return { userCode: dev.user_code, uri: dev.verification_uri, expiresIn: dev.expires_in };
});

// Ely.by: ник/e-mail + пароль. Если включена 2FA — отвечаем {need2fa:true}, окно просит код и шлёт запрос повторно.
handle('acc:ely', async (o) => {
  o = o || {};
  let acc;
  try {
    acc = await accounts.elyLogin(o.login, o.password, o.totp);
  } catch (e) {
    if (e.code === 'ELY_2FA') return { need2fa: true };
    throw e;
  }
  const s = settings();
  s.selectedAccount = acc.id;
  store.save('settings');
  return snapshot();
});

handle('acc:ms:cancel', () => { if (msSignal) msSignal.cancelled = true; });

// ---- сборки
handle('versions', async () => {
  if (!versionsCache || Date.now() - versionsCache.t > 600000) versionsCache = { t: Date.now(), list: await V.listVersions() };
  return versionsCache.list;
});

handle('inst:create', (o) => {
  const name = String(o.name || '').trim().slice(0, 32) || 'Сборка';
  const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'inst';
  const arr = instances();
  let uid = id, n = 1;
  while (arr.some((i) => i.id === uid)) uid = id + '-' + (++n);
  arr.push({ id: uid, name, mc: String(o.mc), fabric: !!o.fabric, darkx: o.darkx !== false, memoryMb: 0, kind: 'custom' });
  settings().selectedInstance = uid;
  store.save('instances');
  store.save('settings');
  return snapshot();
});

handle('inst:update', (id, patch) => {
  const i = instances().find((x) => x.id === id);
  if (!i) throw new Error('Сборка не найдена');
  for (const k of ['name', 'memoryMb', 'jvmArgs', 'darkx']) if (k in patch) i[k] = patch[k];
  store.save('instances');
  return snapshot();
});

handle('inst:delete', (id) => {
  const arr = instances();
  if (arr.length <= 1) throw new Error('Нельзя удалить последнюю сборку');
  const i = arr.findIndex((x) => x.id === id);
  if (i >= 0) arr.splice(i, 1);
  fs.rmSync(P.instance(id), { recursive: true, force: true });
  const s = settings();
  if (s.selectedInstance === id) s.selectedInstance = arr[0].id;
  if (s.modsInstance === id) s.modsInstance = null;
  store.save('instances');
  store.save('settings');
  return snapshot();
});

handle('inst:select', (id) => {
  settings().selectedInstance = id;
  store.save('settings');
  return snapshot();
});

/** Свободный id папки сборки по названию. */
function freeInstanceId(name) {
  const base = String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'inst';
  const arr = instances();
  let uid = base, n = 1;
  while (arr.some((i) => i.id === uid) || fs.existsSync(P.instance(uid))) uid = base + '-' + (++n);
  return uid;
}

/** Быстрое создание: последний релиз с Fabric + DarkX, название подбирается само. */
handle('inst:quick', async (o) => {
  o = o || {};
  if (!versionsCache || Date.now() - versionsCache.t > 600000) versionsCache = { t: Date.now(), list: await V.listVersions() };
  const list = versionsCache.list;
  const pick = (o.mc && list.find((v) => v.id === o.mc)) || list.find((v) => v.id === CONFIG.defaultMcVersion) || list.find((v) => v.fabric) || list[0];
  if (!pick) throw new Error('Не удалось получить список версий');
  const fabric = o.fabric !== false && pick.fabric;
  const supported = CONFIG.darkxMcVersions || [];
  const name = String(o.name || '').trim().slice(0, 32) || 'Сборка ' + pick.id;
  const uid = freeInstanceId(name);
  instances().push({ id: uid, name, mc: pick.id, fabric, darkx: fabric && o.darkx !== false && (!supported.length || supported.includes(pick.id)), memoryMb: 0, kind: 'custom' });
  settings().selectedInstance = uid;
  store.save('instances');
  store.save('settings');
  return snapshot();
});

// ---- перенос из других лаунчеров
handle('import:launchers', async () => ({ launchers: importers.LAUNCHERS, counts: await importers.summary() }));

handle('import:detect', async (id, dir) => {
  const items = dir ? await importers.detectFolder(dir) : await importers.detect(id);
  return items;
});

handle('import:pick', async () => {
  const r = await dialog.showOpenDialog(win, { title: T('Выбери папку лаунчера или сборки'), properties: ['openDirectory'] });
  if (r.canceled || !r.filePaths.length) return null;
  return { dir: r.filePaths[0], items: await importers.detectFolder(r.filePaths[0]) };
});

/** Переносит одну сборку. opts: {name, mc, addDarkx}. Прогресс — ev:import. */
handle('import:run', async (item, opts) => {
  if (importAbort) throw new Error('Перенос уже идёт');
  opts = opts || {};
  const loader = importers.loaderOf(item.loader) || 'vanilla';
  const supportedLoader = loader === 'fabric' || loader === 'vanilla';
  const mc = String(opts.mc || item.mc || '');
  if (!importers.MC_FULL.test(mc) && !/^\d\dw\d\d[a-z]$/.test(mc)) throw new Error('Не удалось определить версию Minecraft — выбери её вручную');
  if (!item.gameDir || !fs.existsSync(item.gameDir)) throw new Error('Папка сборки не найдена');
  const name = String(opts.name || item.name || 'Сборка').trim().slice(0, 32) || 'Сборка';
  const uid = freeInstanceId(name);
  const dest = P.instance(uid);
  importAbort = new AbortController();
  const emit = (done, total) => send('ev:import', { key: item.key, done, total });
  try {
    const r = await importers.copyGame(item, dest, { noMods: !supportedLoader, onProgress: emit, signal: importAbort.signal });
    const fabric = loader === 'fabric';
    const supported = CONFIG.darkxMcVersions || [];
    const inst = {
      id: uid, name, mc, fabric,
      darkx: fabric && opts.addDarkx !== false && (!supported.length || supported.includes(mc)),
      memoryMb: item.memoryMb || 0, kind: 'imported', source: item.source,
      importedFrom: item.name, skippedMods: !supportedLoader && item.mods > 0 ? item.mods : 0, loaderOrigin: loader
    };
    if (fabric && item.loaderVersion && /^\d+\.\d+/.test(item.loaderVersion)) inst.loader = item.loaderVersion;
    instances().push(inst);
    settings().selectedInstance = uid;
    store.save('instances');
    store.save('settings');
    return { state: snapshot(), files: r.files, bytes: r.bytes, skippedMods: inst.skippedMods, loaderOrigin: loader };
  } catch (e) {
    fs.rmSync(dest, { recursive: true, force: true });
    throw e;
  } finally {
    importAbort = null;
  }
});

handle('import:cancel', () => { if (importAbort) importAbort.abort(); });

// ---- сервера для быстрого входа
const serversOf = () => { const s = settings(); return s.servers || (s.servers = []); };

handle('servers:add', async (text) => {
  const addr = ping.parseAddress(text);
  if (!addr) throw new Error('Неверный адрес. Пример: mc.example.com или mc.example.com:25566');
  const list = serversOf();
  const key = addr.host.toLowerCase() + ':' + addr.port;
  if (list.some((x) => (x.host.toLowerCase() + ':' + x.port) === key)) throw new Error('Такой сервер уже добавлен');
  if (list.length >= 6) throw new Error('Можно добавить не больше 6 серверов');
  const r = await ping.ping(addr).catch(() => ({ online: null, favicon: '' }));
  const entry = { id: 's' + Date.now().toString(36), name: addr.host, host: addr.host, port: addr.port, icon: r.favicon || '' };
  list.push(entry);
  settings().selectedServer = entry.id;
  store.save('settings');
  return snapshot();
});

handle('servers:remove', (id) => {
  const s = settings();
  s.servers = serversOf().filter((x) => x.id !== id);
  if (s.selectedServer === id) s.selectedServer = null;
  store.save('settings');
  return snapshot();
});

handle('servers:select', (id) => {
  const s = settings();
  s.selectedServer = id && serversOf().some((x) => x.id === id) ? id : null;
  store.save('settings');
  return snapshot();
});

/** Обновляет иконки и онлайн всех серверов (на главной, по открытии). */
handle('servers:refresh', async () => {
  const list = serversOf();
  const res = await Promise.all(list.map((x) => ping.ping(x).catch(() => ({ online: null, favicon: '' }))));
  list.forEach((x, i) => { if (res[i].favicon) x.icon = res[i].favicon; });
  store.save('settings');
  return { state: snapshot(), status: res.map((r, i) => ({ id: list[i].id, online: r.online, max: r.max })) };
});

handle('open:folder', (what) => {
  const s = settings();
  const dir = what === 'root' ? P.root : P.instance(s.selectedInstance);
  fs.mkdirSync(dir, { recursive: true });
  return shell.openPath(dir);
});


// ---- обновление самого лаунчера
const canSelfUpdate = () => app.isPackaged && process.platform === 'win32';
const checkUpdate = () => updater.check(effective(), app.getVersion(), { canInstall: canSelfUpdate() });
handle('update:check', async () => {
  const info = await checkUpdate();
  send('ev:update', info);
  return info;
});
let updating = false;
async function runUpdateInstall(info) {
  if (!info || !info.available) throw new Error('Нет доступного обновления');
  if (!canSelfUpdate()) throw new Error('Автообновление работает только в установленной сборке Windows. Скачай новую версию вручную: ' + info.page);
  if (state !== 'idle') throw new Error('Сначала закончи игру или установку');
  if (updating) return;
  updating = true;
  try {
    const dir = path.join(app.getPath('userData'), 'updates');
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    const file = await updater.download(info, dir, (done, total) => send('ev:update-progress', { done, total }));
    updater.install(file, { portable: info.portable, exe: process.execPath, dir });
    setTimeout(() => app.quit(), 300);
  } finally {
    updating = false;
  }
}
handle('update:install', () => runUpdateInstall(updater.current));

// ---- лента релизов
handle('releases', () => releases.latest(effective(), 5));

// ---- моды
const instById = (id) => {
  const i = instances().find((x) => x.id === id);
  if (!i) throw new Error('Выбери профиль');
  return i;
};

handle('mods:categories', (source) => modhub.categories(source, effective().curseforgeKey));
handle('mods:search', (opts) => {
  const inst = opts.instance ? instances().find((x) => x.id === opts.instance) : null;
  return modhub.search(Object.assign({}, opts, { mc: inst ? inst.mc : opts.mc, loader: 'fabric' }), effective().curseforgeKey);
});
handle('mods:installed', (instId) => modhub.installed(instById(instId)));
handle('mods:install', async (instId, ref) => {
  const inst = instById(instId);
  const s = settings();
  s.modsInstance = inst.id; // запоминаем профиль правой панели
  store.save('settings');
  const files = await modhub.install(inst, ref, effective().curseforgeKey, (text) => send('ev:mod', { text }));
  return { files, installed: modhub.installed(inst) };
});
handle('mods:remove', (instId, source, projectId) => {
  const inst = instById(instId);
  modhub.remove(inst, source, projectId);
  return modhub.installed(inst);
});

// ---- скины
const skinsState = () => ({ list: skins.all(), active: settings().activeSkins || {} });

handle('skins:list', () => skinsState());

handle('skins:nick', async (nick, apply) => {
  const it = await skins.fromNick(nick);
  return { added: it, state: skinsState() };
});

handle('skins:pick', async (model) => {
  const r = await dialog.showOpenDialog(win, {
    title: 'Выбери скин (PNG 64×64)',
    properties: ['openFile'],
    filters: [{ name: I18N.T('Скин Minecraft'), extensions: ['png'] }]
  });
  if (r.canceled || !r.filePaths.length) return null;
  const file = r.filePaths[0];
  const it = skins.add({ buf: fs.readFileSync(file), name: path.basename(file, path.extname(file)), model, source: 'file' });
  return { added: it, state: skinsState() };
});

handle('skins:remove', async (id) => {
  const s = settings();
  const map = s.activeSkins || (s.activeSkins = {});
  for (const nick of Object.keys(map)) {
    if (map[nick] === id) {
      try { await skins.unpublish(effective().firebaseUrl, nick); } catch (_) { /* сеть недоступна — локально всё равно убираем */ }
      delete map[nick];
    }
  }
  skins.remove(id);
  store.save('settings');
  return skinsState();
});

handle('skins:model', (id, model) => {
  const it = skins.all().find((x) => x.id === id);
  if (!it) throw new Error('Скин не найден');
  skins.add({ buf: skins.read(id).buf, name: it.name, model, source: it.source, nick: it.nick });
  return skinsState();
});

/** Сделать скин «моим»: публикуем под ником выбранного аккаунта. */
handle('skins:apply', async (id) => {
  const s = settings();
  const acc = accounts.find(s.selectedAccount);
  if (!acc) throw new Error('Сначала выбери аккаунт');
  await skins.publish(effective().firebaseUrl, acc.name, id);
  (s.activeSkins || (s.activeSkins = {}))[acc.name.toLowerCase()] = id;
  store.save('settings');
  return skinsState();
});

handle('skins:clear', async () => {
  const s = settings();
  const acc = accounts.find(s.selectedAccount);
  if (!acc) throw new Error('Сначала выбери аккаунт');
  await skins.unpublish(effective().firebaseUrl, acc.name);
  if (s.activeSkins) delete s.activeSkins[acc.name.toLowerCase()];
  store.save('settings');
  return skinsState();
});

// ---- запуск
handle('play', async () => {
  if (state !== 'idle') throw new Error('Уже выполняется');
  const s = settings();
  const inst = instances().find((i) => i.id === s.selectedInstance);
  const acc = accounts.find(s.selectedAccount);
  if (!inst) throw new Error('Выбери сборку');
  if (!acc) throw new Error('Добавь аккаунт: меню аккаунта сверху → «Новый аккаунт»');
  const cfg = effective();
  const server = serversOf().find((x) => x.id === s.selectedServer) || null;

  setState('installing');
  playAbort = new AbortController();
  let prep, token, authlibJar;
  try {
    token = await accounts.ensureFresh(acc, cfg.msClientId);
    if (acc.type === 'ely') authlibJar = await authlib.ensure();
    prep = await installer.prepare(inst, cfg, (p) => send('ev:progress', p), playAbort.signal);
  } catch (e) {
    setState('idle');
    throw e;
  } finally {
    playAbort = null;
  }
  const cmd = launch.command(prep, acc, token, inst, cfg, app.getVersion(), server ? { host: server.host, port: server.port } : null,
    acc.type === 'ely' ? { authlib: { jar: authlibJar, api: accounts.ELY_API } } : null);
  send('ev:log', '[launcher] ' + prep.notes.join(' · '));
  send('ev:log', '[launcher] ' + cmd.java + ' ' + cmd.args.filter((a) => !a.includes(token) || token === '0').join(' ').slice(0, 600));
  inst.lastPlayed = Date.now();
  store.save('instances');

  child = launch.run(cmd, {
    onLog: (line) => send('ev:log', line),
    onExit: (code) => {
      child = null;
      setState('idle');
      send('ev:exit', { code });
      if (win && !win.isDestroyed()) {
        if (settings().onLaunch === 'minimize') { win.show(); win.restore(); }
      }
    }
  });
  setState('running');
  const mode = s.onLaunch;
  if (mode === 'minimize' && win) win.minimize();
  if (mode === 'close') setTimeout(() => app.quit(), 1500);
});

/** «Прервать» на экране запуска: останавливаем подготовку (текущие файлы дозагрузятся, новые не начнутся). */
handle('abort', () => { if (playAbort) playAbort.abort(); });

handle('stop', () => { if (child) child.kill(); });

// ================================================================== запуск

const lock = app.requestSingleInstanceLock();
if (!lock) {
  app.quit();
} else {
  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
  app.whenReady().then(() => { boot(); applyProxy(); createWindow(); });
  app.on('window-all-closed', () => app.quit());
}
