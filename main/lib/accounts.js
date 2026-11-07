'use strict';
// Аккаунты: оффлайн, Microsoft (device code flow → Xbox Live → XSTS → Minecraft Services) и Ely.by (Yggdrasil).
const crypto = require('crypto');
const http = require('./http');
const store = require('./store');
const { offlineUuid } = require('./versions');

const SCOPE = 'XboxLive.signin offline_access';
const MS = 'https://login.microsoftonline.com/consumers/oauth2/v2.0';

// шифрование токенов: main.js подставляет safeStorage (DPAPI на Windows)
let sealer = {
  seal: (s) => 'p:' + Buffer.from(s, 'utf8').toString('base64'),
  open: (s) => Buffer.from(String(s).slice(2), 'base64').toString('utf8')
};
function setSealer(s) { sealer = s; }

const list = () => store.load('accounts', []);
const find = (id) => list().find((a) => a.id === id);

function publicView(a) {
  return { id: a.id, type: a.type, name: a.name, uuid: a.uuid };
}

function addOffline(name) {
  name = String(name || '').trim();
  if (!/^[A-Za-z0-9_]{3,16}$/.test(name)) throw new Error('Ник: 3–16 символов, латиница, цифры и _');
  if (list().some((a) => a.type === 'offline' && a.name.toLowerCase() === name.toLowerCase())) throw new Error('Такой аккаунт уже есть');
  const acc = { id: crypto.randomUUID(), type: 'offline', name, uuid: offlineUuid(name) };
  list().push(acc);
  store.save('accounts');
  return acc;
}

function remove(id) {
  const arr = list();
  const i = arr.findIndex((a) => a.id === id);
  if (i >= 0) arr.splice(i, 1);
  store.save('accounts');
}

// ------------------------------------------------------------------- Microsoft

function needClient(clientId) {
  if (!clientId) {
    const e = new Error('В этой сборке лаунчера не настроен вход через Microsoft. Пока можно играть с оффлайн-аккаунтом.');
    e.code = 'NO_CLIENT_ID';
    throw e;
  }
}

async function deviceStart(clientId) {
  needClient(clientId);
  return http.json(MS + '/devicecode', { form: true, body: { client_id: clientId, scope: SCOPE } });
}

/** Ждёт, пока пользователь введёт код. signal = {cancelled:boolean}. */
async function devicePoll(clientId, dev, signal) {
  const deadline = Date.now() + dev.expires_in * 1000;
  let interval = (dev.interval || 5) * 1000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, interval));
    if (signal && signal.cancelled) throw Object.assign(new Error('Отменено'), { code: 'CANCELLED' });
    try {
      return await http.json(MS + '/token', {
        form: true,
        body: { grant_type: 'urn:ietf:params:oauth:grant-type:device_code', client_id: clientId, device_code: dev.device_code }
      });
    } catch (e) {
      const err = e.body && e.body.error;
      if (err === 'authorization_pending') continue;
      if (err === 'slow_down') { interval += 5000; continue; }
      if (err === 'authorization_declined') throw new Error('Вход отклонён');
      if (err === 'expired_token') throw new Error('Код истёк, начни заново');
      throw e;
    }
  }
  throw new Error('Код истёк, начни заново');
}

const XERR = {
  2148916233: 'У этого Microsoft-аккаунта нет профиля Xbox. Создай его на xbox.com.',
  2148916235: 'Xbox Live недоступен в твоей стране.',
  2148916238: 'Детский аккаунт: нужно добавить его в семью Microsoft.'
};

/** Токен Microsoft → токен Minecraft. */
async function xboxChain(msAccess) {
  const xbl = await http.json('https://user.auth.xboxlive.com/user/authenticate', {
    body: { Properties: { AuthMethod: 'RPS', SiteName: 'user.auth.xboxlive.com', RpsTicket: 'd=' + msAccess }, RelyingParty: 'http://auth.xboxlive.com', TokenType: 'JWT' }
  });
  let xsts;
  try {
    xsts = await http.json('https://xsts.auth.xboxlive.com/xsts/authorize', {
      body: { Properties: { SandboxId: 'RETAIL', UserTokens: [xbl.Token] }, RelyingParty: 'rp://api.minecraftservices.com/', TokenType: 'JWT' }
    });
  } catch (e) {
    const code = e.body && e.body.XErr;
    if (code && XERR[code]) throw new Error(XERR[code]);
    throw e;
  }
  const uhs = xsts.DisplayClaims.xui[0].uhs;
  let mc;
  try {
    mc = await http.json('https://api.minecraftservices.com/authentication/login_with_xbox', {
      body: { identityToken: 'XBL3.0 x=' + uhs + ';' + xsts.Token }
    });
  } catch (e) {
    if (e.status === 403) {
      throw new Error('Minecraft отклонил приложение (Invalid app registration). Azure-приложению нужно одобрение Mojang: aka.ms/mce-reviewappid');
    }
    throw e;
  }
  return { token: mc.access_token, expiresAt: Date.now() + (mc.expires_in || 86400) * 1000 };
}

async function mcProfile(token) {
  try {
    return await http.json('https://api.minecraftservices.com/minecraft/profile', { headers: { Authorization: 'Bearer ' + token } });
  } catch (e) {
    if (e.status === 404) throw new Error('На этом аккаунте нет лицензии Minecraft Java Edition');
    throw e;
  }
}

