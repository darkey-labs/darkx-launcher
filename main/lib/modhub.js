'use strict';
// Моды из каталогов: Modrinth (без ключа) и CurseForge (нужен свой API-ключ).
// Установка в папку mods выбранного профиля, с обязательными зависимостями и реестром установленного.
const fs = require('fs');
const path = require('path');
const http = require('./http');
const P = require('./paths');

const MR = 'https://api.modrinth.com/v2';
const CF = 'https://api.curseforge.com/v1';
const CF_GAME = 432, CF_MODS = 6, CF_FABRIC = 4;
const MR_UA = 'darkey-labs/darkx-launcher/1.0.0 (https://github.com/darkey-labs/darkx)';

const MR_SORT = { relevance: 'relevance', downloads: 'downloads', newest: 'newest', updated: 'updated', follows: 'follows' };
const CF_SORT = { relevance: 1, downloads: 6, newest: 11, updated: 3, follows: 2 };

const RU = {
  adventure: 'Приключения', cursed: 'Проклятое', decoration: 'Декор', economy: 'Экономика', equipment: 'Снаряжение',
  food: 'Еда', 'game-mechanics': 'Механики', library: 'Библиотеки', magic: 'Магия', management: 'Управление',
  minigame: 'Мини-игры', mobs: 'Мобы', optimization: 'Оптимизация', social: 'Социальное', storage: 'Хранение',
  technology: 'Технологии', transportation: 'Транспорт', utility: 'Утилиты', worldgen: 'Генерация мира'
};

