'use strict';
// Скины DarkX: локальная библиотека + публикация в общую базу (Firebase RTDB), чтобы скин видели все игроки DarkX.
// Библиотека лежит в userData/skins/<id>.png, список — в skins.json.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const http = require('./http');
const store = require('./store');

const MAX_BYTES = 64 * 1024;
const SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const dir = () => path.join(store.root, 'skins');
const list = () => store.load('skins', []);

/** Проверка PNG: сигнатура, IHDR, размер 64×64 (или старый 64×32), не больше 64 КБ. */
function inspect(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 33 || !buf.subarray(0, 8).equals(SIG) || buf.toString('ascii', 12, 16) !== 'IHDR') {
    throw new Error('Это не PNG-файл');
  }
  if (buf.length > MAX_BYTES) throw new Error('Файл больше 64 КБ — скин такого размера не бывает');
  const w = buf.readUInt32BE(16), h = buf.readUInt32BE(20);
  if (w !== 64 || (h !== 64 && h !== 32)) throw new Error('Скин должен быть 64×64 (или 64×32), а тут ' + w + '×' + h);
  return { w, h };
}

const hashOf = (buf) => crypto.createHash('sha1').update(buf).digest('hex').slice(0, 16);

function view(it) {
  let data = null;
  try { data = 'data:image/png;base64,' + fs.readFileSync(path.join(dir(), it.id + '.png')).toString('base64'); } catch (_) { /* файл удалён вручную */ }
  return Object.assign({}, it, { data });
}

function all() {
  return list().filter((it) => fs.existsSync(path.join(dir(), it.id + '.png'))).map(view);
}

function add({ buf, name, model, source, nick }) {
  inspect(buf);
  const id = hashOf(buf);
  fs.mkdirSync(dir(), { recursive: true });
  const arr = list();
  const have = arr.find((x) => x.id === id);
  if (have) {
    have.name = name || have.name;
    have.model = model || have.model;
    store.save('skins');
    return view(have);
  }
  fs.writeFileSync(path.join(dir(), id + '.png'), buf);
  const it = { id, name: String(name || 'Скин').slice(0, 32), model: model === 'slim' ? 'slim' : 'classic', source: source || 'file', nick: nick || null, at: Date.now() };
  arr.unshift(it);
  store.save('skins');
  return view(it);
}

function remove(id) {
  const arr = list();
  const i = arr.findIndex((x) => x.id === id);
  if (i >= 0) arr.splice(i, 1);
  store.save('skins');
  try { fs.unlinkSync(path.join(dir(), id + '.png')); } catch (_) { /* уже нет */ }
}

function read(id) {
  const it = list().find((x) => x.id === id);
  if (!it) throw new Error('Скин не найден в библиотеке');
  return { it, buf: fs.readFileSync(path.join(dir(), id + '.png')) };
}

// ===================================================================== Mojang

/** Скин лицензионного игрока по нику (Mojang API). */
async function fromNick(nick) {
  nick = String(nick || '').trim();
  if (!/^[A-Za-z0-9_]{3,16}$/.test(nick)) throw new Error('Ник: 3–16 символов, латиница, цифры и _');
  let prof;
  try {
    prof = await http.json('https://api.mojang.com/users/profiles/minecraft/' + encodeURIComponent(nick));
  } catch (e) {
    if (e.status === 404 || e.status === 204) throw new Error('Игрока «' + nick + '» нет у Mojang — скин взять не получится');
    throw e;
  }
  if (!prof || !prof.id) throw new Error('Игрока «' + nick + '» нет у Mojang — скин взять не получится');
  const full = await http.json('https://sessionserver.mojang.com/session/minecraft/profile/' + prof.id);
  const prop = ((full && full.properties) || []).find((p) => p.name === 'textures');
  if (!prop) throw new Error('У игрока нет профиля текстур');
  const tex = JSON.parse(Buffer.from(prop.value, 'base64').toString('utf8'));
  const skin = tex.textures && tex.textures.SKIN;
  if (!skin || !skin.url) throw new Error('У «' + prof.name + '» стандартный скин — нечего брать');
  const r = await http.request(String(skin.url).replace(/^http:/, 'https:'));
  if (r.status !== 200) throw new Error('Mojang не отдал файл скина (HTTP ' + r.status + ')');
  return add({ buf: r.body, name: prof.name, model: skin.metadata && skin.metadata.model === 'slim' ? 'slim' : 'classic', source: 'nick', nick: prof.name });
}

// ==================================================================== Firebase

const dbUrl = (base, nick) => String(base).replace(/\/+$/, '') + '/darkx/skins/' + String(nick).toLowerCase() + '.json';

/** Публикует скин под ником игрока: его увидят все, у кого стоит DarkX. */
async function publish(base, nick, id) {
  if (!base) throw new Error('Не задан адрес сети DarkX (firebaseUrl)');
  if (!/^[A-Za-z0-9_]{3,16}$/.test(String(nick))) throw new Error('Нужен аккаунт с корректным ником');
  const { it, buf } = read(id);
  const r = await http.request(dbUrl(base, nick), {
    method: 'PUT',
    body: { png: buf.toString('base64'), model: it.model, name: nick, at: Date.now() }
  });
  if (r.status >= 400) {
    throw new Error(r.status === 401 || r.status === 403
      ? 'База DarkX не разрешила запись скинов (нужно открыть узел darkx/skins в правилах Firebase)'
      : 'База DarkX ответила HTTP ' + r.status);
  }
}

/** Что сейчас опубликовано под ником (или null). */
async function remote(base, nick) {
  if (!base) return null;
  const d = await http.json(dbUrl(base, nick));
  return d && d.png ? { model: d.model || 'classic', data: 'data:image/png;base64,' + d.png } : null;
}

async function unpublish(base, nick) {
  if (!base) return;
  await http.request(dbUrl(base, nick), { method: 'DELETE' });
}

module.exports = { inspect, all, add, remove, read, fromNick, publish, remote, unpublish };
