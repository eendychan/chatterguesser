// ChatterGuesser — получение смайликов канала через 7TV API
const SevenTV = (() => {
  const cache = new Map(); // channelLogin -> Set<emoteName>

  async function fetchEmotes(channelLogin) {
    const login = channelLogin.toLowerCase();
    if (cache.has(login)) return cache.get(login);

    const emoteSet = new Set();
    try {
      // Пробуем новый API сначала (api.7tv.app), потом старый (7tv.io) как fallback
      const urls = [
        `https://api.7tv.app/v3/users/twitch/${encodeURIComponent(login)}`,
        `https://7tv.io/v3/users/twitch/${encodeURIComponent(login)}`,
      ];

      let userData = null;
      for (const url of urls) {
        try {
          const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
          if (res.ok) { userData = await res.json(); break; }
        } catch (e) { /* пробуем следующий */ }
      }

      if (!userData) {
        console.warn(`7TV: канал "${login}" не найден ни через один API`);
        cache.set(login, emoteSet);
        return emoteSet;
      }

      // Активный эмоут-сет: emote_set.emotes[]
      const mainEmotes = userData?.emote_set?.emotes || [];
      for (const e of mainEmotes) {
        if (e?.name) emoteSet.add(e.name);
      }

      // Дополнительные сеты через channel_emote_sets[]
      const extraSets = userData?.channel_emote_sets || [];
      for (const s of extraSets) {
        for (const e of (s?.emotes || [])) {
          if (e?.name) emoteSet.add(e.name);
        }
      }

      console.log(`7TV: загружено ${emoteSet.size} эмоутов для канала ${login}`);
    } catch (e) {
      console.warn('7TV API ошибка:', e);
    }

    cache.set(login, emoteSet);
    return emoteSet;
  }

  function clearCache(channelLogin) {
    if (channelLogin) cache.delete(channelLogin.toLowerCase());
    else cache.clear();
  }

  // Сообщение состоит ТОЛЬКО из 7TV-эмоутов (и пробелов)
  function isOnlyEmotes(text, emotes) {
    if (!emotes || emotes.size === 0) return false;
    const tokens = text.trim().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) return false;
    return tokens.every(t => emotes.has(t));
  }

  // Сообщение содержит хотя бы один 7TV-эмоут
  function containsEmote(text, emotes) {
    if (!emotes || emotes.size === 0) return false;
    return text.trim().split(/\s+/).some(t => emotes.has(t));
  }

  return { fetchEmotes, clearCache, isOnlyEmotes, containsEmote };
})();
