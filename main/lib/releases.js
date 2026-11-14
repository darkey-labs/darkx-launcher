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

function decodeHtml(s) {
  return String(s || '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

function htmlToMd(html) {
  return decodeHtml(html)
    .replace(/<li[^>]*>/gi, '\n- ')
    .replace(/<\/li>/gi, '')
    .replace(/<(?:p|div|br|h[1-6])[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .join('\n');
}

async function fetchExpandedAssets(repo, tag) {
  try {
    const r = await http.request('https://github.com/' + repo + '/releases/expanded_assets/' + encodeURIComponent(tag));
    if (r.status >= 400) return [];
    const html = r.body.toString('utf8');
    const assets = [];
    const rows = html.split(/<li\b[^>]*class="[^"]*Box-row[^"]*"[^>]*>/i).slice(1);
    for (const row of rows) {
      const hrefMatch = /href="([^"]*\/releases\/download\/[^"]+)"/i.exec(row);
      if (!hrefMatch) continue;
      const href = hrefMatch[1];
      const url = href.startsWith('http') ? href : 'https://github.com' + href;
      const name = decodeURIComponent(url.split('/').pop());
      const shaMatch = /sha256:([0-9a-f]{64})/i.exec(row);
      assets.push({
        name,
        browser_download_url: url,
        size: 0,
        digest: shaMatch ? 'sha256:' + shaMatch[1].toLowerCase() : null
      });
    }
    return assets;
  } catch (_) {
    return [];
  }
}

/**
 * Запасной способ получения релизов напрямую с веб-страницы GitHub (releases.atom + expanded_assets),
 * который не расходует лимит 60 запросов/час у api.github.com (и не падает с HTTP 403).
 */
async function fetchWebReleases(repo, count = 10, withAssets = false) {
  const r = await http.request('https://github.com/' + repo + '/releases.atom');
  if (r.status >= 400) {
    const err = new Error('HTTP ' + r.status + ' https://github.com/' + repo + '/releases.atom');
    err.status = r.status;
    throw err;
  }
  const xml = r.body.toString('utf8');
  const entries = [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].slice(0, count);
  const out = [];
  for (const m of entries) {
    const chunk = m[1];
    const linkMatch = /<link[^>]*href="https:\/\/github\.com\/[^"]+\/releases\/tag\/([^"]+)"/i.exec(chunk);
    if (!linkMatch) continue;
    const tag = decodeURIComponent(linkMatch[1]);
    const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(chunk);
    const updatedMatch = /<updated>([\s\S]*?)<\/updated>/i.exec(chunk);
    const contentMatch = /<content[^>]*>([\s\S]*?)<\/content>/i.exec(chunk);
    const assets = withAssets ? await fetchExpandedAssets(repo, tag) : [];
    out.push({
      id: tag,
      tag_name: tag,
      name: titleMatch ? decodeHtml(titleMatch[1].trim()) : tag,
      published_at: updatedMatch ? updatedMatch[1].trim() : null,
      html_url: 'https://github.com/' + repo + '/releases/tag/' + encodeURIComponent(tag),
      prerelease: false,
      draft: false,
      body: contentMatch ? htmlToMd(contentMatch[1]) : '',
      assets
    });
  }
  return out;
}

async function latest(cfg, count = 5) {
  const repo = repoOf(cfg);
  if (!repo) throw new Error('Не задан репозиторий релизов (releasesRepo в launcher.config.json)');
  if (mem && mem.repo === repo && Date.now() - mem.t < TTL) return mem.list;
  const cacheFile = P.shared('cache', 'releases.json');
  try {
    let rels;
    try {
      rels = await http.json('https://api.github.com/repos/' + repo + '/releases?per_page=' + Math.max(count, 5) * 2, {
        headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' }
      });
    } catch (_) {
      rels = await fetchWebReleases(repo, Math.max(count, 5) * 2, false);
    }
    const when = (r) => Date.parse(r.published_at || r.created_at || 0) || 0;
    const list = rels.filter((r) => !r.draft).sort((a, b) => when(b) - when(a)).slice(0, count).map(parse);
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

/** Тег релиза DarkX начинается с версии игры: 1.21.11, 1.21.4, 1.21.11-U9. «1.21.1» не должен цеплять «1.21.11». */
function tagIsFor(tag, mc) {
  const t = String(tag || '').replace(/^v/i, '');
  if (t === mc || (t.startsWith(mc) && !/[\d.]/.test(t.charAt(mc.length)))) return true;
  const esc = String(mc || '').replace(/\./g, '\\.');
  return new RegExp('(?:^|[^\\d.])' + esc + '(?:$|[^\\d.])').test(t);
}

function assetMatchesMc(name, mc) {
  const esc = String(mc || '').replace(/\./g, '\\.');
  return new RegExp('(?:^|[^\\d.])' + esc + '(?:$|[^\\d.])').test(String(name || ''));
}

/**
 * Jar мода DarkX из самого свежего релиза под нужную версию игры (1.21.11 или 1.21.4).
 * Проверяет как тег релиза, так и имя .jar ассета (например darkx-visuals-1.21.4-1.3.3.jar).
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
  } catch (_) {
    try {
      rels = await fetchWebReleases(repo, 12, true);
    } catch (__) {
      return null;
    }
  }
  const when = (r) => Date.parse(r.published_at || r.created_at || 0) || 0;
  let value = null;
  const all = (rels || []).filter((r) => !r.draft).sort((a, b) => when(b) - when(a));
  for (const r of all) {
    const jars = (r.assets || []).filter((a) => /\.jar$/i.test(a.name) && !/-(sources|dev|javadoc)\.jar$/i.test(a.name));
    const byName = jars.find((x) => assetMatchesMc(x.name, mc));
    if (byName) {
      value = { url: byName.browser_download_url, file: byName.name, size: byName.size, tag: r.tag_name };
      break;
    }
    if (tagIsFor(r.tag_name, mc)) {
      const a = jars.find((x) => /darkx/i.test(x.name)) || jars[0];
      if (a) { value = { url: a.browser_download_url, file: a.name, size: a.size, tag: r.tag_name }; break; }
    }
  }
  assetMem = { key: repo + '|' + mc, t: Date.now(), value };
  return value;
}

module.exports = { latest, parse, repoOf, clientAsset, tagIsFor, assetMatchesMc, fetchWebReleases };

