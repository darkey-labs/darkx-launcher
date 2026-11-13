'use strict';
/* Обложка сборки: пиксельный пейзаж, рисуется кодом. Для каждой сборки — свои цвета и холмы (по id), для стандартной — закат.
 * Запасной вариант: если assets/cover.jpg нет, показывается этот пейзаж (поверх него app.js кладёт баннер). */

function seedOf(str) {
  let x = 2166136261;
  for (const ch of String(str)) { x ^= ch.charCodeAt(0); x = Math.imul(x, 16777619); }
  return x >>> 0;
}

function rng(seed) {
  let a = seed || 1;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const hsl = (h, s, l) => 'hsl(' + Math.round(h) + ' ' + Math.round(s) + '% ' + Math.round(l) + '%)';

/** SVG-пейзаж 30×45 клеток. standard — закат; иначе палитра от seed. */
function coverSvg(seedText, standard) {
  const seed = seedOf(seedText), r = rng(seed);
  const W = 30, H = 45, C = 8;
  const hue = standard ? 28 : seed % 360;
  const cool = standard ? 205 : (hue + 190) % 360;
  const P = {
    skyTop: hsl(cool, standard ? 45 : 38, standard ? 30 : 22),
    skyMid: hsl(standard ? 32 : hue, standard ? 70 : 55, standard ? 62 : 48),
    skyLow: hsl(standard ? 40 : (hue + 24) % 360, standard ? 80 : 60, standard ? 74 : 62),
    sun: hsl(standard ? 45 : (hue + 30) % 360, 90, 82),
    cloud: hsl(standard ? 35 : hue, 55, 86),
    far: hsl(standard ? 18 : (hue + 320) % 360, standard ? 28 : 24, standard ? 42 : 30),
    mid: hsl(standard ? 95 : (hue + 120) % 360, standard ? 32 : 30, standard ? 34 : 28),
    near: hsl(standard ? 100 : (hue + 130) % 360, standard ? 48 : 42, standard ? 38 : 30),
    top: hsl(standard ? 92 : (hue + 120) % 360, standard ? 55 : 48, standard ? 48 : 40),
    dirt: hsl(standard ? 24 : (hue + 20) % 360, 34, standard ? 24 : 18),
    leaf: hsl(standard ? 110 : (hue + 140) % 360, 42, 22),
    wood: hsl(25, 38, 18)
  };
  const out = [];
  const rect = (x, y, w, h, fill, extra) => out.push('<rect x="' + x * C + '" y="' + y * C + '" width="' + w * C + '" height="' + h * C + '" fill="' + fill + '"' + (extra || '') + '/>');

  // небо тремя полосами-градиентом (пиксельная лесенка)
  const bands = 13;
  for (let i = 0; i < bands; i++) {
    const t = i / (bands - 1);
    const col = t < .55 ? mix(P.skyTop, P.skyMid, t / .55) : mix(P.skyMid, P.skyLow, (t - .55) / .45);
    rect(0, Math.floor(i * 36 / bands), W, Math.ceil(36 / bands) + 1, col);
  }
  // солнце
  const sx = 6 + Math.floor(r() * 18), sy = 14 + Math.floor(r() * 4);
  for (let y = -4; y <= 4; y++) for (let x = -4; x <= 4; x++) if (x * x + y * y <= 13) rect(sx + x, sy + y, 1, 1, P.sun, ' opacity=".92"');
  // облака
  for (let i = 0; i < 3; i++) {
    const cx = Math.floor(r() * 22), cy = 6 + Math.floor(r() * 12), cw = 4 + Math.floor(r() * 4);
    rect(cx, cy, cw, 1, P.cloud, ' opacity=".7"');
    rect(cx + 1, cy - 1, Math.max(2, cw - 3), 1, P.cloud, ' opacity=".7"');
  }
  // холмы тремя слоями: столбцы разной высоты
  const layer = (base, amp, fill, f1, f2) => {
    const ph = r() * 6.28, ph2 = r() * 6.28;
    for (let x = 0; x < W; x++) {
      const y = Math.round(base - amp * (Math.sin(x * f1 + ph) * .6 + Math.sin(x * f2 + ph2) * .4));
      rect(x, y, 1, H - y, fill);
    }
  };
  layer(24, 4, P.far, .28, .7);
  layer(29, 3, P.mid, .35, .9);
  // передний план: трава сверху, земля ниже, деревья
  const gy = 34;
  const hgt = [];
  for (let x = 0; x < W; x++) hgt.push(gy + Math.round(Math.sin(x * .5 + hue) * 1.2));
  hgt.forEach((y, x) => { rect(x, y, 1, H - y, P.dirt); rect(x, y, 1, 3, P.near); rect(x, y, 1, 1, P.top); });
  for (let i = 0; i < 3; i++) {
    const x = 2 + Math.floor(r() * 24), y = hgt[x] - 1, tall = 3 + Math.floor(r() * 2);
    rect(x, y - tall, 1, tall + 1, P.wood);
    rect(x - 2, y - tall - 2, 5, 2, P.leaf);
    rect(x - 1, y - tall - 3, 3, 1, P.leaf);
  }
  // затемнение сверху слева — под подпись
  const shade = '<defs><linearGradient id="sh" x1="0" y1="0" x2="0.6" y2="1"><stop offset="0" stop-color="#000" stop-opacity=".62"/><stop offset=".45" stop-color="#000" stop-opacity=".12"/><stop offset="1" stop-color="#000" stop-opacity=".18"/></linearGradient></defs>';
  return '<svg viewBox="0 0 ' + W * C + ' ' + H * C + '" preserveAspectRatio="xMidYMid slice" width="100%" height="100%" shape-rendering="crispEdges" aria-hidden="true">'
    + out.join('') + shade + '<rect width="' + W * C + '" height="' + H * C + '" fill="url(#sh)"/></svg>';
}

/** Смешивает два hsl()-цвета через RGB (по оттенку выходило бы через зелёный). */
function mix(a, b, t) {
  const rgb = (c) => {
    const [h, s0, l0] = c.match(/[\d.]+/g).map(Number), s = s0 / 100, l = l0 / 100;
    const k = (n) => (n + h / 30) % 12, f = (n) => l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    return [f(0), f(8), f(4)].map((v) => v * 255);
  };
  const x = rgb(a), y = rgb(b);
  return 'rgb(' + x.map((v, i) => Math.round(v + (y[i] - v) * t)).join(',') + ')';
}

if (typeof module !== 'undefined') module.exports = { coverSvg, seedOf, rng };
