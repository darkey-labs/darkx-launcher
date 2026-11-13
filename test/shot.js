// Скриншоты и сквозной прогон интерфейса в настоящем Electron 20 (xvfb) с подменённой сетью и синтетическими «чужими» лаунчерами.
// SHOT_DIR — куда класть png и report.json, SHOT_DATA — папка данных лаунчера.
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const out = process.env.SHOT_DIR;
app.commandLine.appendSwitch('no-sandbox');
process.env.DXL_DATA = process.env.SHOT_DATA;
const fx = fs.mkdtempSync(path.join(os.tmpdir(), 'dxl-shot-fx-'));
process.env.HOME = path.join(fx, 'home');
process.env.XDG_DATA_HOME = path.join(fx, 'home', '.local', 'share');
require('./fixtures').build(fx);
const mock = require('./mocknet');
require('../main/main.js');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
app.whenReady().then(async () => {
  await sleep(1800);
  const win = BrowserWindow.getAllWindows()[0];
  const size = (process.env.SHOT_SIZE || '1180x700').split('x').map(Number);
  win.setSize(size[0], size[1]);
  const wc = win.webContents;
  const ev = (js) => wc.executeJavaScript(js);
  const shot = async (name, wait = 350) => { await sleep(wait); fs.writeFileSync(path.join(out, name + '.png'), (await wc.capturePage()).toPNG()); };
  const report = {};
  const click = (sel, text) => ev(`(()=>{const l=[...document.querySelectorAll(${JSON.stringify(sel)})];const e=${text ? `l.find(b=>b.textContent.includes(${JSON.stringify(text)}))` : 'l[0]'};if(!e)return 'NOT FOUND ${sel} ${text || ''}';e.click();return 'ok'})()`);
  const rail = (i) => ev("document.querySelectorAll('#nav .rail')[" + i + "].click()");
  const step = async (name, fn) => { try { await fn(); } catch (e) { report['ERR ' + name] = String(e.stack || e).slice(0, 400); } };
  try {
    await step('home-empty', async () => { await shot('01-home-no-account', 900); });

    await step('account', async () => {
      await click('#acc-chip');
      await shot('02-account-menu', 250);
      await click('button', 'Новый аккаунт');
      await shot('03-new-account-modal', 300);
      await click('#modal-root button', 'Offline');
      await ev("(()=>{const i=document.querySelector('#modal-root input');i.value='tr3atxd_';i.dispatchEvent(new Event('input'));})()");
      await click('#modal-root button', 'Добавить');
      await shot('04-home', 700);
      report.title = await ev("document.querySelector('.greet').textContent");
      report.nick = await ev("document.querySelector('.pixel').textContent");
      report.coverLabel = await ev("document.querySelector('#main .font-bold.leading-\\\\[1\\\\.05\\\\]').textContent");
      report.playBtn = await ev("document.querySelector('.play-go').textContent");
      report.nickFont = await ev("getComputedStyle(document.querySelector('.pixel')).fontFamily");
    });

    await step('servers', async () => {
      await click('#pill button');
      await shot('05-servers-menu', 300);
      await ev("(()=>{const i=document.querySelector('body > div.fixed input');i.value='mc.example.com:25566';i.dispatchEvent(new Event('input'));})()");
      await ev("document.querySelector('body > div.fixed input').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter'}))");
      await sleep(5000);
      report.servers = JSON.parse(fs.readFileSync(path.join(process.env.SHOT_DATA, 'settings.json'), 'utf8')).servers;
      await shot('06-home-server', 500);
    });

    await step('overlay', async () => {
      await ev("S.state='installing'; progress={step:5,steps:5,name:'Моды',label:'DX Visuals',done:12*1048576,total:80*1048576}; launching=true; rerollTitle(false); syncOverlay(); renderPage();");
      await shot('07-launch-overlay', 700);
      report.tip = await ev("document.querySelector('#overlay-root').innerText.replace(/\\n+/g,' | ')");
      await ev("progress={step:5,steps:5,name:'Моды',label:'Fabric API',done:0,total:0}; paintOverlay();0");
      report.noNullOverlay = !(await ev("document.querySelector('#overlay-root').innerText")).includes('null');
      await ev("progress={step:5,steps:5,name:'Моды',done:0,total:0}; paintOverlay();0");
      report.noNullOverlay2 = !(await ev("document.querySelector('#overlay-root').innerText")).includes('null');
      await ev("S.state='idle'; progress=null; launching=false; syncOverlay(); renderPage();");
      report.overlayGone = await ev("!document.querySelector('#overlay-root').firstChild");
    });

    await step('wizard', async () => {
      await click('.play-chev');
      await shot('08-instance-menu', 250);
      await click('body > div.fixed button', 'Мастер создания сборок');
      await shot('09-wizard-menu', 300);
      await click('#modal-root .wiz-row');
      await shot('10-wizard-launchers', 900);
      report.launcherTiles = await ev("[...document.querySelectorAll('#modal-root .tile')].map(t=>t.innerText.replace(/\\n+/g,' | '))");
      await click('#modal-root .tile', 'Prism');
      await shot('11-wizard-prism', 700);
      report.prismRows = await ev("[...document.querySelectorAll('#modal-root .tile')].map(t=>t.innerText.replace(/\\n+/g,' | '))");
      await click('#modal-root button', 'Перенести');
      await sleep(2500);
      await shot('12-after-import', 600);
      report.afterImport = await ev("JSON.stringify(S.instances.map(i=>[i.id,i.name,i.kind,i.source,i.mc,i.fabric,i.darkx,i.loaderOrigin||'']))");
      report.importedFiles = fs.readdirSync(path.join(process.env.SHOT_DATA, 'game', 'instances')).join(',');
    });

    await step('marks', async () => {
      await ev("(()=>{const r=document.createElement('div');r.id='mk';r.style.cssText='position:fixed;inset:auto 0 0 0;z-index:99;background:#000;padding:20px;display:flex;gap:18px';for(const id of ['modrinth','curseforge','prism','atlauncher','dawn','multimc','gdlauncher','lunar']){r.append(mark(id,84))}document.body.append(r)})();0");
      await shot('22-marks', 700);
      await ev("document.getElementById('mk').remove();0");
    });

    await step('create', async () => {
      await click('#nav .rail', '');
      await ev("go('play');0");
      await sleep(300);
      await ev("openWizard('create');0");
      await shot('13-wizard-create', 600);
      await click('#modal-root button', 'Создать сразу');
      await sleep(700);
      report.afterQuick = await ev("JSON.stringify(S.instances.map(i=>[i.id,i.name,i.kind,i.mc,i.fabric,i.darkx]))");
      await shot('14-home-quick', 500);
    });

    await step('home-imported', async () => {
      await ev("api.selectInstance('mojave') ; 0");
      const ids = await ev("S.instances.map(i=>i.id)");
      report.ids = ids;
      const imp = ids.find((i) => i !== 'darkx' && /survival|myj|vyzh/i.test(i)) || ids[1];
      await ev(`(async()=>{const r=await api.selectInstance(${JSON.stringify(imp)});setState(r.data);})()`);
      await shot('15-home-imported', 500);
      report.importedLabel = await ev("document.querySelector('#main .font-bold.leading-\\\\[1\\\\.05\\\\]').textContent");
    });

    await step('instances', async () => { await rail(2); await shot('16-instances', 400); });
    await step('mods', async () => { await rail(1); await shot('17-mods', 1200); });
    await step('skins', async () => { await rail(3); await shot('18-skins', 600); });
    await step('settings', async () => {
      await ev("document.querySelector('#nav-bottom .rail:last-child').click()");
      await shot('19-settings', 400);
      await ev("document.querySelector('#main').scrollTop=9999");
      await shot('20-settings-bottom', 300);
    });
    await step('console', async () => {
      await rail(0);
      await ev("logs=['[launcher] Fabric API: ok','[INFO] Loading Minecraft','[WARN] something','[ERROR] boom']; consoleOpen=true; renderPage();");
      await shot('21-console', 400);
      await ev("consoleOpen=false; renderPage();");
    });

    report.junk = [];
    for (let i = 0; i < 4; i++) { await rail(i); await sleep(i === 1 ? 1000 : 300); const t = await ev("document.body.innerText"); if (/\bnull\b|undefined|\[object|NaN/.test(t)) report.junk.push('rail' + i); }
    await rail(0);
    // ---- языки: проходим по основным экранам, ищем непереведённое
    report.i18n = {};
    for (const lang of ['en', 'uk', 'be']) {
      await step('lang-' + lang, async () => {
        await ev(`(()=>{S.settings.lang=${JSON.stringify(lang)};applyLang();I18N.misses.clear();})()`);
        await rail(0); await sleep(300);
        await ev("S.state='installing'; progress={step:2,steps:5,name:'Библиотеки',label:'12 файлов',done:5242880,total:20971520}; launching=true; syncOverlay();");
        await sleep(300);
        if (lang === 'en') await shot('30-overlay-en', 200);
        await ev("S.state='idle'; progress=null; launching=false; syncOverlay();");
        await click('#pill button'); await sleep(200); await ev("closePop && closePop();0");
        await ev("openWizard();0"); await sleep(200);
        if (lang === 'uk') await shot('31-wizard-uk', 100);
        await click('#modal-root .wiz-row'); await sleep(900);
        await click('#modal-root .tile', ''); await sleep(700);
        await ev("closeModal();0");
        await ev("openWizard('create');0"); await sleep(600);
        if (lang === 'en') await shot('32-create-en', 100);
        await ev("closeModal();0");
        await rail(2); await sleep(300);
        await rail(1); await sleep(900);
        await rail(3); await sleep(400);
        await ev("document.querySelector('#nav-bottom .rail:last-child').click()"); await sleep(400);
        await rail(0); await sleep(300);
        report.i18n[lang] = await ev('[...I18N.misses]');
      });
    }
    await ev("(()=>{S.settings.lang='ru';applyLang();})()");
  } catch (e) {
    fs.writeFileSync(path.join(out, 'error.txt'), String(e.stack || e));
  }
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 1));
  app.exit(0);
});
