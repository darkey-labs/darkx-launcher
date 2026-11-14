'use strict';
/* Вкладка «Скины»: библиотека скинов, интерактивный 3D-просмотр выбранного скина и публикация под ником аккаунта для всех игроков DarkX. */

let selectedSkinId = null;
let skin3dWalk = true;
let skin3dLayer2 = true;

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

/** Создаёт дефолтную 64×64 текстуру скина, если в гардеробе пока нет скинов. */
function makeDefaultSkinCanvas() {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const g = c.getContext('2d');
  // Голова (8,8,8,8) и верх/низ/бока
  g.fillStyle = '#3A2B22';
  g.fillRect(0, 0, 32, 16);
  g.fillStyle = '#D9A98A';
  g.fillRect(8, 8, 8, 8);
  g.fillStyle = '#3A2B22';
  g.fillRect(8, 8, 8, 2);
  g.fillStyle = '#27406B';
  g.fillRect(9, 12, 2, 1);
  g.fillRect(13, 12, 2, 1);
  g.fillStyle = '#A8624A';
  g.fillRect(11, 14, 2, 1);
  // Торс (16,16..40,32)
  g.fillStyle = '#1E293B';
  g.fillRect(16, 16, 24, 16);
  g.fillStyle = '#F97316';
  g.fillRect(22, 21, 4, 6);
  // Руки
  g.fillStyle = '#334155';
  g.fillRect(40, 16, 16, 12);
  g.fillRect(32, 48, 16, 12);
  g.fillStyle = '#D9A98A';
  g.fillRect(40, 26, 16, 6);
  g.fillRect(32, 58, 16, 6);
  // Ноги
  g.fillStyle = '#18181B';
  g.fillRect(0, 16, 16, 16);
  g.fillRect(16, 48, 16, 16);
  return c;
}

/**
 * Интерактивный 3D-просмотр скина Minecraft на HTML5 Canvas.
 * Рисует все 6 граней каждой части тела (голова, торс, руки, ноги + 2-й слой) с попиксельной раскладкой UV,
 * освещением граней, перспективой и вращением мышью.
 */
