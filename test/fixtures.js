'use strict';
// Синтетические папки «чужих» лаунчеров для тестов и скриншотов (реальных установок в песочнице нет).
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const AdmZip = require('adm-zip');

/** Создаёт всё внутри tmp, возвращает {home, data}. Переменные окружения HOME / XDG_DATA_HOME ставит вызывающий. */
function build(tmp) {
const home = path.join(tmp, 'home');
const data = path.join(home, '.local', 'share');


const w = (f, text) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, typeof text === 'string' ? text : JSON.stringify(text)); };
const fabricJar = (f, mc) => {
  const z = new AdmZip();
  z.addFile('fabric.mod.json', Buffer.from(JSON.stringify({ id: 'x', depends: { minecraft: '~' + mc } })));
  fs.mkdirSync(path.dirname(f), { recursive: true });
  z.writeZip(f);
};

// ---- Prism
const pr = path.join(data, 'PrismLauncher', 'instances', 'Survival');
w(path.join(pr, 'instance.cfg'), '[General]\nname=Мой выживач\nOverrideMemory=true\nMaxMemAlloc=6144\n');
w(path.join(pr, 'mmc-pack.json'), { formatVersion: 1, components: [{ uid: 'net.minecraft', version: '1.21.4' }, { uid: 'net.fabricmc.fabric-loader', version: '0.16.10' }] });
w(path.join(pr, '.minecraft', 'saves', 'World1', 'level.dat'), 'x');
w(path.join(pr, '.minecraft', 'options.txt'), 'fov:90');
w(path.join(pr, '.minecraft', 'logs', 'latest.log'), 'log');
fabricJar(path.join(pr, '.minecraft', 'mods', 'sodium.jar'), '1.21.4');
// Forge-сборка
const pf = path.join(data, 'PrismLauncher', 'instances', 'ForgePack');
w(path.join(pf, 'instance.cfg'), 'name=ForgePack\n');
w(path.join(pf, 'mmc-pack.json'), { components: [{ uid: 'net.minecraft', version: '1.20.1' }, { uid: 'net.minecraftforge', version: '47.2.0' }] });
w(path.join(pf, 'minecraft', 'mods', 'a.jar'), 'x');
w(path.join(pf, 'minecraft', 'saves', 'W', 'level.dat'), 'x');

// ---- CurseForge
const cf = path.join(home, 'curseforge', 'minecraft', 'Instances', 'Pack CF');
w(path.join(cf, 'minecraftinstance.json'), { name: 'Pack CF', gameVersion: '1.20.4', baseModLoader: { name: 'fabric-0.15.7-1.20.4', minecraftVersion: '1.20.4' }, allocatedMemory: 5000 });
w(path.join(cf, 'mods', 'm.jar'), 'x');

// ---- ATLauncher
const at = path.join(data, 'ATLauncher', 'instances', 'AllTheMods');
w(path.join(at, 'instance.json'), { id: '1.19.2', launcher: { name: 'AllTheMods', loaderVersion: { type: 'Forge', version: '43.2.0' } } });
w(path.join(at, 'mods', 'f.jar'), 'x');

// ---- GDLauncher Carbon
const gd = path.join(data, 'gdlauncher_carbon', 'data', 'instances', 'abc123');
w(path.join(gd, 'instance.json'), { name: 'GD сборка', game_configuration: { version_info: { minecraft_version: '1.21.1', modloaders: [{ type: 'fabric', version: '0.16.5' }] } } });
w(path.join(gd, 'instance', 'saves', 'S', 'level.dat'), 'x');

// ---- Modrinth App (app.db создаём через python sqlite3)
const mr = path.join(data, 'ModrinthApp');
w(path.join(mr, 'profiles', 'Fabulously Optimized', 'options.txt'), 'x');
w(path.join(mr, 'profiles', 'Fabulously Optimized', 'saves', 'S', 'level.dat'), 'x');
fabricJar(path.join(mr, 'profiles', 'Fabulously Optimized', 'mods', 'fo.jar'), '1.21.11');
w(path.join(mr, 'profiles', 'NoDb', 'options.txt'), 'x');
fabricJar(path.join(mr, 'profiles', 'NoDb', 'mods', 'z.jar'), '1.21.8');
execFileSync('python3', ['-I', '-c', `
import sqlite3,sys
c=sqlite3.connect(sys.argv[1])
c.execute("create table profiles(path text primary key,name text,game_version text,mod_loader text,mod_loader_version text,memory integer,icon_path text)")
c.execute("insert into profiles values('Fabulously Optimized','Fabulously Optimized','1.21.11','fabric','0.17.3',8192,null)")
c.commit()
`, path.join(mr, 'app.db')]);

// ---- Lunar (.minecraft)
w(path.join(home, '.minecraft', 'saves', 'LW', 'level.dat'), 'x');
w(path.join(home, '.minecraft', 'options.txt'), 'x');
w(path.join(home, '.minecraft', 'servers.dat'), 'x');
w(path.join(home, '.minecraft', 'versions', 'x', 'x.json'), 'x');


return { home, data };
}

module.exports = { build };
