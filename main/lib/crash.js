'use strict';
// Человекочитаемый анализатор вылетов и крашей Minecraft (замена голого кода завершения на понятный попап).
const fs = require('fs');
const path = require('path');

function readRecentCrashReport(instDir, sinceMs = 0) {
  if (!instDir) return '';
  const crDir = path.join(instDir, 'crash-reports');
  try {
    if (!fs.existsSync(crDir)) return '';
    const files = fs.readdirSync(crDir)
      .filter((f) => /\.(txt|log)$/i.test(f))
      .map((f) => {
        const full = path.join(crDir, f);
        const st = fs.statSync(full);
        return { full, mtime: st.mtimeMs };
      })
      .filter((x) => !sinceMs || x.mtime >= sinceMs - 10000)
      .sort((a, b) => b.mtime - a.mtime);
    if (!files.length) return '';
    return fs.readFileSync(files[0].full, 'utf8').slice(0, 24000);
  } catch (_) {
    return '';
  }
}

function extractCulpritMods(fullText) {
  const culprits = new Set();
  const lines = String(fullText || '').split(/\r?\n/);

  for (const line of lines) {
    // Fabric ModResolutionException: "- Mod 'Sodium' (sodium) 0.6.0 requires version 1.21.4 of 'Minecraft'"
    const fabReq = /Mod\s+'([^']+)'\s*\(([^)]+)\)[^\n]*requires\s+([^\n]+)/i.exec(line);
    if (fabReq) {
      culprits.add(fabReq[1] + ' (' + fabReq[2] + '): требует ' + fabReq[3].replace(/[!]+$/, '').trim());
      continue;
    }
    // Mixin apply error: "Mixin transformation of ... failed" или "from mod <id>"
    const mixinMod = /from mod\s+([a-z0-9_.-]+)/i.exec(line);
    if (mixinMod && mixinMod[1] !== 'minecraft') {
      culprits.add('Конфликт миксинов в моде: ' + mixinMod[1]);
    }
    // Suspected Mods: Sodium (sodium), Iris (iris)
    const susp = /Suspected Mods:\s*(.+)/i.exec(line);
    if (susp && !/None/i.test(susp[1])) {
      culprits.add('Подозреваемый мод: ' + susp[1].trim());
    }
    // Упоминание конкретного .jar файла в папке mods
    const jarMatch = /mods[\\/]+([^\s\\/:"']+\.jar)/i.exec(line);
    if (jarMatch) {
      culprits.add(jarMatch[1]);
    }
  }

  return [...culprits].slice(0, 6);
}

function pickImportantLines(logs, crashText) {
  const combined = [].concat(
    Array.isArray(logs) ? logs : String(logs || '').split(/\r?\n/),
    crashText ? String(crashText).split(/\r?\n/).slice(0, 45) : []
  );
  const important = combined.filter((l) => /Exception|Error|FATAL|Incompatible|requires|Mixin|GLFW|OutOfMemory|Caused by:|at net\.|Suspected Mods/i.test(l));
  const tail = (important.length ? important : combined).slice(-14);
  return tail.join('\n').trim();
}

/**
 * Анализирует логи, crash-reports и код выхода и возвращает понятную структуру для попапа.
 */
