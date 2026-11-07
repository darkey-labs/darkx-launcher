'use strict';
/* Оболочка DarkX Launcher: шапка, боковая панель, главная, сборки, настройки. Общие утилиты — в core.js. */

let progress = null;
let launching = false; // пользователь нажал «Запустить», main ещё не ответил
let ovl = null; // экран запуска: {root, refs, timer}
let logs = [];
let consoleOpen = false;
let rel = { state: 'idle', list: [], err: null };
let serverStatus = {}; // id → {online, max} после последнего пинга
let serversAt = 0;

const NAV_TOP = [
  ['mods', 'Моды', 'puzzle'],
  ['instances', 'Сборки', 'layers'],
  ['skins', 'Скины', 'wardrobe']
];

function go(id) {
  if (page === id) return;
  page = id;
  animateNext = true;
  renderNav();
  renderPage();
  if (id === 'mods') enterMods().then(() => { if (page === 'mods') { modsPaintList(); modsPaintSide(); } });
  if (id === 'skins') reloadSkins().then(() => { if (page === 'skins') renderPage(); });
  if (id === 'play') loadReleases();
}

function setState(next) {
  S = next;
  applyAccent();
  renderHeader();
  renderPage();
}

// ============================================================ шапка и боковая панель

function renderNav() {
  const nav = $('#nav');
  nav.textContent = '';
  const btn = (id, label, icon, extra) => h('button', {
    class: 'rail' + (page === id ? ' on' : '') + (extra ? ' ' + extra : ''), title: label, 'aria-label': label,
    onclick: () => go(id)
  }, svg(icon, 22));
  nav.append(btn('play', 'Играть', 'play'));
  nav.append(h('div', { class: 'h-4' }));
  for (const [id, label, icon] of NAV_TOP) nav.append(btn(id, label, icon));
  const bottom = $('#nav-bottom');
  bottom.textContent = '';
  if (S.update && S.update.available) {
    const u = btn('update', 'Доступно обновление ' + S.update.latest, 'download', 'rail-update');
    u.onclick = () => openUpdate();
    bottom.append(u);
  }
  bottom.append(btn('settings', 'Настройки', 'gear'));
}

function renderHeader() {
  const a = currentAccount();
  const box = $('#acc-chip');
  box.textContent = '';
  box.append(
    a ? avatar(a, 26) : h('div', { class: 'w-[26px] h-[26px] rounded-xl bg-raise grid place-items-center text-mute shrink-0' }, svg('user', 16)),
    h('span', { class: 'font-bold truncate max-w-[130px]' }, a ? a.name : 'Войти'),
    svg('chevron', 14, 'text-dim'));
  box.onclick = (e) => accountMenu(e.currentTarget);
  $('#side-ver').textContent = 'v' + S.version;
}

const ACC_LABEL = { microsoft: 'Microsoft', ely: 'Ely.by', offline: 'Offline' };

function accountMenu(anchor) {
  popover(anchor, (close) => {
    const rows = S.accounts.map((a) => {
      const on = a.id === S.settings.selectedAccount;
      return h('div', { class: 'flex items-center gap-1' },
        h('button', { class: 'flex-1 min-w-0 flex items-center gap-3 p-2 rounded-xl text-left hover:bg-raise ' + (on ? 'bg-raise' : ''),
          onclick: async () => { close(); const s = await act(api.selectAccount, a.id); if (s) setState(s); } },
        avatar(a, 28),
        h('div', { class: 'flex-1 min-w-0' }, h('div', { class: 'font-bold truncate' }, a.name),
          h('div', { class: 'text-[10px] text-dim' }, ACC_LABEL[a.type] || 'Offline')),
        on ? svg('check', 16, 'text-accent') : null),
        h('button', { class: 'p-2 rounded-lg text-mute hover:text-bad hover:bg-raise', title: 'Удалить аккаунт', 'aria-label': 'Удалить аккаунт',
          onclick: () => { close(); confirmRemoveAccount(a); } }, svg('trash', 14)));
    });
    return [
      rows.length ? rows : h('div', { class: 'p-3 text-dim text-[12px]' }, 'Аккаунтов пока нет'),
      h('div', { class: 'h-px bg-line my-1' }),
      h('button', { class: 'flex items-center gap-3 p-2 rounded-xl text-accent font-bold hover:bg-raise', onclick: () => { close(); newAccountModal(); } },
        h('span', { class: 'w-7 h-7 rounded-lg bg-accent/15 grid place-items-center' }, svg('plus', 16)), 'Новый аккаунт')
    ];
  }, { width: 270 });
}

function confirmRemoveAccount(a) {
  modal('Удалить «' + a.name + '»?', h('div', { class: 'text-dim' }, 'Аккаунт пропадёт из лаунчера. Миры и сборки останутся на месте.'),
    (close) => [h('button', { class: 'btn', onclick: close }, 'Отмена'),
      h('button', { class: 'btn btn-bad', onclick: async () => { const s = await act(api.removeAccount, a.id); close(); if (s) setState(s); } }, 'Удалить')]);
}

// ============================================================ новый аккаунт

function newAccountModal() {
  const opt = (icon, title, text, fn) => h('button', { class: 'flex-1 min-w-0 card p-5 flex flex-col items-center gap-2 text-center hover:bg-raise hover:border-accent/50 transition-colors cursor-pointer', onclick: fn },
    h('span', { class: 'text-accent' }, svg(icon, 34)), h('span', { class: 'font-bold text-[15px]' }, title), h('span', { class: 'text-[11px] text-dim' }, text));
  modal('Новый аккаунт',
    h('div', { class: 'flex gap-3' },
      opt('ms', 'Microsoft', 'Лицензия: вход по коду', () => { closeModal(); startMicrosoft(); }),
      opt('shield', 'Ely.by', 'Аккаунт Ely.by: ник и скин', elyModal),
      opt('user', 'Offline', 'Любой ник, без лицензии', offlineModal)),
    null, 560);
}

