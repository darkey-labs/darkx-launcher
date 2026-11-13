'use strict';
/* Вкладка «Моды»: каталог Modrinth / CurseForge, фильтры, профиль в правой панели и DarkAI — сборщик модов с одного промпта (DeepSeek MCP). */

const MODS = {
  source: 'modrinth',
  query: '',
  cats: new Set(),
  client: true,
  server: false,
  sort: 'relevance',
  catList: {},      // source → [{id,name}]
  hits: [],
  total: 0,
  loading: false,
  err: null,
  tab: 'catalog',   // catalog | installed | ai
  installed: [],    // реестр выбранного профиля
  busy: new Map(),  // "source:id" → текст шага
  req: 0,
  timer: null,
  // DarkAI (DeepSeek v4.1 Flash MCP)
  aiHistory: [],
  aiBusy: false,
  aiPhase: 'thinking', // 'thinking' | 'tool'
  aiStatus: '',
  aiLiveSteps: [],
  aiInput: '',
  aiHooked: false
};

const SORTS = [['relevance', 'По релевантности'], ['downloads', 'По скачиваниям'], ['follows', 'По подпискам'], ['newest', 'Новые'], ['updated', 'Недавно обновлённые']];
const modKey = (m) => m.source + ':' + (m.projectId || m.id);

function modsInstance() {
  return S.instances.find((i) => i.id === S.settings.modsInstance) || S.instances.find((i) => i.id === S.settings.selectedInstance) || S.instances[0] || null;
}

function isInstalled(m) {
  return MODS.installed.find((r) => r.source === m.source && (r.projectId === String(m.id) || r.slug === String(m.slug)));
}

async function modsRefreshInstalled() {
  const inst = modsInstance();
  MODS.installed = inst ? (await act(api.modInstalled, inst.id)) || [] : [];
}

function modsNeedKey() {
  return MODS.source === 'curseforge' && !S.effective.curseforge;
}

function ensureAiEventsHooked() {
  if (MODS.aiHooked) return;
  MODS.aiHooked = true;
  if (api.onAiProgress) {
    api.onAiProgress((p) => {
      if (!p) return;
      if (p.phase === 'thinking') {
        if (!MODS.aiLiveSteps.length) {
          MODS.aiPhase = 'thinking';
        }
      } else if (p.phase === 'tool') {
        MODS.aiPhase = 'tool';
        MODS.aiStatus = p.text || 'Выполняю команду…';
      } else if (p.text) {
        MODS.aiStatus = p.text;
      }
      if (page === 'mods' && MODS.tab === 'ai') modsUpdateAiLiveRow();
    });
  }
  if (api.onAiStep) {
    api.onAiStep((step) => {
      if (step) {
        MODS.aiLiveSteps.push(step);
        MODS.aiPhase = 'tool';
        MODS.aiStatus = step.humanLabel || step.summary || 'Команда выполнена';
      }
      if (page === 'mods' && MODS.tab === 'ai') modsUpdateAiLiveRow();
    });
  }
}

async function modsSearch(append) {
  if (modsNeedKey()) { MODS.hits = []; MODS.total = 0; MODS.err = null; modsPaintList(); return; }
  const my = ++MODS.req;
  MODS.loading = true;
  MODS.err = null;
  if (!append) { MODS.hits = []; MODS.total = 0; }
  modsPaintList();
  const inst = modsInstance();
  const r = await api.modSearch({
    source: MODS.source, query: MODS.query.trim(), categories: [...MODS.cats],
    client: MODS.client, server: MODS.server, sort: MODS.sort, offset: append ? MODS.hits.length : 0, limit: 20,
    instance: inst ? inst.id : null, mc: inst ? inst.mc : S.defaultMc
  });
  if (my !== MODS.req) return;
  MODS.loading = false;
  if (!r.ok) { MODS.err = r.error; } else {
    MODS.hits = append ? MODS.hits.concat(r.data.hits) : r.data.hits;
    MODS.total = r.data.total;
  }
  modsPaintList();
}

function modsLater() {
  clearTimeout(MODS.timer);
  MODS.timer = setTimeout(() => modsSearch(false), 350);
}

async function modsLoadCats() {
  if (MODS.catList[MODS.source] || modsNeedKey()) return;
  const r = await api.modCategories(MODS.source);
  if (r.ok) { MODS.catList[MODS.source] = r.data; if (page === 'mods' && MODS.tab !== 'ai') modsPaintSide(); }
}

// ------------------------------------------------------------------ установка

function pickProfile(then) {
  const rows = S.instances.map((i) => {
    const ok = !!i.fabric;
    return h('button', { class: 'card p-3 flex items-center gap-3 text-left ' + (ok ? 'hover:bg-raise cursor-pointer' : 'opacity-40 cursor-default'),
      disabled: !ok, onclick: async () => {
        closeModal();
        const s = await act(api.saveSettings, { modsInstance: i.id });
        if (s) { S = s; await modsRefreshInstalled(); renderPage(); then && then(i); }
      } },
    h('div', { class: 'w-9 h-9 shrink-0', html: LOGO }),
    h('div', { class: 'flex-1 min-w-0' }, h('div', { class: 'font-bold truncate' }, i.name),
      h('div', { class: 'text-[11px] text-dim' }, 'Minecraft ' + i.mc + (i.fabric ? ' · Fabric' : ' · без Fabric — моды не заработают'))));
  });
  modal('В какой профиль ставить?', h('div', { class: 'flex flex-col gap-2 max-h-[50vh] overflow-y-auto' }, rows), (c) => [h('button', { class: 'btn', onclick: c }, 'Отмена')]);
}

