// ChatterGuesser — главный модуль приложения
(async function () {

  // ===== Элементы DOM =====
  const screens = {
    auth: document.getElementById('auth-screen'),
    setup: document.getElementById('setup-screen'),
    game: document.getElementById('game-screen'),
    results: document.getElementById('results-screen'),
  };

  function showScreen(name) {
    Object.values(screens).forEach((el) => el.classList.add('hidden'));
    screens[name].classList.remove('hidden');
  }

  // ===== Состояние настроек (восстанавливается из sessionStorage, если есть) =====
  let settings = { ...CONFIG.DEFAULTS };
  let mods = new Set();
  let vips = new Set();

  function loadSettingsFromSession() {
    try {
      const raw = sessionStorage.getItem(CONFIG.STORAGE_KEYS.SETTINGS);
      if (raw) {
        settings = { ...settings, ...JSON.parse(raw) };
      }
    } catch (e) { /* noop */ }
  }

  function saveSettingsToSession() {
    sessionStorage.setItem(CONFIG.STORAGE_KEYS.SETTINGS, JSON.stringify(settings));
  }

  // ===== Инициализация бейджей в фильтре автора =====
  function initBadgeImages() {
    document.querySelectorAll('img[data-badge]').forEach((img) => {
      const key = img.getAttribute('data-badge');
      img.src = CONFIG.BADGES[key];
    });
  }

  // ===== Экран авторизации =====

  document.getElementById('btn-auth').addEventListener('click', () => {
    TwitchAuth.startLogin();
  });

  async function initAuthFlow() {
    // Если уже авторизованы в этой сессии — сразу на настройки
    if (TwitchAuth.loadFromSession()) {
      enterSetupScreen();
      return;
    }

    // Проверяем, не вернулись ли мы только что с Twitch с токеном в URL
    showScreen('auth');
    const authResultEl = document.getElementById('auth-error');

    if (window.location.hash.includes('access_token')) {
      const ok = await TwitchAuth.completeLoginIfRedirected();
      if (ok) {
        enterSetupScreen();
        return;
      } else {
        authResultEl.textContent = 'Не удалось завершить авторизацию через Twitch. Попробуйте снова.';
        authResultEl.classList.remove('hidden');
      }
    } else if (window.location.hash.includes('error=')) {
      const params = new URLSearchParams(window.location.hash.substring(1));
      authResultEl.textContent = `Авторизация отменена: ${params.get('error_description') || params.get('error')}`;
      authResultEl.classList.remove('hidden');
      history.replaceState(null, '', window.location.pathname);
    }
  }

  document.getElementById('btn-logout').addEventListener('click', () => {
    TwitchAuth.logout();
    sessionStorage.removeItem(CONFIG.STORAGE_KEYS.SETTINGS);
    location.reload();
  });

  // ===== Экран настроек =====

  async function enterSetupScreen() {
    initBadgeImages();
    loadSettingsFromSession();

    const user = TwitchAuth.getState();
    document.getElementById('user-avatar').src = user.profileImageUrl || '';
    document.getElementById('user-name').textContent = user.displayName || user.login;
    document.getElementById('logs-channel-label').textContent = CONFIG.LOGS_CHANNEL;

    applySettingsToUI();
    showScreen('setup');

    // Подтягиваем список модов/випов канала стримера (для фильтра "Только от")
    // Если канал логов отличается от канала стримера, эти бейджи всё равно
    // полезны как индикатор статуса в Twitch-аккаунте авторизовавшегося пользователя.
    const [modList, vipList] = await Promise.all([
      TwitchAuth.fetchModerators(),
      TwitchAuth.fetchVips(),
    ]);
    mods = new Set(modList);
    vips = new Set(vipList);
  }

  function applySettingsToUI() {
    document.getElementById('input-rounds').value = settings.rounds;
    document.getElementById('range-rounds').value = settings.rounds;

    document.getElementById('range-min-length').value = settings.minLength;
    document.getElementById('range-max-length').value = settings.maxLength;
    document.getElementById('label-min-length').textContent = settings.minLength;
    document.getElementById('label-max-length').textContent = settings.maxLength;

    document.getElementById('input-variants').value = settings.variants;
    document.getElementById('range-variants').value = settings.variants;

    document.getElementById('input-min-messages').value = settings.minMessages;
    document.getElementById('range-min-messages').value = Math.min(settings.minMessages, CONFIG.DEFAULTS.maxMessagesBound);

    document.querySelectorAll('.author-toggle-btn').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.author === settings.authorFilter);
    });

    document.querySelectorAll('.mode-card').forEach((card) => {
      card.classList.toggle('active', card.dataset.mode === settings.mode);
    });
  }

  // --- Привязка контролов фильтров (range <-> number синхронизация) ---

  function bindRangeAndNumber(rangeId, numberId, onChange) {
    const range = document.getElementById(rangeId);
    const number = document.getElementById(numberId);

    range.addEventListener('input', () => {
      number.value = range.value;
      onChange(Number(range.value));
    });
    number.addEventListener('input', () => {
      let val = Number(number.value);
      if (isNaN(val)) return;
      val = Math.max(Number(range.min), Math.min(Number(range.max) || val, val));
      range.value = Math.min(val, Number(range.max));
      onChange(val);
    });
  }

  bindRangeAndNumber('range-rounds', 'input-rounds', (val) => {
    settings.rounds = val;
    saveSettingsToSession();
  });

  bindRangeAndNumber('range-variants', 'input-variants', (val) => {
    settings.variants = val;
    saveSettingsToSession();
  });

  // Минимум сообщений — number может уходить выше 30000, range ограничен
  document.getElementById('input-min-messages').addEventListener('input', (e) => {
    let val = Number(e.target.value);
    if (isNaN(val)) return;
    val = Math.max(CONFIG.DEFAULTS.minMessagesBound, val);
    settings.minMessages = val;
    document.getElementById('range-min-messages').value = Math.min(val, CONFIG.DEFAULTS.maxMessagesBound);
    saveSettingsToSession();
  });
  document.getElementById('range-min-messages').addEventListener('input', (e) => {
    const val = Number(e.target.value);
    settings.minMessages = val;
    document.getElementById('input-min-messages').value = val;
    saveSettingsToSession();
  });

  // Длина сообщения — два ползунка, min не может превышать max и наоборот
  const rangeMinLength = document.getElementById('range-min-length');
  const rangeMaxLength = document.getElementById('range-max-length');

  rangeMinLength.addEventListener('input', () => {
    let val = Number(rangeMinLength.value);
    if (val > settings.maxLength) {
      val = settings.maxLength;
      rangeMinLength.value = val;
    }
    settings.minLength = val;
    document.getElementById('label-min-length').textContent = val;
    saveSettingsToSession();
  });

  rangeMaxLength.addEventListener('input', () => {
    let val = Number(rangeMaxLength.value);
    if (val < settings.minLength) {
      val = settings.minLength;
      rangeMaxLength.value = val;
    }
    settings.maxLength = val;
    document.getElementById('label-max-length').textContent = val;
    saveSettingsToSession();
  });

  document.querySelectorAll('.author-toggle-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.author-toggle-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      settings.authorFilter = btn.dataset.author;
      saveSettingsToSession();
    });
  });

  document.querySelectorAll('.mode-card').forEach((card) => {
    card.addEventListener('click', () => {
      document.querySelectorAll('.mode-card').forEach((c) => c.classList.remove('active'));
      card.classList.add('active');
      settings.mode = card.dataset.mode;
      saveSettingsToSession();
    });
  });

  // ===== Запуск игры =====

  const setupErrorEl = document.getElementById('setup-error');
  const loadingStatusEl = document.getElementById('loading-status');
  const btnStart = document.getElementById('btn-start-game');

  document.getElementById('btn-start-game').addEventListener('click', async () => {
    setupErrorEl.classList.add('hidden');
    btnStart.disabled = true;
    btnStart.textContent = 'Загрузка логов...';

    try {
      const neededCount = settings.rounds * settings.variants + 5; // небольшой запас

      const { pool, daysScanned, totalRawMessages } = await MessagePool.buildPool(
        {
          channel: CONFIG.LOGS_CHANNEL,
          minLength: settings.minLength,
          maxLength: settings.maxLength,
          authorFilter: settings.authorFilter,
          minMessages: settings.minMessages,
          neededCount,
          mods,
          vips,
        },
        ({ daysScanned, rawCount, validCount }) => {
          loadingStatusEl.textContent = `Просканировано дней: ${daysScanned} · сообщений найдено: ${validCount} / ${neededCount}`;
        }
      );

      if (pool.length < settings.variants * 2) {
        throw new Error(
          `Недостаточно сообщений под текущие фильтры (найдено ${pool.length} после ${daysScanned} дней сканирования логов из ${totalRawMessages} всего). Попробуйте ослабить фильтры: уменьшить "минимум сообщений автора" или расширить диапазон длины.`
        );
      }

      const roundsBuilt = GameEngine.startGame(pool, settings, settings.mode);
      if (roundsBuilt === 0) {
        throw new Error('Не удалось сформировать ни одного раунда. Ослабьте фильтры.');
      }

      loadingStatusEl.textContent = '';
      startGameUI();
    } catch (e) {
      console.error('[ChatterGuesser] Ошибка запуска игры:', e);
      // Гарантируем, что пользователь увидит ошибку независимо от того,
      // какой экран сейчас активен (на случай если экран успел переключиться
      // до момента сбоя).
      showScreen('setup');
      setupErrorEl.textContent = e.message;
      setupErrorEl.classList.remove('hidden');
      setupErrorEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } finally {
      btnStart.disabled = false;
      btnStart.textContent = 'Начать игру';
    }
  });

  // ===== Игровой экран =====

  const optionsListEl = document.getElementById('options-list');
  const btnNextRound = document.getElementById('btn-next-round');
  const chatSidebarEl = document.getElementById('chat-sidebar');
  const connectionStatusEl = document.getElementById('connection-status');
  const leaderboardListEl = document.getElementById('leaderboard-list');

  function startGameUI() {
    // Сначала готовим контент первого раунда, и только если это прошло без
    // ошибок — переключаем экран. Иначе ошибка ловится в setup-экране, который
    // к этому моменту уже скрыт, и игра выглядит "зависшей" на пустом экране.
    renderCurrentRound();

    showScreen('game');
    chatSidebarEl.classList.toggle('hidden', settings.mode !== 'chat');

    if (settings.mode === 'chat') {
      setupChatVoting();
    }
  }

  function renderCurrentRound() {
    const round = GameEngine.getCurrentRound();
    if (!round) return;

    document.getElementById('round-progress-label').textContent =
      `Раунд ${GameEngine.getRoundNumber()} / ${GameEngine.getTotalRounds()}`;

    const score = GameEngine.getStreamerScore();
    document.getElementById('score-progress-label').textContent =
      score.total > 0 ? `Верно: ${score.correct} / ${score.total}` : '';

    document.getElementById('target-username').textContent = round.targetUser;

    optionsListEl.innerHTML = '';
    round.options.forEach((opt, idx) => {
      const btn = document.createElement('button');
      btn.className = 'option-row';
      btn.innerHTML = `
        <span class="option-number">${idx + 1}</span>
        <span class="option-text">${escapeHtml(opt.text)}</span>
      `;
      btn.addEventListener('click', () => handleAnswerSelect(idx));
      optionsListEl.appendChild(btn);
    });

    btnNextRound.classList.add('hidden');
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function handleAnswerSelect(idx) {
    const result = GameEngine.submitAnswer(idx);
    if (!result) return;
    revealAnswer(result.correctIndex, idx);
  }

  function revealAnswer(correctIndex, selectedIndex) {
    const buttons = optionsListEl.querySelectorAll('.option-row');
    buttons.forEach((btn, idx) => {
      btn.disabled = true;
      if (idx === correctIndex) {
        btn.classList.add('correct');
      } else if (idx === selectedIndex) {
        btn.classList.add('incorrect-selected');
      }
    });

    if (settings.mode === 'chat') {
      GameEngine.resolveChatVotesAndUpdateScores();
      renderLeaderboard();
    }

    document.getElementById('score-progress-label').textContent = (() => {
      const score = GameEngine.getStreamerScore();
      return `Верно: ${score.correct} / ${score.total}`;
    })();

    if (GameEngine.isGameOver()) {
      btnNextRound.textContent = 'Посмотреть результаты →';
    } else {
      btnNextRound.textContent = 'Следующий раунд →';
    }
    btnNextRound.classList.remove('hidden');
  }

  btnNextRound.addEventListener('click', () => {
    if (GameEngine.isGameOver()) {
      showResults();
      return;
    }
    GameEngine.nextRound();
    renderCurrentRound();
  });

  // ===== Режим "играть с чатом" =====

  function setupChatVoting() {
    connectionStatusEl.textContent = 'подключение...';
    connectionStatusEl.classList.remove('connected');
    connectionStatusEl.classList.add('disconnected');

    ChatListener.connect(CONFIG.LOGS_CHANNEL, (msg) => {
      const num = parseInt(msg.text.trim(), 10);
      if (!isNaN(num) && num >= 1 && num <= settings.variants) {
        const round = GameEngine.getCurrentRound();
        if (round && !round.answered) {
          GameEngine.registerChatVote(msg.login, num);
        }
      }
    });

    // Простая проверка соединения раз в секунду для индикатора
    const statusInterval = setInterval(() => {
      const connected = ChatListener.isConnected();
      connectionStatusEl.textContent = connected ? 'подключено к чату' : 'переподключение...';
      connectionStatusEl.classList.toggle('connected', connected);
      connectionStatusEl.classList.toggle('disconnected', !connected);
    }, 1000);

    window.addEventListener('beforeunload', () => {
      clearInterval(statusInterval);
      ChatListener.disconnect();
    });
  }

  function renderLeaderboard() {
    const top = GameEngine.getChatLeaderboard(10);
    leaderboardListEl.innerHTML = '';
    if (!top.length) {
      leaderboardListEl.innerHTML = '<div style="color: var(--text-dim); font-size: 13px;">Пока никто не угадал</div>';
      return;
    }
    top.forEach((entry, idx) => {
      const row = document.createElement('div');
      row.className = 'leaderboard-row';
      row.innerHTML = `
        <span class="rank">#${idx + 1}</span>
        <span class="name">${escapeHtml(entry.login)}</span>
        <span class="score">${entry.score}</span>
      `;
      leaderboardListEl.appendChild(row);
    });
  }

  // ===== Финальный экран =====

  function showResults() {
    if (settings.mode === 'chat') {
      ChatListener.disconnect();
    }
    const score = GameEngine.getStreamerScore();
    document.getElementById('final-score').textContent = `${score.correct} / ${score.total}`;

    const pct = score.total > 0 ? score.correct / score.total : 0;
    let comment = '';
    if (pct === 1) comment = 'Идеальное знание своего чата!';
    else if (pct >= 0.7) comment = 'Отличный результат — чат как на ладони.';
    else if (pct >= 0.4) comment = 'Неплохо, но есть куда расти.';
    else comment = 'Похоже, пора почаще читать чат :)';
    document.getElementById('final-comment').textContent = comment;

    showScreen('results');
  }

  document.getElementById('btn-restart').addEventListener('click', () => {
    showScreen('setup');
  });

  // ===== Запуск приложения =====
  initAuthFlow();

})();
