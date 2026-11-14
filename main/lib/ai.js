'use strict';
// DarkAI — встроенный ИИ-сборщик модов для DarkX Launcher на базе OpenRouter (deepseek/deepseek-v4.1-flash-1017)
// с поддержкой MCP-инструментов управления сборками и каталогом Modrinth.

const https = require('https');
const modhub = require('./modhub');

const DEFAULT_OPENROUTER_KEY = '';
const DEFAULT_OPENROUTER_MODEL = 'deepseek/deepseek-v4.1-flash-1017';

const SYSTEM_PROMPT = `Ты — DarkAI, встроенный ИИ-архитектор сборок модов в лаунчере DarkX Launcher.
Твоя задача — помогать пользователю собирать сборки модов с одного промпта, искать и фильтровать моды в Modrinth, просматривать существующие сборки, создавать новые сборки и автоматически устанавливать моды.

Ты подключён к ядру DarkX Launcher через интерфейс инструментов MCP (Model Context Protocol).
Когда тебе нужно выполнить действие (узнать список сборок, создать сборку, отфильтровать каталог, найти мод или установить мод), ты ДОЛЖЕН вызвать соответствующую команду MCP.

====================================================================
ОБЯЗАТЕЛЬНЫЕ ПРАВИЛА ФОРМАТИРОВАНИЯ КОМАНД MCP:
====================================================================
1. Каждая команда вызывается внутри блока <mcp>...</mcp> (по одной или несколько команд, каждая с новой строки).
2. ВСЕ строковые значения флагов и аргументов ОБЯЗАТЕЛЬНО заключаются в двойные кавычки "..."!
   Правильно: -name:"FPS Ultra" -mod_link_name:"sodium" -profileid:"darkx"
3. ВСЕ версии Minecraft в командах MCP ОБЯЗАТЕЛЬНО пишутся через нижнее подчёркивание "_", а НЕ через точку "."!
   Правильно: -version:1_21_11 или -version:"1_21_4" (НЕ 1.21.11 и НЕ 1.21.4).
4. Если во флаге передаётся несколько значений (например, несколько категорий в -cat или сторон в -side), они перечисляются ЧЕРЕЗ ЗАПЯТУЮ БЕЗ ПРОБЕЛОВ внутри кавычек:
   Правильно: modrinth:filter -cat:"world_generation,optimization,technology" -side:"client"
5. После вывода блока <mcp>...</mcp> остановись и дождись системного ответа [MCP_RESPONSE], в котором лаунчер вернёт результат выполнения каждой команды (например, ID созданной сборки или точные mod_link_name найденных модов).

====================================================================
ДОСТУПНЫЕ ИНСТРУМЕНТЫ (MCP TOOLS):
====================================================================

1) darkx:instances
   Назначение: Получает список всех сборок пользователя из оперативной памяти лаунчера.
   Формат вызова:
   <mcp>
   darkx:instances
   </mcp>
   Ответ команды содержит для каждой сборки:
   - id (технический ID сборки в памяти лаунчера)
   - name (Название сборки)
   - last_launched (Последняя дата запуска)
   - modloader (Модлоадер: сборка с DX Visuals отображается как "Fabric with integrated DX Mod", обычный Fabric как "Fabric", также "Vanilla", "Forge", "NeoForge")
   - version (Версия Minecraft в формате через "_", например 1_21_11 или 1_21_4)

2) darkx:create_instance -name:"[название]" -mloader:"[модлоадер]", -version:[версия майнкрафт]
   Назначение: Создаёт пользователю новую сборку в DarkX Launcher и возвращает её новый технический ID.
   Аргументы:
   - -name:"[название]" — название новой сборки в кавычках.
   - -mloader:"[модлоадер]" — модлоадер в кавычках ("Fabric with integrated DX Mod", "dx", "fabric", "forge", "neoforge", "vanilla").
   - -version:[версия майнкрафт] — версия Minecraft через "_" (например: -version:1_21_11 или -version:1_21_4).
   Пример вызова:
   <mcp>
   darkx:create_instance -name:"Cyber FPS" -mloader:"Fabric with integrated DX Mod", -version:1_21_11
   </mcp>

3) modrinth:filter [флаги]
   Назначение: Фильтрует выдачу модов в Modrinth по категориям и стороне.
   Поддерживаемые флаги:
   - -cat:"[категории]" — коды категорий через запятую без пробелов:
     world_generation, optimization, technology, magic, adventure, decoration, equipment, food, game_mechanics, library, management, minigame, mobs, social, storage, transportation, utility, cursed, economy
   - -side:"[сторона]" — "client", "server" или "client,server".
   - -version:[версия] — версия Minecraft через "_" (например, -version:1_21_11).
   Пример вызова:
   <mcp>
   modrinth:filter -cat:"world_generation"
   </mcp>

4) modrinth:query "[запрос]"
   Назначение: Ищет моды в Modrinth по названию.
   Пример вызова:
   <mcp>
   modrinth:query "sodium"
   </mcp>

5) modrinth:install -mod_link_name:"[название мода из ссылки]" -profileid:"[id сборки]"
   Назначение: Скачивает и устанавливает мод (по его slug из ссылки Modrinth) в выбранную сборку.
   Пример вызова:
   <mcp>
   modrinth:install -mod_link_name:"sodium" -profileid:"darkx-1-21-4"
   </mcp>

====================================================================
СТИЛЬ ОБЩЕНИЯ С ПОЛЬЗОВАТЕЛЕМ:
====================================================================
- Общайся живым, человечным и дружелюбным языком, без сухого технического мусора. Не выводи пользователю внутренние технические ID сборок или сырой синтаксис флагов, если он сам об этом не спросил.
- В ответах пользователю пиши версии привычно через точку (например, **1.21.11** или **1.21.4**), а внутри команд <mcp>...</mcp> — строго через нижнее подчёркивание (1_21_11).
- Активно используй Markdown для красивого оформления ответа:
  * Выделяй ключевые названия сборок, модов и версий **жирным текстом**.
  * Когда показываешь список подобранных или установленных модов (от 3 и более), оформляй их удобной Markdown-таблицей, например:
    | Мод | Категория | Что делает |
    | --- | --- | --- |
    | **Sodium** | Оптимизация | Повышает FPS и плавность рендера |
- Если запрос пользователя слишком общий (например, «сделай сборку и вставь в мою сборку с друзьями» без указания тематики), сначала проверь его сборки через darkx:instances, скажи что увидел нужную сборку и коротко уточни, какая тематика нужна (хоррор, оптимизация, генерация мира, техно, магия и т.д.).`;

