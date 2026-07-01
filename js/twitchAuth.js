// ChatterGuesser — модуль авторизации Twitch
const TwitchAuth = (() => {
  const CLIENT_ID = CONFIG.TWITCH_CLIENT_ID;
  const REDIRECT_URI = CONFIG.REDIRECT_URI;
  const SCOPES = CONFIG.TWITCH_SCOPES;

  let state = {
    accessToken: null,
    login: null,
    displayName: null,
    profileImageUrl: null,
    userId: null,
    isAuthenticated: false,
  };

  function loadFromSession() {
    try {
      const raw = sessionStorage.getItem(CONFIG.STORAGE_KEYS.TWITCH_AUTH);
      if (raw) {
        const saved = JSON.parse(raw);
        // Проверяем, что токен не просрочен (грубо — по времени сохранения)
        if (saved.accessToken && saved.timestamp) {
          const age = Date.now() - saved.timestamp;
          if (age < 24 * 60 * 60 * 1000) { // 24 часа
            Object.assign(state, saved);
            state.isAuthenticated = true;
            return true;
          }
        }
      }
    } catch (e) { /* noop */ }
    return false;
  }

  function saveToSession() {
    const data = {
      accessToken: state.accessToken,
      login: state.login,
      displayName: state.displayName,
      profileImageUrl: state.profileImageUrl,
      userId: state.userId,
      isAuthenticated: state.isAuthenticated,
      timestamp: Date.now(),
    };
    sessionStorage.setItem(CONFIG.STORAGE_KEYS.TWITCH_AUTH, JSON.stringify(data));
  }

  function startLogin() {
    const authUrl = `https://id.twitch.tv/oauth2/authorize?` +
      `client_id=${CLIENT_ID}` +
      `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
      `&response_type=token` +
      `&scope=${encodeURIComponent(SCOPES.join(' '))}`;
    window.location.href = authUrl;
  }

  async function completeLoginIfRedirected() {
    const hash = window.location.hash.substring(1);
    if (!hash) return false;

    const params = new URLSearchParams(hash);
    const accessToken = params.get('access_token');
    const error = params.get('error');

    if (error) {
      console.error('[TwitchAuth] Ошибка авторизации:', error);
      return false;
    }

    if (!accessToken) return false;

    state.accessToken = accessToken;

    try {
      const userInfo = await fetchUserInfo(accessToken);
      if (!userInfo) throw new Error('Не удалось получить информацию о пользователе');

      state.login = userInfo.login;
      state.displayName = userInfo.display_name;
      state.profileImageUrl = userInfo.profile_image_url;
      state.userId = userInfo.id;
      state.isAuthenticated = true;

      saveToSession();

      // Очищаем URL от хэша
      history.replaceState(null, '', window.location.pathname + window.location.search);

      return true;
    } catch (e) {
      console.error('[TwitchAuth] Ошибка завершения авторизации:', e);
      state.isAuthenticated = false;
      return false;
    }
  }

  async function fetchUserInfo(token) {
    try {
      const resp = await fetch('https://api.twitch.tv/helix/users', {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Client-Id': CLIENT_ID,
        },
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      return data.data?.[0] || null;
    } catch (e) {
      console.error('[TwitchAuth] Ошибка fetchUserInfo:', e);
      return null;
    }
  }

  async function fetchChannelInfo(channelLogin) {
    if (!state.accessToken) return null;
    try {
      const resp = await fetch(
        `https://api.twitch.tv/helix/users?login=${encodeURIComponent(channelLogin)}`,
        {
          headers: {
            'Authorization': `Bearer ${state.accessToken}`,
            'Client-Id': CLIENT_ID,
          },
        }
      );
      if (!resp.ok) return null;
      const data = await resp.json();
      if (!data.data?.length) return null;
      const user = data.data[0];
      return {
        login: user.login,
        displayName: user.display_name,
        profileImageUrl: user.profile_image_url,
        id: user.id,
      };
    } catch (e) {
      console.error('[TwitchAuth] Ошибка fetchChannelInfo:', e);
      return null;
    }
  }

  // Получение списка модераторов
  async function fetchModerators(channelLogin) {
    const result = { ok: false, list: [] };
    if (!state.accessToken) return result;

    // Сначала получаем ID канала
    const channelInfo = await fetchChannelInfo(channelLogin);
    if (!channelInfo) return result;

    try {
      const resp = await fetch(
        `https://api.twitch.tv/helix/moderation/moderators?broadcaster_id=${channelInfo.id}`,
        {
          headers: {
            'Authorization': `Bearer ${state.accessToken}`,
            'Client-Id': CLIENT_ID,
          },
        }
      );
      if (resp.status === 403 || resp.status === 401) {
        // Нет прав — возвращаем ok: false
        return { ok: false, list: [] };
      }
      if (!resp.ok) return { ok: false, list: [] };

      const data = await resp.json();
      const list = (data.data || []).map(m => m.user_login);
      return { ok: true, list };
    } catch (e) {
      console.error('[TwitchAuth] Ошибка fetchModerators:', e);
      return { ok: false, list: [] };
    }
  }

  // Получение списка VIP
  async function fetchVips(channelLogin) {
    const result = { ok: false, list: [] };
    if (!state.accessToken) return result;

    const channelInfo = await fetchChannelInfo(channelLogin);
    if (!channelInfo) return result;

    try {
      const resp = await fetch(
        `https://api.twitch.tv/helix/channels/vips?broadcaster_id=${channelInfo.id}`,
        {
          headers: {
            'Authorization': `Bearer ${state.accessToken}`,
            'Client-Id': CLIENT_ID,
          },
        }
      );
      if (resp.status === 403 || resp.status === 401) {
        return { ok: false, list: [] };
      }
      if (!resp.ok) return { ok: false, list: [] };

      const data = await resp.json();
      const list = (data.data || []).map(v => v.user_login);
      return { ok: true, list };
    } catch (e) {
      console.error('[TwitchAuth] Ошибка fetchVips:', e);
      return { ok: false, list: [] };
    }
  }

  function isAuthenticated() {
    return state.isAuthenticated && !!state.accessToken;
  }

  function getState() {
    return { ...state };
  }

  function logout() {
    state = {
      accessToken: null,
      login: null,
      displayName: null,
      profileImageUrl: null,
      userId: null,
      isAuthenticated: false,
    };
    sessionStorage.removeItem(CONFIG.STORAGE_KEYS.TWITCH_AUTH);
  }

  // Публичный API
  return {
    startLogin,
    completeLoginIfRedirected,
    loadFromSession,
    saveToSession,
    fetchChannelInfo,
    fetchModerators,
    fetchVips,
    isAuthenticated,
    getState,
    logout,
  };
})();