function createSkin3DCanvas(skinItem) {
  const CW = 260, CH = 330;
  const canvas = h('canvas', {
    width: CW,
    height: CH,
    class: 'cursor-grab active:cursor-grabbing select-none rounded-2xl',
    style: 'width:' + CW + 'px;height:' + CH + 'px'
  });
  const ctx = canvas.getContext('2d');

  // Загружаем пиксели скина в буфер 64×64
  const texCanvas = document.createElement('canvas');
  texCanvas.width = 64;
  texCanvas.height = 64;
  const texCtx = texCanvas.getContext('2d', { willReadFrequently: true });
  let texData = null;
  let isLegacy = false;

  const loadTexFromSource = (imgEl) => {
    texCtx.clearRect(0, 0, 64, 64);
    isLegacy = imgEl.height === 32;
    texCtx.drawImage(imgEl, 0, 0);
    texData = texCtx.getImageData(0, 0, 64, 64).data;
  };

  if (skinItem && skinItem.data) {
    const img = new Image();
    img.onload = () => loadTexFromSource(img);
    img.src = skinItem.data;
  } else {
    loadTexFromSource(makeDefaultSkinCanvas());
  }

  let yaw = -0.48;
  let pitch = 0.16;
  let dragging = false;
  let lastX = 0, lastY = 0;

  canvas.addEventListener('mousedown', (e) => {
    dragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
  });
  const onMove = (e) => {
    if (!dragging) return;
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;
    yaw += dx * 0.014;
    pitch = Math.max(-1.1, Math.min(1.1, pitch + dy * 0.012));
  };
  const onUp = () => { dragging = false; };
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);

  // Получить цвет текселя (u, v) с учётом оттенка грани shade
  function getTexel(u, v, flipU, w, shade) {
    if (!texData) return null;
    const tx = flipU ? (u + w - 1) : u;
    const ty = v;
    if (tx < 0 || tx >= 64 || ty < 0 || ty >= 64) return null;
    const idx = (ty * 64 + tx) * 4;
    const a = texData[idx + 3];
    if (a < 25) return null;
    const r = Math.round(texData[idx] * shade);
    const g = Math.round(texData[idx + 1] * shade);
    const b = Math.round(texData[idx + 2] * shade);
    return 'rgba(' + r + ',' + g + ',' + b + ',' + (a / 255).toFixed(2) + ')';
  }

  // Поворот точки вокруг X (pitch), затем вокруг Y (yaw)
  function transformPt(x, y, z, pRotX, pivotY, pivotZ) {
    // Вращение конечности вокруг плеча/бедра (ось X)
    let ly = y - pivotY;
    let lz = z - pivotZ;
    if (pRotX) {
      const c = Math.cos(pRotX), s = Math.sin(pRotX);
      const ny = ly * c - lz * s;
      const nz = ly * s + lz * c;
      ly = ny;
      lz = nz;
    }
    const wy = ly + pivotY;
    const wz = lz + pivotZ;
    const wx = x;

    // Вращение модели по yaw (вокруг Y)
    const cy = Math.cos(yaw), sy = Math.sin(yaw);
    const rx = wx * cy + wz * sy;
    const rz = -wx * sy + wz * cy;

    // Вращение по pitch (вокруг X)
    const cp = Math.cos(pitch), sp = Math.sin(pitch);
    const ry = wy * cp - rz * sp;
    const fz = wy * sp + rz * cp;

    // Перспективная проекция
    const camDist = 68;
    const scale = 6.7 * (camDist / (camDist - fz));
    return {
      sx: CW * 0.5 + rx * scale,
      sy: CH * 0.52 - ry * scale,
      z: fz
    };
  }

  /**
   * Строит попиксельные полигоны для параллелепипеда части тела.
   * Раскладка UV в Minecraft для куба размера (W, H, D) с началом (u0, v0):
   * - Top:    (u0 + D,         v0,     W, D)
   * - Bottom: (u0 + D + W,     v0,     W, D)
   * - Right:  (u0,             v0 + D, D, H)  [x = xMin]
   * - Front:  (u0 + D,         v0 + D, W, H)  [z = zMax]
   * - Left:   (u0 + D + W,     v0 + D, D, H)  [x = xMax]
   * - Back:   (u0 + D + W + D, v0 + D, W, H)  [z = zMin]
   */
  function emitBoxQuads(quads, opts) {
    const {
      cx, cy, cz, w, hgt, d, expand = 0,
      u0, v0, tw, th, td,
      rotX = 0, pivotY = 0, pivotZ = 0, mirror = false
    } = opts;

    const x0 = cx - w / 2 - expand, x1 = cx + w / 2 + expand;
    const y0 = cy - hgt / 2 - expand, y1 = cy + hgt / 2 + expand;
    const z0 = cz - d / 2 - expand, z1 = cz + d / 2 + expand;

    const addGrid = (nx, ny, nz, uStart, vStart, gw, gh, shade, ptFn) => {
      // Отсечение задних граней для базового слоя (для 2-го слоя рисуем только передние грани)
      const p00 = transformPt(...ptFn(0, 0), rotX, pivotY, pivotZ);
      const p10 = transformPt(...ptFn(gw, 0), rotX, pivotY, pivotZ);
      const p01 = transformPt(...ptFn(0, gh), rotX, pivotY, pivotZ);
      const cross = (p10.sx - p00.sx) * (p01.sy - p00.sy) - (p10.sy - p00.sy) * (p01.sx - p00.sx);
      if (cross <= 0) return;

      for (let iy = 0; iy < gh; iy++) {
        for (let ix = 0; ix < gw; ix++) {
          const u = mirror ? (uStart + gw - 1 - ix) : (uStart + ix);
          const v = vStart + iy;
          const col = getTexel(u, v, false, 1, shade);
          if (!col) continue;
          const a = transformPt(...ptFn(ix, iy), rotX, pivotY, pivotZ);
          const b = transformPt(...ptFn(ix + 1, iy), rotX, pivotY, pivotZ);
          const c = transformPt(...ptFn(ix + 1, iy + 1), rotX, pivotY, pivotZ);
          const dPt = transformPt(...ptFn(ix, iy + 1), rotX, pivotY, pivotZ);
          quads.push({
            z: (a.z + b.z + c.z + dPt.z) * 0.25 + (expand ? 0.08 : 0),
            col,
            a, b, c, d: dPt
          });
        }
      }
    };

    const sx = (x1 - x0) / tw;
    const sy = (y1 - y0) / th;
    const sz = (z1 - z0) / td;

    // Front (z = z1): ix: x0 -> x1, iy: y1 -> y0
    addGrid(0, 0, 1, u0 + td, v0 + td, tw, th, 1.0,
      (ix, iy) => [x0 + ix * sx, y1 - iy * sy, z1]);

    // Back (z = z0): ix: x1 -> x0, iy: y1 -> y0
    addGrid(0, 0, -1, u0 + td + tw + td, v0 + td, tw, th, 0.72,
      (ix, iy) => [x1 - ix * sx, y1 - iy * sy, z0]);

    // Right side of character (x = x0): ix: z0 -> z1, iy: y1 -> y0
    addGrid(-1, 0, 0, u0, v0 + td, td, th, 0.84,
      (ix, iy) => [x0, y1 - iy * sy, z0 + ix * sz]);

    // Left side of character (x = x1): ix: z1 -> z0, iy: y1 -> y0
    addGrid(1, 0, 0, u0 + td + tw, v0 + td, td, th, 0.88,
      (ix, iy) => [x1, y1 - iy * sy, z1 - ix * sz]);

    // Top (y = y1): ix: x0 -> x1, iy: z0 -> z1
    addGrid(0, 1, 0, u0 + td, v0, tw, td, 1.06,
      (ix, iy) => [x0 + ix * sx, y1, z0 + iy * sz]);

    // Bottom (y = y0): ix: x0 -> x1, iy: z1 -> z0
    addGrid(0, -1, 0, u0 + td + tw, v0, tw, td, 0.62,
      (ix, iy) => [x0 + ix * sx, y0, z1 - iy * sz]);
  }

  let rafId = 0;
  const startAt = performance.now();

  function frame(now) {
    if (!canvas.isConnected) {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      return;
    }
    const t = (now - startAt) * 0.001;
    const swing = skin3dWalk ? Math.sin(t * 3.4) * 0.55 : Math.sin(t * 1.4) * 0.05;
    if (!dragging && skin3dWalk) {
      yaw += 0.0035;
    }

    ctx.clearRect(0, 0, CW, CH);

    // Мягкое свечение подиума под персонажем
    const grad = ctx.createRadialGradient(CW * 0.5, CH * 0.86, 4, CW * 0.5, CH * 0.86, 75);
    grad.addColorStop(0, 'rgba(249, 115, 22, 0.25)');
    grad.addColorStop(1, 'rgba(249, 115, 22, 0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.ellipse(CW * 0.5, CH * 0.86, 68, 18, 0, 0, Math.PI * 2);
    ctx.fill();

    const slim = skinItem && skinItem.model === 'slim';
    const aw = slim ? 3 : 4;
    const armX = 4 + aw / 2;
    const quads = [];

    // Координаты по Y: центр модели в Y = 0 (пол на Y = -16, макушка на Y = +16)
    // Голова: Y от +8 до +16 (центр +12)
    emitBoxQuads(quads, { cx: 0, cy: 12, cz: 0, w: 8, hgt: 8, d: 8, u0: 0, v0: 0, tw: 8, th: 8, td: 8 });
    // Торс: Y от -4 до +8 (центр +2)
    emitBoxQuads(quads, { cx: 0, cy: 2, cz: 0, w: 8, hgt: 12, d: 4, u0: 16, v0: 16, tw: 8, th: 12, td: 4 });
    // Правая рука (x = -armX)
    emitBoxQuads(quads, { cx: -armX, cy: 2, cz: 0, w: aw, hgt: 12, d: 4, u0: 40, v0: 16, tw: aw, th: 12, td: 4, rotX: swing, pivotY: 7, pivotZ: 0 });
    // Левая рука (x = +armX)
    if (isLegacy) {
      emitBoxQuads(quads, { cx: armX, cy: 2, cz: 0, w: aw, hgt: 12, d: 4, u0: 40, v0: 16, tw: aw, th: 12, td: 4, rotX: -swing, pivotY: 7, pivotZ: 0, mirror: true });
    } else {
      emitBoxQuads(quads, { cx: armX, cy: 2, cz: 0, w: aw, hgt: 12, d: 4, u0: 32, v0: 48, tw: aw, th: 12, td: 4, rotX: -swing, pivotY: 7, pivotZ: 0 });
    }
    // Правая нога (x = -2, Y от -16 до -4, центр -10)
    emitBoxQuads(quads, { cx: -2, cy: -10, cz: 0, w: 4, hgt: 12, d: 4, u0: 0, v0: 16, tw: 4, th: 12, td: 4, rotX: -swing, pivotY: -4, pivotZ: 0 });
    // Левая нога (x = +2)
    if (isLegacy) {
      emitBoxQuads(quads, { cx: 2, cy: -10, cz: 0, w: 4, hgt: 12, d: 4, u0: 0, v0: 16, tw: 4, th: 12, td: 4, rotX: swing, pivotY: -4, pivotZ: 0, mirror: true });
    } else {
      emitBoxQuads(quads, { cx: 2, cy: -10, cz: 0, w: 4, hgt: 12, d: 4, u0: 16, v0: 48, tw: 4, th: 12, td: 4, rotX: swing, pivotY: -4, pivotZ: 0 });
    }

    // 2-й слой (шляпа, куртка, рукава, штаны)
    if (skin3dLayer2) {
      emitBoxQuads(quads, { cx: 0, cy: 12, cz: 0, w: 8, hgt: 8, d: 8, expand: 0.45, u0: 32, v0: 0, tw: 8, th: 8, td: 8 });
      if (!isLegacy) {
        emitBoxQuads(quads, { cx: 0, cy: 2, cz: 0, w: 8, hgt: 12, d: 4, expand: 0.35, u0: 16, v0: 32, tw: 8, th: 12, td: 4 });
        emitBoxQuads(quads, { cx: -armX, cy: 2, cz: 0, w: aw, hgt: 12, d: 4, expand: 0.35, u0: 40, v0: 32, tw: aw, th: 12, td: 4, rotX: swing, pivotY: 7, pivotZ: 0 });
        emitBoxQuads(quads, { cx: armX, cy: 2, cz: 0, w: aw, hgt: 12, d: 4, expand: 0.35, u0: 48, v0: 48, tw: aw, th: 12, td: 4, rotX: -swing, pivotY: 7, pivotZ: 0 });
        emitBoxQuads(quads, { cx: -2, cy: -10, cz: 0, w: 4, hgt: 12, d: 4, expand: 0.35, u0: 0, v0: 32, tw: 4, th: 12, td: 4, rotX: -swing, pivotY: -4, pivotZ: 0 });
        emitBoxQuads(quads, { cx: 2, cy: -10, cz: 0, w: 4, hgt: 12, d: 4, expand: 0.35, u0: 0, v0: 48, tw: 4, th: 12, td: 4, rotX: swing, pivotY: -4, pivotZ: 0 });
      }
    }

    quads.sort((p, q) => p.z - q.z);
    for (let i = 0; i < quads.length; i++) {
      const q = quads[i];
      ctx.fillStyle = q.col;
      ctx.strokeStyle = q.col;
      ctx.lineWidth = 0.65;
      ctx.beginPath();
      ctx.moveTo(q.a.sx, q.a.sy);
      ctx.lineTo(q.b.sx, q.b.sy);
      ctx.lineTo(q.c.sx, q.c.sy);
      ctx.lineTo(q.d.sx, q.d.sy);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }

    rafId = requestAnimationFrame(frame);
  }

  rafId = requestAnimationFrame(frame);
  return {
    canvas,
    resetAngles: () => { yaw = -0.48; pitch = 0.16; }
  };
}