function modsInstall(m) {
  const inst = modsInstance();
  if (!inst) { pickProfile(() => modsInstall(m)); return; }
  if (!inst.fabric && inst.loaderOrigin !== 'forge' && inst.loaderOrigin !== 'neoforge') {
    toast('В профиле «' + inst.name + '» нет модлоадера — выбери другой профиль', 'bad');
    return;
  }
  const k = modKey(m);
  if (MODS.busy.has(k)) return;
  MODS.busy.set(k, 'Скачиваю…');
  modsPaintList();
  api.modInstall(inst.id, { source: m.source, id: m.id, slug: m.slug, title: m.title }).then(async (r) => {
    MODS.busy.delete(k);
    if (!r.ok) toast(r.error, 'bad');
    else {
      MODS.installed = r.data.installed;
      toast(m.title + ' установлен' + (r.data.files.length > 1 ? ' (+' + (r.data.files.length - 1) + ' завис.)' : ''), 'ok');
    }
    if (page === 'mods') { modsPaintList(); modsPaintSide(); }
  });
}

async function modsRemove(rec) {
  const inst = modsInstance();
  if (!inst) return;
  const list = await act(api.modRemove, inst.id, rec.source, rec.projectId);
  if (list) { MODS.installed = list; toast('«' + rec.title + '» удалён', 'ok'); modsPaintList(); modsPaintSide(); }
}

// ------------------------------------------------------------------ Безопасный DOM Markdown рендерер (жирный, списки, код, таблицы)

