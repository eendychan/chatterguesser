// ChatterGuesser — построение пула сообщений с учётом всех фильтров
const MessagePool = (() => {

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
      case 'all':      return true;
      case 'mods':     return mods.has(user);
      case 'vips':     return vips.has(user);
      case 'vips_mods':return mods.has(user) || vips.has(user);
      case 'regulars': return !mods.has(user) && !vips.has(user);
      default:         return true;
    }
  }

  // Парсит строку "ник1 ник2 ник3" в Set из ников в нижнем регистре
  function parseChatterList(str) {
    if (!str) return new Set();
    return new Set(
      str.split(/\s+/).map(s => s.trim().toLowerCase()).filter(Boolean)
    );
  }

  // Парсит строку разрешённых фраз вида: "!v" "!vanish" "привет" -> Set<string>
  // Формат: фразы в двойных кавычках через пробел
  function parseAllowedPhrases(str) {
    if (!str) return new Set();
    const matches = str.match(/"([^"]+)"/g) || [];
    return new Set(matches.map(m => m.replace(/"/g, '').toLowerCase()));
  }

  // Сообщение "разрешено" если начинается с одной из разрешённых фраз
  function isAllowed(text, allowedPhrases) {
    if (!allowedPhrases || allowedPhrases.size === 0) return false;
    const lower = text.toLowerCase();
    for (const phrase of allowedPhrases) {
      if (lower.startsWith(phrase)) return true;
    }
    return false;
  }

  // Фильтр 7TV-смайликов
  // mode: 'off' | 'only_emotes' | 'no_emotes'
  function passes7tvFilter(text, mode, emotes) {
    if (mode === 'off') return true;
    // Защита: если SevenTV модуль не загрузился — пропускаем всё
    if (typeof SevenTV === 'undefined') return true;
    if (mode === 'only_emotes') {
      return !SevenTV.isOnlyEmotes(text, emotes);
    }
    if (mode === 'no_emotes') {
      return !SevenTV.containsEmote(text, emotes);
    }
    return true;
  }

  // Полный парсинг всего диапазона (для кнопки "Спарсить диапазон" / "Парсить всё")
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
      if (onProgress) onProgress({
        daysScanned,
        totalDays: allDates.length,
        rawCount: rawMessages.length,
        chattersCount: chattersSeen.size,
      });
    }
    return rawMessages;
  }

  // Синхронная фильтрация уже загруженного пула под все настройки
  function filterPool(rawMessages, options) {
    const {
      minLength, maxLength, authorFilter, minMessages,
      mods, vips, ignoredChattersStr,
      allowedPhrasesStr, emoteFilter, emotes,
    } = options;

    const ignored        = parseChatterList(ignoredChattersStr);
    const allowedPhrases = parseAllowedPhrases(allowedPhrasesStr || '');
    const counts         = countMessagesByUser(rawMessages);

    const pool = rawMessages.filter((msg) => {
      if (ignored.has(msg.user)) return false;
      if (!passesLength(msg.text, minLength, maxLength)) return false;
      if (!passesAuthorFilter(msg.user, authorFilter, mods, vips)) return false;
      const authorCount = counts.get(msg.user) || 0;
      if (authorCount < minMessages) return false;
      // Разрешённые сообщения обходят 7TV-фильтр
      if (!passes7tvFilter(msg.text, emoteFilter || 'off', emotes || new Set())) {
        if (!isAllowed(msg.text, allowedPhrases)) return false;
      }
      return true;
    });

    const uniqueAuthors = new Set(pool.map(m => m.user));
    return { pool, uniqueAuthorCount: uniqueAuthors.size };
  }

  function sampleUnique(pool, n, excludeTexts = new Set()) {
    const available = pool.filter(m => !excludeTexts.has(m.text));
    const shuffled = [...available].sort(() => Math.random() - 0.5);
    return shuffled.slice(0, n);
  }

  return {
    scanAllMessages,
    filterPool,
    countMessagesByUser,
    sampleUnique,
    parseChatterList,
    parseAllowedPhrases,
  };
})();
