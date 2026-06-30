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

  // Парсит строку "ник1 ник2 ник3" в Set из ников в нижнем регистре
  function parseChatterList(str) {
    if (!str) return new Set();
    return new Set(
      str
        .split(/\s+/)
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean)
    );
  }

  // Сканирует диапазон логов [start, end] (включительно) и возвращает массив
  // сырых сообщений без применения каких-либо фильтров. Это единственная
  // функция, которая обращается к сети — вызывается при входе на экран
  // настроек (или при смене диапазона дат / нажатии "Парсить всё"), до того
  // как кнопка "Начать игру" станет доступной.
  async function scanAllMessages(options, onProgress) {
    const { channel, startDate, endDate } = options;

    const allDates = LogsService.enumerateDatesDescending(startDate, endDate);
    let rawMessages = [];
    let daysScanned = 0;
    const chattersSeen = new Set();

    for (const date of allDates) {
      const dayMessages = await LogsService.fetchDay(channel, date.year, date.month, date.day);
      daysScanned++;
      rawMessages = rawMessages.concat(dayMessages);
      for (const msg of dayMessages) chattersSeen.add(msg.user);

      if (onProgress) {
        onProgress({
          daysScanned,
          totalDays: allDates.length,
          rawCount: rawMessages.length,
          chattersCount: chattersSeen.size,
        });
      }
    }

    return rawMessages;
  }

  // Синхронно фильтрует уже загруженный пул сырых сообщений под текущие
  // настройки (длина, автор, минимум сообщений автора, игнор-лист). Не делает
  // сетевых запросов — вызывается мгновенно при каждом клике "Начать игру",
  // что позволяет менять фильтры без повторного скачивания логов.
  function filterPool(rawMessages, options) {
    const { minLength, maxLength, authorFilter, minMessages, mods, vips, ignoredChattersStr } = options;

    const ignored = parseChatterList(ignoredChattersStr);
    const counts = countMessagesByUser(rawMessages);

    const pool = rawMessages.filter((msg) => {
      if (ignored.has(msg.user)) return false;
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
    parseChatterList,
  };
})();