function parseInlineMarkdown(text) {
  const frag = document.createDocumentFragment();
  const str = String(text || '');
  const re = /(`[^`\n]+`|\*\*[^*\n]+\*\*|__[^_\n]+__|\*[^*\n]+\*|\[[^\]]+\]\([^)]+\))/g;
  let lastIdx = 0;
  let m;
  while ((m = re.exec(str)) !== null) {
    if (m.index > lastIdx) {
      frag.append(document.createTextNode(str.slice(lastIdx, m.index)));
    }
    const tok = m[0];
    if (tok.startsWith('`') && tok.endsWith('`')) {
      frag.append(h('code', {
        class: 'darkai-inline-code',
        style: 'font-family:ui-monospace,Consolas,monospace;font-size:12px;padding:2px 6px;border-radius:6px;background:#16161A;border:1px solid #26262C;color:rgb(var(--accent))'
      }, tok.slice(1, -1)));
    } else if ((tok.startsWith('**') && tok.endsWith('**')) || (tok.startsWith('__') && tok.endsWith('__'))) {
      frag.append(h('strong', { class: 'font-bold text-white', style: 'font-weight:700;color:#FFFFFF' }, parseInlineMarkdown(tok.slice(2, -2))));
    } else if (tok.startsWith('*') && tok.endsWith('*')) {
      frag.append(h('em', { class: 'italic text-ink/90', style: 'font-style:italic' }, parseInlineMarkdown(tok.slice(1, -1))));
    } else if (tok.startsWith('[')) {
      const lm = tok.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      if (lm) {
        const url = lm[2];
        frag.append(h('a', {
          href: '#',
          class: 'text-accent underline hover:opacity-85 cursor-pointer',
          style: 'color:rgb(var(--accent));text-decoration:underline;cursor:pointer',
          onclick: (e) => { e.preventDefault(); if (/^https?:\/\//i.test(url) && api.external) api.external(url); }
        }, lm[1]));
      } else {
        frag.append(document.createTextNode(tok));
      }
    }
    lastIdx = re.lastIndex;
  }
  if (lastIdx < str.length) {
    frag.append(document.createTextNode(str.slice(lastIdx)));
  }
  return frag;
}

function splitTableCells(line) {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|')) s = s.slice(0, -1);
  return s.split('|').map((c) => c.trim());
}

function isTableSeparatorLine(line) {
  const s = line.trim();
  if (!s.includes('|')) return false;
  const cells = splitTableCells(s);
  if (!cells.length) return false;
  return cells.every((c) => /^:?-{2,}:?$/.test(c));
}

function renderMarkdownDom(mdText) {
  const root = h('div', {
    class: 'darkai-md flex flex-col gap-2.5',
    style: 'font-size:13.5px;line-height:1.58;color:#E4E4E2;user-select:text;-webkit-user-select:text'
  });
  const raw = String(mdText || '').replace(/\r\n/g, '\n').trim();
  if (!raw) return root;

  const lines = raw.split('\n');
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) {
      i++;
      continue;
    }

    // Блок кода ```
    if (trimmed.startsWith('```')) {
      const codeLines = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      if (i < lines.length) i++;
      root.append(h('pre', {
        class: 'darkai-pre',
        style: 'font-family:ui-monospace,Consolas,monospace;font-size:12px;line-height:1.5;padding:12px 16px;border-radius:14px;background:#0C0C0E;border:1px solid #1E1E24;color:#E4E4E2;overflow-x:auto;white-space:pre-wrap'
      }, h('code', {}, codeLines.join('\n'))));
      continue;
    }

    // Таблица Markdown: | Заголовок | ... | + | --- | --- |
    if (trimmed.includes('|') && i + 1 < lines.length && isTableSeparatorLine(lines[i + 1])) {
      const headers = splitTableCells(trimmed);
      i += 2;
      const bodyRows = [];
      while (i < lines.length && lines[i].trim().includes('|') && lines[i].trim() !== '') {
        if (!isTableSeparatorLine(lines[i])) {
          bodyRows.push(splitTableCells(lines[i]));
        }
        i++;
      }
      const thead = h('thead', {},
        h('tr', {}, headers.map((hd) => h('th', {
          class: 'darkai-th',
          style: 'padding:10px 14px;font-weight:700;color:#FFFFFF;background:#121216;border-bottom:1px solid #222228;white-space:nowrap;text-align:left'
        }, parseInlineMarkdown(hd)))));
      const tbody = h('tbody', {},
        bodyRows.map((row) => h('tr', { class: 'darkai-tr' },
          headers.map((_, colIdx) => h('td', {
            class: 'darkai-td',
            style: 'padding:9px 14px;color:#D8D8D6;border-bottom:1px solid #18181D;vertical-align:top;text-align:left'
          }, parseInlineMarkdown(row[colIdx] !== undefined ? row[colIdx] : ''))))));
      root.append(h('div', {
        class: 'darkai-table-wrap',
        style: 'width:100%;overflow-x:auto;border-radius:14px;border:1px solid #1F1F24;background:#0A0A0D;margin:4px 0'
      }, h('table', {
        class: 'darkai-table',
        style: 'width:100%;border-collapse:collapse;font-size:12.5px'
      }, thead, tbody)));
      continue;
    }

    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      root.append(h('hr', { class: 'border-t border-line2 my-1' }));
      i++;
      continue;
    }

    const hm = trimmed.match(/^(#{1,4})\s+(.+)$/);
    if (hm) {
      const lvl = hm[1].length;
      const cls = lvl === 1 ? 'text-[17px] font-extrabold text-white mt-1'
        : lvl === 2 ? 'text-[15px] font-bold text-white mt-1'
        : 'text-[14px] font-bold text-white mt-0.5';
      root.append(h('div', { class: cls, style: 'font-weight:700;color:#FFFFFF' }, parseInlineMarkdown(hm[2])));
      i++;
      continue;
    }

    if (/^([-*•])\s+/.test(trimmed)) {
      const items = [];
      while (i < lines.length && /^([-*•])\s+/.test(lines[i].trim())) {
        const itemText = lines[i].trim().replace(/^([-*•])\s+/, '');
        items.push(h('li', { class: 'darkai-li', style: 'line-height:1.5;color:#E4E4E2' }, parseInlineMarkdown(itemText)));
        i++;
      }
      root.append(h('ul', { class: 'darkai-ul', style: 'list-style:disc;padding-left:20px;display:flex;flex-direction:column;gap:4px' }, items));
      continue;
    }

    if (/^\d+\.\s+/.test(trimmed)) {
      const items = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i].trim())) {
        const itemText = lines[i].trim().replace(/^\d+\.\s+/, '');
        items.push(h('li', { class: 'darkai-oli', style: 'line-height:1.5;color:#E4E4E2' }, parseInlineMarkdown(itemText)));
        i++;
      }
      root.append(h('ol', { class: 'darkai-ol', style: 'list-style:decimal;padding-left:20px;display:flex;flex-direction:column;gap:4px' }, items));
      continue;
    }

    if (trimmed.startsWith('>')) {
      const quoteLines = [];
      while (i < lines.length && lines[i].trim().startsWith('>')) {
        quoteLines.push(lines[i].trim().replace(/^>\s?/, ''));
        i++;
      }
      root.append(h('blockquote', {
        class: 'border-l-2 border-accent pl-3 text-dim italic',
        style: 'border-left:2px solid rgb(var(--accent));padding-left:12px;color:#8A8A88;font-style:italic'
      }, parseInlineMarkdown(quoteLines.join(' '))));
      continue;
    }

    const paraLines = [];
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !lines[i].trim().startsWith('```') &&
      !lines[i].trim().startsWith('#') &&
      !lines[i].trim().startsWith('>') &&
      !/^([-*•]|\d+\.)\s+/.test(lines[i].trim()) &&
      !/^(-{3,}|\*{3,}|_{3,})$/.test(lines[i].trim()) &&
      !(lines[i].trim().includes('|') && i + 1 < lines.length && isTableSeparatorLine(lines[i + 1]))
    ) {
      paraLines.push(lines[i]);
      i++;
    }
    if (paraLines.length) {
      const p = h('p', { class: 'leading-[1.55] text-ink/95', style: 'line-height:1.55;color:#E4E4E2' });
      paraLines.forEach((pl, idx) => {
        if (idx > 0) p.append(document.createElement('br'));
        p.append(parseInlineMarkdown(pl));
      });
      root.append(p);
    } else {
      i++;
    }
  }

  return root;
}

// ------------------------------------------------------------------ DarkAI (DeepSeek MCP)

function darkAiAvatarBox() {
  return h('div', {
    class: 'darkai-avatar',
    style: 'width:42px;height:42px;border-radius:14px;background:rgb(var(--accent) / 0.22);color:rgb(var(--accent));display:grid;place-items:center;flex-shrink:0'
  }, svg('star4', 22));
}

