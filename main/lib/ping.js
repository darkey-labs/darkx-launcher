'use strict';
// Server List Ping: имя, онлайн и иконка сервера для быстрых кнопок на главной.
const net = require('net');
const dns = require('dns');

function varint(n) {
  const out = [];
  do {
    let b = n & 0x7f;
    n >>>= 7;
    if (n) b |= 0x80;
    out.push(b);
  } while (n);
  return Buffer.from(out);
}

function packet(id, body) {
  const data = Buffer.concat([varint(id), body]);
  return Buffer.concat([varint(data.length), data]);
}

function str(s) {
  const b = Buffer.from(s, 'utf8');
  return Buffer.concat([varint(b.length), b]);
}

function readVarint(buf, pos) {
  let n = 0, shift = 0, b;
  do {
    if (pos >= buf.length) return null;
    b = buf[pos++];
    n |= (b & 0x7f) << shift;
    shift += 7;
    if (shift > 35) throw new Error('varint слишком длинный');
  } while (b & 0x80);
  return { value: n, pos };
}

/** "host", "host:port" → {host, port}. */
function parseAddress(text) {
  const t = String(text || '').trim().replace(/^[a-z]+:\/\//i, '').replace(/\/.*$/, '');
  const m = t.match(/^([^:\s]+)(?::(\d{1,5}))?$/);
  if (!m) return null;
  const port = m[2] ? Number(m[2]) : 25565;
  if (port < 1 || port > 65535) return null;
  return { host: m[1], port, explicitPort: !!m[2] };
}

async function resolveSrv(host) {
  try {
    const r = await dns.promises.resolveSrv('_minecraft._tcp.' + host);
    if (r && r.length) return { host: r[0].name, port: r[0].port };
  } catch (_) { /* SRV нет — это нормально */ }
  return null;
}

/** Возвращает {name?, online, max, favicon?} или бросает ошибку. */
function ping(addr, timeout = 3500) {
  return new Promise(async (resolve, reject) => {
    let target = { host: addr.host, port: addr.port };
    if (!addr.explicitPort) target = (await resolveSrv(addr.host)) || target;
    const sock = net.connect({ host: target.host, port: target.port });
    let buf = Buffer.alloc(0);
    let done = false;
    const end = (fn, v) => { if (!done) { done = true; sock.destroy(); fn(v); } };
    sock.setTimeout(timeout, () => end(reject, new Error('timeout')));
    sock.on('error', (e) => end(reject, e));
    sock.on('connect', () => {
      const port = Buffer.alloc(2);
      port.writeUInt16BE(addr.port);
      sock.write(packet(0, Buffer.concat([varint(765), str(addr.host), port, varint(1)])));
      sock.write(packet(0, Buffer.alloc(0)));
    });
    sock.on('data', (d) => {
      buf = Buffer.concat([buf, d]);
      try {
        const len = readVarint(buf, 0);
        if (!len || buf.length < len.pos + len.value) return;
        const id = readVarint(buf, len.pos);
        const jl = readVarint(buf, id.pos);
        if (!jl || buf.length < jl.pos + jl.value) return;
        const json = JSON.parse(buf.slice(jl.pos, jl.pos + jl.value).toString('utf8'));
        const fav = typeof json.favicon === 'string' && json.favicon.startsWith('data:image/png;base64,') && json.favicon.length < 40000 ? json.favicon : '';
        end(resolve, { online: json.players ? json.players.online : 0, max: json.players ? json.players.max : 0, favicon: fav });
      } catch (e) { end(reject, e); }
    });
  });
}

module.exports = { ping, parseAddress, varint, packet };
