'use strict';
// Сборка командной строки и запуск Minecraft.
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const P = require('./paths');
const V = require('./versions');

function classpath(prep) {
  const seen = new Set();
  const out = [];
  for (const l of prep.libs) {
    if (l.native) continue; // старые natives в classpath не нужны
    if (seen.has(l.dest)) continue;
    seen.add(l.dest);
    out.push(l.dest);
  }
  out.push(prep.clientJar);
  return out.join(path.delimiter);
}

/** Возвращает {java, args, cwd}. Чистая функция — легко тестировать. */
function command(prep, account, token, inst, cfg, launcherVersion, server) {
  const v = prep.version;
  const vars = {
    auth_player_name: account.name,
    version_name: v.id,
    game_directory: prep.instDir,
    assets_root: P.assets(),
    assets_index_name: v.assets,
    auth_uuid: account.uuid.replace(/-/g, ''),
    auth_access_token: token,
    auth_session: token,
    clientid: '',
    auth_xuid: '',
    user_type: account.type === 'microsoft' ? 'msa' : 'legacy',
    version_type: v.type || 'release',
    user_properties: '{}',
    natives_directory: prep.nativesDir,
    launcher_name: 'DarkXLauncher',
    launcher_version: launcherVersion,
    library_directory: P.libraries(),
    classpath_separator: path.delimiter,
    game_assets: P.assets('virtual', v.assets),
    classpath: classpath(prep),
    quickPlayMultiplayer: server ? server.host + (server.port && server.port !== 25565 ? ':' + server.port : '') : ''
  };
  // Быстрый вход на сервер: с 1.20 — через --quickPlayMultiplayer (правило has_quick_plays_support), раньше — --server/--port
  const quick = !!server && JSON.stringify(v.arguments || {}).includes('has_quick_plays_support');
  const a = V.buildArgs(v, vars, { features: { has_quick_plays_support: quick } });
  if (server && !quick) a.game.push('--server', server.host, '--port', String(server.port || 25565));
  const mem = Math.max(512, Number(inst.memoryMb || cfg.memoryMb || 4096));
  const extra = String(inst.jvmArgs || cfg.jvmArgs || '').split(/\s+/).filter(Boolean);
  const args = ['-Xmx' + mem + 'M', '-Xms' + Math.min(512, mem) + 'M', ...extra, ...a.jvm, a.mainClass, ...a.game];
  return { java: prep.javaBin, args, cwd: prep.instDir };
}

/** Запускает процесс. Колбэки: onLog(line), onExit(code). Возвращает child. */
function run(cmd, { onLog, onExit }) {
  const logFile = P.shared('logs', 'latest.log');
  fs.writeFileSync(logFile, '');
  const out = fs.createWriteStream(logFile, { flags: 'a' });
  const child = spawn(cmd.java, cmd.args, { cwd: cmd.cwd, windowsHide: true });
  const pipe = (stream) => {
    let buf = '';
    stream.on('data', (d) => {
      out.write(d);
      buf += d.toString('utf8');
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        onLog(buf.slice(0, i).replace(/\r$/, ''));
        buf = buf.slice(i + 1);
      }
    });
  };
  pipe(child.stdout);
  pipe(child.stderr);
  let finished = false;
  const finish = (code) => {
    if (finished) return;
    finished = true;
    out.end(() => onExit(code));
  };
  child.on('error', (e) => { onLog('[launcher] не удалось запустить Java: ' + e.message); finish(-1); });
  child.on('close', (code) => finish(code)); // close — после того как потоки вывода дочитаны
  return child;
}

module.exports = { command, run, classpath };
