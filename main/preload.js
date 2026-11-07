'use strict';
const { contextBridge, ipcRenderer } = require('electron');

const call = (name) => (...a) => ipcRenderer.invoke(name, ...a);
const on = (ch) => (cb) => {
  const f = (_e, p) => cb(p);
  ipcRenderer.on(ch, f);
  return () => ipcRenderer.removeListener(ch, f);
};

contextBridge.exposeInMainWorld('api', {
  state: call('state'),
  win: { min: call('win:min'), max: call('win:max'), close: call('win:close') },
  external: call('external'),
  saveSettings: call('settings:save'),
  addOffline: call('acc:offline'),
  removeAccount: call('acc:remove'),
  selectAccount: call('acc:select'),
  elyLogin: call('acc:ely'),
  msStart: call('acc:ms:start'),
  msCancel: call('acc:ms:cancel'),
  versions: call('versions'),
  createInstance: call('inst:create'),
  updateInstance: call('inst:update'),
  deleteInstance: call('inst:delete'),
  selectInstance: call('inst:select'),
  openFolder: call('open:folder'),
  releases: call('releases'),
  updateCheck: call('update:check'),
  updateInstall: call('update:install'),
  modCategories: call('mods:categories'),
  modSearch: call('mods:search'),
  modInstalled: call('mods:installed'),
  modInstall: call('mods:install'),
  modRemove: call('mods:remove'),
  skins: call('skins:list'),
  skinNick: call('skins:nick'),
  skinPick: call('skins:pick'),
  skinRemove: call('skins:remove'),
  skinModel: call('skins:model'),
  skinApply: call('skins:apply'),
  skinClear: call('skins:clear'),
  quickInstance: call('inst:quick'),
  importLaunchers: call('import:launchers'),
  importDetect: call('import:detect'),
  importPick: call('import:pick'),
  importRun: call('import:run'),
  importCancel: call('import:cancel'),
  serverAdd: call('servers:add'),
  serverRemove: call('servers:remove'),
  serverSelect: call('servers:select'),
  serversRefresh: call('servers:refresh'),
  play: call('play'),
  abort: call('abort'),
  stop: call('stop'),
  onState: on('ev:state'),
  onProgress: on('ev:progress'),
  onLog: on('ev:log'),
  onExit: on('ev:exit'),
  onMs: on('ev:ms'),
  onImport: on('ev:import'),
  onMod: on('ev:mod'),
  onUpdate: on('ev:update'),
  onUpdateProgress: on('ev:update-progress'),
  onUpdateError: on('ev:update-error')
});