function modsSyncAiInputVisuals() {
  const inp = $('#ai-chat-input');
  const sendBtn = $('#ai-send-btn');
  if (inp) {
    inp.placeholder = (MODS.aiHistory.length || MODS.aiBusy) ? 'Ответь DarkAI...' : 'Сгенерируй сборку...';
  }
  if (!sendBtn) return;
  sendBtn.textContent = '';
  const baseStyle = 'width:40px;height:40px;border-radius:9999px;display:grid;place-items:center;flex-shrink:0;color:#FFFFFF;cursor:pointer;transition:background-color .15s ease,filter .15s ease;';
  if (MODS.aiBusy) {
    sendBtn.className = 'darkai-send-btn is-stop';
    sendBtn.setAttribute('style', baseStyle + 'background:#FF3B30;');
    sendBtn.title = 'Остановить генерацию';
    sendBtn.append(svg('stopSq', 18));
  } else if (MODS.aiInput && MODS.aiInput.trim().length > 0) {
    sendBtn.className = 'darkai-send-btn is-ready';
    sendBtn.setAttribute('style', baseStyle + 'background:rgb(var(--accent));');
    sendBtn.title = 'Отправить';
    sendBtn.append(svg('arrowUp', 20));
  } else {
    sendBtn.className = 'darkai-send-btn is-idle';
    sendBtn.setAttribute('style', baseStyle + 'background:#525256;');
    sendBtn.title = 'Введите запрос';
    sendBtn.append(svg('arrowUp', 20));
  }
}

async function modsAbortAi() {
  if (!MODS.aiBusy) return;
  if (api.aiAbort) await act(api.aiAbort);
  MODS.aiBusy = false;
  MODS.aiStatus = '';
  MODS.aiLiveSteps = [];
  if (page === 'mods' && MODS.tab === 'ai') {
    modsPaintAiMessages();
    modsSyncAiInputVisuals();
  }
}

async function modsSendAi(customText) {
  if (MODS.aiBusy) {
    await modsAbortAi();
    return;
  }
  const inp = $('#ai-chat-input');
  const text = String(customText !== undefined ? customText : (inp ? inp.value : MODS.aiInput)).trim();
  if (!text) return;
  if (inp && customText === undefined) inp.value = '';
  MODS.aiInput = '';
  MODS.aiBusy = true;
  MODS.aiPhase = 'thinking';
  MODS.aiStatus = '';
  MODS.aiLiveSteps = [];
  MODS.aiHistory.push({ role: 'user', content: text, at: Date.now() });
  modsPaintAiMessages();
  modsSyncAiInputVisuals();

  try {
    const r = await api.aiChat(text);
    MODS.aiBusy = false;
    MODS.aiStatus = '';
    MODS.aiLiveSteps = [];
    if (!r.ok) {
      if (r.code !== 'ABORTED') {
        toast(r.error, 'bad');
        MODS.aiHistory.push({ role: 'assistant', content: 'Не удалось выполнить запрос: ' + r.error, steps: [], durationSec: 1, at: Date.now() });
      }
    } else {
      if (r.data.state) S = r.data.state;
      if (r.data.installed) MODS.installed = r.data.installed;
      MODS.aiHistory = r.data.history || MODS.aiHistory;
    }
  } catch (e) {
    MODS.aiBusy = false;
    MODS.aiStatus = '';
    MODS.aiLiveSteps = [];
    toast(e.message || String(e), 'bad');
  }
  if (page === 'mods') {
    if (MODS.tab === 'ai') {
      modsPaintAiMessages();
      modsSyncAiInputVisuals();
    } else {
      modsPaintSide();
      modsPaintList();
    }
  }
}

function renderAiInstanceBadge(targetInst) {
  if (!targetInst || !targetInst.name) return null;
  const liveInst = S && S.instances ? S.instances.find((x) => x.id === targetInst.id) : null;
  const customImg = (liveInst && (liveInst.icon || liveInst.banner)) || (targetInst.icon && !String(targetInst.icon).startsWith('assets/') ? targetInst.icon : null);
  const mcVer = (liveInst && liveInst.mc) || targetInst.mc || '1.21.11';
  const loaderLabel = targetInst.loaderLabel || (liveInst && liveInst.fabric ? 'Fabric' : 'Vanilla');

  const avatarNode = customImg
    ? h('img', {
        src: customImg,
        alt: '',
        class: 'w-7 h-7 rounded-full object-cover shrink-0',
        style: 'width:28px;height:28px;border-radius:9999px;object-fit:cover;flex-shrink:0;background:#18181B'
      })
    : h('div', {
        class: 'w-7 h-7 rounded-full grid place-items-center shrink-0 overflow-hidden relative',
        style: 'width:28px;height:28px;border-radius:9999px;background:#18181B;border:1px solid rgba(255,255,255,0.12);display:grid;place-items:center;flex-shrink:0;font-size:11px;font-weight:800;color:#FFFFFF;overflow:hidden;position:relative'
      },
      h('img', {
        src: '../assets/cover.jpg',
        alt: '',
        style: 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:0.65',
        onerror: (e) => { e.currentTarget.style.display = 'none'; }
      }),
      h('span', { style: 'position:relative;z-index:1;text-shadow:0 1px 4px rgba(0,0,0,0.8)' }, initialsOf(targetInst.name)));

  return h('button', {
    class: 'darkai-inst-chip mt-1 self-start',
    style: 'display:inline-flex;align-items:center;gap:10px;padding:4px 10px 4px 2px;border-radius:9999px;background:transparent;cursor:pointer',
    title: 'Перейти к сборке «' + targetInst.name + '»',
    onclick: async () => {
      if (liveInst) {
        const s = await act(api.saveSettings, { selectedInstance: liveInst.id, modsInstance: liveInst.id });
        if (s) S = s;
        await modsRefreshInstalled();
        toast('Выбрана сборка «' + liveInst.name + '»', 'ok');
      }
    }
  },
  avatarNode,
  h('span', { class: 'text-[13px] font-bold text-white truncate max-w-[220px]', style: 'font-size:13px;font-weight:700;color:#FFFFFF' }, targetInst.name),
  h('span', { class: 'text-[13px] font-medium text-dim', style: 'font-size:13px;font-weight:500;color:#6E6E73' }, mcVer + ' ' + loaderLabel));
}

