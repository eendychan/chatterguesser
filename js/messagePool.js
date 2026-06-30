// ChatterGuesser — построение пула сообщений с учётом всех фильтров
const MessagePool = (() => {

  // Считает кол-во сообщений на пользователя по уже собранным сырым сообщениям
  function countMessagesByUser(messages) {
    const counts = new Map();
    for (const msg of messages) {
      counts.set(msg.user, (counts.get(msg.user) || 0) + 1);
    }
    return counts;
  }

  function passesLength(text, minLen, maxLen) {
    const len = text.length;
    return len >= minLen && len <= maxLen;
  }

  function passesAuthorFilter(user, authorFilter, mods, vips) {
    switch (authorFilter) {
      case 'all':
        return true;
      case 'mods':
        return mods.has(user);
      case 'vips':
        return vips.has(user);
      case 'vips_mods':
        return mods.has(user) || vips.has(user);
      case 'regulars':
        // "Работяги" — обычные чаттеры без бейджей мода/вип
        return !mods.has(user) && !vips.has(user);
      default:
        return true;
    }
  }

  // Сканирует ВЕСЬ доступный диапазон логов (от стартовой даты до сегодняшнего
  // дня включительно) и возвращает массив сырых сообщений без применения
  // каких-либо фильтров. Это единственная функция, которая обращается к сети —
  // вызывается один раз при входе на экран настроек, до того как кнопка
  // "Начать игру" станет доступной.
  async function scanAllMessages(options, onProgress) {
    const { channel } = options;

    const start = CONFIG.LOGS_START_DATE;
    const end = (() => {
      const now = new Date();
      return { year: now.getUTCFullYear(), month: now.getUTCMonth() + 1, day: now.getUTCDate() };
    })();

    const allDates = enumerateDatesDescending(start, end);
    let rawMessages = [];
    let daysScanned = 0;

    for (const date of allDates) {
      const dayMessages = await LogsService.fetchDay(channel, date.year, date.month, date.day);
      daysScanned++;
      rawMessages = rawMessages.concat(dayMessages);

      if (onProgress) {
        onProgress({
          daysScanned,
          totalDays: allDates.length,
          rawCount: rawMessages.length,
        });
      }
    }

    return rawMessages;
  }

  // Синхронно фильтрует уже загруженный пул сырых сообщений под текущие
  // настройки (длина, автор, минимум сообщений автора). Не делает сетевых
  // запросов — вызывается мгновенно при каждом клике "Начать игру", что
  // позволяет менять фильтры без повторного скачивания логов.
  function filterPool(rawMessages, options) {
    const { minLength, maxLength, authorFilter, minMessages, mods, vips } = options;

    const counts = countMessagesByUser(rawMessages);

    const pool = rawMessages.filter((msg) => {
      if (!passesLength(msg.text, minLength, maxLength)) return false;
      if (!passesAuthorFilter(msg.user, authorFilter, mods, vips)) return false;
      const authorCount = counts.get(msg.user) || 0;
      if (authorCount < minMessages) return false;
      return true;
    });

    const uniqueAuthors = new Set(pool.map((m) => m.user));

    return {
      pool,
      uniqueAuthorCount: uniqueAuthors.size,
    };
  }

  function enumerateDatesDescending(start, end) {
    function isBefore(a, b) {
      if (a.year !== b.year) return a.year < b.year;
      if (a.month !== b.month) return a.month < b.month;
      return a.day < b.day;
    }
    function subtractDay(y, m, d) {
      const dt = new Date(Date.UTC(y, m - 1, d));
      dt.setUTCDate(dt.getUTCDate() - 1);
      return { year: dt.getUTCFullYear(), month: dt.getUTCMonth() + 1, day: dt.getUTCDate() };
    }

    const dates = [];
    let cursor = { ...end };
    while (true) {
      dates.push({ ...cursor });
      if (cursor.year === start.year && cursor.month === start.month && cursor.day === start.day) break;
      if (isBefore(cursor, start)) break;
      cursor = subtractDay(cursor.year, cursor.month, cursor.day);
    }
    return dates;
  }

  // Выбирает N случайных уникальных по тексту сообщений из пула
  function sampleUnique(pool, n, excludeTexts = new Set()) {
    const available = pool.filter((m) => !excludeTexts.has(m.text));
    const shuffled = [...available].sort(() => Math.random() - 0.5);
    return shuffled.slice(0, n);
  }

  return {
    scanAllMessages,
    filterPool,
    countMessagesByUser,
    sampleUnique,
  };
})();