function elyModal() {
  const login = h('input', { class: 'input', placeholder: 'Ник или e-mail', spellcheck: 'false', autocomplete: 'username' });
  const pass = h('input', { class: 'input', type: 'password', placeholder: 'Пароль', autocomplete: 'current-password' });
  const totp = h('input', { class: 'input', placeholder: 'Код из приложения', maxlength: '8', inputmode: 'numeric', autocomplete: 'one-time-code' });
  const totpBox = h('div', { class: 'hidden' }, h('label', { class: 'label' }, 'Код двухфакторной защиты'), totp);
  let busy = false;
  const go = async () => {
    if (busy) return;
    busy = true; enter.disabled = true;
    try {
      const r = await act(api.elyLogin, { login: login.value, password: pass.value, totp: totp.value });
      if (!r) return;
      if (r.need2fa) {
        totpBox.classList.remove('hidden');
        toast('Включена двухфакторная защита: введи код из приложения');
        setTimeout(() => totp.focus(), 30);
        return;
      }
      closeModal(); setState(r);
      const a = currentAccount();
      toast('Аккаунт «' + (a ? a.name : 'Ely.by') + '» добавлен', 'ok');
    } finally { busy = false; enter.disabled = false; }
  };
  const enter = h('button', { class: 'btn btn-accent', onclick: go }, 'Войти');
  for (const el of [login, pass, totp]) el.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
  modal('Вход через Ely.by',
    h('div', { class: 'flex flex-col gap-3' },
      h('div', {}, h('label', { class: 'label' }, 'Ник или e-mail'), login),
      h('div', {}, h('label', { class: 'label' }, 'Пароль'), pass),
      totpBox,
      h('div', { class: 'text-[11px] text-mute' }, 'Пароль уходит только на authserver.ely.by и нигде не сохраняется. С таким аккаунтом можно играть на серверах с поддержкой Ely.by и на offline-серверах, но не на серверах, которые проверяют только лицензию Mojang.'),
      h('button', { class: 'text-[11px] text-accent text-left hover:text-ink', onclick: () => api.external('https://ely.by') }, 'Нет аккаунта? Зарегистрироваться на ely.by')),
    (close) => [h('button', { class: 'btn', onclick: () => { close(); newAccountModal(); } }, 'Назад'), enter]);
  setTimeout(() => login.focus(), 30);
}

function offlineModal() {
  const nick = h('input', { class: 'input', placeholder: 'Ник (3–16 символов)', maxlength: '16', spellcheck: 'false' });
  const add = async () => {
    const s = await act(api.addOffline, nick.value);
    if (s) { closeModal(); setState(s); toast('Аккаунт «' + nick.value.trim() + '» добавлен', 'ok'); }
  };
  nick.addEventListener('keydown', (e) => { if (e.key === 'Enter') add(); });
  modal('Offline-аккаунт', h('div', {}, h('label', { class: 'label' }, 'Ник'), nick,
    h('div', { class: 'text-[11px] text-mute mt-2' }, 'Латиница, цифры и _. Подойдёт для серверов без проверки лицензии.')),
  (close) => [h('button', { class: 'btn', onclick: () => { close(); newAccountModal(); } }, 'Назад'), h('button', { class: 'btn btn-accent', onclick: add }, 'Добавить')]);
  setTimeout(() => nick.focus(), 30);
}

let msUi = null;
async function startMicrosoft() {
  let info;
  try { info = await call(api.msStart); } catch (_) { return; }
  const status = h('div', { class: 'text-[12px] text-dim' }, 'Ждём подтверждения…');
  const code = h('div', { class: 'text-[34px] font-bold tracking-[.25em] text-accent text-center select-text py-2' }, info.userCode);
  const close = modal('Вход через Microsoft',
    h('div', { class: 'flex flex-col gap-3' },
      h('div', { class: 'text-dim' }, 'Открой страницу и введи код:'),
      code,
      h('div', { class: 'flex gap-2 justify-center' },
        h('button', { class: 'btn btn-accent', onclick: () => api.external(info.uri) }, 'Открыть ' + info.uri.replace('https://', '')),
        h('button', { class: 'btn', onclick: () => { navigator.clipboard.writeText(info.userCode); toast('Код скопирован', 'ok'); } }, 'Копировать код')),
      status),
    (c) => [h('button', { class: 'btn', onclick: () => { api.msCancel(); c(); } }, 'Отмена')]);
  msUi = { close, status };
}

// ============================================================ главная

const isStandard = (inst) => inst.kind === 'standard';
/** Крупная подпись на обложке: у стандартной сборки — версия с буквой b, у остальных — название сборки. */
const instLabel = (inst) => (isStandard(inst) ? inst.mc + 'b' : inst.name);

function instShort(inst) {
  if (isStandard(inst)) return 'DX Visuals';
  return inst.mc + ' · ' + (inst.fabric ? 'Fabric' : 'Vanilla') + (inst.fabric && inst.darkx !== false && S.darkxVersions.includes(inst.mc) ? ' · DX' : '');
}

function cover(inst, cls) {
  const std = isStandard(inst);
  const box = h('div', { class: 'relative overflow-hidden bg-panel ' + (cls || ''), html: coverSvg(inst.id, std) });
  // Официальный баннер 1.21.11: у стандартной сборки — центр (всадники), у остальных — свой участок картинки по id.
  const img = new Image();
  img.className = 'absolute inset-0 w-full h-full object-cover';
  img.draggable = false;
  img.style.objectPosition = (std ? 47 : 6 + (seedOf(inst.id) % 89)) + '% 50%';
  img.onload = () => box.append(img);
  img.src = '../assets/cover.jpg';
  return box;
}

