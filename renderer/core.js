'use strict';
/* Общие утилиты интерфейса. Всё строится через DOM API (textContent), чтобы ники, названия модов и пути не могли внедрить HTML. */

const PRESETS = [
  ['Orange', 'F97316'], ['Phantom', '8B5CF6'], ['Crimson', 'EF4444'], ['Ocean', '38BDF8'],
  ['Emerald', '34D399'], ['Amber', 'F59E0B'], ['Rose', 'F472B6'], ['Ash', 'D4D4D4']
];

const LOGO = '<svg viewBox="0 0 160 160" width="100%" height="100%" aria-hidden="true">'
  + '<g fill="#E4E4E2"><circle cx="30.5" cy="30.5" r="10"/><circle cx="129.5" cy="129.5" r="10"/></g>'
  + '<g stroke="#E4E4E2" stroke-width="12.5" fill="none"><line x1="36" y1="36" x2="65.5" y2="65.5"/><line x1="94" y1="94" x2="124" y2="124"/></g>'
  + '<line x1="127.5" y1="29.5" x2="31" y2="127" stroke="rgb(var(--accent))" stroke-width="12.5" stroke-linecap="round"/></svg>';

const ICON = {
  play: '<path d="M8 5v14l11-7z" fill="currentColor"/>',
  puzzle: '<path d="M10 3.5a2 2 0 0 1 4 0V6h3.5A1.5 1.5 0 0 1 19 7.5V11h-2.5a2 2 0 0 0 0 4H19v3.5a1.5 1.5 0 0 1-1.5 1.5H14v-2.5a2 2 0 0 0-4 0V20H6.5A1.5 1.5 0 0 1 5 18.5V15h2.5a2 2 0 0 0 0-4H5V7.5A1.5 1.5 0 0 1 6.5 6H10z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>',
  layers: '<path d="M12 3l9 5-9 5-9-5zM3 13l9 5 9-5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>',
  wardrobe: '<path d="M12 3.2a2 2 0 0 1 2 2c0 1-.8 1.5-2 2.3L3.6 12.6A1.6 1.6 0 0 0 4.4 15.5h15.2a1.6 1.6 0 0 0 .8-2.9L12 7.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"/><path d="M5 15.5V20h14v-4.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>',
  gear: '<g fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></g>',
  chevron: '<path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>',
  plus: '<path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>',
  download: '<path d="M12 4v11m0 0l-4.5-4.5M12 15l4.5-4.5M5 19.5h14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>',
  close: '<path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  search: '<circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M16 16l4.5 4.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  download: '<path d="M12 4v11M7 11l5 5 5-5M5 20h14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
  trash: '<path d="M5 7h14M9 7V4.5h6V7M7 7l1 13h8l1-13" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>',
  ms: '<path d="M3 3h8.5v8.5H3zM12.5 3H21v8.5h-8.5zM3 12.5h8.5V21H3zM12.5 12.5H21V21h-8.5z" fill="currentColor"/>',
  shield: '<path d="M12 3l7 3v5c0 5-3 8-7 10-4-2-7-5-7-10V6z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>',
  user: '<circle cx="12" cy="8" r="4" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6" fill="none" stroke="currentColor" stroke-width="1.8"/>',
  grid: '<g fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3.5" y="3.5" width="7" height="7" rx="2.6"/><rect x="13.5" y="3.5" width="7" height="7" rx="2.6"/><rect x="3.5" y="13.5" width="7" height="7" rx="2.6"/><rect x="13.5" y="13.5" width="7" height="7" rx="2.6"/></g>',
  tools: '<g fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" stroke-linecap="round"><g transform="rotate(-45 12 12)"><rect x="9" y="2.4" width="6" height="19.2" rx="1.5"/><path d="M9 6.4h2.4M9 9.9h3.4M9 13.4h2.4M9 16.9h3.4"/></g><g transform="rotate(45 12 12)"><path d="M10.1 3.4h3.8v13l-1.9 4.2-1.9-4.2z" fill="#18181B"/><path d="M10.1 7.2h3.8"/></g></g>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>',
  warn: '<path d="M12 4l9 15.5H3z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M12 10v4.2M12 16.8v.2" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  arrow: '<path d="M9 5.5l6.5 6.5L9 18.5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>',
  server: '<g fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="3.5" y="4" width="17" height="6.5" rx="2"/><rect x="3.5" y="13.5" width="17" height="6.5" rx="2"/><path d="M7 7.2h.01M7 16.8h.01"/></g>',
  link: '<path d="M14 5h5v5M19 5l-8 8M18 14v4.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>',
  star4: '<path d="M12 2.2c.4 0 .75.26.88.64l1.82 5.26a1.6 1.6 0 0 0 1.02 1.02l5.26 1.82a.93.93 0 0 1 0 1.76l-5.26 1.82a1.6 1.6 0 0 0-1.02 1.02l-1.82 5.26a.93.93 0 0 1-1.76 0l-1.82-5.26a1.6 1.6 0 0 0-1.02-1.02L3.02 12.7a.93.93 0 0 1 0-1.76l5.26-1.82a1.6 1.6 0 0 0 1.02-1.02l1.82-5.26c.13-.38.48-.64.88-.64z" fill="currentColor"/>',
  globe: '<g fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M3.6 9h16.8M3.6 15h16.8"/><path d="M12 3a14.5 14.5 0 0 0 0 18 14.5 14.5 0 0 0 0-18z"/></g>',
  arrowUp: '<path d="M12 19V5M6 11l6-6 6 6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>',
  arrowLeft: '<path d="M19 12H5M11 6l-6 6 6 6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>',
  stopSq: '<rect x="7" y="7" width="10" height="10" rx="2.2" fill="currentColor"/>',
  send: '<path d="M21 3L10 14M21 3l-7 18-4-7-7-4 18-7z" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/>'
};

