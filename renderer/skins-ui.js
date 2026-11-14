'use strict';
/* Вкладка «Скины»: библиотека скинов и публикация под ником аккаунта для всех игроков DarkX. */

/** Плоский вид спереди (голова, тело, руки, ноги, со вторым слоем). Рисуется на canvas без сглаживания. */
function skinFront(src, model, scale) {
  const W = 16, Hh = 32;
  const c = h('canvas', { width: W, height: Hh, style: 'width:' + W * scale + 'px;height:' + Hh * scale + 'px;image-rendering:pixelated' });
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = false;
  const img = new Image();
  img.onload = () => {
    const legacy = img.height === 32;
    const slim = model === 'slim';
    const aw = slim ? 3 : 4;
    const part = (sx, sy, w, hgt, dx, dy, flip) => {
      if (flip) { g.save(); g.translate(dx + w, dy); g.scale(-1, 1); g.drawImage(img, sx, sy, w, hgt, 0, 0, w, hgt); g.restore(); }
      else g.drawImage(img, sx, sy, w, hgt, dx, dy, w, hgt);
    };
    part(8, 8, 8, 8, 4, 0);
    part(20, 20, 8, 12, 4, 8);
    part(44, 20, aw, 12, 4 - aw, 8);                        // правая рука
    part(4, 20, 4, 12, 4, 20);                              // правая нога
    if (legacy) {
      part(44, 20, aw, 12, 12, 8, true);
      part(4, 20, 4, 12, 8, 20, true);
    } else {
      part(36, 52, aw, 12, 12, 8);
      part(20, 52, 4, 12, 8, 20);
    }
    part(40, 8, 8, 8, 4, 0);                                // шляпа
    if (!legacy) {
      part(20, 36, 8, 12, 4, 8);
      part(44, 36, aw, 12, 4 - aw, 8);
      part(52, 52, aw, 12, 12, 8);
      part(4, 36, 4, 12, 4, 20);
      part(4, 52, 4, 12, 8, 20);
    }
  };
  img.src = src;
  return c;
}

async function reloadSkins() {
  const r = await api.skins();
  if (r.ok) K = r.data;
}

function renderSkins(main) {
  const acc = currentAccount();
  const activeId = acc && K ? (K.active || {})[acc.name.toLowerCase()] : null;
  const list = K ? K.list : [];

  const cards = list.map((it) => {
    const on = it.id === activeId;
    return h('div', { class: 'card p-4 flex flex-col items-center gap-3 ' + (on ? 'border-accent/60' : '') },
      h('div', { class: 'h-[176px] grid place-items-center' }, skinFront(it.data, it.model, 5)),
      h('div', { class: 'w-full text-center min-w-0' },
        h('div', { class: 'font-bold truncate' }, it.name),
        h('div', { class: 'text-[11px] text-dim' }, (it.model === 'slim' ? 'Тонкие руки' : 'Классика') + (it.source === 'nick' ? ' · с ником' : ' · из файла'))),
      on ? h('span', { class: 'chip chip-accent' }, 'Виден всем DarkX') : null,
      on ? h('button', { class: 'btn btn-sm w-full', onclick: async () => { const k = await act(api.skinClear); if (k) { K = k; toast('Скин снят', 'ok'); renderSkinsAll(); } } }, 'Снять')
        : h('button', { class: 'btn btn-sm btn-accent w-full', onclick: () => applySkin(it) }, 'Применить'),
      h('div', { class: 'flex gap-2 w-full' },
        h('button', { class: 'btn btn-sm flex-1', title: it.model === 'slim' ? 'Сделать классическим' : 'Сделать тонким', onclick: async () => {
          const k = await act(api.skinModel, it.id, it.model === 'slim' ? 'classic' : 'slim');
          if (k) { K = k; renderSkinsAll(); }
        } }, it.model === 'slim' ? 'Slim' : 'Classic'),
        h('button', { class: 'btn btn-sm btn-bad', 'aria-label': 'Удалить', onclick: async () => {
          const k = await act(api.skinRemove, it.id);
          if (k) { K = k; renderSkinsAll(); }
        } }, svg('trash', 14))));
  });

  main.append(h('div', { class: 'fade-in flex flex-col gap-6 max-w-5xl mx-auto' },
    h('div', { class: 'flex items-center justify-between gap-4 flex-wrap' },
      h('div', {}, h('h2', { class: 'text-[22px]' }, 'Скины'),
        h('div', { class: 'text-dim text-[12px] mt-1' }, acc ? 'Применённый скин увидят все игроки с DarkX — под ником ' : 'Сначала выбери аккаунт',
          acc ? h('span', { class: 'text-accent font-bold' }, acc.name) : null)),
      h('button', { class: 'btn btn-accent', onclick: uploadSkinModal }, svg('plus', 14), 'Загрузить скин')),
    S.effective.firebase ? null : h('div', { class: 'card p-4 text-warn text-[12px]' }, 'Сеть DarkX недоступна в этой сборке — скины можно хранить, но опубликовать нельзя.'),
    cards.length ? h('div', { class: 'grid gap-4', style: 'grid-template-columns:repeat(auto-fill,minmax(190px,1fr))' }, cards)
      : h('div', { class: 'card p-10 text-center flex flex-col items-center gap-2' },
        h('div', { class: 'text-accent' }, svg('wardrobe', 40)),
        h('div', { class: 'font-bold' }, 'В гардеробе пусто'),
        h('div', { class: 'text-dim text-[12px] max-w-sm' }, 'Загрузи скин по нику лицензионного игрока или своим PNG-файлом — он сохранится здесь, и его можно будет применить в один клик.'))));
}

