// ChatterGuesser — авторизация через Twitch (Implicit Grant Flow) + Helix API
const TwitchAuth = (() => {
  let state = {
    accessToken: null,
    login: null,
    userId: null,
    displayName: null,
    profileImageUrl: null,
  };

  function loadFromSession() {
    try {
      const raw = sessionStorage.getItem(CONFIG.STORAGE_KEYS.AUTH);
      if (!raw) return false;
      const parsed = JSON.parse(raw);
      if (!parsed.accessToken || !parsed.login) return false;
      state = parsed;
      return true;
    } catch (e) {
      console.warn('Не удалось прочитать сессию авторизации:', e);
      return false;
    }
  }

  function saveToSession() {
    sessionStorage.setItem(CONFIG.STORAGE_KEYS.AUTH, JSON.stringify(state));
  }

  function clearSession() {
    sessionStorage.removeItem(CONFIG.STORAGE_KEYS.AUTH);
    state = { accessToken: null, login: null, userId: null, displayName: null, profileImageUrl: null };
  }

  function isAuthenticated() {
    return !!state.accessToken && !!state.login;
  }

  function getState() {
    return { ...state };
  }

  // Шаг 1: редирект на Twitch для авторизации
  function startLogin() {
    const params = new URLSearchParams({
      client_id: CONFIG.TWITCH_CLIENT_ID,
      redirect_uri: CONFIG.TWITCH_REDIRECT_URI,
      response_type: 'token',
      scope: CONFIG.TWITCH_SCOPES.join(' '),
      force_verify: 'true',
    });
    window.location.href = `https://id.twitch.tv/oauth2/authorize?${params.toString()}`;
  }

  // Шаг 2: разбор fragment-а URL после редиректа обратно (#access_token=...&...)
  function parseTokenFromUrl() {
    if (!window.location.hash) return null;
    const hash = window.location.hash.substring(1);
    const params = new URLSearchParams(hash);
    const token = params.get('access_token');
    if (!token) return null;

    // Очищаем URL от токена, чтобы он не "прилипал" в адресной строке
    history.replaceState(null, '', window.location.pathname);
    return token;
  }

  // Шаг 3: получаем данные о пользователе через Helix /users
  async function fetchUserInfo(token) {
    const res = await fetch('https://api.twitch.tv/helix/users', {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Client-Id': CONFIG.TWITCH_CLIENT_ID,
      },
    });
    if (!res.ok) {
      throw new Error(`Helix /users вернул ${res.status}`);
    }
    const data = await res.json();
    if (!data.data || !data.data.length) {
      throw new Error('Helix /users не вернул данные пользователя');
    }
    return data.data[0];
  }

  // Завершает обработку редиректа: пытается достать токен из URL, валидирует его
  async function completeLoginIfRedirected() {
    const token = parseTokenFromUrl();
    if (!token) return false;

    try {
      const user = await fetchUserInfo(token);
      state = {
        accessToken: token,
        login: user.login,
        userId: user.id,
        displayName: user.display_name,
        profileImageUrl: user.profile_image_url,
      };
      saveToSession();
      return true;
    } catch (e) {
      console.error('Ошибка завершения авторизации:', e);
      clearSession();
      return false;
    }
  }

  function logout() {
    clearSession();
  }

  // --- Helix: получение модераторов и VIP-ов канала ---

  async function fetchModerators() {
    if (!isAuthenticated()) return [];
    try {
      const params = new URLSearchParams({ broadcaster_id: state.userId, first: '100' });
      const res = await fetch(`https://api.twitch.tv/helix/moderation/moderators?${params}`, {
        headers: {
          'Authorization': `Bearer ${state.accessToken}`,
          'Client-Id': CONFIG.TWITCH_CLIENT_ID,
        },
      });
      if (!res.ok) {
        console.warn('Не удалось получить список модераторов:', res.status);
        return [];
      }
      const data = await res.json();
      return (data.data || []).map(m => m.user_login.toLowerCase());
    } catch (e) {
      console.warn('Ошибка запроса модераторов:', e);
      return [];
    }
  }

  async function fetchVips() {
    if (!isAuthenticated()) return [];
    try {
      const params = new URLSearchParams({ broadcaster_id: state.userId, first: '100' });
      const res = await fetch(`https://api.twitch.tv/helix/channels/vips?${params}`, {
        headers: {
          'Authorization': `Bearer ${state.accessToken}`,
          'Client-Id': CONFIG.TWITCH_CLIENT_ID,
        },
      });
      if (!res.ok) {
        console.warn('Не удалось получить список VIP:', res.status);
        return [];
      }
      const data = await res.json();
      return (data.data || []).map(v => v.user_login.toLowerCase());
    } catch (e) {
      console.warn('Ошибка запроса VIP:', e);
      return [];
    }
  }

  return {
    loadFromSession,
    isAuthenticated,
    getState,
    startLogin,
    completeLoginIfRedirected,
    logout,
    fetchModerators,
    fetchVips,
  };
})();