async function reloadSkins() {
  const r = await api.skins();
  if (r.ok) K = r.data;
}

function renderSkins(main) {
  const acc = currentAccount();
  const activeId = acc && K ? (K.active || {})[acc.name.toLowerCase()] : null;
  const list = K ? K.list : [];

  if (!selectedSkinId || !list.some((x) => x.id === selectedSkinId)) {
    selectedSkinId = activeId || (list[0] ? list[0].id : null);
  }
  const previewSkin = list.find((x) => x.id === selectedSkinId) || list[0] || null;
  const viewer = createSkin3DCanvas(previewSkin);

  const walkBtn = h('button', {
    class: 'btn btn-sm flex-1 ' + (skin3dWalk ? 'btn-accent' : ''),
    onclick: () => {
      skin3dWalk = !skin3dWalk;
      walkBtn.classList.toggle('btn-accent', skin3dWalk);
      setText(walkBtn, skin3dWalk ? 'Анимация: ВКЛ' : 'Анимация: ВЫКЛ');
    }
  }, skin3dWalk ? 'Анимация: ВКЛ' : 'Анимация: ВЫКЛ');

  const layerBtn = h('button', {
    class: 'btn btn-sm flex-1 ' + (skin3dLayer2 ? 'btn-accent' : ''),
    onclick: () => {
      skin3dLayer2 = !skin3dLayer2;
      layerBtn.classList.toggle('btn-accent', skin3dLayer2);
      setText(layerBtn, skin3dLayer2 ? '2-й слой: ВКЛ' : '2-й слой: ВЫКЛ');
    }
  }, skin3dLayer2 ? '2-й слой: ВКЛ' : '2-й слой: ВЫКЛ');

  const previewPanel = h('div', { class: 'card p-5 w-[300px] shrink-0 flex flex-col items-center gap-3.5 self-start' },
    h('div', { class: 'w-full flex items-center justify-between' },
      h('span', { class: 'text-[12px] font-bold text-dim uppercase tracking-wider' }, '3D-просмотр скина'),
      h('button', {
        class: 'text-[11px] text-mute hover:text-ink',
        onclick: () => viewer.resetAngles()
      }, 'Сбросить ракурс')),
    h('div', { class: 'relative bg-raise/70 border border-line rounded-2xl p-2 grid place-items-center' },
      viewer.canvas,
      h('div', { class: 'absolute bottom-2.5 inset-x-0 text-center text-[10px] text-mute pointer-events-none' },
        'Зажми ЛКМ и крути модель на 360°')),
    previewSkin ? h('div', { class: 'w-full text-center' },
      h('div', { class: 'font-extrabold text-[16px] truncate' }, previewSkin.name),
      h('div', { class: 'text-[11px] text-dim mt-0.5' },
        (previewSkin.model === 'slim' ? 'Тонкие руки (3px)' : 'Классика (4px)') + (previewSkin.id === activeId ? ' · Активен' : '')))
      : h('div', { class: 'text-[12px] text-dim text-center' }, 'Стандартный скин (предпросмотр)'),
    h('div', { class: 'flex gap-2 w-full' }, walkBtn, layerBtn),
    previewSkin && previewSkin.id !== activeId ? h('button', {
      class: 'btn btn-accent w-full',
      onclick: () => applySkin(previewSkin)
    }, 'Применить выбранный скин') : null);

  const cards = list.map((it) => {
    const on = it.id === activeId;
    const isSel = it.id === (previewSkin && previewSkin.id);
    return h('div', {
      class: 'card p-4 flex flex-col items-center gap-3 cursor-pointer transition-colors ' + (isSel ? 'ring-2 ring-accent border-accent/60' : on ? 'border-accent/60' : 'hover:border-line2'),
      onclick: () => {
        selectedSkinId = it.id;
        renderPage();
      }
    },
      h('div', { class: 'h-[164px] grid place-items-center' }, skinFront(it.data, it.model, 5)),
      h('div', { class: 'w-full text-center min-w-0' },
        h('div', { class: 'font-bold truncate' }, it.name),
        h('div', { class: 'text-[11px] text-dim' }, (it.model === 'slim' ? 'Тонкие руки' : 'Классика') + (it.source === 'nick' ? ' · с ником' : ' · из файла'))),
      on ? h('span', { class: 'chip chip-accent' }, 'Виден всем DarkX') : null,
      on ? h('button', { class: 'btn btn-sm w-full', onclick: async (e) => { e.stopPropagation(); const k = await act(api.skinClear); if (k) { K = k; toast('Скин снят', 'ok'); renderSkinsAll(); } } }, 'Снять')
        : h('button', { class: 'btn btn-sm btn-accent w-full', onclick: (e) => { e.stopPropagation(); applySkin(it); } }, 'Применить'),
      h('div', { class: 'flex gap-2 w-full' },
        h('button', { class: 'btn btn-sm flex-1', title: it.model === 'slim' ? 'Сделать классическим' : 'Сделать тонким', onclick: async (e) => {
          e.stopPropagation();
          const k = await act(api.skinModel, it.id, it.model === 'slim' ? 'classic' : 'slim');
          if (k) { K = k; renderSkinsAll(); }
        } }, it.model === 'slim' ? 'Slim' : 'Classic'),
        h('button', { class: 'btn btn-sm btn-bad', 'aria-label': 'Удалить', onclick: async (e) => {
          e.stopPropagation();
          const k = await act(api.skinRemove, it.id);
          if (k) { K = k; renderSkinsAll(); }
        } }, svg('trash', 14))));
  });

  const rightContent = cards.length
    ? h('div', { class: 'flex-1 min-w-0 grid gap-4 self-start', style: 'grid-template-columns:repeat(auto-fill,minmax(185px,1fr))' }, cards)
    : h('div', { class: 'flex-1 card p-10 text-center flex flex-col items-center justify-center gap-2 min-h-[360px]' },
        h('div', { class: 'text-accent' }, svg('wardrobe', 40)),
        h('div', { class: 'font-bold' }, 'В гардеробе пусто'),
        h('div', { class: 'text-dim text-[12px] max-w-sm' }, 'Загрузи скин по нику лицензионного игрока или своим PNG-файлом — он сохранится здесь, и ты сможешь рассмотреть его в 3D со всех сторон.'));

  main.append(h('div', { class: 'fade-in flex flex-col gap-6 max-w-5xl mx-auto' },
    h('div', { class: 'flex items-center justify-between gap-4 flex-wrap' },
      h('div', {}, h('h2', { class: 'text-[22px]' }, 'Скины'),
        h('div', { class: 'text-dim text-[12px] mt-1' }, acc ? 'Применённый скин увидят все игроки с DarkX — под ником ' : 'Сначала выбери аккаунт',
          acc ? h('span', { class: 'text-accent font-bold' }, acc.name) : null)),
      h('button', { class: 'btn btn-accent', onclick: uploadSkinModal }, svg('plus', 14), 'Загрузить скин')),
    S.effective.firebase ? null : h('div', { class: 'card p-4 text-warn text-[12px]' }, 'Сеть DarkX недоступна в этой сборке — скины можно хранить, но опубликовать нельзя.'),
    h('div', { class: 'flex gap-6 items-start flex-wrap lg:flex-nowrap' },
      previewPanel,
      rightContent)));
}

function renderSkinsAll() {
  renderHeader();
  if (page === 'skins') renderPage();
}

async function applySkin(it) {
  if (!currentAccount()) { toast('Сначала выбери аккаунт', 'bad'); return; }
  const k = await act(api.skinApply, it.id);
  if (k) { K = k; selectedSkinId = it.id; toast('Скин «' + it.name + '» виден всем игрокам DarkX', 'ok'); renderSkinsAll(); }
}

function uploadSkinModal() {
  let model = 'classic';
  const nick = h('input', { class: 'input', placeholder: 'Ник игрока (лицензия)', maxlength: '16', spellcheck: 'false' });
  const status = h('div', { class: 'text-[12px] text-dim min-h-[18px]' });

  const done = (res) => {
    if (!res) return;
    K = res.state;
    if (res.added && res.added.id) selectedSkinId = res.added.id;
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