function renderSkinsAll() {
  renderHeader();
  if (page === 'skins') renderPage();
}

async function applySkin(it) {
  if (!currentAccount()) { toast('Сначала выбери аккаунт', 'bad'); return; }
  const k = await act(api.skinApply, it.id);
  if (k) { K = k; toast('Скин «' + it.name + '» виден всем игрокам DarkX', 'ok'); renderSkinsAll(); }
}

function uploadSkinModal() {
  let model = 'classic';
  const nick = h('input', { class: 'input', placeholder: 'Ник игрока (лицензия)', maxlength: '16', spellcheck: 'false' });
  const status = h('div', { class: 'text-[12px] text-dim min-h-[18px]' });

  const done = (res) => {
    if (!res) return;
    K = res.state;
    closeModal();
    toast('Скин «' + res.added.name + '» добавлен в библиотеку', 'ok');
    renderSkinsAll();
  };
  const byNick = async () => {
    if (!nick.value.trim()) return;
    status.textContent = T('Ищу скин…');
    const r = await api.skinNick(nick.value.trim());
    if (!r.ok) { status.textContent = T(r.error); status.className = 'text-[12px] text-bad min-h-[18px]'; return; }
    done(r.data);
  };
  nick.addEventListener('keydown', (e) => { if (e.key === 'Enter') byNick(); });

  const modelBtns = ['classic', 'slim'].map((m) => h('button', { class: 'btn flex-1', 'data-m': m, onclick: (e) => {
    model = m;
    modelBtns.forEach((b) => b.classList.toggle('btn-accent', b.dataset.m === model));
  } }, m === 'classic' ? 'Классика (руки 4px)' : 'Тонкие (руки 3px)'));
  modelBtns[0].classList.add('btn-accent');

  modal('Загрузить скин',
    h('div', { class: 'flex flex-col gap-5' },
      h('div', { class: 'flex flex-col gap-2' },
        h('label', { class: 'label' }, 'По нику'),
        h('div', { class: 'flex gap-2' }, nick, h('button', { class: 'btn btn-accent shrink-0', onclick: byNick }, 'Найти')),
        h('div', { class: 'text-[11px] text-mute' }, 'Берём текущий скин игрока с серверов Mojang.'),
        status),
      h('div', { class: 'h-px bg-line' }),
      h('div', { class: 'flex flex-col gap-2' },
        h('label', { class: 'label' }, 'Из файла (PNG 64×64)'),
        h('div', { class: 'flex gap-2' }, modelBtns),
        h('button', { class: 'btn', onclick: async () => {
          const r = await api.skinPick(model);
          if (!r.ok) { toast(r.error, 'bad'); return; }
          done(r.data);
        } }, 'Выбрать файл…'))),
    null, 480);
  setTimeout(() => nick.focus(), 30);
}