const svg = (name, size = 20, cls = '') => h('span', { class: 'inline-grid place-items-center shrink-0 ' + cls, style: 'width:' + size + 'px;height:' + size + 'px',
  html: '<svg viewBox="0 0 24 24" width="' + size + '" height="' + size + '" aria-hidden="true">' + ICON[name] + '</svg>' });

let S = null;            // состояние из main
let page = 'play';
let animateNext = true;  // fade-in только при смене вкладки, а не при каждом обновлении состояния

const T = (s) => I18N.T(s);
const TR_ATTRS = ['placeholder', 'title', 'aria-label'];

function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'html') el.innerHTML = v; // только статичные SVG из этого проекта
    else el.setAttribute(k, v === true ? '' : TR_ATTRS.includes(k) ? T(v) : v);
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid == null || kid === false) continue;
    el.append(kid.nodeType ? kid : document.createTextNode(T(String(kid))));
  }
  return el;
}

function initialsOf(name) {
  const words = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return 'DX';
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  return words[0].slice(0, 2).toUpperCase();
}

const $ = (s, r = document) => r.querySelector(s);

function hexToRgb(hex) {
  const n = parseInt(hex, 16);
  return ((n >> 16) & 255) + ' ' + ((n >> 8) & 255) + ' ' + (n & 255);
}

function applyAccent() {
  document.documentElement.style.setProperty('--accent', hexToRgb(S.settings.accent || 'F97316'));
}

function toast(text, kind) {
  const color = kind === 'bad' ? 'border-bad/60 text-bad' : kind === 'ok' ? 'border-ok/60 text-ok' : 'border-line text-ink';
  const t = h('div', { class: 'fade-in card px-4 py-3 max-w-sm text-[12px] ' + color }, text);
  $('#toasts').append(t);
  setTimeout(() => t.remove(), kind === 'bad' ? 7000 : 3500);
}

