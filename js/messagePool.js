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

  // Основная функция: собирает пригодный пул сообщений под все фильтры.
  // Двухпроходный подход:
  //   1) сканируем логи по дням, копим ВСЕ сообщения (для подсчёта активности авторов)
  //   2) применяем фильтр длины + автора + минимума сообщений автора
  // Если на найденном диапазоне дат не набралось достаточно сообщений —
  // расширяем диапазон (это уже делает LogsService.collectMessages),
  // используя пересчёт счётчиков по мере роста охвата.
  async function buildPool(options, onProgress) {
    const {
      channel,
      minLength,
      maxLength,
      authorFilter,
      minMessages,
      neededCount, // сколько валидных сообщений минимум нужно набрать (rounds * variants, с запасом)
      mods,
      vips,
    } = options;

    const start = CONFIG.LOGS_START_DATE;
    const end = (() => {
      const now = new Date();
      return { year: now.getUTCFullYear(), month: now.getUTCMonth() + 1, day: now.getUTCDate() };
    })();

    // Собираем сырые сообщения по дням, расширяя диапазон, пока не наберём
    // достаточно ПОСЛЕ фильтрации. Поскольку фильтр "минимум сообщений автора"
    // зависит от общего охвата, пересчитываем кандидатов на каждом шаге.
    const allDates = enumerateDatesDescending(start, end);
    let rawMessages = [];
    let daysScanned = 0;
    let validPool = [];

    for (const date of allDates) {
      if (daysScanned >= CONFIG.MAX_DAYS_LOOKBACK_EXPANSION) break;

      const dayMessages = await LogsService.fetchDay(channel, date.year, date.month, date.day);
      daysScanned++;
      rawMessages = rawMessages.concat(dayMessages);

      // Пересчитываем активность авторов на всём собранном охвате
      const counts = countMessagesByUser(rawMessages);

      validPool = rawMessages.filter((msg) => {
        if (!passesLength(msg.text, minLength, maxLength)) return false;
        if (!passesAuthorFilter(msg.user, authorFilter, mods, vips)) return false;
        const authorCount = counts.get(msg.user) || 0;
        if (authorCount < minMessages) return false;
        return true;
      });

      if (onProgress) onProgress({ daysScanned, rawCount: rawMessages.length, validCount: validPool.length });

      if (validPool.length >= neededCount) break;
    }

    return {
      pool: validPool,
      daysScanned,
      totalRawMessages: rawMessages.length,
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
    buildPool,
    countMessagesByUser,
    sampleUnique,
  };
})();