function serverBtn(sv) {
  const sel = S.settings.selectedServer === sv.id;
  const dim = S.settings.selectedServer && !sel;
  const st = serverStatus[sv.id];
  const face = sv.icon
    ? h('img', { src: sv.icon, alt: '', draggable: 'false', class: 'w-full h-full object-cover pixel-img' })
    : h('span', { class: 'pixel text-[13px] text-dim' }, sv.name.replace(/^(www|mc|play)\./i, '').slice(0, 2));
  return h('button', {
    class: 'pill-btn relative ' + (sv.icon ? '' : 'bg-tile ') + (sel ? 'ring-2 ring-ink ' : '') + (dim ? 'opacity-45' : ''),
    title: sv.host + (sv.port !== 25565 ? ':' + sv.port : '') + (sel ? ' — зайдём сразу после запуска' : ''), 'aria-label': sv.name,
    onclick: async () => { const s = await act(api.serverSelect, sel ? null : sv.id); if (s) setState(s); }
  }, face, st && st.online === false ? h('span', { class: 'absolute right-0.5 bottom-0.5 w-2 h-2 rounded-full bg-abort border border-black' }) : null);
}

function serversMenu(anchor) {
  popover(anchor, (close) => {
    const input = h('input', { class: 'input !h-10 !text-[13px] flex-1', placeholder: 'mc.example.com', spellcheck: 'false' });
    const add = async () => {
      const s = await act(api.serverAdd, input.value);
      if (s) { close(); setState(s); refreshServers(true); }
    };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') add(); });
    setTimeout(() => input.focus(), 30);
    const rows = S.settings.servers.map((sv) => h('div', { class: 'flex items-center gap-1' },
      h('button', { class: 'flex-1 min-w-0 flex items-center gap-3 p-2 rounded-xl text-left hover:bg-raise', onclick: async () => { close(); const s = await act(api.serverSelect, sv.id); if (s) setState(s); } },
        sv.icon ? h('img', { src: sv.icon, alt: '', class: 'w-8 h-8 rounded-lg pixel-img' }) : h('span', { class: 'w-8 h-8 rounded-lg bg-tile grid place-items-center text-mute' }, svg('server', 16)),
        h('div', { class: 'flex-1 min-w-0' }, h('div', { class: 'font-bold truncate' }, sv.host), h('div', { class: 'text-[10px] text-dim' }, sv.port !== 25565 ? 'порт ' + sv.port : 'по умолчанию')),
        S.settings.selectedServer === sv.id ? svg('check', 16, 'text-ink') : null),
      h('button', { class: 'p-2 rounded-lg text-mute hover:text-abort hover:bg-raise', title: 'Убрать сервер', 'aria-label': 'Убрать сервер',
        onclick: async () => { close(); const s = await act(api.serverRemove, sv.id); if (s) setState(s); } }, svg('trash', 14))));
    return [
      h('div', { class: 'px-2 pt-1 pb-1 text-[11px] text-dim font-semibold' }, 'Сервер для быстрого входа'),
      S.settings.selectedServer ? h('button', { class: 'flex items-center gap-3 p-2 rounded-xl text-left text-dim hover:bg-raise', onclick: async () => { close(); const s = await act(api.serverSelect, null); if (s) setState(s); } }, svg('close', 16), 'Не заходить на сервер') : null,
      rows.length ? rows : h('div', { class: 'p-2 text-dim text-[12px] font-normal' }, 'Сервера не добавлены. Добавь адрес — игра зайдёт на него сразу после запуска.'),
      h('div', { class: 'h-px bg-line my-1' }),
      h('div', { class: 'flex gap-2 p-1' }, input, h('button', { class: 'btn !h-10 !px-4', onclick: add }, svg('plus', 16)))
    ];
  }, { width: 320 });
}

/** Обновляет иконки и онлайн серверов (не чаще раза в минуту). */
async function refreshServers(force) {
  if (!S.settings.servers.length || (!force && Date.now() - serversAt < 60000)) return;
  serversAt = Date.now();
  const r = await api.serversRefresh();
  if (!r.ok) return;
  serverStatus = {};
  for (const x of r.data.status) serverStatus[x.id] = x;
  S.settings.servers = r.data.state.settings.servers;
  if (page === 'play') paintPill();
}

function paintPill() {
  const box = $('#pill');
  if (!box) return;
  box.textContent = '';
  const manage = h('button', { class: 'pill-btn text-ink', title: 'Сервера', 'aria-label': 'Сервера', onclick: (e) => serversMenu(e.currentTarget) }, svg('grid', 26));
  box.append(manage, ...S.settings.servers.map(serverBtn));
}

function instMenu(anchor) {
  const inst = currentInstance();
  popover(anchor, (close) => [
    S.instances.map((i) => h('button', {
      class: 'flex items-center gap-3 p-2 rounded-xl text-left hover:bg-raise',
      onclick: async () => { close(); const s = await act(api.selectInstance, i.id); if (s) setState(s); }
    }, cover(i, 'w-9 h-9 rounded-xl shrink-0'),
    h('div', { class: 'flex-1 min-w-0' }, h('div', { class: 'font-bold truncate' }, i.name), h('div', { class: 'text-[11px] text-dim' }, instShort(i))),
    i.id === inst.id ? svg('check', 16, 'text-ink') : null)),
    h('div', { class: 'h-px bg-line my-1' }),
    h('button', { class: 'flex items-center gap-3 p-2 rounded-xl text-left font-bold hover:bg-raise', onclick: () => { close(); openWizard(); } },
      h('span', { class: 'w-9 h-9 rounded-xl bg-tile grid place-items-center' }, svg('plus', 16)), 'Мастер создания сборок')
  ], { place: 'below', align: 'right', width: 300 });
}

