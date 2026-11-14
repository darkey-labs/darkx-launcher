'use strict';
// Подменённая сеть: фикстуры Mojang/Fabric/Modrinth для тестов и скриншотов.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const AdmZip = require('adm-zip');

const sha1 = (b) => crypto.createHash('sha1').update(b).digest('hex');
// ---------------------------------------------------------------- фикстуры
const files = {}; // url -> Buffer
const jsons = {};

const libB = Buffer.from('lib-b-bytes');
files['mock://lib/b'] = libB;
const nativeZip = new AdmZip();
nativeZip.addFile('libnative.so', Buffer.from('so-bytes'));
nativeZip.addFile('META-INF/MANIFEST.MF', Buffer.from('x'));
const nativeBuf = nativeZip.toBuffer();
files['mock://lib/native'] = nativeBuf;
files['mock://lib/win'] = Buffer.from('win-only');
files['mock://client'] = Buffer.from('client-jar');
files['mock://asset/1'] = Buffer.from('asset-one');
files['mock://asset/2'] = Buffer.from('asset-two');
files['https://maven.fabricmc.net/net/fabricmc/fabric-loader/0.17.0/fabric-loader-0.17.0.jar'] = Buffer.from('loader');
files['https://maven.fabricmc.net/net/fabricmc/intermediary/1.21.11/intermediary-1.21.11.jar'] = Buffer.from('inter');
files['mock://fapi'] = Buffer.from('fabric-api-bytes');
files['mock://darkx'] = Buffer.from('darkx-bytes');
files['https://github.com/darkey-labs/darkx/releases/download/1.21.11/darkx-visuals-1.0.0.jar'] = files['mock://darkx']; // ссылка из launcher.config.json
const fakeJava = Buffer.from('#!/bin/sh\necho "JAVA-ARGS: $@"\nexit 0\n');
files['mock://rt/java'] = fakeJava;

const assetIdx = { objects: { 'icons/a.png': { hash: sha1(Buffer.from('asset-one')), size: 9 }, 'sounds/b.ogg': { hash: sha1(Buffer.from('asset-two')), size: 9 } } };
const assetIdxBuf = Buffer.from(JSON.stringify(assetIdx));
files['mock://assetindex'] = assetIdxBuf;
for (const [k, o] of Object.entries(assetIdx.objects)) {
  files['https://resources.download.minecraft.net/' + o.hash.slice(0, 2) + '/' + o.hash] = k.startsWith('icons') ? files['mock://asset/1'] : files['mock://asset/2'];
}