function modsUpdateAiLiveRow() {
  const row = $('#ai-live-row');
  if (!row) {
    modsPaintAiMessages();
    return;
  }
  row.textContent = '';
  const dotStyle = 'width:7px;height:7px;border-radius:9999px;background:rgb(var(--accent));display:inline-block;';
  row.append(
    darkAiAvatarBox(),
    MODS.aiPhase === 'thinking' && !MODS.aiStatus
      ? h('div', {
          class: 'darkai-dots',
          style: 'display:inline-flex;align-items:center;gap:6px;padding-left:2px',
          'aria-label': 'DarkAI думает'
        },
        h('span', { style: dotStyle }),
        h('span', { style: dotStyle + 'opacity:0.75;' }),
        h('span', { style: dotStyle + 'opacity:0.5;' }))
      : h('div', {
          class: 'flex items-center gap-2.5 text-[13.5px] text-dim font-medium',
          style: 'display:flex;align-items:center;gap:10px;font-size:13.5px;color:#7A7A7E;font-weight:500'
        },
        svg('globe', 19, 'text-dim'),
        h('span', { id: 'ai-live-status' }, MODS.aiStatus || 'DarkX: Получен список сборок'))
  );
}

function modsPaintAiMessages() {
  const box = $('#ai-messages');
  if (!box) return;
  box.textContent = '';

  if (!MODS.aiHistory.length && !MODS.aiBusy) {
    box.append(
      h('div', {
        class: 'my-auto mx-auto flex flex-col items-center justify-center text-center gap-3.5 select-none pb-8',
        style: 'margin:auto;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;gap:14px;padding-bottom:32px'
      },
      h('div', { class: 'text-accent grid place-items-center', style: 'color:rgb(var(--accent))' }, svg('star4', 44)),
      h('div', {
        class: 'text-[34px] font-extrabold text-white tracking-tight leading-tight',
        style: 'font-size:34px;font-weight:800;color:#FFFFFF;letter-spacing:-0.02em;line-height:1.15'
      }, 'Готов к сборкам.'))
    );
    return;
  }

  // Выравниваем поток сообщений ближе к нижней панели ввода (mt-auto), как на скриншотах 3–6
  const streamWrap = h('div', {
    class: 'w-full max-w-[680px] mx-auto mt-auto flex flex-col gap-6 pt-4 pb-3 px-2',
    style: 'width:100%;max-width:680px;margin:auto auto 0 auto;display:flex;flex-direction:column;gap:22px;padding:16px 8px 14px 8px'
  });

  for (const msg of MODS.aiHistory) {
    if (msg.role === 'user') {
      streamWrap.append(
        h('div', {
          class: 'self-end max-w-[68%] rounded-[18px] bg-[#0E0E11] border border-[#1B1B20] text-white px-5 py-3.5 text-[13.5px] font-medium leading-relaxed select-text break-words',
          style: 'align-self:flex-end;max-width:68%;border-radius:18px;background:#0D0D10;border:1px solid #18181D;color:#FFFFFF;padding:13px 18px;font-size:13.5px;font-weight:500;line-height:1.48;user-select:text'
        }, msg.content)
      );
    } else {
      const sec = Math.max(1, Number(msg.durationSec) || 1);
      const secWord = sec % 10 === 1 && sec % 100 !== 11 ? 'секунду' : (sec % 10 >= 2 && sec % 10 <= 4 && (sec % 100 < 10 || sec % 100 >= 20) ? 'секунды' : 'секунд');
      const fallbackInst = msg.targetInstance || (() => {
        const cur = modsInstance();
        return cur ? { id: cur.id, name: cur.name, mc: cur.mc, loaderLabel: cur.fabric ? 'Fabric' : 'Vanilla', icon: cur.icon || cur.banner || null } : null;
      })();

      streamWrap.append(
        h('div', {
          class: 'self-start w-full flex flex-col gap-3',
          style: 'align-self:flex-start;width:100%;display:flex;flex-direction:column;gap:12px'
        },
        h('div', {
          class: 'flex items-center gap-3.5',
          style: 'display:flex;align-items:center;gap:14px'
        },
        darkAiAvatarBox(),
        h('span', {
          class: 'text-[13px] font-medium text-dim',
          style: 'font-size:13px;font-weight:500;color:#6E6E73'
        }, 'Выполнял ' + sec + ' ' + secWord)),
        msg.content ? renderMarkdownDom(msg.content) : null,
        renderAiInstanceBadge(fallbackInst))
      );
    }
  }

  if (MODS.aiBusy) {
    const liveRow = h('div', {
      id: 'ai-live-row',
      class: 'self-start flex items-center gap-3.5 py-1',
      style: 'align-self:flex-start;display:flex;align-items:center;gap:14px;padding:4px 0'
    });
    streamWrap.append(liveRow);
    box.append(streamWrap);
    modsUpdateAiLiveRow();
  } else {
    box.append(streamWrap);
  }

  box.scrollTop = box.scrollHeight;
}

