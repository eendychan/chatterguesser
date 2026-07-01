// ChatterGuesser — получение смайликов канала через 7TV API
// Загружает активный эмоут-сет канала один раз, кэширует в рамках сессии.
const SevenTV = (() => {
  const cache = new Map(); // channelLogin -> Set<emoteName>

  // Получает все имена эмоутов активного сета канала.
  // Возвращает Set<string> или пустой Set если API недоступен.
  async function fetchEmotes(channelLogin) {
    const login = channelLogin.toLowerCase();
    if (cache.has(login)) return cache.get(login);

    const emoteSet = new Set();
    try {
      // 1. Получаем user_id канала в 7TV
      const userRes = await fetch(
        `https://7tv.io/v3/users/twitch/${encodeURIComponent(login)}`,
        { headers: { 'Accept': 'application/json' } }
      );
      if (!userRes.ok) {
        console.warn(`7TV: канал "${login}" не найден (${userRes.status})`);
        cache.set(login, emoteSet);
        return emoteSet;
      }
      const userData = await userRes.json();

      // Активный эмоут-сет лежит в emote_set
      const emoteSets = userData?.emote_set?.emotes || [];
      for (const e of emoteSets) {
        if (e?.name) emoteSet.add(e.name);
      }

      // Иногда основной сет пустой, а данные идут через channel.emote_set
      const channelSets = userData?.channel_emote_sets || [];
      for (const s of channelSets) {
        for (const e of (s?.emotes || [])) {
          if (e?.name) emoteSet.add(e.name);
        }
      }
    } catch (e) {
      console.warn('7TV API ошибка:', e);
    }

    cache.set(login, emoteSet);
    return emoteSet;
  }

  // Очищает кэш (при смене канала)
  function clearCache(channelLogin) {
    if (channelLogin) cache.delete(channelLogin.toLowerCase());
    else cache.clear();
  }

  // Проверяет, состоит ли сообщение ТОЛЬКО из 7TV-эмоутов (и пробелов)
  // Если emotes — пустой Set (API недоступен), всегда возвращает false.
  function isOnlyEmotes(text, emotes) {
    if (!emotes || emotes.size === 0) return false;
    const tokens = text.trim().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) return false;
    return tokens.every(t => emotes.has(t));
  }

  // Проверяет, содержит ли сообщение ХОТЯ БЫ ОДИН 7TV-эмоут
  function containsEmote(text, emotes) {
    if (!emotes || emotes.size === 0) return false;
    return text.trim().split(/\s+/).some(t => emotes.has(t));
  }

  return { fetchEmotes, clearCache, isOnlyEmotes, containsEmote };
})();