function renderPlay(main) {
  const inst = currentInstance();
  const acc = currentAccount();
  const busy = S.state === 'installing';
  const running = S.state === 'running';
  const std = isStandard(inst);
  const lbl = instLabel(inst);
  const size = lbl.length <= 8 ? 'text-[44px]' : lbl.length <= 14 ? 'text-[32px]' : 'text-[24px]';

  const sub = std
    ? h('div', { class: 'flex items-center gap-2 mt-2.5 text-[15px] text-ink/90' }, h('span', { class: 'w-[18px] h-[18px]', html: LOGO }), 'DX Visuals', h('span', { class: 'pixel text-[11px] bg-soft text-black px-1.5 py-0.5 rounded' }, 'beta'))
    : h('div', { class: 'flex flex-col gap-1 mt-2.5 text-[13px] text-ink/85 font-medium' },
      h('div', {}, 'Minecraft ' + inst.mc + ' · ' + (inst.fabric ? 'Fabric' : 'Vanilla')),
      inst.fabric && inst.darkx !== false && S.darkxVersions.includes(inst.mc) ? h('div', { class: 'flex items-center gap-2' }, h('span', { class: 'w-4 h-4', html: LOGO }), 'DX Visuals') : null,
      inst.kind === 'imported' ? h('div', { class: 'text-ink/70' }, 'Перенесена из ' + importSourceName(inst.source)) : null);

  const art = cover(inst, 'h-full aspect-[0.66] max-w-full shrink-0 rounded-[30px]');
  art.append(
    h('div', { class: 'absolute inset-x-0 top-0 h-[45%] z-[5] pointer-events-none', style: 'background:linear-gradient(180deg,rgba(0,0,0,.62),rgba(0,0,0,.3) 55%,transparent)' }),
    h('div', { class: 'absolute left-7 top-6 right-5 z-10' }, h('div', { class: size + ' font-bold leading-[1.05] tracking-tight break-words line-clamp-2', style: 'text-shadow:0 2px 14px rgba(0,0,0,.5)' }, lbl), sub));

  const playMain = h('button', { class: 'play-go', disabled: busy, onclick: running ? () => act(api.stop) : startPlay }, running ? 'Остановить' : busy ? 'Подготовка…' : 'Запустить');
  const chev = h('button', { class: 'play-chev', 'aria-label': 'Выбрать сборку', title: 'Сборка: ' + inst.name, disabled: busy || running, onclick: (e) => instMenu(e.currentTarget) }, svg('chevron', 20));
  const play = h('div', { class: 'play' + (running ? ' stop' : '') }, playMain, chev);

  const right = h('div', { class: 'flex-1 min-w-0 max-w-[560px] flex flex-col h-full' },
    h('div', { class: 'pt-[54px] shrink-0' },
      acc ? h('div', { class: 'pixel text-[26px] leading-none text-ink truncate' }, acc.name) : h('div', { class: 'text-dim text-[13px]' }, 'Сначала добавь аккаунт — меню в левом верхнем углу'),
      h('h1', { class: 'greet text-[38px] leading-[1.1] mt-3 tracking-tight' }, titleText()),
      h('div', { class: 'flex items-center gap-3 mt-7 flex-wrap' }, h('div', { id: 'pill', class: 'pill' }), play)),
    h('div', { class: 'mt-7 flex-1 min-h-[150px] flex flex-col bg-panel rounded-[28px] border border-line overflow-hidden' },
      h('div', { class: 'flex items-center justify-between px-6 pt-4 pb-1 shrink-0' },
        h('div', { class: 'text-[13px] font-bold' }, consoleOpen ? 'Консоль' : 'Обновления клиента'),
        h('button', { class: 'text-[12px] text-dim hover:text-ink font-semibold', onclick: () => { consoleOpen = !consoleOpen; renderPage(); } }, consoleOpen ? 'Новости' : 'Консоль')),
      h('div', { id: 'feed', class: 'flex-1 min-h-0 overflow-y-auto px-6 pb-5' })));

  main.append(h('div', { class: 'fade-in h-full min-h-[540px] flex justify-center' },
    h('div', { class: 'h-full w-full max-w-[1040px] flex gap-[46px] px-10 pb-[56px] pt-[54px]' }, art, right)));
  paintPill();
  paintFeed();
  refreshServers();
}

const SOURCE_NAMES = { modrinth: 'Modrinth App', curseforge: 'CurseForge', prism: 'Prism Launcher', atlauncher: 'ATLauncher', dawn: 'Dawn', multimc: 'MultiMC', gdlauncher: 'GDLauncher', lunar: 'Lunar Client', folder: 'папки' };
const importSourceName = (id) => SOURCE_NAMES[id] || id || '';

async function startPlay() {
  progress = null;
  logs = [];
  rerollTitle(false);
  launching = true;
  syncOverlay();
  try { await call(api.play); } catch (_) { /* тост уже показан */ }
  launching = false;
  syncOverlay();
}

// ============================================================ экран запуска