function renderDarkAiView(main) {
  const wrap = h('div', {
    class: 'fade-in h-full flex flex-col justify-between min-h-0 px-5 sm:px-8 pt-2 pb-3',
    style: 'height:100%;display:flex;flex-direction:column;justify-content:space-between;min-height:0;padding:8px 32px 12px 32px'
  });

  // Верхняя шапка DarkAI + кнопка Очистить (один в один как на скриншотах 1–6)
  const topSection = h('div', {
    class: 'flex flex-col gap-5 shrink-0',
    style: 'display:flex;flex-direction:column;gap:22px;flex-shrink:0'
  },
  h('div', {
    class: 'flex items-center justify-between gap-4',
    style: 'display:flex;align-items:center;justify-content:space-between;gap:16px'
  },
  h('div', {
    class: 'flex items-center gap-3.5',
    style: 'display:flex;align-items:center;gap:14px'
  },
  h('div', {
    class: 'text-accent shrink-0 grid place-items-center',
    style: 'color:rgb(var(--accent));display:grid;place-items:center;flex-shrink:0'
  }, svg('star4', 36)),
  h('div', { class: 'flex flex-col', style: 'display:flex;flex-direction:column' },
    h('div', {
      class: 'text-[26px] font-extrabold text-white leading-[1.1] tracking-tight',
      style: 'font-size:26px;font-weight:800;color:#FFFFFF;line-height:1.1;letter-spacing:-0.02em'
    }, 'DarkAI'),
    h('div', {
      class: 'text-[13px] text-ink/80 font-medium mt-0.5',
      style: 'font-size:13px;color:rgba(228,228,226,0.82);font-weight:500;margin-top:2px'
    }, 'Соберу сборку с одного промпта!')))),
  h('div', { class: 'flex items-center gap-2.5', style: 'display:flex;align-items:center;gap:10px' },
    h('button', {
      class: 'darkai-clear-btn',
      style: 'display:inline-flex;align-items:center;gap:9px;height:40px;padding:0 18px;border-radius:14px;border:1.5px solid rgb(var(--accent));background:transparent;color:rgb(var(--accent));font-size:13px;font-weight:700;cursor:pointer',
      onclick: async () => {
        if (MODS.aiBusy) await modsAbortAi();
        await act(api.aiClear);
        MODS.aiHistory = [];
        MODS.aiLiveSteps = [];
        MODS.aiStatus = '';
        modsPaintAiMessages();
        modsSyncAiInputVisuals();
      }
    }, svg('trash', 16), 'Очистить')));

  // Центральная область сообщений / пустого экрана
  const msgArea = h('div', {
    id: 'ai-messages',
    class: 'flex-1 overflow-y-auto flex flex-col min-h-0 my-2 pr-1',
    style: 'flex:1 1 0%;overflow-y:auto;display:flex;flex-direction:column;min-height:0;margin:8px 0'
  });

  // Нижний центрированный пилл ввода
  const bottomBar = h('div', {
    class: 'w-full max-w-[470px] mx-auto shrink-0 pt-1 pb-1',
    style: 'width:100%;max-width:470px;margin:0 auto;flex-shrink:0;padding:4px 0'
  },
  h('div', {
    class: 'darkai-input-pill',
    style: 'display:flex;align-items:center;gap:12px;height:56px;border-radius:9999px;background:#0D0D0F;border:1px solid #16161A;padding:0 8px 0 24px'
  },
  h('input', {
    id: 'ai-chat-input',
    type: 'text',
    class: 'darkai-input-field',
    style: 'flex:1 1 0%;min-width:0;background:transparent;border:0;outline:none;color:#FFFFFF;font-size:14px;font-weight:500',
    placeholder: (MODS.aiHistory.length || MODS.aiBusy) ? 'Ответь DarkAI...' : 'Сгенерируй сборку...',
    value: MODS.aiInput,
    spellcheck: 'false',
    autocomplete: 'off',
    oninput: (e) => {
      MODS.aiInput = e.target.value;
      modsSyncAiInputVisuals();
    },
    onkeydown: (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        if (!MODS.aiBusy) modsSendAi();
      }
    }
  }),
  h('button', {
    id: 'ai-send-btn',
    type: 'button',
    class: 'darkai-send-btn is-idle',
    style: 'width:40px;height:40px;border-radius:9999px;display:grid;place-items:center;flex-shrink:0;color:#FFFFFF;background:#525256;cursor:pointer',
    onclick: () => {
      if (MODS.aiBusy) modsAbortAi();
      else modsSendAi();
    }
  }, svg('arrowUp', 20))));

  wrap.append(topSection, msgArea, bottomBar);
  main.append(wrap);
  modsPaintAiMessages();
  modsSyncAiInputVisuals();
}

// ------------------------------------------------------------------ отрисовка каталога модов

function modCard(m) {
  const k = modKey(m);
  const rec = isInstalled(m);
  const step = MODS.busy.get(k);
  let btn;
  if (step) btn = h('button', { class: 'btn btn-accent min-w-[132px]', disabled: true, 'data-mod-btn': k }, step);
  else if (rec) btn = h('button', { class: 'btn min-w-[132px] text-ok border-ok/50', onclick: () => modsRemove(rec), title: 'Нажми, чтобы удалить' }, svg('check', 14), 'Установлен');
  else if (m.blocked) btn = h('button', { class: 'btn min-w-[132px]', onclick: () => m.url && api.external(m.url) }, 'На сайте');
  else btn = h('button', { class: 'btn btn-accent min-w-[132px] uppercase tracking-wide', onclick: () => modsInstall(m) }, 'Установить');

  const icon = m.icon ? h('img', { src: m.icon, alt: '', class: 'w-14 h-14 rounded-xl bg-black border border-line object-cover shrink-0', referrerpolicy: 'no-referrer' })
    : h('div', { class: 'w-14 h-14 rounded-xl bg-black border border-line grid place-items-center text-mute shrink-0' }, svg('puzzle', 24));
  return h('div', { class: 'card p-4 flex items-center gap-4' },
    icon,
    h('div', { class: 'flex-1 min-w-0' },
      h('div', { class: 'flex items-baseline gap-2 min-w-0' },
        h('span', { class: 'font-bold truncate' }, m.title),
        h('span', { class: 'text-[11px] text-mute truncate' }, m.author ? 'от ' + m.author : '')),
      h('div', { class: 'text-[12px] text-dim line-clamp-2 mt-0.5' }, m.description),
      h('div', { class: 'flex items-center gap-2 mt-2 flex-wrap' },
        h('span', { class: 'chip' }, svg('download', 11, 'mr-1'), fmtNum(m.downloads)),
        (m.categories || []).map((c) => h('span', { class: 'chip' }, c)))),
    btn);
}

