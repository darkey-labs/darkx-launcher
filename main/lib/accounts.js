'use strict';
// Аккаунты: оффлайн и Microsoft (device code flow → Xbox Live → XSTS → Minecraft Services).
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

/** Вернёт актуальный accessToken (обновит при необходимости). */
async function ensureFresh(acc, clientId) {
  if (acc.type === 'offline') return '0';
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

module.exports = { list, find, publicView, addOffline, remove, deviceStart, devicePoll, finishMicrosoft, ensureFresh, setSealer, xboxChain };