function openOverlay() {
  const refs = {
    title: h('div', { class: 'text-[44px] font-bold leading-none tracking-tight' }, 'Запускаем игру'),
    tip: h('div', { class: 'text-[24px] leading-[1.35] max-w-[640px] tip-swap font-normal' }),
    step: h('div', { class: 'text-[19px] flex items-baseline justify-center gap-2 min-h-[28px]' }),
    bar: h('div', { class: 'h-full bg-soft rounded-full transition-[width] duration-200', style: 'width:0%' }),
    btn: h('button', { class: 'abort-btn', onclick: async () => { refs.btn.disabled = true; setText(refs.btn, 'Прерываю…'); await act(api.abort); } }, 'Прервать')
  };
  const root = h('div', { class: 'overlay-in fixed inset-0 z-[60] bg-black/80 backdrop-blur-2xl grid place-items-center px-8', role: 'dialog', 'aria-label': 'Запуск игры' },
    h('div', { class: 'flex flex-col items-center text-center gap-7' },
      refs.title, refs.tip,
      h('div', { class: 'flex flex-col items-center gap-3 mt-1' }, refs.step, h('div', { class: 'w-[300px] h-[3px] rounded-full bg-line2 overflow-hidden' }, refs.bar)),
      refs.btn));
  $('#overlay-root').append(root);
  ovl = { root, refs, timer: null };
  paintTip(true);
  ovl.timer = setInterval(() => paintTip(false), 7000);
  paintOverlay();
}

function paintTip(first) {
  if (!ovl) return;
  const t = first ? (rerollTip(), tipText()) : (rerollTip(), tipText());
  const tip = ovl.refs.tip;
  tip.textContent = '';
  tip.classList.remove('tip-swap');
  void tip.offsetWidth;
  tip.classList.add('tip-swap');
  tip.append(h('b', {}, 'Совет:'), ' ' + t);
}

function paintOverlay() {
  if (!ovl) return;
  const r = ovl.refs, p = progress;
  r.step.textContent = '';
  if (!p) { r.step.append(h('span', { class: 'text-dim' }, 'Подготовка…')); r.bar.style.width = '0%'; return; }
  const frac = p.total ? Math.min(1, p.done / p.total) : 0;
  r.bar.style.width = Math.round((((p.step - 1) + frac) / p.steps) * 1000) / 10 + '%';
  const mb = (n) => (n / 1048576).toFixed(n > 10485760 ? 0 : 1);
  r.step.append(...[h('b', {}, p.step + '/' + p.steps), ' ' + T(p.name), p.label ? h('span', { class: 'text-dim' }, ' ' + T(p.label)) : null,
    p.total ? h('span', { class: 'text-mute text-[14px] tabular-nums' }, ' · ', mb(p.done) + '/' + mb(p.total) + ' МБ') : null].filter(Boolean));
}

function closeOverlay() {
  if (!ovl) return;
  clearInterval(ovl.timer);
  ovl.root.remove();
  ovl = null;
}

function syncOverlay() {
  const want = launching || S.state === 'installing';
  if (want && !ovl) openOverlay();
  else if (!want && ovl) closeOverlay();
}

/** Меняет текст только если он действительно изменился. */
function setText(el, text) {
  text = T(text);
  if (el.textContent !== text) el.textContent = text;
}

function logClass(l) {
  if (/ERROR|Exception|FATAL/.test(l)) return 'text-abort';
  if (/WARN/.test(l)) return 'text-warn';
  if (l.startsWith('[launcher]')) return 'text-ink';
  return 'text-dim';
}

/** Нижняя карточка главной: консоль или лента релизов. */
function paintFeed() {
  const feed = $('#feed');
  if (!feed) return;
  feed.textContent = '';
  if (consoleOpen) {
    const pre = h('div', { id: 'console', class: 'font-mono text-[11px] leading-4 select-text', style: 'font-family:Consolas,monospace' });
    for (const l of logs) pre.append(h('div', { class: logClass(l) }, l));
    feed.append(pre);
    feed.scrollTop = feed.scrollHeight;
  } else renderReleases();
}

function pushLog(line) {
  logs.push(line);
  if (logs.length > 600) logs.shift();
  const pre = $('#console');
  if (pre) {
    const feed = pre.parentElement;
    const stick = feed.scrollTop + feed.clientHeight >= feed.scrollHeight - 30;
    pre.append(h('div', { class: logClass(line) }, line));
    while (pre.childNodes.length > 600) pre.firstChild.remove();
    if (stick) feed.scrollTop = feed.scrollHeight;
  }
}

// ---- лента релизов

async function loadReleases(force) {
  if (rel.state === 'loading' || (rel.state === 'ok' && !force)) return;
  rel = { state: 'loading', list: rel.list, err: null };
  renderReleases();
  const r = await api.releases();
  rel = r.ok ? { state: 'ok', list: r.data, err: null } : { state: 'err', list: rel.list, err: r.error };
  renderReleases();
}

function renderReleases() {
  const box = $('#feed');
  if (!box || consoleOpen) return;
  box.textContent = '';
  if (rel.state === 'loading' && !rel.list.length) { box.append(h('div', { class: 'h-1 rounded-full pulse-bar mt-3' })); return; }
  if (rel.state === 'err' && !rel.list.length) {
    box.append(h('div', { class: 'py-6 text-center flex flex-col items-center gap-3' },
      h('div', { class: 'text-dim text-[12px] font-normal' }, 'Не получилось загрузить ленту: ' + rel.err),
      h('button', { class: 'btn btn-sm', onclick: () => loadReleases(true) }, 'Повторить')));
    return;
  }
  if (!rel.list.length) { box.append(h('div', { class: 'py-8 text-center text-dim font-normal' }, 'Релизов пока нет.')); return; }
  box.append(...rel.list.map((r, i) => h('article', { class: 'py-4 ' + (i ? 'border-t border-line' : '') },
    h('div', { class: 'flex items-baseline gap-3 flex-wrap' },
      h('span', { class: 'text-[16px] font-bold' }, r.version.startsWith('v') ? r.version : 'v' + r.version),
      h('span', { class: 'text-mute text-[12px] font-normal' }, fmtDate(r.date)),
      r.prerelease ? h('span', { class: 'chip' }, 'пре-релиз') : null,
      r.url ? h('button', { class: 'ml-auto text-mute hover:text-ink', title: 'Открыть на GitHub', 'aria-label': 'Открыть на GitHub', onclick: () => api.external(r.url) }, svg('link', 15)) : null),
    r.headline ? h('div', { class: 'font-semibold text-[13px] mt-1' }, r.headline) : null,
    r.blocks.length ? h('ul', { class: 'mt-2 flex flex-col gap-1.5' }, r.blocks.map((b) => b.type === 'li'
      ? h('li', { class: 'flex gap-3 text-dim text-[12px] leading-5 font-normal' }, h('span', { class: 'mt-[8px] w-1 h-1 rounded-full bg-mute shrink-0' }), b.text)
      : h('li', { class: 'text-dim text-[12px] leading-5 font-normal' }, b.text))) : null)));
}

