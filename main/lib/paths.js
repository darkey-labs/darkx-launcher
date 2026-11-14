'use strict';
const path = require('path');
const fs = require('fs');

const P = { root: '' };

function init(root) {
  P.root = root;
  for (const d of ['versions', 'libraries', 'assets', 'runtime', 'instances', 'logs', 'cache']) {
    fs.mkdirSync(path.join(root, d), { recursive: true });
  }
}

P.init = init;
P.shared = (...a) => path.join(P.root, ...a);
P.versions = (...a) => path.join(P.root, 'versions', ...a);
P.libraries = (...a) => path.join(P.root, 'libraries', ...a);
P.assets = (...a) => path.join(P.root, 'assets', ...a);
P.runtime = (...a) => path.join(P.root, 'runtime', ...a);
P.instance = (id, ...a) => path.join(P.root, 'instances', id, ...a);

module.exports = P;
