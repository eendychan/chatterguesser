// ChatterGuesser — загрузка и парсинг логов с logs.zonian.dev
const LogsService = (() => {

  // Кэш уже скачанных дней в рамках текущей сессии (чтобы не дёргать сервер повторно)
  const dayCache = new Map(); // key: "YYYY-MM-DD" -> [{ time, user, text }]

  let corsMode = 'direct'; // 'direct' | 'proxy' | 'failed'

  function pad(n) {
    return String(n).padStart(2, '0');
  }

  function dateKey(y, m, d) {
    return `${y}-${pad(m)}-${pad(d)}`;
  }

  function buildUrl(channel, y, m, d) {
    return `${CONFIG.LOGS_BASE_URL}/channel/${channel}/${y}/${pad(m)}/${pad(d)}`;
  }

  // Проверяет, является ли строка сообщением системного типа (не от человека)
  function isSystemMessage(text) {
    return CONFIG.SYSTEM_MESSAGE_PATTERNS.some((re) => re.test(text));
  }

  // Парсит сырой текст лога в массив сообщений
  // Формат: [2025-06-14 00:28:45] #xah0b xuan21k: текст сообщения
  function parseLogText(raw, channel) {
    const lines = raw.split('\n');
    const lineRe = /^\[(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\] #(\S+) ([^:]+): (.*)$/;
    const messages = [];

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const match = trimmed.match(lineRe);
      if (!match) continue;

      const [, timestamp, lineChannel, user, text] = match;
      if (lineChannel.toLowerCase() !== channel.toLowerCase()) continue;
      if (!text || !text.trim()) continue;
      if (isSystemMessage(text)) continue;

      messages.push({
        time: timestamp,
        user: user.toLowerCase(),
        text: text.trim(),
      });
    }
    return messages;
  }

  async function rawFetch(url) {
    const res = await fetch(url, { mode: 'cors' });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    return await res.text();
  }

  async function fetchWithCorsFallback(url) {
    if (corsMode === 'direct' || corsMode === 'untested') {
      try {
        const text = await rawFetch(url);
        corsMode = 'direct';
        return text;
      } catch (e) {
        console.warn('Прямой запрос не прошёл (вероятно CORS), пробуем прокси:', e.message);
      }
    }

    // Фоллбэк через публичный CORS-прокси
    try {
      const proxied = `${CONFIG.CORS_PROXY}${encodeURIComponent(url)}`;
      const text = await rawFetch(proxied);
      corsMode = 'proxy';
      return text;
    } catch (e) {
      corsMode = 'failed';
      throw new Error('Не удалось получить логи ни напрямую, ни через прокси: ' + e.message);
    }
  }

  // Скачивает (или берёт из кэша) сообщения за один день
  async function fetchDay(channel, y, m, d) {
    const key = `${channel}_${dateKey(y, m, d)}`;
    if (dayCache.has(key)) {
      return dayCache.get(key);
    }

    const url = buildUrl(channel, y, m, d);
    try {
      const raw = await fetchWithCorsFallback(url);
      const parsed = parseLogText(raw, channel);
      dayCache.set(key, parsed);
      return parsed;
    } catch (e) {
      // День может просто не существовать (стрима не было) — это нормально
      dayCache.set(key, []);
      return [];
    }
  }

  function todayUTC() {
    const now = new Date();
    return { year: now.getUTCFullYear(), month: now.getUTCMonth() + 1, day: now.getUTCDate() };
  }

  function subtractDay(y, m, d) {
    const dt = new Date(Date.UTC(y, m - 1, d));
    dt.setUTCDate(dt.getUTCDate() - 1);
    return { year: dt.getUTCFullYear(), month: dt.getUTCMonth() + 1, day: dt.getUTCDate() };
  }

  function isBefore(a, b) {
    // a < b ?
    if (a.year !== b.year) return a.year < b.year;
    if (a.month !== b.month) return a.month < b.month;
    return a.day < b.day;
  }

  // Собирает список дат от end назад до start (включительно), от новых к старым
  function enumerateDatesDescending(start, end) {
    const dates = [];
    let cursor = { ...end };
    while (!isBefore(cursor, start) || (cursor.year === start.year && cursor.month === start.month && cursor.day === start.day)) {
      dates.push({ ...cursor });
      if (cursor.year === start.year && cursor.month === start.month && cursor.day === start.day) break;
      cursor = subtractDay(cursor.year, cursor.month, cursor.day);
    }
    return dates;
  }

  function getCorsMode() {
    return corsMode;
  }

  return {
    fetchDay,
    parseLogText,
    isSystemMessage,
    getCorsMode,
    todayUTC,
    enumerateDatesDescending,
    isBefore,
  };
})();