jsons['https://piston-meta.mojang.com/mc/game/version_manifest_v2.json'] = {
  versions: [{ id: '1.21.11', type: 'release', url: 'mock://v/1.21.11', releaseTime: '2025-12-09' }, { id: '25w01a', type: 'snapshot', url: 'mock://v/x', releaseTime: 'x' }]
};
jsons['mock://v/1.21.11'] = {
  id: '1.21.11', type: 'release', mainClass: 'net.minecraft.client.main.Main', assets: '17',
  assetIndex: { id: '17', url: 'mock://assetindex', sha1: sha1(assetIdxBuf), size: assetIdxBuf.length },
  downloads: { client: { url: 'mock://client', sha1: sha1(files['mock://client']), size: files['mock://client'].length } },
  javaVersion: { component: 'java-runtime-delta', majorVersion: 21 },
  libraries: [
    { name: 'com.example:b:1.0', downloads: { artifact: { path: 'com/example/b/1.0/b-1.0.jar', url: 'mock://lib/b', sha1: sha1(libB), size: libB.length } } },
    { name: 'org.lwjgl:lwjgl:3.3.3:natives-windows', rules: [{ action: 'allow', os: { name: 'windows' } }],
      downloads: { artifact: { path: 'org/lwjgl/lwjgl/3.3.3/lwjgl-3.3.3-natives-windows.jar', url: 'mock://lib/win', sha1: sha1(files['mock://lib/win']), size: 8 } } },
    { name: 'old:nat:1.0', natives: { linux: 'natives-linux', windows: 'natives-windows' }, extract: { exclude: ['META-INF/'] },
      downloads: { classifiers: { 'natives-linux': { path: 'old/nat/1.0/nat-1.0-natives-linux.jar', url: 'mock://lib/native', sha1: sha1(nativeBuf), size: nativeBuf.length } } } }
  ],
  arguments: {
    jvm: ['-Djava.library.path=${natives_directory}', '-Dminecraft.launcher.brand=${launcher_name}',
      { rules: [{ action: 'allow', os: { name: 'osx' } }], value: '-XstartOnFirstThread' }, '-cp', '${classpath}'],
    game: ['--username', '${auth_player_name}', '--version', '${version_name}', '--gameDir', '${game_directory}', '--assetsDir', '${assets_root}',
      '--assetIndex', '${assets_index_name}', '--uuid', '${auth_uuid}', '--accessToken', '${auth_access_token}', '--userType', '${user_type}',
      { rules: [{ action: 'allow', features: { is_demo_user: true } }], value: '--demo' }]
  }
};
jsons['https://meta.fabricmc.net/v2/versions/game'] = [{ version: '1.21.11', stable: true }];
jsons['https://meta.fabricmc.net/v2/versions/loader/1.21.11'] = [{ loader: { version: '0.17.1', stable: false } }, { loader: { version: '0.17.0', stable: true } }];
jsons['https://meta.fabricmc.net/v2/versions/loader/1.21.11/0.17.0/profile/json'] = {
  id: 'fabric-loader-0.17.0-1.21.11', inheritsFrom: '1.21.11', type: 'release', mainClass: 'net.fabricmc.loader.impl.launch.knot.KnotClient',
  arguments: { game: [], jvm: ['-DFabricMcEmu= net.minecraft.client.main.Main '] },
  libraries: [{ name: 'net.fabricmc:fabric-loader:0.17.0', url: 'https://maven.fabricmc.net/' }, { name: 'net.fabricmc:intermediary:1.21.11', url: 'https://maven.fabricmc.net/' }]
};
jsons['https://launchermeta.mojang.com/v1/products/java-runtime/2ec0cc96c44e5a76b9c8b7c39df7210883d12871/all.json'] = {
  linux: { 'java-runtime-delta': [{ manifest: { url: 'mock://rt/manifest' }, version: { name: '21.0.7' } }] }
};
jsons['mock://rt/manifest'] = { files: {
  bin: { type: 'directory' },
  'bin/java': { type: 'file', executable: true, downloads: { raw: { url: 'mock://rt/java', sha1: sha1(fakeJava), size: fakeJava.length } } }
} };
jsons['https://api.modrinth.com/v2/project/fabric-api/version?loaders=' + encodeURIComponent('["fabric"]') + '&game_versions=' + encodeURIComponent('["1.21.11"]')] = [
  { files: [{ primary: true, url: 'mock://fapi', filename: 'fabric-api-0.141.6+1.21.11.jar', size: files['mock://fapi'].length, hashes: { sha1: sha1(files['mock://fapi']) } }] }
];


// ---------------------------------------------------------------- PNG-скин для тестов
const zlib = require('zlib');
function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function makePng(w, h, px) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const o = y * (w * 4 + 1) + 1 + x * 4;
    const [r, g, b, a] = px(x, y);
    raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; raw[o + 3] = a;
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
// простой тестовый «скин»: голова, тело, руки и ноги разных цветов
function demoSkin(seed) {
  return makePng(64, 64, (x, y) => {
    if (x >= 8 && x < 16 && y >= 8 && y < 16) return y === 11 && (x === 10 || x === 13) ? [30, 40, 110, 255] : [214 - seed, 166, 130, 255];
    if (x >= 8 && x < 16 && y < 8) return [58, 43, 34, 255];
    if (x >= 20 && x < 28 && y >= 20 && y < 32) return [60 + seed, 120, 200, 255];
    if (x >= 44 && x < 48 && y >= 20 && y < 32) return [214 - seed, 166, 130, 255];
    if (x >= 36 && x < 40 && y >= 52 && y < 64) return [214 - seed, 166, 130, 255];
    if (x >= 4 && x < 8 && y >= 20 && y < 32) return [50, 60, 120, 255];
    if (x >= 20 && x < 24 && y >= 52 && y < 64) return [50, 60, 120, 255];
    return [0, 0, 0, 0];
  });
}
const skinA = demoSkin(0);
files['https://textures.minecraft.net/texture/aaaa'] = skinA;
jsons['https://api.mojang.com/users/profiles/minecraft/Notch'] = { id: '069a79f444e94726a5befca90e38aaf5', name: 'Notch' };
jsons['https://sessionserver.mojang.com/session/minecraft/profile/069a79f444e94726a5befca90e38aaf5'] = {
  id: '069a79f444e94726a5befca90e38aaf5', name: 'Notch',
  properties: [{ name: 'textures', value: Buffer.from(JSON.stringify({ textures: { SKIN: { url: 'http://textures.minecraft.net/texture/aaaa' } } })).toString('base64') }]
};
const puts = []; // записи в Firebase