const mrHeaders = { 'User-Agent': MR_UA };
const cfHeaders = (key) => ({ 'x-api-key': String(key).replace(/^["'\s]+|["'\s]+$/g, ''), Accept: 'application/json' });

/** Запрос к CurseForge: 401/403 — это почти всегда неверный ключ, говорим об этом прямо. */
async function cfJson(url, key) {
  try {
    return await http.json(url, { headers: cfHeaders(key) });
  } catch (e) {
    if (e.status === 401 || e.status === 403) {
      const err = new Error('CurseForge не принял API-ключ сборки (HTTP ' + e.status + '). Пока доступен только Modrinth.');
      err.code = 'CF_BAD_KEY';
      throw err;
    }
    throw e;
  }
}

function needKey(key) {
  if (!key) {
    const e = new Error('В этой сборке лаунчера CurseForge недоступен. Пока доступен только Modrinth.');
    e.code = 'NO_CF_KEY';
    throw e;
  }
}

// ============================================================ категории

const catCache = {};

async function categories(source, key) {
  if (catCache[source]) return catCache[source];
  let list;
  if (source === 'curseforge') {
    needKey(key);
    const r = await cfJson(CF + '/categories?gameId=' + CF_GAME + '&classId=' + CF_MODS, key);
    list = (r.data || []).filter((c) => c.classId === CF_MODS && c.parentCategoryId === CF_MODS)
      .map((c) => ({ id: String(c.id), name: c.name })).sort((a, b) => a.name.localeCompare(b.name));
  } else {
    const r = await http.json(MR + '/tag/category', { headers: mrHeaders });
    list = r.filter((c) => c.project_type === 'mod' && c.header === 'categories')
      .map((c) => ({ id: c.name, name: RU[c.name] || c.name })).sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  }
  catCache[source] = list;
  return list;
}

// ============================================================ поиск

/**
 * opts: {source, query, categories:[id], client:boolean, server:boolean, mc, loader, sort, offset, limit}
 * Возвращает {total, hits:[{source,id,slug,title,description,icon,author,downloads,categories,url}]}
 */
async function search(opts, key) {
  const limit = Math.max(1, Math.min(50, opts.limit || 20));
  const offset = Math.max(0, opts.offset || 0);
  if (opts.source === 'curseforge') {
    needKey(key);
    const q = ['gameId=' + CF_GAME, 'classId=' + CF_MODS, 'sortField=' + (CF_SORT[opts.sort] || 2), 'sortOrder=desc',
      'index=' + offset, 'pageSize=' + limit];
    if (opts.query) q.push('searchFilter=' + encodeURIComponent(opts.query));
    if (opts.mc) q.push('gameVersion=' + encodeURIComponent(opts.mc));
    if (opts.loader === 'fabric') q.push('modLoaderType=' + CF_FABRIC);
    if (opts.categories && opts.categories.length) q.push('categoryIds=' + encodeURIComponent('[' + opts.categories.slice(0, 10).join(',') + ']'));
    const r = await cfJson(CF + '/mods/search?' + q.join('&'), key);
    return {
      total: (r.pagination && r.pagination.totalCount) || 0,
      hits: (r.data || []).map((m) => ({
        source: 'curseforge', id: String(m.id), slug: m.slug, title: m.name, description: m.summary,
        icon: (m.logo && (m.logo.thumbnailUrl || m.logo.url)) || null,
        author: (m.authors && m.authors[0] && m.authors[0].name) || '',
        downloads: m.downloadCount || 0,
        categories: (m.categories || []).map((c) => c.name).slice(0, 4),
        url: (m.links && m.links.websiteUrl) || null,
        blocked: m.allowModDistribution === false
      }))
    };
  }

  const facets = [['project_type:mod']];
  if (opts.mc) facets.push(['versions:' + opts.mc]);
  if (opts.loader) facets.push(['categories:' + opts.loader]);
  for (const c of opts.categories || []) facets.push(['categories:' + c]);
  const sides = [];
  if (opts.client) sides.push('client_side:required', 'client_side:optional');
  if (opts.server) sides.push('server_side:required', 'server_side:optional');
  if (sides.length) facets.push(sides);
  const q = ['facets=' + encodeURIComponent(JSON.stringify(facets)), 'index=' + (MR_SORT[opts.sort] || 'relevance'),
    'offset=' + offset, 'limit=' + limit];
  if (opts.query) q.push('query=' + encodeURIComponent(opts.query));
  const r = await http.json(MR + '/search?' + q.join('&'), { headers: mrHeaders });
  return {
    total: r.total_hits || 0,
    hits: (r.hits || []).map((m) => ({
      source: 'modrinth', id: m.project_id, slug: m.slug, title: m.title, description: m.description,
      icon: m.icon_url || null, author: m.author || '', downloads: m.downloads || 0,
      categories: (m.display_categories || m.categories || []).filter((c) => RU[c]).map((c) => RU[c]).slice(0, 4),
      url: 'https://modrinth.com/mod/' + (m.slug || m.project_id)
    }))
  };
}

// ============================================================ версии и файлы

async function mrResolve(projectId, mc, loader) {
  const q = '?loaders=' + encodeURIComponent('["' + loader + '"]') + '&game_versions=' + encodeURIComponent('["' + mc + '"]') + '&include_changelog=false';
  const vers = await http.json(MR + '/project/' + encodeURIComponent(projectId) + '/version' + q, { headers: mrHeaders });
  if (!vers.length) {
    const e = new Error('Нет версии этого мода для Minecraft ' + mc + ' (' + loader + ')');
    e.code = 'NO_VERSION';
    throw e;
  }
  const order = { release: 0, beta: 1, alpha: 2 };
  vers.sort((a, b) => (order[a.version_type] - order[b.version_type]) || (new Date(b.date_published) - new Date(a.date_published)));
  const v = vers[0];
  const f = v.files.find((x) => x.primary) || v.files[0];
  return {
    source: 'modrinth', projectId, versionId: v.id, name: v.name, file: f.filename, url: f.url, size: f.size,
    sha1: f.hashes && f.hashes.sha1,
    deps: (v.dependencies || []).filter((d) => d.dependency_type === 'required' && d.project_id).map((d) => ({ projectId: d.project_id, versionId: d.version_id }))
  };
}

async function cfResolve(modId, mc, loader, key) {
  needKey(key);
  const q = '?gameVersion=' + encodeURIComponent(mc) + (loader === 'fabric' ? '&modLoaderType=' + CF_FABRIC : '') + '&pageSize=30';
  const r = await cfJson(CF + '/mods/' + encodeURIComponent(modId) + '/files' + q, key);
  const files = (r.data || []).filter((f) => f.isAvailable !== false);
  if (!files.length) {
    const e = new Error('Нет версии этого мода для Minecraft ' + mc + ' (' + loader + ')');
    e.code = 'NO_VERSION';
    throw e;
  }
  files.sort((a, b) => (a.releaseType - b.releaseType) || (new Date(b.fileDate) - new Date(a.fileDate)));
  const f = files[0];
  if (!f.downloadUrl) {
    const e = new Error('Автор «' + (f.displayName || modId) + '» запретил скачивание вне сайта CurseForge — установи вручную со страницы мода.');
    e.code = 'CF_BLOCKED';
    throw e;
  }
  const sha1 = (f.hashes || []).find((h) => h.algo === 1);
  return {
    source: 'curseforge', projectId: String(modId), versionId: String(f.id), name: f.displayName, file: f.fileName, url: f.downloadUrl,
    size: f.fileLength, sha1: sha1 && sha1.value,
    deps: (f.dependencies || []).filter((d) => d.relationType === 3).map((d) => ({ projectId: String(d.modId) }))
  };
}

// ============================================================ реестр установленного

const regFile = (inst) => P.instance(inst.id, 'darkx-mods.json');

function registry(inst) {
  try { return JSON.parse(fs.readFileSync(regFile(inst), 'utf8')); } catch (_) { return []; }
}

function saveRegistry(inst, list) {
  fs.mkdirSync(P.instance(inst.id), { recursive: true });
  fs.writeFileSync(regFile(inst), JSON.stringify(list, null, 2));
}

/** Установленные моды профиля: только те, что файл которых ещё лежит в mods. */
function installed(inst) {
  const dir = P.instance(inst.id, 'mods');
  const list = registry(inst).filter((r) => fs.existsSync(path.join(dir, r.file)));
  return list;
}

// ============================================================ установка

/**
 * Ставит мод и его обязательные зависимости в mods профиля.
 * onStep(text) — человекочитаемый статус. Возвращает список установленных файлов.
 */
async function install(inst, ref, key, onStep) {
  if (!inst.fabric) throw new Error('В профиле «' + inst.name + '» нет Fabric — моды для него не заработают. Создай профиль с Fabric.');
  const loader = 'fabric';
  const dir = P.instance(inst.id, 'mods');
  fs.mkdirSync(dir, { recursive: true });
  const reg = registry(inst);
  const done = [];
  const seen = new Set();

  const have = (source, id) => reg.find((r) => r.source === source && r.projectId === String(id) && fs.existsSync(path.join(dir, r.file)));

  async function one(source, projectId, title, depth, versionHint) {
    const key2 = source + ':' + projectId;
    if (seen.has(key2)) return;
    seen.add(key2);
    if (have(source, projectId)) return;
    if (depth > 0 && fabricApiPresent(dir, source, projectId)) return;
    onStep && onStep((depth ? 'Зависимость: ' : '') + (title || projectId));
    const r = source === 'curseforge' ? await cfResolve(projectId, inst.mc, loader, key) : await mrResolve(projectId, inst.mc, loader);
    const dest = path.join(dir, r.file);
    if (!(fs.existsSync(dest) && r.size && fs.statSync(dest).size === r.size)) {
      await http.download(r.url, dest, { sha1: r.sha1, size: r.size });
    }
    const idx = reg.findIndex((x) => x.source === source && x.projectId === String(projectId));
    const rec = { source, projectId: String(projectId), title: title || r.name || projectId, file: r.file, versionId: r.versionId, dep: depth > 0, at: Date.now() };
    if (idx >= 0) reg[idx] = rec; else reg.push(rec);
    done.push(r.file);
    if (depth < 3) for (const d of r.deps) await one(source, d.projectId, null, depth + 1);
  }

  await one(ref.source, ref.id, ref.title, 0);
  saveRegistry(inst, reg);
  return done;
}

/** Fabric API ставится лаунчером сам — не дублируем его как зависимость. */
function fabricApiPresent(dir, source, projectId) {
  const isApi = (source === 'modrinth' && projectId === 'P7dR8mSH') || (source === 'curseforge' && String(projectId) === '306612');
  if (!isApi) return false;
  try { return fs.readdirSync(dir).some((n) => /^fabric-api-.*\.jar$/i.test(n)); } catch (_) { return false; }
}

function remove(inst, source, projectId) {
  const dir = P.instance(inst.id, 'mods');
  const reg = registry(inst);
  const i = reg.findIndex((r) => r.source === source && r.projectId === String(projectId));
  if (i < 0) return;
  try { fs.unlinkSync(path.join(dir, reg[i].file)); } catch (_) { /* файла уже нет */ }
  reg.splice(i, 1);
  saveRegistry(inst, reg);
}

module.exports = { categories, search, install, remove, installed, mrResolve, cfResolve };