// ============================================================ страница «Сборки»

function renderInstances(main) {
  const cards = S.instances.map((i) => {
    const on = i.id === S.settings.selectedInstance;
    return h('div', { class: 'card p-3 pr-5 flex items-center gap-4 flex-wrap ' + (on ? '!border-mute' : '') },
      cover(i, 'w-[58px] h-[76px] rounded-2xl shrink-0'),
      h('div', { class: 'flex-1 min-w-[160px]' },
        h('div', { class: 'font-bold text-[15px] truncate' }, isStandard(i) ? i.name : i.name),
        h('div', { class: 'text-[12px] text-dim font-normal mt-0.5' }, 'Minecraft ' + i.mc + (i.fabric ? ' · Fabric' : ' · Vanilla') + (i.fabric && i.darkx !== false && S.darkxVersions.includes(i.mc) ? ' · DX Visuals' : '')),
        isStandard(i) ? h('span', { class: 'chip mt-1.5' }, 'Стандартная')
          : i.kind === 'imported' ? h('span', { class: 'chip mt-1.5' }, 'Из ' + importSourceName(i.source)) : null),
      on ? h('span', { class: 'chip chip-accent' }, 'Выбрана')
        : h('button', { class: 'btn btn-sm', onclick: async () => setState(await call(api.selectInstance, i.id)) }, 'Выбрать'),
      i.fabric ? h('button', { class: 'btn btn-sm', onclick: async () => { const s = await act(api.saveSettings, { modsInstance: i.id }); if (s) { S = s; go('mods'); } } }, svg('puzzle', 14), 'Моды') : null,
      h('button', { class: 'btn btn-sm', onclick: async () => { await call(api.selectInstance, i.id); api.openFolder('instance'); } }, 'Папка'),
      h('button', { class: 'btn btn-sm btn-bad', onclick: () => confirmDelete(i) }, 'Удалить'));
  });
  main.append(h('div', { class: 'fade-in flex flex-col gap-6 max-w-3xl mx-auto' },
    h('div', { class: 'flex items-center justify-between' },
      h('h2', { class: 'text-[26px] tracking-tight' }, 'Сборки'),
      h('button', { class: 'btn btn-accent', onclick: () => openWizard() }, svg('plus', 16), 'Мастер создания сборок')),
    h('div', { class: 'flex flex-col gap-3' }, cards)));
}

function confirmDelete(i) {
  modal('Удалить «' + i.name + '»?', h('div', { class: 'text-dim' }, 'Папка сборки (миры, настройки, моды) будет удалена без возможности восстановления.'),
    (close) => [h('button', { class: 'btn', onclick: close }, 'Отмена'),
      h('button', { class: 'btn btn-bad', onclick: async () => { const s = await act(api.deleteInstance, i.id); close(); if (s) setState(s); } }, 'Удалить')]);
}

// ============================================================ страница «Настройки»

// ============================================================ обновление лаунчера

function setUpdate(info) {
  S.update = info;
  renderNav();
  if (page === 'settings') renderPage();
}

/** Окно «Доступно обновление»: что нового + кнопка. Скачивание идёт в main, прогресс приходит событиями. */
function openUpdate(auto) {
  const u = S.update;
  if (!u || !u.available) return;
  const bar = h('div', { class: 'h-full bg-accent rounded-full', style: 'width:0%' });
  const label = h('div', { class: 'text-dim text-[12px]' }, '');
  const prog = h('div', { class: 'hidden flex flex-col gap-2' }, h('div', { class: 'h-2 rounded-full bg-black border border-line overflow-hidden' }, bar), label);
  let busy = !!auto; // автоустановка: main уже качает, кнопки не нужны
  if (auto) prog.classList.remove('hidden');
  updateUi = (p) => {
    const frac = p.total ? Math.min(1, p.done / p.total) : 0;
    bar.style.width = Math.round(frac * 1000) / 10 + '%';
    setText(label, p.total ? (p.done / 1048576).toFixed(1) + ' / ' + (p.total / 1048576).toFixed(1) + ' МБ' : 'Скачивание…');
  };
  const notes = u.blocks && u.blocks.length
    ? h('ul', { class: 'flex flex-col gap-1.5 text-[12px] text-dim max-h-[220px] overflow-y-auto' }, u.blocks.map((b) =>
      h('li', { class: 'flex gap-2' }, b.type === 'li' ? h('span', { class: 'text-accent' }, '•') : null, h('span', {}, b.text))))
    : null;
  modal(auto ? 'Обновляю лаунчер' : 'Доступно обновление', h('div', { class: 'flex flex-col gap-3' },
    h('div', { class: 'flex items-baseline gap-2' }, h('span', { class: 'text-[22px] font-bold text-accent' }, 'v' + u.latest), h('span', { class: 'text-dim text-[12px]' }, 'сейчас v' + u.current)),
    u.headline ? h('div', { class: 'font-bold' }, u.headline) : null,
    notes,
    auto ? h('div', { class: 'text-[11px] text-mute' }, 'Скачиваю и ставлю новую версию, лаунчер сам перезапустится.') : null,
    !u.canInstall ? h('div', { class: 'text-[11px] text-mute' }, 'Это сборка для разработки — автообновление работает только в установленной версии.') : null,
    u.note ? h('div', { class: 'text-[11px] text-bad' }, u.note) : null,
    prog), (close) => {
    if (auto) return [];
    const go = h('button', { class: 'btn btn-accent', onclick: async () => {
      if (busy) return;
      busy = true;
      go.disabled = true;
      prog.classList.remove('hidden');
      setText(go, 'Обновляю…');
      try {
        await call(api.updateInstall);
        setText(label, 'Перезапуск лаунчера…');
      } catch (_) {
        busy = false;
        go.disabled = false;
        setText(go, 'Повторить');
      }
    } }, 'Обновить');
    if (!u.canInstall || !u.asset) {
      go.disabled = true;
      return [h('button', { class: 'btn', onclick: () => api.external(u.page) }, 'Открыть страницу релиза'), h('button', { class: 'btn', onclick: close }, 'Закрыть')];
    }
    return [h('button', { class: 'btn', onclick: () => { if (!busy) close(); } }, 'Позже'), go];
  }, 480);
}
let updateUi = () => {};

