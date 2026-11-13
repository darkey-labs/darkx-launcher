'use strict';
/* Мастер создания сборок: перенос из других лаунчеров и быстрое создание. Общие утилиты — в core.js. */

let versions = null;
let importUi = () => {}; // прогресс переноса из main

async function ensureVersions() {
  if (versions) return versions;
  const r = await api.versions();
  if (!r.ok) { toast('Не удалось получить список версий: ' + r.error, 'bad'); return null; }
  versions = r.data;
  return versions;
}

// ------------------------------------------------------------ значки лаунчеров (упрощённые собственные рисунки в цветах брендов)

const MARKS = {
  modrinth: '<circle cx="24" cy="24" r="16" fill="none" stroke="#1BD96A" stroke-width="5.5"/><path d="M15 27c5 5 13 4 17-3" fill="none" stroke="#1BD96A" stroke-width="4.5" stroke-linecap="round"/><circle cx="24" cy="24" r="3.4" fill="#1BD96A"/>',
  curseforge: '<path d="M7 11h34l-3.6 7.2H27.5c.4 3 3.6 3.6 4.6 8.4H16c1-4.8 4.2-5.4 4.6-8.4H10.6z" fill="#F16436"/><path d="M14 31h20l1.6 5H12.4z" fill="#F16436"/>',
  prism: '<path d="M24 5l16 9v20L24 43 8 34V14z" fill="#6B4E3D"/><path d="M24 5l16 9-16 9-16-9z" fill="#E4E4E2"/><path d="M24 23l16-9v20L24 43z" fill="#3FA7D6"/><path d="M24 23L8 14v20l16 9z" fill="#E85D75"/><path d="M24 23l16 11-16 9z" fill="#7BC74D" opacity=".9"/>',
  atlauncher: '<path d="M24 5l17 9.5v19L24 43 7 33.5v-19z" fill="#2A79D4"/><path d="M17 33l7-17 7 17M19.6 28h8.8" fill="none" stroke="#E4E4E2" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/>',
  dawn: '<path d="M8 32a16 16 0 0 1 32 0z" fill="#FF9F4A"/><path d="M24 8v6M9 14l4 4M39 14l-4 4M4 26h6M38 26h6" stroke="#FFC37D" stroke-width="3" stroke-linecap="round"/><path d="M6 37h36" stroke="#E4E4E2" stroke-width="3" stroke-linecap="round"/>',
  multimc: '<path d="M24 5l16 9v20L24 43 8 34V14z" fill="#1C2733" stroke="#4C8FD6" stroke-width="3"/><path d="M16 31V17l8 8 8-8v14" fill="none" stroke="#E4E4E2" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/>',
  gdlauncher: '<rect x="6" y="6" width="36" height="36" rx="10" fill="#6C4CF1"/><path d="M29 18a7 7 0 1 0 0 12v-5h-5M32 18h4v12h-4z" fill="none" stroke="#E4E4E2" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>',
  lunar: '<path d="M32 8a16 16 0 1 0 8 26A13 13 0 0 1 32 8z" fill="#7CC8F0"/><circle cx="35" cy="14" r="2" fill="#E4E4E2"/><circle cx="39" cy="22" r="1.4" fill="#E4E4E2"/>',
  folder: '<path d="M6 14a3 3 0 0 1 3-3h9l4 4h17a3 3 0 0 1 3 3v17a3 3 0 0 1-3 3H9a3 3 0 0 1-3-3z" fill="#4A4A4E"/>'
};

// Настоящие логотипы лежат в assets/launchers/<id>.svg|png. Если файла нет, рисуем запасной значок из MARKS.
const LOGO_EXT = { modrinth: 'png', atlauncher: 'png', gdlauncher: 'png' };
const markSvg = (id, size) => '<svg viewBox="0 0 48 48" width="' + size + '" height="' + size + '" aria-hidden="true">' + (MARKS[id] || MARKS.folder) + '</svg>';
const mark = (id, size) => {
  const box = h('span', { class: 'inline-grid place-items-center shrink-0', style: 'width:' + size + 'px;height:' + size + 'px' });
  if (!MARKS[id] || id === 'folder') { box.innerHTML = markSvg(id, size); return box; }
  const img = new Image();
  img.alt = ''; img.draggable = false;
  img.className = 'w-full h-full object-contain';
  img.onerror = () => { box.innerHTML = markSvg(id, size); };
  img.src = '../assets/launchers/' + id + '.' + (LOGO_EXT[id] || 'svg');
  box.append(img);
  return box;
};