function installedRow(rec) {
  return h('div', { class: 'card p-4 flex items-center gap-4' },
    h('div', { class: 'w-10 h-10 rounded-xl bg-black border border-line grid place-items-center text-accent shrink-0' }, svg('puzzle', 20)),
    h('div', { class: 'flex-1 min-w-0' },
      h('div', { class: 'font-bold truncate' }, rec.title),
      h('div', { class: 'text-[11px] text-dim truncate' }, rec.file + (rec.dep ? ' · зависимость' : '') + ' · ' + (rec.source === 'curseforge' ? 'CurseForge' : 'Modrinth'))),
    h('button', { class: 'btn btn-sm btn-bad', onclick: () => modsRemove(rec) }, svg('trash', 14), 'Удалить'));
}

function modsPaintList() {
  const box = $('#mods-list');
  if (!box) return;
  box.textContent = '';
  const inst = modsInstance();
  if (MODS.tab === 'installed') {
    if (!inst) box.append(emptyNote('Профиль не выбран', 'Выбери профиль в правой панели — покажу его моды.'));
    else if (!MODS.installed.length) box.append(emptyNote('Пока пусто', 'Моды, установленные отсюда или через DarkAI, появятся в этом списке. Fabric API лаунчер ставит сам.'));
    else box.append(...MODS.installed.map(installedRow));
    return;
  }
  if (modsNeedKey()) {
    box.append(emptyNote('Нужен ключ CurseForge', 'CurseForge отдаёт каталог только по API-ключу (бесплатный, console.curseforge.com). Вставь его в Настройках → Моды.',
      h('button', { class: 'btn btn-accent mt-3', onclick: () => go('settings') }, 'Открыть настройки')));
    return;
  }
  if (MODS.err) { box.append(emptyNote('Не удалось получить каталог', MODS.err, h('button', { class: 'btn mt-3', onclick: () => modsSearch(false) }, 'Повторить'))); return; }
  if (!MODS.hits.length && !MODS.loading) { box.append(emptyNote('Ничего не нашлось', 'Попробуй другой запрос или сними часть фильтров.')); return; }
  box.append(...MODS.hits.map(modCard));
  if (MODS.loading) box.append(h('div', { class: 'h-1 rounded-full pulse-bar' }));
  else if (MODS.hits.length < MODS.total) box.append(h('button', { class: 'btn self-center', onclick: () => modsSearch(true) }, 'Показать ещё'));
}

function emptyNote(title, text, extra) {
  return h('div', { class: 'card p-8 text-center flex flex-col items-center' }, h('div', { class: 'font-bold mb-1' }, title), h('div', { class: 'text-dim text-[12px] max-w-md' }, text), extra);
}

function sideBlock(title, ...kids) {
  return h('div', { class: 'flex flex-col gap-2' }, h('div', { class: 'text-[10px] tracking-[.14em] text-mute uppercase' }, title), kids);
}

function toggleChip(label, on, fn, extra) {
  return h('button', { class: 'chip h-7 px-3 text-[12px] cursor-pointer transition-colors ' + (on ? 'chip-accent' : 'hover:text-ink hover:bg-raise'), 'aria-pressed': on ? 'true' : 'false', onclick: fn }, label, extra);
}