function updateCard() {
  const s = S.settings;
  const status = h('div', { class: 'text-[12px] text-dim' }, S.update
    ? (S.update.available ? 'Доступна версия ' + S.update.latest : 'Установлена последняя версия')
    : 'Проверка ещё не выполнялась');
  const btn = h('button', { class: 'btn', onclick: async () => {
    btn.disabled = true;
    setText(btn, 'Проверяю…');
    try {
      const info = await call(api.updateCheck);
      setUpdate(info);
      if (info.available) openUpdate();
      else toast('У тебя последняя версия — v' + info.current, 'ok');
    } catch (_) { /* тост уже показан */ }
    btn.disabled = false;
    setText(btn, 'Проверить обновления');
  } }, 'Проверить обновления');
  const auto = h('input', { type: 'checkbox', checked: s.autoUpdate !== false, onchange: (e) => {
    s.autoUpdate = e.target.checked;
    api.saveSettings({ autoUpdate: e.target.checked });
  } });
  const autoInst = h('input', { type: 'checkbox', checked: s.autoInstall !== false, onchange: (e) => {
    s.autoInstall = e.target.checked;
    api.saveSettings({ autoInstall: e.target.checked });
  } });
  return h('div', { class: 'card p-5 flex flex-col gap-4' },
    h('h3', {}, 'Лаунчер'),
    h('div', { class: 'flex items-center justify-between gap-4' },
      h('div', {}, h('div', { class: 'font-bold' }, 'DarkX Launcher v' + S.version), status),
      S.update && S.update.available
        ? h('div', { class: 'flex gap-2' }, h('button', { class: 'btn btn-accent', onclick: openUpdate }, 'Обновить до ' + S.update.latest), btn)
        : btn),
    h('label', { class: 'flex items-center gap-3 text-[13px] cursor-pointer' }, auto, 'Проверять обновления при запуске'),
    h('label', { class: 'flex items-center gap-3 text-[13px] cursor-pointer' }, autoInst, 'Ставить обновления сами (скачать и перезапуститься при запуске)'));
}

/** Применяет язык: переводит окно и перерисовывает всё, что на экране. */
function applyLangStatic() {
  I18N.setLang(S.settings.lang);
  document.documentElement.lang = I18N.getLang();
  for (const [id, ru] of [['w-min', 'Свернуть'], ['w-max', 'Развернуть'], ['w-close', 'Закрыть']]) $('#' + id).setAttribute('aria-label', T(ru));
}

function applyLang() {
  applyLangStatic();
  closeModal();
  renderNav();
  renderHeader();
  renderPage();
}

function langCard() {
  return h('div', { class: 'card p-5 flex flex-col gap-4' },
    h('h3', {}, 'Язык'),
    h('div', { class: 'flex gap-2 flex-wrap' }, I18N.LANGS.map(([id, name]) => h('button', {
      class: 'btn ' + ((S.settings.lang || 'ru') === id ? 'btn-accent' : ''),
      onclick: () => { S.settings.lang = id; api.saveSettings({ lang: id }); applyLang(); }
    }, name))));
}

