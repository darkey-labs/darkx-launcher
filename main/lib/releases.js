'use strict';
// Лента «Обновления клиента»: последние релизы с GitHub. Версия берётся из названия релиза,
// заголовок и пункты — из описания (Markdown).
const fs = require('fs');
const P = require('./paths');
const http = require('./http');

const TTL = 10 * 60 * 1000;
let mem = null;

/** owner/repo из настроек или из прямой ссылки на .jar. */
function repoOf(cfg) {
  if (cfg.releasesRepo && /^[\w.-]+\/[\w.-]+$/.test(cfg.releasesRepo)) return cfg.releasesRepo;
  const m = /github\.com\/([\w.-]+\/[\w.-]+)\/releases/.exec(cfg.darkxClientUrl || '');
  return m ? m[1] : null;
}

const VER = /v?(\d+(?:\.\d+){1,3}(?:[-+][0-9A-Za-z.]+)?)/g;

function stripMd(s) {
  return s
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/!\[[^\]]*]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/(\*\*|__)(.*?)\1/g, '$2')
    .replace(/(\*|_)(.*?)\1/g, '$2')
    .replace(/`([^`]*)`/g, '$1')
    .trim();
}

/** Версия: первое число вида 1.2.3 в названии, не равное тегу (тег у DarkX — версия Minecraft). */
function pickVersion(name, tag) {
  const all = [];
  let m;
  VER.lastIndex = 0;
  while ((m = VER.exec(name || ''))) all.push({ v: m[1], raw: m[0], at: m.index });
  const pick = all.find((x) => x.v !== String(tag || '').replace(/^v/, '')) || all[0];
  if (pick) return pick;
  const t = VER.exec(tag || '');
  VER.lastIndex = 0;
  return { v: t ? t[1] : String(tag || name || '?'), raw: null, at: -1 };
}

function parse(rel) {
  const name = String(rel.name || '').trim();
  const ver = pickVersion(name, rel.tag_name);
  let rest = name;
  if (ver.raw) rest = name.replace(ver.raw, ' ');
  rest = rest.replace(/\b(darkx|visuals|release|релиз|version|версия)\b/ig, ' ').replace(/^[\s\-–—:|·•,.]+|[\s\-–—:|·•,.]+$/g, '').replace(/\s+/g, ' ');

  const blocks = [];
  for (const raw of String(rel.body || '').replace(/\r/g, '').split('\n')) {
    const line = raw.trim();
    if (!line || /^(-{3,}|\*{3,}|_{3,})$/.test(line)) continue;
    if (/^\*\*?full changelog/i.test(line) || /^full changelog/i.test(line)) continue;
    const li = /^([-*+•]|\d+[.)])\s+(.*)$/.exec(line);
    const isHead = /^#{1,6}\s/.test(line);
    const text = stripMd((li ? li[2] : line).replace(/^#{1,6}\s*/, ''));
    if (!text) continue;
    if (isHead && /^(что нового|что изменилось|изменения|changes|what'?s new|changelog)\W*$/i.test(text)) continue;
    blocks.push({ type: li ? 'li' : 'p', text: text.slice(0, 300) });
    if (blocks.length >= 14) break;
  }
  let headline = rest;
  if (!headline) {
    const i = blocks.findIndex((b) => b.type === 'p');
    if (i >= 0) headline = blocks.splice(i, 1)[0].text;
  }
  return {
    id: rel.id,
    tag: rel.tag_name,
    version: ver.v,
    headline,
    date: rel.published_at || rel.created_at || null,
    url: rel.html_url,
    prerelease: !!rel.prerelease,
    blocks
  };
}

async function latest(cfg, count = 5) {
  const repo = repoOf(cfg);
  if (!repo) throw new Error('Не задан репозиторий релизов (releasesRepo в launcher.config.json)');
  if (mem && mem.repo === repo && Date.now() - mem.t < TTL) return mem.list;
  const cacheFile = P.shared('cache', 'releases.json');
  try {
    const rels = await http.json('https://api.github.com/repos/' + repo + '/releases?per_page=' + Math.max(count, 5) * 2, {
      headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' }
    });
    const list = rels.filter((r) => !r.draft).slice(0, count).map(parse);
    mem = { repo, t: Date.now(), list };
    try { fs.writeFileSync(cacheFile, JSON.stringify({ repo, list })); } catch (_) { /* кэш необязателен */ }
    return list;
  } catch (e) {
    // нет сети / лимит GitHub — показываем последнюю удачную ленту
    try {
      const c = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
      if (c.repo === repo && Array.isArray(c.list)) return c.list;
    } catch (_) { /* кэша нет */ }
    throw e;
  }
}


let assetMem = null;

/** Тег релиза DarkX начинается с версии игры: 1.21.11, 1.21.11-U9, 1.21.11-U9-P1. «1.21.1» не должен цеплять «1.21.11». */
function tagIsFor(tag, mc) {
  const t = String(tag || '').replace(/^v/i, '');
  return t === mc || (t.startsWith(mc) && !/[\d.]/.test(t.charAt(mc.length)));
}

/**
 * Jar мода DarkX из самого свежего релиза под нужную версию игры. Имя файла и порядок тегов не важны:
 * релизы идут по дате публикации, берётся новейший с .jar. null, если GitHub недоступен или подходящего релиза нет
 * (тогда работает ссылка darkxClientUrl из настроек).
 */
async function clientAsset(cfg, mc) {
  const repo = repoOf(cfg);
  if (!repo) return null;
  if (assetMem && assetMem.key === repo + '|' + mc && Date.now() - assetMem.t < 5 * 60 * 1000) return assetMem.value;
  let rels;
  try {
    rels = await http.json('https://api.github.com/repos/' + repo + '/releases?per_page=30', {
      headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' }
    });
  } catch (_) { return null; }
  const when = (r) => Date.parse(r.published_at || r.created_at || 0) || 0;
  let value = null;
  const sorted = (rels || []).filter((r) => !r.draft && tagIsFor(r.tag_name, mc)).sort((a, b) => when(b) - when(a));
  for (const r of sorted) {
    const jars = (r.assets || []).filter((a) => /\.jar$/i.test(a.name) && !/-(sources|dev|javadoc)\.jar$/i.test(a.name));
    const a = jars.find((x) => /darkx/i.test(x.name)) || jars[0];
    if (a) { value = { url: a.browser_download_url, file: a.name, size: a.size, tag: r.tag_name }; break; }
  }
  assetMem = { key: repo + '|' + mc, t: Date.now(), value };
  return value;
}

module.exports = { latest, parse, repoOf, clientAsset };
