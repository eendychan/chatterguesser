// ChatterGuesser — анонимный read-only слушатель Twitch IRC (для голосования чата)
const ChatListener = (() => {
  let ws = null;
  let onMessageCallback = null;
  let currentChannel = null;
  let reconnectTimer = null;
  let manuallyClosed = false;

  function randomAnonUsername() {
    const n = Math.floor(Math.random() * 80000) + 1000;
    return `${IRC_CONFIG.ANON_USERNAME_PREFIX}${n}`;
  }

  function connect(channel, onMessage) {
    currentChannel = channel.toLowerCase();
    onMessageCallback = onMessage;
    manuallyClosed = false;
    openSocket();
  }

  function openSocket() {
    ws = new WebSocket(IRC_CONFIG.WS_URL);

    ws.onopen = () => {
      const nick = randomAnonUsername();
      ws.send('CAP REQ :twitch.tv/tags');
      ws.send(`PASS SCHMOOPIIE`);
      ws.send(`NICK ${nick}`);
      ws.send(`JOIN #${currentChannel}`);
    };

    ws.onmessage = (event) => {
      const lines = event.data.split('\r\n').filter(Boolean);
      for (const line of lines) {
        handleIrcLine(line);
      }
    };

    ws.onclose = () => {
      if (!manuallyClosed) {
        // Автоматический реконнект через 3 секунды
        reconnectTimer = setTimeout(() => openSocket(), 3000);
      }
    };

    ws.onerror = (err) => {
      console.warn('Twitch IRC ошибка соединения:', err);
    };
  }

  function handleIrcLine(line) {
    if (line.startsWith('PING')) {
      ws.send('PONG :tmi.twitch.tv');
      return;
    }

    // Формат PRIVMSG: [@tags] :nick!nick@nick.tmi.twitch.tv PRIVMSG #channel :message text
    const privmsgMatch = line.match(/^(?:@[^ ]+ )?:([a-zA-Z0-9_]+)!\S+ PRIVMSG #\S+ :(.*)$/);
    if (privmsgMatch) {
      const [, login, text] = privmsgMatch;
      if (onMessageCallback) {
        onMessageCallback({ login: login.toLowerCase(), text: text.trim() });
      }
    }
  }

  function disconnect() {
    manuallyClosed = true;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    if (ws) {
      try { ws.close(); } catch (e) { /* noop */ }
      ws = null;
    }
  }

  function isConnected() {
    return !!ws && ws.readyState === WebSocket.OPEN;
  }

  return {
    connect,
    disconnect,
    isConnected,
  };
})();