const sessionState = {
  messages: [],
  filter: {
    categories: [],
    client: true,
    server: false,
    version: null,
    loader: 'fabric'
  }
};

let currentRequest = null;
let currentAborted = false;

function abortCurrent() {
  currentAborted = true;
  if (currentRequest) {
    try {
      if (typeof currentRequest.abort === 'function') currentRequest.abort();
      else if (typeof currentRequest.destroy === 'function') currentRequest.destroy(new Error('ABORTED'));
    } catch (_) {}
    currentRequest = null;
  }
}

function dotVersion(verStr) {
  if (!verStr) return '';
  return String(verStr).trim().replace(/^["']|["']$/g, '').replace(/_/g, '.');
}

function underscoreVersion(verStr) {
  if (!verStr) return '';
  return String(verStr).trim().replace(/\./g, '_');
}

function formatModloaderForMcp(inst, darkxVersions = []) {
  const orig = String(inst.loaderOrigin || '').toLowerCase();
  const isDx = orig === 'dx' || (inst.kind === 'standard') || (inst.fabric && inst.darkx !== false && (!darkxVersions.length || darkxVersions.includes(inst.mc)));
  if (isDx) return 'Fabric with integrated DX Mod';
  if (orig === 'forge') return 'Forge';
  if (orig === 'neoforge') return 'NeoForge';
  if (inst.fabric || orig === 'fabric') return 'Fabric';
  return 'Vanilla';
}

function formatShortLoader(inst, darkxVersions = []) {
  const orig = String(inst.loaderOrigin || '').toLowerCase();
  const isDx = orig === 'dx' || (inst.kind === 'standard') || (inst.fabric && inst.darkx !== false && (!darkxVersions.length || darkxVersions.includes(inst.mc)));
  if (isDx) return 'DX Visuals';
  if (orig === 'forge') return 'Forge';
  if (orig === 'neoforge') return 'NeoForge';
  if (inst.fabric || orig === 'fabric') return 'Fabric';
  return 'Vanilla';
}

function formatLastPlayedForMcp(ts) {
  if (!ts) return 'Никогда не запускалась';
  const d = new Date(ts);
  if (isNaN(d.getTime())) return 'Никогда не запускалась';
  return d.toISOString().replace('T', ' ').slice(0, 19);
}

function parseFlags(argsStr) {
  const flags = {};
  const flagRegex = /-([a-zA-Z0-9_]+):(?:"([^"]*)"|'([^']*)'|([^\s,]+))/g;
  let m;
  while ((m = flagRegex.exec(argsStr)) !== null) {
    const key = m[1].toLowerCase();
    const val = m[2] !== undefined ? m[2] : m[3] !== undefined ? m[3] : m[4];
    flags[key] = val;
  }
  return flags;
}

function extractMcpCommands(text) {
  if (!text) return [];
  const commands = [];
  const blockRegex = /<mcp>([\s\S]*?)<\/mcp>|```(?:mcp|bash|sh|text)?\s*([\s\S]*?)```/gi;
  let match;

  while ((match = blockRegex.exec(text)) !== null) {
    const content = match[1] !== undefined ? match[1] : match[2];
    const lines = String(content || '').split(/\r?\n/);
    for (const rawLine of lines) {
      const line = rawLine.trim().replace(/^[>$#*-]\s*/, '');
      if (/^(modrinth:query|modrinth:filter|modrinth:install|darkx:instances|darkx:create_instance)\b/i.test(line)) {
        commands.push(line);
      }
    }
  }

  const allLines = String(text).split(/\r?\n/);
  for (const rawLine of allLines) {
    const line = rawLine.trim().replace(/^`+|`+$/g, '').trim();
    if (/^(modrinth:query|modrinth:filter|modrinth:install|darkx:instances|darkx:create_instance)\b/i.test(line)) {
      if (!commands.includes(line)) {
        commands.push(line);
      }
    }
  }

  return commands;
}

function cleanAssistantVisibleText(text) {
  if (!text) return '';
  return String(text)
    .replace(/<mcp>[\s\S]*?<\/mcp>/gi, '')
    .replace(/```mcp[\s\S]*?```/gi, '')
    .split(/\r?\n/)
    .filter((ln) => !/^\s*`?(modrinth:query|modrinth:filter|modrinth:install|darkx:instances|darkx:create_instance)\b/i.test(ln))
    .join('\n')
    .trim();
}

function humanLabelForCommand(rawCmd) {
  const cmd = String(rawCmd || '').trim().toLowerCase();
  if (cmd.startsWith('darkx:instances')) return 'DarkX: Получен список сборок';
  if (cmd.startsWith('darkx:create_instance')) return 'DarkX: Создана новая сборка';
  if (cmd.startsWith('modrinth:filter')) return 'Modrinth: Установлен фильтр модов';
  if (cmd.startsWith('modrinth:query')) return 'Modrinth: Поиск модов в каталоге';
  if (cmd.startsWith('modrinth:install')) return 'Modrinth: Установка мода в сборку';
  return 'DarkX: Выполнение команды';
}

async function executeCommand(rawCmd, ctx) {
  const cmdLine = String(rawCmd || '').trim();
  const firstSpace = cmdLine.search(/\s/);
  const toolName = (firstSpace === -1 ? cmdLine : cmdLine.slice(0, firstSpace)).toLowerCase();
  const rest = firstSpace === -1 ? '' : cmdLine.slice(firstSpace + 1).trim();
  const flags = parseFlags(rest);
  const humanLabel = humanLabelForCommand(cmdLine);

  try {
    if (toolName === 'darkx:instances') {
      const insts = ctx.getInstances() || [];
      const rows = insts.map((i) => ({
        id: i.id,
        name: i.name,
        last_launched: formatLastPlayedForMcp(i.lastPlayed),
        modloader: formatModloaderForMcp(i, ctx.darkxVersions),
        version: underscoreVersion(i.mc),
        version_dot: i.mc,
        installed_mods: (modhub.installed(i) || []).length
      }));
      return {
        tool: 'darkx:instances',
        command: cmdLine,
        humanLabel: 'DarkX: Получен список сборок',
        ok: true,
        summary: 'DarkX: Получен список сборок',
        data: rows,
        textForAi: JSON.stringify({ status: 'ok', count: rows.length, instances: rows }, null, 2)
      };
    }

    if (toolName === 'darkx:create_instance') {
      const name = (flags.name || 'AI Modpack').trim();
      const rawLoader = (flags.mloader || flags.loader || 'dx').trim().toLowerCase();
      const rawVer = flags.version || flags.ver || '1_21_11';
      const mc = dotVersion(rawVer) || '1.21.11';

      let loaderType = 'dx';
      if (rawLoader.includes('integrated dx') || rawLoader === 'dx' || rawLoader === 'darkx' || rawLoader === 'dx_visuals') {
        loaderType = 'dx';
      } else if (rawLoader.includes('neoforge')) {
        loaderType = 'neoforge';
      } else if (rawLoader.includes('forge')) {
        loaderType = 'forge';
      } else if (rawLoader.includes('vanilla')) {
        loaderType = 'vanilla';
      } else if (rawLoader.includes('fabric')) {
        loaderType = 'fabric';
      }

      const created = await ctx.createInstance({
        name,
        mc,
        loader: loaderType,
        fabric: loaderType === 'dx' || loaderType === 'fabric',
        darkx: loaderType === 'dx'
      });

      const resPayload = {
        status: 'ok',
        profileid: created.id,
        name: created.name,
        modloader: formatModloaderForMcp(created, ctx.darkxVersions),
        version: underscoreVersion(created.mc)
      };

      return {
        tool: 'darkx:create_instance',
        command: cmdLine,
        humanLabel: 'DarkX: Создана сборка «' + created.name + '»',
        ok: true,
        summary: 'DarkX: Создана сборка «' + created.name + '»',
        touchedInstance: {
          id: created.id,
          name: created.name,
          mc: created.mc,
          loaderLabel: formatShortLoader(created, ctx.darkxVersions),
          icon: created.icon || null
        },
        data: resPayload,
        textForAi: JSON.stringify(resPayload, null, 2)
      };
    }

    if (toolName === 'modrinth:filter') {
      if (flags.reset === 'true' || flags.reset === '1') {
        sessionState.filter = { categories: [], client: true, server: false, version: null, loader: 'fabric' };
      }
      if (flags.cat || flags.category || flags.categories) {
        const rawCats = String(flags.cat || flags.category || flags.categories)
          .split(',')
          .map((s) => s.trim().replace(/^["']|["']$/g, ''))
          .filter(Boolean);
        sessionState.filter.categories = rawCats.map(modhub.normalizeCategory);
      }
      if (flags.side) {
        const sides = String(flags.side)
          .toLowerCase()
          .split(',')
          .map((s) => s.trim().replace(/^["']|["']$/g, ''))
          .filter(Boolean);
        if (sides.includes('both') || (sides.includes('client') && sides.includes('server'))) {
          sessionState.filter.client = true;
          sessionState.filter.server = true;
        } else if (sides.includes('server')) {
          sessionState.filter.client = false;
          sessionState.filter.server = true;
        } else {
          sessionState.filter.client = true;
          sessionState.filter.server = false;
        }
      }
      if (flags.version || flags.ver) {
        sessionState.filter.version = dotVersion(flags.version || flags.ver);
      }
      if (flags.mloader || flags.loader) {
        const l = String(flags.mloader || flags.loader).toLowerCase();
        sessionState.filter.loader = l.includes('neoforge') ? 'neoforge' : l.includes('forge') ? 'forge' : 'fabric';
      }

      const activeInst = ctx.getSelectedInstance();
      const targetMc = sessionState.filter.version || (activeInst ? activeInst.mc : '1.21.4');
      const searchRes = await modhub.search({
        source: 'modrinth',
        query: flags.query || '',
        categories: sessionState.filter.categories,
        client: sessionState.filter.client,
        server: sessionState.filter.server,
        mc: targetMc,
        loader: sessionState.filter.loader || 'fabric',
        sort: 'downloads',
        limit: 12
      });

      const compactHits = (searchRes.hits || []).map((h) => ({
        title: h.title,
        mod_link_name: h.slug,
        project_id: h.id,
        downloads: h.downloads,
        categories: h.rawCategories || h.categories,
        client_side: h.clientSide,
        server_side: h.serverSide,
        url: h.url,
        description: String(h.description || '').slice(0, 140)
      }));

      const resPayload = {
        status: 'ok',
        active_filters: {
          categories: sessionState.filter.categories,
          side: sessionState.filter.client && sessionState.filter.server ? 'client,server' : sessionState.filter.server ? 'server' : 'client',
          version: underscoreVersion(targetMc),
          loader: sessionState.filter.loader
        },
        total_matching: searchRes.total,
        mods: compactHits
      };

      return {
        tool: 'modrinth:filter',
        command: cmdLine,
        humanLabel: 'Modrinth: Установлен фильтр модов',
        ok: true,
        summary: 'Modrinth: Установлен фильтр модов',
        data: resPayload,
        textForAi: JSON.stringify(resPayload, null, 2)
      };
    }

    if (toolName === 'modrinth:query') {
      let queryText = flags.query || flags.q || '';
      if (!queryText) {
        const quoted = rest.match(/"([^"]+)"|'([^']+)'/);
        queryText = quoted ? (quoted[1] || quoted[2]) : rest.replace(/-[a-zA-Z0-9_]+:(?:"[^"]*"|'[^']*'|[^\s]+)/g, '').trim();
      }
      const activeInst = ctx.getSelectedInstance();
      const targetMc = flags.version ? dotVersion(flags.version) : (sessionState.filter.version || (activeInst ? activeInst.mc : '1.21.4'));
      const searchRes = await modhub.search({
        source: 'modrinth',
        query: queryText,
        categories: sessionState.filter.categories,
        client: sessionState.filter.client,
        server: sessionState.filter.server,
        mc: targetMc,
        loader: sessionState.filter.loader || 'fabric',
        sort: 'relevance',
        limit: 10
      });

      const compactHits = (searchRes.hits || []).map((h) => ({
        title: h.title,
        mod_link_name: h.slug,
        project_id: h.id,
        downloads: h.downloads,
        categories: h.rawCategories || h.categories,
        url: h.url,
        description: String(h.description || '').slice(0, 140)
      }));

      const resPayload = {
        status: 'ok',
        query: queryText,
        version: underscoreVersion(targetMc),
        total: searchRes.total,
        mods: compactHits
      };

      return {
        tool: 'modrinth:query',
        command: cmdLine,
        humanLabel: 'Modrinth: Поиск «' + queryText + '»',
        ok: true,
        summary: 'Modrinth: Поиск «' + queryText + '»',
        data: resPayload,
        textForAi: JSON.stringify(resPayload, null, 2)
      };
    }

    if (toolName === 'modrinth:install') {
      const modSlug = (flags.mod_link_name || flags.mod || flags.slug || '').trim();
      const profileId = (flags.profileid || flags.profile || flags.id || '').trim();
      if (!modSlug) throw new Error('Не указан флаг -mod_link_name:"[название мода из ссылки]"');

      const insts = ctx.getInstances() || [];
      const targetInst = (profileId && insts.find((i) => i.id.toLowerCase() === profileId.toLowerCase() || i.name.toLowerCase() === profileId.toLowerCase()))
        || ctx.getSelectedInstance()
        || insts[0];

      if (!targetInst) throw new Error('Сборка с ID "' + profileId + '" не найдена');

      const files = await ctx.installMod(targetInst, {
        source: 'modrinth',
        id: modSlug,
        slug: modSlug,
        title: modSlug
      });

      const resPayload = {
        status: 'ok',
        mod_link_name: modSlug,
        profileid: targetInst.id,
        profile_name: targetInst.name,
        version: underscoreVersion(targetInst.mc),
        installed_files: files
      };

      return {
        tool: 'modrinth:install',
        command: cmdLine,
        humanLabel: 'Modrinth: Установлен мод «' + modSlug + '»',
        ok: true,
        summary: 'Modrinth: Установлен мод «' + modSlug + '»',
        touchedInstance: {
          id: targetInst.id,
          name: targetInst.name,
          mc: targetInst.mc,
          loaderLabel: formatShortLoader(targetInst, ctx.darkxVersions),
          icon: targetInst.icon || null
        },
        data: resPayload,
        textForAi: JSON.stringify(resPayload, null, 2)
      };
    }

    return {
      tool: toolName,
      command: cmdLine,
      humanLabel,
      ok: false,
      summary: 'Неизвестная команда: ' + toolName,
      data: { error: 'Unknown MCP tool: ' + toolName },
      textForAi: JSON.stringify({ status: 'error', error: 'Unknown MCP tool: ' + toolName })
    };
  } catch (err) {
    const msg = err && err.message ? err.message : String(err);
    return {
      tool: toolName,
      command: cmdLine,
      humanLabel,
      ok: false,
      summary: 'Ошибка: ' + msg,
      data: { error: msg },
      textForAi: JSON.stringify({ status: 'error', command: cmdLine, error: msg })
    };
  }
}

const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const FALLBACK_MODELS = [
  DEFAULT_OPENROUTER_MODEL,
  'deepseek/deepseek-chat-v3-0324',
  'deepseek/deepseek-chat'
];

function getElectronNet() {
  if (!process.versions || !process.versions.electron) return null;
  try {
    const el = require('electron');
    return el && el.net && (el.app ? el.app.isReady() : true) ? el.net : null;
  } catch (_) {
    return null;
  }
}

function isCertError(err) {
  const msg = String((err && (err.code || err.message)) || '');
  return /SELF_SIGNED_CERT|UNABLE_TO_VERIFY|CERT_|certificate/i.test(msg);
}

function sendViaHttps(url, headers, bodyStr, allowInsecureTls) {
  return new Promise((resolve, reject) => {
    if (currentAborted) {
      const e = new Error('Остановлено пользователем');
      e.code = 'ABORTED';
      return reject(e);
    }
    const req = https.request(url, {
      method: 'POST',
      headers: Object.assign({}, headers, {
        'Content-Length': Buffer.byteLength(bodyStr)
      }),
      timeout: 45000,
      rejectUnauthorized: !allowInsecureTls
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        currentRequest = null;
        resolve({ status: res.statusCode || 0, text: Buffer.concat(chunks).toString('utf8') });
      });
      res.on('error', (err) => {
        currentRequest = null;
        reject(err);
      });
    });
    currentRequest = { abort: () => { try { req.destroy(new Error('ABORTED')); } catch (_) {} } };
    req.on('timeout', () => req.destroy(new Error('Превышено время ожидания ответа от нейросети')));
    req.on('error', (err) => {
      currentRequest = null;
      if (currentAborted || (err && err.message === 'ABORTED')) {
        const e = new Error('Остановлено пользователем');
        e.code = 'ABORTED';
        return reject(e);
      }
      if (!allowInsecureTls && isCertError(err)) {
        return sendViaHttps(url, headers, bodyStr, true).then(resolve, reject);
      }
      reject(err);
    });
    req.write(bodyStr);
    req.end();
  });
}

function sendViaElectronNet(net, url, headers, bodyStr) {
  return new Promise((resolve, reject) => {
    if (currentAborted) {
      const e = new Error('Остановлено пользователем');
      e.code = 'ABORTED';
      return reject(e);
    }
    let done = false;
    const req = net.request({ method: 'POST', url, redirect: 'follow' });
    for (const [k, v] of Object.entries(headers)) req.setHeader(k, v);
    const finish = (fn, val) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      currentRequest = null;
      fn(val);
    };
    const timer = setTimeout(() => {
      try { req.abort(); } catch (_) {}
      finish(reject, new Error('Превышено время ожидания ответа от нейросети'));
    }, 45000);
    currentRequest = { abort: () => { try { req.abort(); } catch (_) {} finish(reject, Object.assign(new Error('Остановлено пользователем'), { code: 'ABORTED' })); } };
    req.on('response', (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => finish(resolve, { status: res.statusCode || 0, text: Buffer.concat(chunks).toString('utf8') }));
      res.on('error', (err) => finish(reject, err));
    });
    req.on('error', (err) => {
      if (currentAborted) {
        const e = new Error('Остановлено пользователем');
        e.code = 'ABORTED';
        return finish(reject, e);
      }
      // Если антивирус подменяет сертификат и Chromium отклонил цепочку — повторяем через https с допуском сертификата
      if (isCertError(err)) {
        done = true;
        clearTimeout(timer);
        currentRequest = null;
        return sendViaHttps(url, headers, bodyStr, true).then(resolve, reject);
      }
      finish(reject, err);
    });
    req.write(bodyStr);
    req.end();
  });
}

async function callOpenRouter(messages, apiKey, model) {
  const key = String(apiKey || DEFAULT_OPENROUTER_KEY).trim();
  const primaryModel = String(model || DEFAULT_OPENROUTER_MODEL).trim();
  const modelsToTry = [primaryModel, ...FALLBACK_MODELS.filter((m) => m !== primaryModel)];
  const url = 'https://openrouter.ai/api/v1/chat/completions';
  const headers = {
    'Authorization': 'Bearer ' + key,
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'User-Agent': BROWSER_UA,
    'HTTP-Referer': 'https://github.com/darkey-labs/darkx-launcher',
    'X-Title': 'DarkX Launcher DarkAI'
  };

  let lastError = null;
  for (let i = 0; i < modelsToTry.length; i++) {
    if (currentAborted) {
      const e = new Error('Остановлено пользователем');
      e.code = 'ABORTED';
      throw e;
    }
    const candidateModel = modelsToTry[i];
    const payload = JSON.stringify({
      model: candidateModel,
      messages,
      temperature: 0.35,
      max_tokens: 2048,
      provider: { allow_fallbacks: true }
    });

    try {
      const net = getElectronNet();
      const res = net
        ? await sendViaElectronNet(net, url, headers, payload)
        : await sendViaHttps(url, headers, payload, false);

      if (res.status >= 200 && res.status < 300) {
        let parsed;
        try {
          parsed = JSON.parse(res.text);
        } catch (e) {
          throw new Error('Ошибка разбора ответа OpenRouter: ' + e.message);
        }
        const msg = parsed && parsed.choices && parsed.choices[0] && parsed.choices[0].message;
        if (!msg) throw new Error('Пустой ответ от OpenRouter');
        return String(msg.content || '').trim();
      }

      // При 403 (Access denied by security policy / региональный блок провайдера) или 429/5xx пробуем следующую модель/провайдер
      lastError = new Error('OpenRouter HTTP ' + res.status + ': ' + String(res.text || '').slice(0, 240));
      if ((res.status === 403 || res.status === 429 || res.status >= 500) && i < modelsToTry.length - 1) {
        continue;
      }
      throw lastError;
    } catch (err) {
      if (err && err.code === 'ABORTED') throw err;
      lastError = err;
      if (i < modelsToTry.length - 1 && /HTTP (403|429|5\d\d)|Access denied|security policy/i.test(String(err.message || ''))) {
        continue;
      }
      throw err;
    }
  }
  throw lastError || new Error('Не удалось получить ответ от OpenRouter');
}

function detectReferencedInstance(text, insts, steps, darkxVersions, selectedInst) {
  for (let i = steps.length - 1; i >= 0; i--) {
    if (steps[i].touchedInstance) return steps[i].touchedInstance;
  }
  const low = String(text || '').toLowerCase();
  const sorted = [...(insts || [])].sort((a, b) => String(b.name || '').length - String(a.name || '').length);
  for (const inst of sorted) {
    const nm = String(inst.name || '').trim().toLowerCase();
    if (nm.length >= 4 && low.includes(nm)) {
      return {
        id: inst.id,
        name: inst.name,
        mc: inst.mc,
        loaderLabel: formatShortLoader(inst, darkxVersions),
        icon: inst.icon || null
      };
    }
  }
  if (selectedInst) {
    return {
      id: selectedInst.id,
      name: selectedInst.name,
      mc: selectedInst.mc,
      loaderLabel: formatShortLoader(selectedInst, darkxVersions),
      icon: selectedInst.icon || null
    };
  }
  return null;
}

async function chat(userText, ctx) {
  const cleanUser = String(userText || '').trim();
  if (!cleanUser) throw new Error('Введи сообщение для DarkAI');

  currentAborted = false;
  const startedAt = Date.now();

  sessionState.messages.push({
    role: 'user',
    content: cleanUser,
    at: startedAt
  });

  const insts = ctx.getInstances() || [];
  const selected = ctx.getSelectedInstance();
  const contextHeader = `[Текущий контекст лаунчера: активная сборка = ${selected ? `"${selected.name}" (ID: "${selected.id}", MC: ${underscoreVersion(selected.mc)}, Modloader: "${formatModloaderForMcp(selected, ctx.darkxVersions)}")` : 'не выбрана'}, всего сборок в памяти = ${insts.length}]`;

  const apiMessages = [
    { role: 'system', content: SYSTEM_PROMPT + '\n\n' + contextHeader }
  ];

  for (const m of sessionState.messages.slice(-16)) {
    if (m.role === 'user') {
      apiMessages.push({ role: 'user', content: m.content });
    } else if (m.role === 'assistant') {
      apiMessages.push({ role: 'assistant', content: m.rawContent || m.content });
    } else if (m.role === 'mcp') {
      apiMessages.push({ role: 'user', content: m.content });
    }
  }

  const executedSteps = [];
  let finalVisibleReply = '';
  let lastRawReply = '';

  for (let turn = 0; turn < 6; turn++) {
    if (currentAborted) {
      const e = new Error('Остановлено пользователем');
      e.code = 'ABORTED';
      throw e;
    }
    ctx.onProgress && ctx.onProgress({
      phase: turn === 0 ? 'thinking' : 'tool',
      text: turn === 0 ? '' : (executedSteps[executedSteps.length - 1] ? executedSteps[executedSteps.length - 1].humanLabel : '')
    });

    const rawReply = await callOpenRouter(apiMessages, ctx.openrouterKey, ctx.openrouterModel);
    lastRawReply = rawReply;
    const cmds = extractMcpCommands(rawReply);
    const visiblePart = cleanAssistantVisibleText(rawReply);
    if (visiblePart) finalVisibleReply = visiblePart;

    apiMessages.push({ role: 'assistant', content: rawReply });

    if (!cmds.length) {
      break;
    }

    const turnResults = [];
    for (const cmd of cmds) {
      if (currentAborted) {
        const e = new Error('Остановлено пользователем');
        e.code = 'ABORTED';
        throw e;
      }
      const label = humanLabelForCommand(cmd);
      ctx.onProgress && ctx.onProgress({ phase: 'tool', text: label, command: cmd });
      const res = await executeCommand(cmd, ctx);
      executedSteps.push(res);
      ctx.onStep && ctx.onStep(res);
      turnResults.push(`[MCP_RESPONSE command="${cmd}"]\n${res.textForAi}\n[/MCP_RESPONSE]`);
    }

    const mcpFeedback = turnResults.join('\n\n');
    apiMessages.push({ role: 'user', content: mcpFeedback });
    sessionState.messages.push({
      role: 'mcp',
      content: mcpFeedback,
      at: Date.now()
    });
  }

  if (!finalVisibleReply && lastRawReply) {
    finalVisibleReply = cleanAssistantVisibleText(lastRawReply) || 'Готово! Сборка обновлена.';
  }

  const durationSec = Math.max(1, Math.round((Date.now() - startedAt) / 1000));
  const updatedInsts = ctx.getInstances() || [];
  const targetInstance = detectReferencedInstance(finalVisibleReply + ' ' + cleanUser, updatedInsts, executedSteps, ctx.darkxVersions, ctx.getSelectedInstance());

  sessionState.messages.push({
    role: 'assistant',
    content: finalVisibleReply,
    rawContent: lastRawReply,
    steps: executedSteps,
    durationSec,
    targetInstance,
    at: Date.now()
  });

  return {
    reply: finalVisibleReply,
    steps: executedSteps,
    durationSec,
    targetInstance,
    history: publicHistory()
  };
}

function publicHistory() {
  return sessionState.messages
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => ({
      role: m.role,
      content: m.content,
      steps: m.steps || [],
      durationSec: m.durationSec || null,
      targetInstance: m.targetInstance || null,
      at: m.at
    }));
}

function clearHistory() {
  abortCurrent();
  sessionState.messages = [];
  sessionState.filter = { categories: [], client: true, server: false, version: null, loader: 'fabric' };
  return [];
}

function getSystemPrompt() {
  return SYSTEM_PROMPT;
}

module.exports = {
  SYSTEM_PROMPT,
  DEFAULT_OPENROUTER_KEY,
  DEFAULT_OPENROUTER_MODEL,
  FALLBACK_MODELS,
  chat,
  callOpenRouter,
  isCertError,
  abortCurrent,
  publicHistory,
  clearHistory,
  getSystemPrompt,
  executeCommand,
  extractMcpCommands,
  parseFlags,
  humanLabelForCommand
};