function modsPaintSide() {
  const box = $('#mods-side');
  if (!box) return;
  box.textContent = '';
  const inst = modsInstance();

  const profile = h('button', {
    class: 'card p-3 flex items-center gap-3 text-left hover:bg-raise w-full ' + (inst ? '' : 'border-accent/60'),
    onclick: (e) => popover(e.currentTarget, (close) => [].concat(
      S.instances.map((i) => h('button', {
        class: 'flex items-center gap-3 p-2 rounded-xl text-left hover:bg-raise ' + (i.fabric ? '' : 'opacity-40'), disabled: !i.fabric,
        onclick: async () => {
          close();
          const s = await act(api.saveSettings, { modsInstance: i.id });
          if (s) { S = s; await modsRefreshInstalled(); renderPage(); if (MODS.tab === 'catalog') modsSearch(false); }
        }
      }, h('div', { class: 'flex-1 min-w-0' }, h('div', { class: 'font-bold truncate' }, i.name), h('div', { class: 'text-[11px] text-dim' }, 'Minecraft ' + i.mc)),
      i.id === (inst && inst.id) ? svg('check', 16, 'text-accent') : null))))
  },
  h('div', { class: 'w-9 h-9 shrink-0', html: LOGO }),
  h('div', { class: 'flex-1 min-w-0' },
    h('div', { class: 'font-bold truncate' }, inst ? inst.name : 'Выбери профиль'),
    h('div', { class: 'text-[11px] text-dim truncate' }, inst ? 'MC ' + inst.mc + ' · ' + MODS.installed.length + ' мод.' : 'Моды ставятся в профиль')),
  svg('chevron', 16, 'text-dim'));

  const src = h('div', { class: 'grid grid-cols-2 gap-2' },
    ['modrinth', 'curseforge'].map((s) => h('button', {
      class: 'btn h-9 ' + (MODS.source === s ? 'btn-accent' : ''),
      onclick: () => { if (MODS.source === s) return; MODS.source = s; MODS.cats = new Set(); S.settings.modsSource = s; api.saveSettings({ modsSource: s }); modsLoadCats(); modsPaintSide(); modsSearch(false); }
    }, s === 'modrinth' ? 'Modrinth' : 'CurseForge')));

  const sides = h('div', { class: 'flex gap-2 flex-wrap' },
    toggleChip('Client', MODS.client, () => { MODS.client = !MODS.client; modsPaintSide(); modsSearch(false); }),
    toggleChip('Server', MODS.server, () => { MODS.server = !MODS.server; modsPaintSide(); modsSearch(false); }));

  const cats = (MODS.catList[MODS.source] || []);
  const catBox = h('div', { class: 'flex gap-2 flex-wrap' },
    cats.length ? cats.map((c) => toggleChip(c.name, MODS.cats.has(c.id), () => {
      MODS.cats.has(c.id) ? MODS.cats.delete(c.id) : MODS.cats.add(c.id);
      modsPaintSide(); modsSearch(false);
    })) : h('div', { class: 'text-[12px] text-mute' }, modsNeedKey() ? 'Нужен ключ CurseForge' : 'Загрузка…'));

  const sort = h('select', { class: 'input', onchange: (e) => { MODS.sort = e.target.value; modsSearch(false); } },
    SORTS.map(([v, t]) => h('option', { value: v, selected: v === MODS.sort }, t)));

  box.append(...[
    sideBlock('Профиль', profile),
    sideBlock('Источник', src, MODS.source === 'curseforge' && !S.effective.curseforge
      ? h('div', { class: 'text-[11px] text-mute' }, 'Для поиска в CurseForge укажи API-ключ в launcher.config.json')
      : null),
    sideBlock('Сторона', sides, MODS.source === 'curseforge' ? h('div', { class: 'text-[11px] text-mute' }, 'CurseForge не умеет фильтровать по стороне') : null),
    sideBlock('Сортировка', sort),
    sideBlock('Категории' + (MODS.cats.size ? ' · ' + MODS.cats.size : ''), catBox,
      MODS.cats.size ? h('button', { class: 'text-[12px] text-dim hover:text-ink text-left', onclick: () => { MODS.cats = new Set(); modsPaintSide(); modsSearch(false); } }, 'Сбросить категории') : null)
  ].filter(Boolean));
}

function renderMods(main) {
  ensureAiEventsHooked();

  if (MODS.tab === 'ai') {
    renderDarkAiView(main);
    return;
  }

  const search = h('div', { class: 'relative flex-1' },
    h('span', { class: 'absolute left-3 top-1/2 -translate-y-1/2 text-mute' }, svg('search', 16)),
    h('input', { class: 'input pl-10 h-10', placeholder: 'Найти мод…', value: MODS.query, spellcheck: 'false',
      oninput: (e) => { MODS.query = e.target.value; if (MODS.tab === 'catalog') modsLater(); } }));

  const starBtn = h('button', {
    id: 'mods-ai-star-btn',
    class: 'btn h-10 !px-3.5 flex items-center gap-2 border-accent/60 text-accent hover:bg-accent/15',
    title: 'Открыть DarkAI — сборщик модов с одного промпта',
    'aria-label': 'DarkAI',
    onclick: async () => {
      MODS.tab = 'ai';
      if (api.aiHistory) {
        const hist = await act(api.aiHistory);
        if (Array.isArray(hist) && hist.length) MODS.aiHistory = hist;
      }
      renderPage();
    }
  }, svg('star4', 17), 'DarkAI');

  const tabs = h('div', { class: 'flex gap-2 items-center' },
    starBtn,
    [['catalog', 'Каталог'], ['installed', 'Установлено']].map(([id, t]) => h('button', {
      class: 'btn h-10 ' + (MODS.tab === id ? 'btn-accent' : ''),
      onclick: async () => { MODS.tab = id; if (id === 'installed') await modsRefreshInstalled(); renderPage(); if (id === 'catalog' && !MODS.hits.length) modsSearch(false); }
    }, t)));

  main.append(h('div', { class: 'fade-in h-full flex flex-col lg:flex-row gap-6 min-h-0' },
    h('div', { class: 'flex-1 min-w-0 flex flex-col gap-4 min-h-0' },
      h('div', { class: 'flex gap-3 items-center' },
        MODS.tab === 'catalog' ? search : h('h2', { class: 'text-[22px] flex-1 self-center' }, 'Установленные моды'),
        tabs),
      h('div', { id: 'mods-list', class: 'flex-1 overflow-y-auto flex flex-col gap-3 pr-1 min-h-0' })),
    h('aside', { id: 'mods-side', class: 'lg:w-[290px] shrink-0 flex flex-col gap-5 lg:border-l lg:border-line lg:pl-6 overflow-y-auto min-h-0' })));
  modsPaintSide();
  modsPaintList();
  modsLoadCats();
}

async function enterMods() {
  ensureAiEventsHooked();
  MODS.source = S.settings.modsSource === 'curseforge' && S.effective.curseforge ? 'curseforge' : 'modrinth';
  await modsRefreshInstalled();
  if (MODS.tab === 'ai' && api.aiHistory) {
    const hist = await act(api.aiHistory);
    if (Array.isArray(hist)) MODS.aiHistory = hist;
  }
  if (!MODS.hits.length || MODS.entered !== (S.settings.modsInstance || '')) {
    MODS.entered = S.settings.modsInstance || '';
    if (MODS.tab === 'catalog') modsSearch(false);
  }
}