// ---------------------------------------------------------------- GitHub Releases
jsons['https://api.github.com/repos/darkey-labs/darkx/releases?per_page=10'] = [
  { id: 6, tag_name: '1.21.11', name: 'DarkX Visuals 1.0.2 — добавлены анимации', published_at: '2026-10-29T12:00:00Z', html_url: 'https://github.com/darkey-labs/darkx/releases/tag/1.21.11',
    body: '## Что нового\r\n- Анимации ClickGui, худа и уведомлений\r\n- **Клиентские звуки** с ревербом\r\n* Исправлен Near HUD\r\n\r\n**Full Changelog**: https://github.com/darkey-labs/darkx/compare/a...b' },
  { id: 5, tag_name: '1.21.11', name: 'v1.0.1', published_at: '2026-10-20T09:30:00Z', html_url: 'https://github.com/darkey-labs/darkx/releases/tag/x', body: 'Друзья через сеть DarkX.\n- Список друзей в LAN\n- Тост при входе друга' },
  { id: 4, tag_name: 'v1.0.0', name: '', published_at: '2026-10-10T09:30:00Z', html_url: 'https://github.com/darkey-labs/darkx/releases/tag/v1.0.0', body: '- Первый публичный релиз' },
  { id: 3, tag_name: '0.9.0', name: 'Beta 0.9.0', draft: true, published_at: null, body: 'черновик' },
  { id: 2, tag_name: '0.8.0', name: 'DarkX 0.8.0', prerelease: true, published_at: '2026-09-30T09:30:00Z', body: '' },
  { id: 1, tag_name: '0.7.0', name: '0.7.0: Orange тема', published_at: '2026-09-20T09:30:00Z', body: '- Новая тема' },
  { id: 0, tag_name: '0.6.0', name: '0.6.0', published_at: '2026-09-10T09:30:00Z', body: '- Старое' }
];

// ---------------------------------------------------------------- релизы самого лаунчера (OTA)
const setupBytes = Buffer.from('setup-exe-bytes');
const portableBytes = Buffer.from('portable-exe-bytes');
files['https://github.com/darkey-labs/darkx-launcher/releases/download/v1.2.0/DarkX-Launcher-Setup-1.2.0-x64.exe'] = setupBytes;
files['https://github.com/darkey-labs/darkx-launcher/releases/download/v1.2.0/DarkX-Launcher-Portable-1.2.0.exe'] = portableBytes;
jsons['https://api.github.com/repos/darkey-labs/darkx-launcher/releases/latest'] = {
  id: 90, tag_name: 'v1.2.0', name: 'DarkX Launcher 1.2.0 — автообновление', published_at: '2026-11-02T10:00:00Z', html_url: 'https://github.com/darkey-labs/darkx-launcher/releases/tag/v1.2.0',
  body: '- Автообновление лаунчера\n- Новая шестерёнка в настройках',
  assets: [
    { name: 'DarkX-Launcher-Setup-1.2.0-ia32.exe', size: 5, browser_download_url: 'https://github.com/darkey-labs/darkx-launcher/releases/download/v1.2.0/DarkX-Launcher-Setup-1.2.0-ia32.exe' },
    { name: 'DarkX-Launcher-Setup-1.2.0-x64.exe', size: setupBytes.length, digest: 'sha256:' + crypto.createHash('sha256').update(setupBytes).digest('hex'), browser_download_url: 'https://github.com/darkey-labs/darkx-launcher/releases/download/v1.2.0/DarkX-Launcher-Setup-1.2.0-x64.exe' },
    { name: 'DarkX-Launcher-Portable-1.2.0.exe', size: portableBytes.length, browser_download_url: 'https://github.com/darkey-labs/darkx-launcher/releases/download/v1.2.0/DarkX-Launcher-Portable-1.2.0.exe' },
    { name: 'latest.yml', size: 10, browser_download_url: 'https://github.com/darkey-labs/darkx-launcher/releases/download/v1.2.0/latest.yml' }
  ]
};