// ------------------------------------------------------------ окно

function openWizard(step, arg) {
  const box = h('div', { class: 'flex flex-col gap-5' });
  let busy = false;
  const close = modal(null, box, null, 680);
  const guard = () => { if (!busy) closeModal(); };

  const head = (title, back) => h('div', { class: 'flex items-center gap-3 pb-1' },
    back ? h('button', { class: 'w-10 h-10 rounded-full grid place-items-center text-dim hover:text-ink hover:bg-raise rotate-180', 'aria-label': 'Назад', onclick: back }, svg('arrow', 20)) : null,
    h('h2', { class: 'text-[28px] leading-tight flex-1 tracking-tight' }, title),
    h('button', { class: 'w-10 h-10 rounded-full grid place-items-center text-dim hover:text-ink hover:bg-raise', 'aria-label': 'Закрыть', onclick: guard }, svg('close', 22)));

  const show = (...kids) => { box.textContent = ''; box.append(...kids.flat().filter((x) => x != null && x !== false)); };

  // ---- главное меню
  const menu = () => {
    const stack = h('div', { class: 'grid grid-cols-2 gap-x-2 gap-y-1 place-items-center' },
      mark('modrinth', 26), mark('curseforge', 26), mark('prism', 26), h('span', { class: 'text-dim text-[18px] font-medium' }, '+5'));
    show(head('Мастер создания сборок'),
      h('div', { class: 'flex flex-col gap-3 pt-1' },
        h('button', { class: 'wiz-row', onclick: () => impPick() },
          h('span', { class: 'wiz-ico' }, stack),
          h('span', { class: 'flex-1 min-w-0' }, h('span', { class: 'block text-[19px] font-bold' }, 'Миграция с других лаунчеров'),
            h('span', { class: 'block text-[14px] text-dim font-normal mt-0.5' }, 'Переходите на DarkX? Перенесите свои сборки!')),
          svg('arrow', 20, 'text-mute')),
        h('button', { class: 'wiz-row', onclick: () => create() },
          h('span', { class: 'wiz-ico text-ink' }, svg('tools', 34)),
          h('span', { class: 'flex-1 min-w-0' }, h('span', { class: 'block text-[19px] font-bold' }, 'Создать новую сборку'),
            h('span', { class: 'block text-[14px] text-dim font-normal mt-0.5' }, 'Быстрое создание новой сборки за несколько кликов.')),
          svg('arrow', 20, 'text-mute'))));
  };

  // ---- выбор лаунчера
  const impPick = async () => {
    const grid = h('div', { class: 'grid grid-cols-2 sm:grid-cols-4 gap-3' });
    const manual = h('button', { class: 'btn self-start', onclick: pickFolder }, svg('folder', 16), 'Выбрать папку вручную…');
    show(head('Миграция с других лаунчеров', menu),
      h('div', { class: 'text-dim text-[13px] font-normal -mt-2' }, 'Выбери лаунчер — найду его сборки сам. Исходные файлы остаются на месте, переносится копия.'),
      grid, manual);
    const r = await api.importLaunchers();
    if (!r.ok) { toast(r.error, 'bad'); return; }
    for (const l of r.data.launchers) {
      const n = r.data.counts[l.id] || 0;
      grid.append(h('button', { class: 'tile p-3 pb-3.5 flex flex-col items-center gap-2 text-center hover:bg-raise transition-colors cursor-pointer border border-transparent hover:border-line2', onclick: () => impList(l.id, l.name) },
        mark(l.id, 40),
        h('span', { class: 'font-bold text-[13px] leading-tight' }, l.name),
        h('span', { class: 'text-[11px] ' + (n ? 'text-ok' : 'text-mute') }, n ? 'Найдено: ' + n : 'Не найдено')));
    }
  };

  const pickFolder = async () => {
    const r = await act(api.importPick);
    if (!r) return;
    impListShow(r.items, 'folder', 'Своя папка', r.dir);
  };

  const impList = async (id, name) => {
    show(head(name, impPick), h('div', { class: 'h-1 rounded-full pulse-bar' }), h('div', { class: 'text-dim text-[13px]' }, 'Ищу сборки…'));
    const items = await act(api.importDetect, id);
    impListShow(items || [], id, name);
  };

  // ---- список найденных сборок
  const impListShow = async (items, id, name, dir) => {
    const vs = await ensureVersions();
    const rows = items.map((it) => {
      const supported = it.loader === 'fabric' || it.loader === 'vanilla' || !it.loader;
      const chk = h('input', { type: 'checkbox', checked: true });
      const nameIn = h('input', { class: 'input !h-9 !rounded-xl !text-[13px] font-bold', value: it.name, maxlength: '32' });
      const sel = h('select', { class: 'input !h-9 !rounded-xl !text-[12px] !w-[120px]' },
        h('option', { value: '' }, 'Версия…'),
        (vs || []).map((v) => h('option', { value: v.id, selected: v.id === it.mc }, v.id)));
      if (it.mc && vs && !vs.some((v) => v.id === it.mc)) sel.prepend(h('option', { value: it.mc, selected: true }, it.mc));
      const meta = [
        it.mc ? h('span', {}, 'Minecraft ' + it.mc + (it.mcGuessed ? ' (по модам)' : '')) : h('span', { class: 'text-warn' }, 'Версия не определена'),
        h('span', {}, (it.loader || 'vanilla').replace(/^./, (c) => c.toUpperCase()).replace('Neoforge', 'NeoForge')),
        it.mods ? h('span', {}, 'Модов: ' + it.mods) : null,
        it.saves ? h('span', {}, 'Миров: ' + it.saves) : null,
        it.memoryMb ? h('span', {}, (it.memoryMb / 1024).toFixed(1) + ' ГБ') : null
      ].filter(Boolean);
      const metaLine = h('div', { class: 'flex flex-wrap items-center gap-x-2 text-[11px] text-dim font-normal' });
      meta.forEach((m, i) => { if (i) metaLine.append(h('span', { class: 'text-mute' }, '·')); metaLine.append(m); });
      return {
        it, chk, nameIn, sel,
        node: h('div', { class: 'tile px-4 py-3 flex items-center gap-3' }, chk,
          h('div', { class: 'flex-1 min-w-0 flex flex-col gap-1.5' }, nameIn, metaLine,
            !supported ? h('div', { class: 'flex items-start gap-1.5 text-[11px] text-warn font-normal' }, svg('warn', 14, 'mt-px'),
              h('span', {}, it.loader === 'forge' || it.loader === 'neoforge' || it.loader === 'quilt'
                ? 'Загрузчик ' + (it.loader === 'neoforge' ? 'NeoForge' : it.loader === 'forge' ? 'Forge' : 'Quilt') + ' не поддерживается: перенесутся миры, ресурспаки и настройки, моды — нет.'
                : 'Загрузчик не поддерживается: моды не переносятся.')) : null,
            it.note ? h('div', { class: 'text-[11px] text-dim font-normal' }, it.note) : null),
          it.mc ? null : sel)
      };
    });
    const darkx = h('input', { type: 'checkbox', checked: true });
    const count = h('span', {}, '');
    const go = h('button', { class: 'btn btn-accent', onclick: () => run() }, 'Перенести');
    const refreshCount = () => {
      const n = rows.filter((r) => r.chk.checked).length;
      go.disabled = !n;
      go.textContent = T('Перенести') + (n ? ' (' + n + ')' : '');
    };
    rows.forEach((r) => r.chk.addEventListener('change', refreshCount));
    const manual = h('button', { class: 'btn btn-sm', onclick: pickFolder }, svg('folder', 14), 'Выбрать папку вручную…');
    show(head(name, id === 'folder' ? impPick : impPick),
      dir ? h('div', { class: 'text-[11px] text-mute font-normal truncate -mt-2' }, dir) : null,
      rows.length
        ? h('div', { class: 'flex flex-col gap-2 max-h-[46vh] overflow-y-auto pr-1' }, rows.map((r) => r.node))
        : h('div', { class: 'tile p-6 text-center flex flex-col items-center gap-3' },
          h('div', { class: 'font-bold' }, 'Сборки не найдены'),
          h('div', { class: 'text-dim text-[12px] font-normal max-w-sm' }, 'Лаунчер установлен в нестандартную папку? Укажи её вручную — подойдёт корень лаунчера или папка самой сборки.'),
          manual),
      rows.length ? h('label', { class: 'flex items-center gap-3 text-[13px] cursor-pointer' }, darkx, 'Добавить DX Visuals к сборкам на Fabric') : null,
      rows.length ? h('div', { class: 'flex items-center justify-between gap-3' }, manual, go) : null);
    if (rows.length) refreshCount();

    async function run() {
      const chosen = rows.filter((r) => r.chk.checked);
      for (const r of chosen) if (!r.it.mc && !r.sel.value) { toast('Выбери версию Minecraft для «' + r.nameIn.value + '»', 'bad'); return; }
      busy = true;
      const bar = h('div', { class: 'h-full bg-soft rounded-full', style: 'width:0%' });
      const label = h('div', { class: 'text-[13px] text-dim font-normal truncate' }, '');
      const title = h('div', { class: 'text-[18px] font-bold' }, 'Переношу сборки…');
      const cancel = h('button', { class: 'btn btn-bad', onclick: () => { cancel.disabled = true; api.importCancel(); } }, 'Отмена');
      show(head('Перенос сборок'), h('div', { class: 'flex flex-col gap-4 py-4' }, title, label,
        h('div', { class: 'h-2.5 rounded-full bg-black border border-line2 overflow-hidden' }, bar),
        h('div', { class: 'flex justify-end' }, cancel)));
      let state = null, okCount = 0, skipped = 0, failed = null;
      for (let i = 0; i < chosen.length; i++) {
        const r = chosen[i];
        setText(label, 'Копирую «' + r.nameIn.value + '» (' + (i + 1) + ' из ' + chosen.length + ')');
        importUi = ({ done, total }) => { bar.style.width = Math.round(((i + (total ? done / total : 0)) / chosen.length) * 1000) / 10 + '%'; };
        const res = await api.importRun(r.it, { name: r.nameIn.value, mc: r.it.mc || r.sel.value, addDarkx: darkx.checked });
        if (!res.ok) { if (res.code !== 'ABORTED') failed = res.error; break; }
        state = res.data.state; okCount++; skipped += res.data.skippedMods ? 1 : 0;
      }
      importUi = () => {};
      busy = false;
      if (state) setState(state);
      if (failed) toast('Перенос остановлен: ' + failed, 'bad');
      if (okCount) {
        closeModal();
        toast(okCount === 1 ? 'Сборка перенесена' : 'Перенесено сборок: ' + okCount, 'ok');
        if (skipped) toast('Моды Forge/NeoForge/Quilt не перенесены — загрузчик не поддерживается', 'bad');
        go_('instances');
      } else impListShow(items, id, name, dir);
    }
  };

  // ---- новая сборка (дизайн по концепту Figma: Название, Модлоадер с 5 иконками, Версия и интерактивная Карточка справа)
  const create = async () => {
    show(head('Создать новую сборку', menu), h('div', { class: 'h-1 rounded-full pulse-bar' }));
    const vs = await ensureVersions();
    if (!vs) { menu(); return; }

    const LOADERS = [
      { id: 'dx', title: 'DX Visuals', sub: '+ Fabric', icon: '../assets/loaders/dx.png' },
      { id: 'vanilla', title: 'Vanilla', sub: 'Чистый Minecraft', icon: '../assets/loaders/vanilla.png' },
      { id: 'fabric', title: 'Fabric', sub: 'Лёгкий модлоадер', icon: '../assets/loaders/fabric.png' },
      { id: 'forge', title: 'Forge', sub: 'Классический модлоадер', icon: '../assets/loaders/forge.png' },
      { id: 'neoforge', title: 'NeoForge', sub: 'Современный форк Forge', icon: '../assets/loaders/neoforge.png' }
    ];

    let loader = 'dx';
    let customBanner = null;
    let customIcon = null;

    const name = h('input', {
      class: 'input !h-12 !rounded-2xl !bg-[#121214] !border-transparent focus:!border-line2 !text-[15px] !px-4',
      placeholder: 'Тупая Сборка',
      value: 'Тупая Сборка',
      maxlength: '32'
    });
    const sel = h('select', {
      class: 'input !h-12 !rounded-2xl !bg-[#121214] !border-transparent focus:!border-line2 !text-[15px] !px-4'
    });
    const loaderRow = h('div', { class: 'flex items-center gap-2.5 mt-2' });
    const loaderBadge = h('div', { class: 'inline-flex flex-col items-center px-3.5 py-1.5 rounded-2xl bg-[#121214] border border-line/60 mt-2 self-start text-center' });
    const verSub = h('div', { class: 'text-[12px] text-dim font-normal leading-snug mt-1 mb-2.5' });

    const cardBanner = h('div', {
      class: 'relative w-[228px] h-[324px] rounded-[28px] overflow-hidden bg-panel cursor-pointer group select-none shadow-2xl border border-white/10',
      title: 'Нажми, чтобы загрузить свой баннер'
    });
    const bannerImg = h('img', {
      src: '../assets/cover.jpg',
      alt: '',
      draggable: 'false',
      class: 'w-full h-full object-cover transition-transform duration-300 group-hover:scale-[1.02]'
    });
    const iconBadge = h('button', {
      type: 'button',
      class: 'absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[82px] h-[82px] rounded-[24px] bg-black/45 backdrop-blur-md border border-white/15 grid place-items-center text-[32px] font-extrabold text-ink shadow-xl overflow-hidden hover:scale-105 transition-transform cursor-pointer',
      title: 'Нажми, чтобы загрузить свою иконку'
    });

    const paintPreview = () => {
      bannerImg.src = customBanner || '../assets/cover.jpg';
      iconBadge.textContent = '';
      if (customIcon) {
        iconBadge.append(h('img', { src: customIcon, alt: '', draggable: 'false', class: 'w-full h-full object-cover' }));
      } else {
        iconBadge.textContent = initialsOf(name.value || 'Тупая Сборка');
      }
    };

    cardBanner.append(bannerImg, iconBadge);
    cardBanner.addEventListener('click', async (e) => {
      if (iconBadge.contains(e.target)) return;
      const dataUrl = await act(api.pickInstanceImage, 'Выбери баннер сборки');
      if (dataUrl) { customBanner = dataUrl; paintPreview(); }
    });
    iconBadge.addEventListener('click', async (e) => {
      e.stopPropagation();
      const dataUrl = await act(api.pickInstanceImage, 'Выбери иконку сборки');
      if (dataUrl) { customIcon = dataUrl; paintPreview(); }
    });
    name.addEventListener('input', paintPreview);

    const fillVersions = () => {
      const prev = sel.value || S.defaultMc;
      sel.textContent = '';
      const list = vs.filter((v) => {
        if (loader === 'dx') return S.darkxVersions.includes(v.id);
        if (loader === 'fabric') return v.fabric;
        if (loader === 'neoforge') return /^1\.(20\.[2-9]|21(\.|$))/.test(v.id);
        if (loader === 'forge') return /^1\.(1[2-9]|20|21)/.test(v.id);
        return true;
      });
      const fallback = list.length ? list : S.darkxVersions.map((id) => ({ id }));
      for (const v of fallback) {
        sel.append(h('option', { value: v.id, selected: v.id === prev || v.id === S.defaultMc }, v.id));
      }
      const cur = LOADERS.find((l) => l.id === loader) || LOADERS[0];
      verSub.textContent = 'Показаны только те версии, которые совместимы с выбранным модлоадером (' + cur.title + ')';
    };

    const paintLoaders = () => {
      loaderRow.textContent = '';
      for (const l of LOADERS) {
        const active = l.id === loader;
        loaderRow.append(h('button', {
          type: 'button',
          class: 'w-[48px] h-[48px] rounded-[16px] grid place-items-center transition-all cursor-pointer '
            + (active ? 'bg-[#222226] ring-2 ring-white/25 scale-105' : 'bg-[#121214] opacity-75 hover:opacity-100 hover:bg-[#1A1A1E]'),
          title: l.title + ' ' + l.sub,
          onclick: () => { loader = l.id; paintLoaders(); fillVersions(); }
        }, h('img', { src: l.icon, alt: l.title, draggable: 'false', class: 'w-6 h-6 object-contain pixel-img' })));
      }
      const cur = LOADERS.find((l) => l.id === loader) || LOADERS[0];
      loaderBadge.textContent = '';
      loaderBadge.append(
        h('span', { class: 'text-[12px] font-bold text-ink leading-tight' }, cur.title),
        h('span', { class: 'text-[11px] text-dim font-normal leading-tight' }, cur.sub)
      );
    };

    paintLoaders();
    fillVersions();
    paintPreview();

    const make = h('button', {
      class: 'btn btn-accent !rounded-full !h-12 !px-8 !text-[16px] font-bold shadow-lg cursor-pointer',
      onclick: async () => {
        if (!sel.value) return;
        make.disabled = true;
        const instName = name.value.trim() || ('Сборка ' + sel.value);
        const isDx = loader === 'dx';
        const isFab = loader === 'dx' || loader === 'fabric';
        const s = await act(api.createInstance, {
          name: instName,
          mc: sel.value,
          loader,
          fabric: isFab,
          darkx: isDx,
          banner: customBanner,
          icon: customIcon
        });
        if (s) { closeModal(); setState(s); toast('Сборка «' + instName + '» создана', 'ok'); go_('instances'); }
        else make.disabled = false;
      }
    }, 'Создать');

    const hdr = h('div', { class: 'flex items-center gap-3.5 pb-1' },
      h('span', { class: 'w-12 h-12 rounded-2xl bg-[#1A1A1E] grid place-items-center text-ink shrink-0' }, svg('tools', 26)),
      h('h2', { class: 'text-[30px] font-medium leading-tight flex-1 tracking-tight' }, 'Создать новую сборку'),
      h('button', { class: 'w-10 h-10 rounded-full grid place-items-center text-dim hover:text-ink hover:bg-raise', 'aria-label': 'Закрыть', onclick: guard }, svg('close', 22)));

    show(
      hdr,
      h('div', { class: 'grid grid-cols-1 md:grid-cols-[1fr_250px] gap-8 pt-2 items-start' },
        h('div', { class: 'flex flex-col gap-5' },
          h('div', {},
            h('div', { class: 'text-[18px] font-bold text-ink' }, 'Название'),
            h('div', { class: 'text-[12px] text-dim font-normal leading-snug mt-0.5 mb-2.5' }, 'Великие сборки начинались с названия... Выбери своё!'),
            name),
          h('div', { class: 'flex flex-col' },
            h('div', { class: 'text-[18px] font-bold text-ink' }, 'Модлоадер'),
            loaderRow,
            loaderBadge),
          h('div', {},
            h('div', { class: 'text-[18px] font-bold text-ink' }, 'Версия'),
            verSub,
            sel)),
        h('div', { class: 'flex flex-col items-center text-center' },
          h('div', { class: 'text-[18px] font-bold text-ink' }, 'Карточка'),
          h('div', { class: 'text-[12px] text-dim font-normal mt-0.5 mb-3' }, 'Настрой вид сборки в лаунчере.'),
          cardBanner,
          h('div', { class: 'text-[11px] text-mute italic mt-2.5 max-w-[210px] leading-snug font-normal' }, 'Кликай по баннеру и иконке для загрузки своей картинки'))),
      h('div', { class: 'flex items-center justify-between pt-2' },
        h('button', { class: 'text-[12px] text-dim hover:text-ink', onclick: menu }, '← Миграция с других лаунчеров'),
        make)
    );
  };

  if (step === 'create') create(); else menu();
  return close;
}

const go_ = (id) => { if (typeof go === 'function') go(id); };