/** Вызов API: бросает ошибку и показывает тост, если main вернул ok:false. */
async function call(fn, ...args) {
  const r = await fn(...args);
  if (!r.ok) {
    if (r.code !== 'ABORTED') toast(r.error, 'bad'); // отмена пользователем — не ошибка

    const e = new Error(r.error);
    e.code = r.code;
    throw e;
  }
  return r.data;
}

async function act(fn, ...args) {
  try { return await call(fn, ...args); } catch (_) { return undefined; }
}

const currentInstance = () => S.instances.find((i) => i.id === S.settings.selectedInstance) || S.instances[0];
const currentAccount = () => S.accounts.find((a) => a.id === S.settings.selectedAccount);

// ============================================================ модальные окна и меню

let closeModal = () => {};

/** Модалка по центру. actions(close) → массив кнопок; можно не передавать. */
function modal(title, body, actions, width) {
  const root = $('#modal-root');
  const close = () => { root.textContent = ''; closeModal = () => {}; };
  closeModal = close;
  const box = h('div', { class: 'pop-in card max-w-[92vw] p-6 flex flex-col gap-4', style: 'width:' + (width || 460) + 'px' },
    title ? h('div', { class: 'flex items-center justify-between' }, h('h3', { class: 'text-[16px]' }, title),
      h('button', { class: 'text-dim hover:text-ink', 'aria-label': 'Закрыть', onclick: close }, svg('close', 18))) : null,
    body, actions ? h('div', { class: 'flex justify-end gap-2' }, actions(close)) : null);
  root.textContent = '';
  root.append(h('div', { class: 'fixed inset-0 z-40 bg-black/80 grid place-items-center', onmousedown: (e) => { if (e.target === e.currentTarget) close(); } }, box));
  return close;
}

let closePop = null;

/** Выпадающее меню у элемента anchor. build(close) → содержимое. place: 'below' | 'above'. */
function popover(anchor, build, { place = 'below', align = 'left', width } = {}) {
  if (closePop) closePop();
  const r = anchor.getBoundingClientRect();
  const box = h('div', { class: 'pop-in card p-2 fixed z-30 flex flex-col gap-1 max-h-[70vh] overflow-y-auto', style: 'visibility:hidden' });
  const close = () => { box.remove(); document.removeEventListener('mousedown', out, true); closePop = null; };
  const out = (e) => { if (!box.contains(e.target) && !anchor.contains(e.target)) close(); };
  closePop = close;
  box.append(...[].concat(build(close)).flat(Infinity).filter((x) => x != null && x !== false)); // build может вернуть вложенные массивы (списки аккаунтов, профилей)
  document.body.append(box);
  const w = width || Math.max(r.width, 240);
  box.style.width = w + 'px';
  let left = align === 'right' ? r.right - w : r.left;
  left = Math.max(8, Math.min(left, window.innerWidth - w - 8));
  box.style.left = left + 'px';
  if (place === 'above') box.style.bottom = (window.innerHeight - r.top + 8) + 'px';
  else box.style.top = (r.bottom + 8) + 'px';
  box.style.visibility = '';
  setTimeout(() => document.addEventListener('mousedown', out, true), 0);
  return close;
}

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (closePop) closePop();
  else closeModal();
});

// ============================================================ аватары (голова скина)

/** Голова 8×8 из скина (с наложением шляпы). src = data:URL или null — тогда рисуем стандартную. */
function headCanvas(size, src) {
  const c = h('canvas', { width: 8, height: 8, class: 'rounded-lg shrink-0', style: 'width:' + size + 'px;height:' + size + 'px;image-rendering:pixelated' });
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = false;
  const fallback = () => {
    // стандартная голова — своя пиксель-арт заготовка
    const rows = ['HHHHHHHH', 'HHHHHHHH', 'HSSSSSSH', 'SSSSSSSS', 'SESSSSES', 'SSSSSSSS', 'SSMMMMSS', 'SSSSSSSS'];
    const col = { H: '#3A2B22', S: '#D9A98A', E: '#27406B', M: '#A8624A' };
    rows.forEach((row, y) => [...row].forEach((ch, x) => { g.fillStyle = col[ch]; g.fillRect(x, y, 1, 1); }));
  };
  if (!src) { fallback(); return c; }
  const img = new Image();
  img.onload = () => { g.clearRect(0, 0, 8, 8); g.drawImage(img, 8, 8, 8, 8, 0, 0, 8, 8); g.drawImage(img, 40, 8, 8, 8, 0, 0, 8, 8); };
  img.onerror = fallback;
  img.src = src;
  return c;
}

