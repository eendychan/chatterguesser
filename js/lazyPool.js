// ChatterGuesser — ленивый пул сообщений
// Хранит накопленные сырые сообщения между играми и раундами.
// При старте игры без предварительного парсинга — подгружает случайные дни
// "на лету" до достижения минимального порога для первого раунда.
const LazyPool = (() => {

  // Единственный долгоживущий кэш — сохраняется между играми в рамках сессии
  let accumulated = []; // все накопленные сырые сообщения
  let scannedDays  = new Set(); // dateKey уже загруженных дней (чтобы не дублировать)
  let allDates     = []; // полный список дат диапазона, перемешанных для случайного порядка

  function pad2(n) { return String(n).padStart(2, '0'); }
  function dateKey(d) { return `${d.year}-${pad2(d.month)}-${pad2(d.day)}`; }

  // Инициализация (вызывается при смене канала / диапазона)
  // Не сбрасывает уже накопленные данные если канал/диапазон те же.
  function init(channel, startDate, endDate) {
    const key = `${channel}|${dateKey(startDate)}|${dateKey(endDate)}`;
    if (LazyPool._currentKey === key) return; // уже инициализирован
    LazyPool._currentKey = key;
    LazyPool._channel = channel;
    accumulated = [];
    scannedDays  = new Set();
    allDates = LogsService
      .enumerateDatesDescending(startDate, endDate)
      .sort(() => Math.random() - 0.5); // перемешиваем для случайного порядка
  }

  // Сколько дней ещё не загружено
  function remainingDays() {
    return allDates.filter(d => !scannedDays.has(dateKey(d))).length;
  }

  // Загружает случайные непросмотренные дни пока не выполнится predicate
  // или не кончатся дни. predicate(accumulated) -> boolean.
  // onProgress({ loaded, total, msgCount, chattersCount }) — колбэк для UI.
  async function loadUntil(predicate, onProgress) {
    const unscanned = allDates.filter(d => !scannedDays.has(dateKey(d)));
    const chatters = new Set(accumulated.map(m => m.user));

    for (const date of unscanned) {
      const key = dateKey(date);
      if (scannedDays.has(key)) continue;

      const msgs = await LogsService.fetchDay(LazyPool._channel, date.year, date.month, date.day);
      scannedDays.add(key);
      accumulated = accumulated.concat(msgs);
      for (const m of msgs) chatters.add(m.user);

      if (onProgress) onProgress({
        loaded:        scannedDays.size,
        total:         allDates.length,
        msgCount:      accumulated.length,
        chattersCount: chatters.size,
      });

      if (predicate(accumulated, chatters.size)) break;
    }
    return { msgs: accumulated, chatters };
  }

  // Подгружает ровно N случайных непросмотренных дней (без условия)
  async function loadRandomDays(n, onProgress) {
    const unscanned = allDates.filter(d => !scannedDays.has(dateKey(d)));
    const batch = unscanned.slice(0, n);
    const chatters = new Set(accumulated.map(m => m.user));

    for (const date of batch) {
      const key = dateKey(date);
      if (scannedDays.has(key)) continue;
      const msgs = await LogsService.fetchDay(LazyPool._channel, date.year, date.month, date.day);
      scannedDays.add(key);
      accumulated = accumulated.concat(msgs);
      for (const m of msgs) chatters.add(m.user);
      if (onProgress) onProgress({
        loaded:        scannedDays.size,
        total:         allDates.length,
        msgCount:      accumulated.length,
        chattersCount: chatters.size,
      });
    }
    return { msgs: accumulated, chatters };
  }

  // Полный парсинг всего диапазона
  async function loadAll(onProgress) {
    return await loadUntil(() => remainingDays() === 0, onProgress);
  }

  function getRaw() { return accumulated; }
  function isFullyLoaded() { return remainingDays() === 0; }
  function stats() {
    const chatters = new Set(accumulated.map(m => m.user));
    return {
      msgCount:      accumulated.length,
      chattersCount: chatters.size,
      daysLoaded:    scannedDays.size,
      daysTotal:     allDates.length,
    };
  }

  return { init, loadUntil, loadRandomDays, loadAll, getRaw, isFullyLoaded, remainingDays, stats };
})();
