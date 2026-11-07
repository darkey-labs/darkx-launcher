'use strict';
/* Вкладка «Моды»: каталог Modrinth / CurseForge, фильтры и профиль — в правой панели. */

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
  tab: 'catalog',   // catalog | installed
  installed: [],    // реестр выбранного профиля
  busy: new Map(),  // "source:id" → текст шага
  req: 0,
  timer: null
};

const SORTS = [['relevance', 'По релевантности'], ['downloads', 'По скачиваниям'], ['follows', 'По подпискам'], ['newest', 'Новые'], ['updated', 'Недавно обновлённые']];
const modKey = (m) => m.source + ':' + (m.projectId || m.id);

function modsInstance() {
  return S.instances.find((i) => i.id === S.settings.modsInstance) || null;
}

function isInstalled(m) {
  return MODS.installed.find((r) => r.source === m.source && r.projectId === String(m.id));
}

async function modsRefreshInstalled() {
  const inst = modsInstance();
  MODS.installed = inst ? (await act(api.modInstalled, inst.id)) || [] : [];
}

function modsNeedKey() {
  return MODS.source === 'curseforge' && !S.effective.curseforge;
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
  if (r.ok) { MODS.catList[MODS.source] = r.data; if (page === 'mods') modsPaintSide(); }
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
  if (!inst.fabric) { toast('В профиле «' + inst.name + '» нет Fabric — выбери другой профиль', 'bad'); return; }
  const k = modKey(m);
  if (MODS.busy.has(k)) return;
  MODS.busy.set(k, 'Скачиваю…');
  modsPaintList();
  api.modInstall(inst.id, { source: m.source, id: m.id, title: m.title }).then(async (r) => {
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

// ------------------------------------------------------------------ отрисовка

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
    else if (!MODS.installed.length) box.append(emptyNote('Пока пусто', 'Моды, установленные отсюда, появятся в этом списке. Fabric API лаунчер ставит сам.'));
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
      }, h('div', { class: 'flex-1 min-w-0' }, h('div', { class: 'font-bold truncate' }, i.name), h('div', { class: 'text-[11px] text-dim' }, 'Minecraft ' + i.mc + (i.fabric ? '' : ' · без Fabric'))),
      i.id === S.settings.modsInstance ? svg('check', 16, 'text-accent') : null))))
  },
  h('div', { class: 'w-9 h-9 shrink-0', html: LOGO }),
  h('div', { class: 'flex-1 min-w-0' },
    h('div', { class: 'font-bold truncate' }, inst ? inst.name : 'Выбери профиль'),
    h('div', { class: 'text-[11px] text-dim' }, inst ? 'Minecraft ' + inst.mc + ' · ' + MODS.installed.length + ' мод.' : 'Моды ставятся в профиль')),
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

  box.append(
    sideBlock('Профиль', profile),
    S.effective.curseforge ? sideBlock('Источник', src) : null,
    sideBlock('Сторона', sides, MODS.source === 'curseforge' ? h('div', { class: 'text-[11px] text-mute' }, 'CurseForge не умеет фильтровать по стороне') : null),
    sideBlock('Сортировка', sort),
    sideBlock('Категории' + (MODS.cats.size ? ' · ' + MODS.cats.size : ''), catBox,
      MODS.cats.size ? h('button', { class: 'text-[12px] text-dim hover:text-ink text-left', onclick: () => { MODS.cats = new Set(); modsPaintSide(); modsSearch(false); } }, 'Сбросить категории') : null));
}

function renderMods(main) {
  const search = h('div', { class: 'relative flex-1' },
    h('span', { class: 'absolute left-3 top-1/2 -translate-y-1/2 text-mute' }, svg('search', 16)),
    h('input', { class: 'input pl-10 h-10', placeholder: 'Найти мод…', value: MODS.query, spellcheck: 'false',
      oninput: (e) => { MODS.query = e.target.value; if (MODS.tab === 'catalog') modsLater(); } }));
  const tabs = h('div', { class: 'flex gap-2' },
    [['catalog', 'Каталог'], ['installed', 'Установлено']].map(([id, t]) => h('button', {
      class: 'btn h-10 ' + (MODS.tab === id ? 'btn-accent' : ''),
      onclick: async () => { MODS.tab = id; if (id === 'installed') await modsRefreshInstalled(); renderPage(); if (id === 'catalog' && !MODS.hits.length) modsSearch(false); }
    }, t)));

  main.append(h('div', { class: 'fade-in h-full flex flex-col lg:flex-row gap-6 min-h-0' },
    h('div', { class: 'flex-1 min-w-0 flex flex-col gap-4 min-h-0' },
      h('div', { class: 'flex gap-3' }, MODS.tab === 'catalog' ? search : h('h2', { class: 'text-[22px] flex-1 self-center' }, 'Установленные моды'), tabs),
      h('div', { id: 'mods-list', class: 'flex-1 overflow-y-auto flex flex-col gap-3 pr-1 min-h-0' })),
    h('aside', { id: 'mods-side', class: 'lg:w-[290px] shrink-0 flex flex-col gap-5 lg:border-l lg:border-line lg:pl-6 overflow-y-auto min-h-0' })));
  modsPaintSide();
  modsPaintList();
  modsLoadCats();
}

async function enterMods() {
  MODS.source = S.settings.modsSource === 'curseforge' && S.effective.curseforge ? 'curseforge' : 'modrinth';
  await modsRefreshInstalled();
  if (!MODS.hits.length || MODS.entered !== (S.settings.modsInstance || '')) {
    MODS.entered = S.settings.modsInstance || '';
    modsSearch(false);
  }
}