/** Скин, который сейчас опубликован под ником аккаунта (или null). */
function skinOf(acc) {
  if (!acc || !K) return null;
  const id = (K.active || {})[acc.name.toLowerCase()];
  const it = id && K.list.find((x) => x.id === id);
  return it ? it.data : null;
}
let K = null; // состояние скинов {list, active}

const avatar = (acc, size) => headCanvas(size, skinOf(acc));

/** Даты и текст */
function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return isNaN(d) ? '' : d.toLocaleDateString(I18N.locale(), { day: 'numeric', month: 'long', year: 'numeric' });
}

const fmtNum = (n) => (n >= 1e6 ? (n / 1e6).toFixed(1).replace(/\.0$/, '') + ' млн' : n >= 1e3 ? (n / 1e3).toFixed(n >= 1e4 ? 0 : 1).replace(/\.0$/, '') + ' тыс.' : String(n));

const LOADER_ICONS = {
  dx: '../assets/loaders/dx.png',
  vanilla: '../assets/loaders/vanilla.png',
  fabric: '../assets/loaders/fabric.png',
  forge: '../assets/loaders/forge.png',
  neoforge: '../assets/loaders/neoforge.png'
};

const LOADER_NAMES = {
  dx: 'DX Visuals',
  vanilla: 'Vanilla',
  fabric: 'Fabric',
  forge: 'Forge',
  neoforge: 'NeoForge'
};

function instLoaderId(inst) {
  if (!inst) return 'dx';
  if (inst.loaderOrigin && LOADER_ICONS[inst.loaderOrigin]) return inst.loaderOrigin;
  if (inst.loader && LOADER_ICONS[inst.loader]) return inst.loader;
  if (inst.kind === 'standard') return 'dx';
  if (inst.fabric && inst.darkx !== false && S && S.darkxVersions && S.darkxVersions.includes(inst.mc)) return 'dx';
  if (inst.fabric) return 'fabric';
  return 'vanilla';
}

function instLoaderName(inst) {
  return LOADER_NAMES[instLoaderId(inst)] || 'Fabric';
}

function instIconBadge(inst, size = 80, radius = 24) {
  const r = radius >= 999 ? '9999px' : radius + 'px';
  if (inst && inst.icon) {
    return h('div', {
      class: 'overflow-hidden shrink-0 shadow-xl border border-white/15 bg-black/50',
      style: 'width:' + size + 'px;height:' + size + 'px;border-radius:' + r
    }, h('img', { src: inst.icon, alt: '', draggable: 'false', class: 'w-full h-full object-cover' }));
  }
  const fontSize = Math.max(14, Math.round(size * 0.39));
  return h('div', {
    class: 'grid place-items-center shrink-0 font-extrabold text-white select-none shadow-xl',
    style: 'width:' + size + 'px;height:' + size + 'px;border-radius:' + r
      + ';font-size:' + fontSize + 'px;background:rgba(16,16,20,0.68);backdrop-filter:blur(12px);border:1px solid rgba(255,255,255,0.14)'
  }, initialsOf(inst ? inst.name : 'DX'));
}

function fmtLastPlayed(ts) {
  if (!ts) return 'недавно';
  const d = new Date(ts);
  if (isNaN(d)) return 'недавно';
  const now = new Date();
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString(I18N.locale(), { hour: '2-digit', minute: '2-digit' });
  }
  return d.toLocaleDateString(I18N.locale(), { day: 'numeric', month: 'long' });
}