// ---------------------------------------------------------------- Modrinth: категории, поиск, версии
jsons['https://api.modrinth.com/v2/tag/category'] = [
  { name: 'optimization', project_type: 'mod', header: 'categories' }, { name: 'utility', project_type: 'mod', header: 'categories' },
  { name: 'fabric', project_type: 'mod', header: 'loaders' }, { name: 'decoration', project_type: 'mod', header: 'categories' }
];
const MR_HITS = [
  { project_id: 'AANobbMI', slug: 'sodium', title: 'Sodium', description: 'Современный движок рендеринга для Minecraft, значительно повышающий FPS', icon_url: null, author: 'jellysquid3', downloads: 85000000, display_categories: ['optimization'], categories: ['optimization'] },
  { project_id: 'YL57xq9U', slug: 'iris', title: 'Iris Shaders', description: 'Шейдеры, совместимые с Sodium', icon_url: null, author: 'coderbot', downloads: 42000000, display_categories: ['decoration'], categories: ['decoration'] },
  { project_id: 'gvQqBUqZ', slug: 'lithium', title: 'Lithium', description: 'Оптимизация игровой логики и физики', icon_url: null, author: 'jellysquid3', downloads: 31000000, display_categories: ['optimization'], categories: ['optimization'] }
];
const MR_VERS = {
  AANobbMI: [{ id: 'v-sodium', name: 'Sodium 0.7.0', version_type: 'release', date_published: '2026-10-01', files: [{ primary: true, url: 'mock://mr/sodium', filename: 'sodium-fabric-0.7.0+mc1.21.11.jar', size: 12, hashes: { sha1: sha1(Buffer.from('sodium-bytes')) } }], dependencies: [{ project_id: 'P7dR8mSH', dependency_type: 'required' }, { project_id: 'dep-lib', dependency_type: 'required' }, { project_id: 'opt', dependency_type: 'optional' }] }],
  'dep-lib': [{ id: 'v-lib', name: 'Lib 1.0', version_type: 'release', date_published: '2026-09-01', files: [{ primary: true, url: 'mock://mr/lib', filename: 'lib-1.0.jar', size: 7, hashes: { sha1: sha1(Buffer.from('lib-one')) } }], dependencies: [] }],
  gvQqBUqZ: []
};
files['mock://mr/sodium'] = Buffer.from('sodium-bytes');
files['mock://mr/lib'] = Buffer.from('lib-one');
const jsonFns = [
  [/^https:\/\/api\.modrinth\.com\/v2\/search\?/, (u) => {
    const q = new URL(u).searchParams;
    const query = (q.get('query') || '').toLowerCase();
    const hits = MR_HITS.filter((m) => !query || m.title.toLowerCase().includes(query));
    return { hits, total_hits: hits.length, _facets: q.get('facets'), _index: q.get('index') };
  }],
  [/^https:\/\/api\.modrinth\.com\/v2\/project\/([^/]+)\/version\?.*include_changelog/, (u) => {
    const id = decodeURIComponent(/project\/([^/]+)\/version/.exec(u)[1]);
    if (id === 'P7dR8mSH') return [{ id: 'fapi-v', name: 'Fabric API', version_type: 'release', date_published: '2026-10-01', files: [{ primary: true, url: 'mock://fapi', filename: 'fabric-api-0.141.6+1.21.11.jar', size: files['mock://fapi'].length, hashes: { sha1: sha1(files['mock://fapi']) } }], dependencies: [] }];
    return MR_VERS[id] || [];
  }]
];

const http = require('../main/lib/http');
const hits = [];
http.json = async (url) => {
  hits.push(url);
  if (url in jsons) return JSON.parse(JSON.stringify(jsons[url]));
  for (const [re, fn] of jsonFns) if (re.test(url)) return JSON.parse(JSON.stringify(fn(url)));
  if (/^https:\/\/darkx-test\.firebaseio\.test\//.test(url)) {
    const e = /skins\/([^.]+)\.json/.exec(url);
    return e && firebase[e[1]] ? firebase[e[1]] : null;
  }
  const err = new Error('нет фикстуры json: ' + url);
  if (/api\.mojang\.com/.test(url)) err.status = 404;
  throw err;
};
const firebase = {};
http.download = async (url, dest, o = {}) => {
  hits.push(url);
  if (!(url in files)) throw new Error('нет фикстуры файла: ' + url);
  const b = files[url];
  if (o.sha1) assert.strictEqual(sha1(b), o.sha1, 'sha1 ' + url);
  if (o.size) assert.strictEqual(b.length, o.size, 'size ' + url);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, b);
  if (o.onBytes) o.onBytes(b.length);
};
const realRequest = http.request;
http.request = async (url, o) => {
  if (o && o.method === 'HEAD') return { status: 200, headers: { etag: '"v1"', 'content-length': '12' }, body: Buffer.alloc(0) };
  if (o && /firebase/.test(url) && (o.method === 'PUT' || o.method === 'DELETE')) {
    const e = /skins\/([^.]+)\.json/.exec(url);
    puts.push([o.method, url, o.body]);
    if (e) { if (o.method === 'PUT') firebase[e[1]] = o.body; else delete firebase[e[1]]; }
    return { status: 200, headers: {}, body: Buffer.from('null') };
  }
  if (url in files) return { status: 200, headers: {}, body: files[url] };
  return realRequest(url, o);
};


module.exports = { hits, files, jsons, sha1, puts, firebase, demoSkin, makePng, skinA };