function renderSettings(main) {
  const s = S.settings;
  let timer = null;
  const save = (patch) => {
    Object.assign(S.settings, patch);
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const r = await call(api.saveSettings, patch);
      S = Object.assign(S, { effective: r.effective });
    }, 350);
  };
  const field = (label, value, key, ph, hint) => h('div', {},
    h('label', { class: 'label' }, label),
    h('input', { class: 'input', value: value || '', placeholder: ph || '', spellcheck: 'false', oninput: (e) => save({ [key]: e.target.value.trim() }) }),
    hint ? h('div', { class: 'text-[11px] text-mute mt-1' }, hint) : null);

  const mem = h('div', { class: 'text-accent font-bold w-20 text-right' }, (s.memoryMb / 1024).toFixed(1) + ' ГБ');
  const range = h('input', { type: 'range', min: '1024', max: '16384', step: '512', value: String(s.memoryMb), class: 'flex-1 accent-[rgb(var(--accent))]',
    oninput: (e) => { mem.textContent = T((e.target.value / 1024).toFixed(1) + ' ГБ'); save({ memoryMb: Number(e.target.value) }); } });

  const swatches = PRESETS.map(([name, hex]) => h('button', {
    title: name, 'aria-label': name,
    class: 'w-9 h-9 rounded-xl border-2 ' + (s.accent === hex ? 'border-ink' : 'border-line'),
    style: 'background:#' + hex,
    onclick: () => { S.settings.accent = hex; applyAccent(); save({ accent: hex }); renderPage(); }
  }));

  const behavior = h('select', { class: 'input', onchange: (e) => save({ onLaunch: e.target.value }) },
    [['minimize', 'Свернуть лаунчер'], ['keep', 'Оставить открытым'], ['close', 'Закрыть лаунчер']].map(([v, t]) => h('option', { value: v, selected: s.onLaunch === v }, t)));

  main.append(h('div', { class: 'fade-in flex flex-col gap-6 max-w-3xl mx-auto' },
    h('h2', { class: 'text-[22px]' }, 'Настройки'),
    langCard(),
    h('div', { class: 'card p-5 flex flex-col gap-4' },
      h('h3', {}, 'Внешний вид'),
      h('div', {}, h('label', { class: 'label' }, 'Акцентный цвет'), h('div', { class: 'flex gap-2 flex-wrap' }, swatches))),
    h('div', { class: 'card p-5 flex flex-col gap-4' },
      h('h3', {}, 'Игра'),
      h('div', {}, h('label', { class: 'label' }, 'Оперативная память'), h('div', { class: 'flex items-center gap-4' }, range, mem)),
      field('Свои аргументы JVM', s.jvmArgs, 'jvmArgs', '-XX:+UseG1GC', 'Необязательно'),
      field('Путь к Java', s.javaPath, 'javaPath', 'Пусто = Java от Mojang скачается сама', 'Для Minecraft 1.21 нужна Java 21'),
      h('div', {}, h('label', { class: 'label' }, 'После запуска игры'), behavior)),
    h('div', { class: 'card p-5 flex flex-col gap-4' },
      h('h3', {}, 'Сеть'),
      field('Прокси', s.proxy, 'proxy', 'http://127.0.0.1:7890 или socks5://127.0.0.1:1080',
        'Пусто = системные настройки (их обычно ставит VPN). Нужен, если сервера Mojang недоступны.')),
    updateCard(),
    h('div', { class: 'flex gap-3' },
      h('button', { class: 'btn', onclick: () => api.openFolder('root') }, 'Открыть папку данных'),
      h('span', { class: 'text-[11px] text-mute self-center truncate' }, S.root))));
}

// ============================================================ роутинг

function renderPage() {
  const main = $('#main');
  main.textContent = '';
  main.scrollTop = 0;
  main.classList.toggle('p-8', page !== 'play');
  if (page === 'play') renderPlay(main);
  else if (page === 'mods') renderMods(main);
  else if (page === 'instances') renderInstances(main);
  else if (page === 'skins') renderSkins(main);
  else renderSettings(main);
  if (!animateNext && main.firstChild) main.firstChild.classList.remove('fade-in');
  animateNext = false;
}

// ============================================================ пасхалка

/** 5 быстрых кликов по логотипу в шапке меняют его на детектива (assets/detektiv.jpg); ещё 5 — возвращают. */
function initEgg() {
  const box = $('#tb-logo');
  let clicks = 0, timer = null, on = false;
  box.addEventListener('click', () => {
    clicks++;
    clearTimeout(timer);
    timer = setTimeout(() => { clicks = 0; }, 1500);
    if (clicks < 5) return;
    clicks = 0;
    on = !on;
    box.textContent = '';
    box.classList.remove('pop-in');
    void box.offsetWidth; // перезапуск анимации появления
    box.classList.add('pop-in');
    if (!on) { box.innerHTML = LOGO; return; }
    const img = h('img', { src: '../assets/detektiv.jpg', alt: '', draggable: 'false', class: 'w-7 h-7 rounded-lg object-cover' });
    img.onerror = () => { on = false; box.innerHTML = LOGO; toast('Положи detektiv.jpg в папку assets лаунчера', 'bad'); };
    box.append(img);
  });
}

// ============================================================ старт

async function init() {
  $('#tb-logo').innerHTML = LOGO;
  initEgg();
  $('#w-min').onclick = () => api.win.min();
  $('#w-max').onclick = () => api.win.max();
  $('#w-close').onclick = () => api.win.close();

  const r = await api.state();
  S = r.data;
  applyLangStatic();
  applyAccent();
  renderNav();
  renderHeader();
  renderPage();
  loadReleases();
  reloadSkins().then(() => renderHeader());

  rerollTitle(S.firstRun);
  api.onState(({ state }) => {
    S.state = state;
    if (state !== 'installing') progress = null;
    if (state === 'running') consoleOpen = true;
    syncOverlay();
    if (page === 'play') renderPage();
  });
  api.onProgress((p) => { progress = p; paintOverlay(); });
  api.onImport((p) => importUi(p));
  api.onLog(pushLog);
  api.onUpdate((info) => { const fresh = info.available && !(S.update && S.update.available && S.update.latest === info.latest); setUpdate(info); if (info.auto) openUpdate(true); else if (fresh) toast('Доступно обновление лаунчера ' + info.latest, 'ok'); });
  api.onUpdateError(({ error }) => { closeModal(); toast('Обновление не удалось: ' + error, 'bad'); });
  api.onUpdateProgress((p) => updateUi(p));
  api.onExit(({ code }) => {
    pushLog('[launcher] игра завершилась, код ' + code);
    if (code !== 0) toast('Игра завершилась с кодом ' + code + ' — смотри консоль', 'bad');
  });
  api.onMod(({ text }) => {
    for (const b of document.querySelectorAll('[data-mod-btn]')) setText(b, text);
  });
  api.onMs((m) => {
    if (m.done) {
      if (msUi) msUi.close();
      setState(m.state);
      toast('Аккаунт Microsoft добавлен', 'ok');
    } else if (m.error && msUi) {
      msUi.status.textContent = T(m.error);
      msUi.status.className = 'text-[12px] text-bad';
    }
  });
}

init();
