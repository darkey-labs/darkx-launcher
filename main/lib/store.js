'use strict';
// JSON-хранилище настроек, аккаунтов и сборок. Запись атомарная (через временный файл).
const fs = require('fs');
const path = require('path');

let root = null;
const cache = {};

function init(dir) {
  root = dir;
  fs.mkdirSync(root, { recursive: true });
}

function file(name) {
  return path.join(root, name + '.json');
}

function load(name, defaults) {
  if (cache[name]) return cache[name];
  let data = null;
  try { data = JSON.parse(fs.readFileSync(file(name), 'utf8')); } catch (_) { /* первый запуск или битый файл */ }
  cache[name] = Array.isArray(defaults) ? (Array.isArray(data) ? data : defaults) : Object.assign({}, defaults, data || {});
  return cache[name];
}

function save(name) {
  if (!cache[name]) return;
  const f = file(name), tmp = f + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(cache[name], null, 2));
  fs.renameSync(tmp, f);
}

module.exports = { init, load, save, get root() { return root; } };