/** Полный вход: после получения токена Microsoft создаёт/обновляет аккаунт. */
async function finishMicrosoft(tokens) {
  const mc = await xboxChain(tokens.access_token);
  const prof = await mcProfile(mc.token);
  const uuid = prof.id.replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, '$1-$2-$3-$4-$5');
  let acc = list().find((a) => a.type === 'microsoft' && a.uuid === uuid);
  if (!acc) {
    acc = { id: crypto.randomUUID(), type: 'microsoft', uuid };
    list().push(acc);
  }
  acc.name = prof.name;
  acc.refresh = sealer.seal(tokens.refresh_token);
  acc.mcToken = sealer.seal(mc.token);
  acc.mcExpires = mc.expiresAt;
  store.save('accounts');
  return acc;
}

// ---------------------------------------------------------------------- Ely.by
// Yggdrasil-совместимый сервер authserver.ely.by. Пароль не хранится нигде: после входа остаются
// только accessToken и clientToken (шифруются тем же sealer, что и токены Microsoft).
// Для игры нужен authlib-injector, который направляет проверку сессии на ELY_API (см. authlib.js).
const ELY = 'https://authserver.ely.by';
const ELY_API = ELY + '/api/authlib-injector';

const dashUuid = (id) => String(id).replace(/-/g, '').replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, '$1-$2-$3-$4-$5');
/** Нет связи с Ely.by или сервер лежит: запуск из-за этого не блокируем. */
const elyDown = (e) => !e.status || e.status >= 500;

function elyError(e, withToken) {
  const b = e && e.body;
  const msg = b && typeof b === 'object' ? String(b.errorMessage || b.error_description || b.message || '') : '';
  if (/two factor/i.test(msg)) return Object.assign(new Error('Включена двухфакторная защита — нужен код из приложения'), { code: 'ELY_2FA' });
  if (/invalid credentials/i.test(msg)) return new Error(withToken ? 'Неверный пароль или код двухфакторной защиты' : 'Неверный логин или пароль');
  if (msg && e.status) return new Error('Ely.by: ' + msg);
  return e;
}

/** Вход по нику/e-mail и паролю. totp — код 2FA, если сервер его потребовал (шлётся как «пароль:код»). */
async function elyLogin(login, password, totp) {
  login = String(login || '').trim();
  password = String(password || '');
  totp = String(totp || '').replace(/\s+/g, '');
  if (!login || !password) throw new Error('Введи ник или e-mail и пароль от Ely.by');
  const clientToken = crypto.randomUUID();
  let r;
  try {
    r = await http.json(ELY + '/auth/authenticate', {
      body: { username: login, password: totp ? password + ':' + totp : password, clientToken, requestUser: true }
    });
  } catch (e) {
    throw elyError(e, !!totp);
  }
  const prof = r && r.selectedProfile;
  if (!r || !r.accessToken || !prof || !prof.id || !prof.name) throw new Error('Ely.by не вернул профиль игрока');
  const uuid = dashUuid(prof.id);
  let acc = list().find((a) => a.type === 'ely' && a.uuid === uuid);
  if (!acc) {
    acc = { id: crypto.randomUUID(), type: 'ely', uuid };
    list().push(acc);
  }
  acc.name = prof.name;
  acc.accessToken = sealer.seal(r.accessToken);
  acc.clientToken = sealer.seal(r.clientToken || clientToken);
  store.save('accounts');
  return acc;
}

/** Проверяет токен Ely.by (validate), при необходимости обновляет (refresh). */
async function elyEnsureFresh(acc) {
  const token = sealer.open(acc.accessToken);
  try {
    await http.json(ELY + '/auth/validate', { body: { accessToken: token } });
    return token;
  } catch (e) {
    if (elyDown(e)) return token;
  }
  let r;
  try {
    r = await http.json(ELY + '/auth/refresh', { body: { accessToken: token, clientToken: sealer.open(acc.clientToken), requestUser: false } });
  } catch (e) {
    if (elyDown(e)) return token;
    throw Object.assign(new Error('Сессия Ely.by истекла — войди в аккаунт заново'), { code: 'ELY_RELOGIN' });
  }
  if (!r || !r.accessToken) throw Object.assign(new Error('Сессия Ely.by истекла — войди в аккаунт заново'), { code: 'ELY_RELOGIN' });
  acc.accessToken = sealer.seal(r.accessToken);
  store.save('accounts');
  return r.accessToken;
}

/** Вернёт актуальный accessToken (обновит при необходимости). */
async function ensureFresh(acc, clientId) {
  if (acc.type === 'offline') return '0';
  if (acc.type === 'ely') return elyEnsureFresh(acc);
  if (acc.mcToken && acc.mcExpires - Date.now() > 120000) return sealer.open(acc.mcToken);
  needClient(clientId);
  let t;
  try {
    t = await http.json(MS + '/token', {
      form: true,
      body: { grant_type: 'refresh_token', client_id: clientId, refresh_token: sealer.open(acc.refresh), scope: SCOPE }
    });
  } catch (e) {
    throw new Error('Сессия Microsoft истекла — войди в аккаунт заново');
  }
  const updated = await finishMicrosoft(t);
  return sealer.open(updated.mcToken);
}

module.exports = { list, find, publicView, addOffline, remove, deviceStart, devicePoll, finishMicrosoft, ensureFresh, setSealer, xboxChain, elyLogin, ELY_API };