function analyzeCrash({ code, logs = [], instDir = '', inst = null, startedAt = 0 } = {}) {
  const crashReport = readRecentCrashReport(instDir, startedAt);
  const logText = (Array.isArray(logs) ? logs.join('\n') : String(logs || '')) + '\n' + crashReport;
  const culprits = extractCulpritMods(logText);
  const details = pickImportantLines(logs, crashReport);
  const instName = (inst && inst.name) || 'Сборка';
  const instMc = (inst && inst.mc) || '';

  // 1. Нехватка оперативной памяти (OutOfMemoryError)
  if (/OutOfMemoryError|Java heap space|GC overhead limit exceeded/i.test(logText) || code === -805306369) {
    return {
      kind: 'oom',
      code,
      instanceName: instName,
      title: 'Не хватило оперативной памяти (ОЗУ)',
      summary: 'Игре не хватило выделенного объёма оперативной памяти во время загрузки или генерации мира.',
      tips: [
        'Открой Настройки → Игра и увеличь ползунок «Оперативная память» (например, до 4–6 ГБ).',
        'Отключи слишком тяжёлые шейдеры, ресурспаки высокого разрешения или лишние моды.',
        'Закрой фоновые программы (браузеры и др.), если на ПК мало свободной ОЗУ.'
      ],
      culprits,
      details
    };
  }

  // 2. Несовместимые моды или отсутствующие зависимости (Fabric / Forge ModResolution)
  if (/Incompatible mods found|ModResolutionException|FormattedException|MissingModsException|ModLoadingException|requires version/i.test(logText)) {
    return {
      kind: 'mods_conflict',
      code,
      instanceName: instName,
      title: 'Конфликт модов или не хватает библиотеки',
      summary: 'Один или несколько модов в сборке «' + instName + '» не подходят под версию Minecraft ' + (instMc || '') + ' или требуют дополнительный мод-библиотеку (например Fabric API, Cloth Config, Architectury).',
      tips: [
        'Проверь список проблемных модов ниже и удали несовместимый мод во вкладке «Моды → Установлено».',
        'Убедись, что все моды скачаны именно под версию ' + (instMc || 'твоей сборки') + ' и нужный модлоадер.',
        'Если мод просит библиотеку (например fabric-api или cloth-config) — установи её в каталоге модов.'
      ],
      culprits,
      details
    };
  }

  // 3. Ошибка Mixin (конфликт двух модов, меняющих один и тот же код игры)
  if (/MixinApplyError|MixinTransformerError|MixinPrepareError|Critical injection failure/i.test(logText)) {
    return {
      kind: 'mixin',
      code,
      instanceName: instName,
      title: 'Моды конфликтуют друг с другом (ошибка Mixin)',
      summary: 'Один из модов попытался изменить внутренний код Minecraft, но столкнулся с несовместимой версией игры или другим модом.',
      tips: [
        'Чаще всего это случается, если мод от другой подверсии (например, мод для 1.21.1 запущен на 1.21.4).',
        'Удали или обнови мод, указанный в списке виновников ниже.',
        'Если ставил архив модов — воспользуйся «Распаковать моды из архива» по ПКМ на сборке, чтобы отсеять чужие версии.'
      ],
      culprits,
      details
    };
  }

  // 4. Неподходящая версия Java
  if (/UnsupportedClassVersionError|compiled by a more recent version of the Java Runtime|не удалось запустить Java/i.test(logText)) {
    return {
      kind: 'java',
      code,
      instanceName: instName,
      title: 'Неподходящая версия Java',
      summary: 'Текущая версия Java слишком старая для запуска Minecraft ' + (instMc || '') + ' или одного из установленных модов (для Minecraft 1.20.5+ и 1.21+ требуется Java 21).',
      tips: [
        'Открой Настройки → Игра и очисти поле «Путь к Java» — лаунчер сам скачает подходящую официальную Java.',
        'Если используешь свою сборку Java, укажи путь к javaw.exe версии Java 21.'
      ],
      culprits,
      details
    };
  }

  // 5. Сбой видеодрайвера / OpenGL / GLFW
  if (/GLFW error|EXCEPTION_ACCESS_VIOLATION|nvoglv64\.dll|atio6axx\.dll|ig7icd64\.dll|Pixel format not accelerated|WGL:/i.test(logText) || code === -1073741819 || code === 3221225477) {
    return {
      kind: 'gpu',
      code,
      instanceName: instName,
      title: 'Сбой видеодрайвера или графического мода (OpenGL)',
      summary: 'Игра вылетела при обращении к видеокарте. Такое бывает из-за устаревшего драйвера видеокарты или конфликта графических модов (Sodium, Iris, ImmediatelyFast, VulkanMod).',
      tips: [
        'Обнови драйвер видеокарты (NVIDIA / AMD / Intel) до актуальной версии.',
        'Если только что добавил шейдеры или графический мод — попробуй временно отключить его.',
        'На ноутбуках с двумя видеокартами убедись, что Java запускается на дискретной видеокарте.'
      ],
      culprits,
      details
    };
  }

  // 6. Повреждён главный класс или кастомный .jar версии
  if (/ClassNotFoundException|NoClassDefFoundError|Could not find or load main class|Invalid or corrupt jarfile/i.test(logText)) {
    return {
      kind: 'corrupt_jar',
      code,
      instanceName: instName,
      title: 'Не найден главный класс запуска или повреждён .JAR',
      summary: 'Java не смогла найти стартовый класс игры. Возможно, выбранный .JAR файл повреждён, является обычным модом вместо версии или скачался не полностью.',
      tips: [
        'Если ты загружал свою версию через .JAR — проверь, что это рабочий файл клиента или мода.',
        'Попробуй перезапустить сборку, чтобы лаунчер перепроверил и докачал недостающие библиотеки.'
      ],
      culprits,
      details
    };
  }

  // 7. Общий понятный диагноз для любых других вылетов
  return {
    kind: 'generic',
    code,
    instanceName: instName,
    title: 'Игра неожиданно завершилась (краш)',
    summary: culprits.length
      ? 'Во время работы сборки «' + instName + '» произошла критическая ошибка. Вероятнее всего, вылет вызван одним из модов.'
      : 'Во время запуска или работы сборки «' + instName + '» произошёл сбой. Ниже приведены последние строки из отчёта об ошибке.',
    tips: [
      'Если ошибка появилась после добавления новых модов — удали последние добавленные моды во вкладке «Моды».',
      'Посмотри детали ошибки ниже или открой консоль, чтобы увидеть точную строчку сбоя.'
    ],
    culprits,
    details
  };
}

module.exports = { analyzeCrash, extractCulpritMods, readRecentCrashReport };
