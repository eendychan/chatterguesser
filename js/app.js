// ChatterGuesser — главный модуль приложения
(async function () {

  // ===== Глобальное состояние канала =====
  const AppState = {
    channel: CONFIG.LOGS_CHANNEL_DEFAULT,
    channelStartDate: CONFIG.CHANNEL_PRESETS[0].startDate,
    channelAvatarUrl: '',
    // Диапазон парсинга (по умолчанию = от начала канала до сегодня)
    scanStartDate: null,
    scanEndDate: null,
  };

  // ===== Элементы DOM =====
  const screens = {
    auth: document.getElementById('auth-screen'),
    setup: document.getElementById('setup-screen'),
    liveSetup: document.getElementById('live-setup-screen'),
    liveTimer: document.getElementById('live-timer-screen'),
    game: document.getElementById('game-screen'),
    results: document.getElementById('results-screen'),
  };

  function showScreen(name) {
    Object.values(screens).forEach((el) => el.classList.add('hidden'));
    const modal = document.getElementById('custom-channel-modal');
    modal.classList.add('hidden');
    screens[name].classList.remove('hidden');
  }

  // ===== Состояние настроек =====
  let settings = {
    rounds: CONFIG.DEFAULTS.rounds,
    minLength: CONFIG.DEFAULTS.minLength,
    maxLength: CONFIG.DEFAULTS.maxLength,
    variants: CONFIG.DEFAULTS.variants,
    minMessages: CONFIG.DEFAULTS.minMessages,
    authorFilter: CONFIG.DEFAULTS.authorFilter,
    ignoredChatters: CONFIG.DEFAULTS.ignoredChatters,
    mode: 'solo',
  };

  let mods = new Set();
  let vips = new Set();
  let modsOk = false;
  let vipsOk = false;

  function loadSettingsFromSession() {
    try {
      const raw = sessionStorage.getItem(CONFIG.STORAGE_KEYS.SETTINGS);
      if (raw) settings = { ...settings, ...JSON.parse(raw) };
    } catch (e) { /* noop */ }
  }

  function saveSettingsToSession() {
    sessionStorage.setItem(CONFIG.STORAGE_KEYS.SETTINGS, JSON.stringify(settings));
  }

  // ===== Кэш сообщений =====
  let rawMessagesCache = null;
  let logsScanPromise = null;

  // ===== Утилиты =====
  function pad2(n) { return String(n).padStart(2, '0'); }

  function escapeHtml(str) {
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  }

  function todayUTC() {
    const now = new Date();
    return { year: now.getUTCFullYear(), month: now.getUTCMonth() + 1, day: now.getUTCDate() };
  }

  function dateToStr(d) {
    return `${pad2(d.day)}.${pad2(d.month)}.${d.year}`;
  }

  // ===== Авторизация =====
  document.getElementById('btn-auth').addEventListener('click', () => TwitchAuth.startLogin());

  async function initAuthFlow() {
    if (TwitchAuth.loadFromSession()) {
      enterSetupScreen();
      return;
    }
    showScreen('auth');
    const authErrorEl = document.getElementById('auth-error');
    if (window.location.hash.includes('access_token')) {
      const ok = await TwitchAuth.completeLoginIfRedirected();
      if (ok) { enterSetupScreen(); return; }
      authErrorEl.textContent = 'Не удалось завершить авторизацию через Twitch. Попробуйте снова.';
      authErrorEl.classList.remove('hidden');
    } else if (window.location.hash.includes('error=')) {
      const params = new URLSearchParams(window.location.hash.substring(1));
      authErrorEl.textContent = `Авторизация отменена: ${params.get('error_description') || params.get('error')}`;
      authErrorEl.classList.remove('hidden');
      history.replaceState(null, '', window.location.pathname);
    }
  }

  document.getElementById('btn-logout').addEventListener('click', () => {
    TwitchAuth.logout();
    sessionStorage.removeItem(CONFIG.STORAGE_KEYS.SETTINGS);
    location.reload();
  });

  // ===== Экран настроек =====

  function initBadgeImages() {
    document.querySelectorAll('img[data-badge]').forEach((img) => {
      img.src = CONFIG.BADGES[img.getAttribute('data-badge')];
    });
  }

  async function enterSetupScreen() {
    initBadgeImages();
    loadSettingsFromSession();

    const user = TwitchAuth.getState();
    document.getElementById('user-avatar').src = user.profileImageUrl || '';
    document.getElementById('user-name').textContent = user.displayName || user.login;

    // Ссылка "Ссылки"
    document.getElementById('btn-links').href = CONFIG.LINKS_URL;

    // Поле "Добавить свой канал" — ссылка на сайт логов
    document.getElementById('custom-logs-site-link').href = CONFIG.CUSTOM_LOGS_SITE_URL;

    applySettingsToUI();
    initChannelPickerUI();
    initDateRangeUI();
    showScreen('setup');

    // Подтягиваем аватарку текущего канала
    loadChannelAvatar(AppState.channel);

    // Моды/VIP текущего канала
    await loadModsVips();

    // Запуск полного парсинга
    startFullLogsScan();
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
    document.getElementById('range-min-messages').value = Math.min(settings.minMessages, 30000);
    document.getElementById('input-ignored-chatters').value = settings.ignoredChatters;

    document.querySelectorAll('.author-toggle-btn').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.author === settings.authorFilter);
    });
    document.querySelectorAll('.mode-card').forEach((c) => {
      c.classList.toggle('active', c.dataset.mode === settings.mode);
    });
  }

  // ===== Канальный picker =====

  function initChannelPickerUI() {
    const listEl = document.getElementById('channel-preset-list');
    listEl.innerHTML = '';

    CONFIG.CHANNEL_PRESETS.forEach((preset) => {
      const btn = document.createElement('button');
      btn.className = 'channel-preset-item';
      btn.innerHTML = `
        <img src="https://static-cdn.jtvnw.net/user-default-pictures-uv/cdd517fe-def4-11e9-948e-784f43822e80-profile_image-50x50.png"
             class="channel-avatar"
             style="width:22px;height:22px;"
             data-login="${preset.login}" alt="">
        <span class="preset-login">${preset.login.toUpperCase()}</span>
        <span class="preset-start">с ${dateToStr(preset.startDate)}</span>`;
      btn.addEventListener('click', () => selectChannel(preset.login, preset.startDate));
      listEl.appendChild(btn);

      // Ленивая подгрузка аватарок в дропдауне
      if (TwitchAuth.isAuthenticated()) {
        TwitchAuth.fetchChannelInfo(preset.login).then((info) => {
          if (!info) return;
          const img = btn.querySelector('img');
          if (img) img.src = info.profileImageUrl;
        });
      }
    });
  }

  async function loadChannelAvatar(login) {
    const avatarEl = document.getElementById('channel-picker-avatar');
    const labelEl = document.getElementById('channel-picker-label');
    labelEl.textContent = login.toUpperCase();
    if (!TwitchAuth.isAuthenticated()) return;
    const info = await TwitchAuth.fetchChannelInfo(login);
    if (info) {
      avatarEl.src = info.profileImageUrl;
      AppState.channelAvatarUrl = info.profileImageUrl;
    }
  }

  async function selectChannel(login, startDate) {
    if (login === AppState.channel && rawMessagesCache) return;
    AppState.channel = login;
    AppState.channelStartDate = startDate;
    AppState.scanStartDate = null;
    AppState.scanEndDate = null;
    rawMessagesCache = null;

    document.getElementById('logs-channel-label').textContent = login;
    document.getElementById('channel-picker-label').textContent = login.toUpperCase();
    loadChannelAvatar(login);

    // Обновляем поля дат парсинга под новый канал
    initDateRangeUI();

    // Обновляем тултип кнопки "Парсить всё"
    updateParseAllTooltip();

    // Перезагружаем моды/VIP и парсим
    await loadModsVips();
    startFullLogsScan();
  }

  // Кнопка "+ Добавить свой канал"
  document.getElementById('btn-add-custom-channel').addEventListener('click', () => {
    document.getElementById('custom-channel-modal').classList.remove('hidden');
  });

  document.getElementById('btn-close-custom-channel').addEventListener('click', () => {
    document.getElementById('custom-channel-modal').classList.add('hidden');
  });

  document.getElementById('custom-channel-modal').addEventListener('click', (e) => {
    if (e.target === document.getElementById('custom-channel-modal')) {
      document.getElementById('custom-channel-modal').classList.add('hidden');
    }
  });

  document.getElementById('btn-confirm-custom-channel').addEventListener('click', async () => {
    const login = document.getElementById('custom-channel-login').value.trim().toLowerCase();
    const day = parseInt(document.getElementById('custom-channel-day').value, 10);
    const month = parseInt(document.getElementById('custom-channel-month').value, 10);
    const year = parseInt(document.getElementById('custom-channel-year').value, 10);
    const errEl = document.getElementById('custom-channel-error');

    if (!login || isNaN(day) || isNaN(month) || isNaN(year)) {
      errEl.textContent = 'Заполните ник и все поля даты.';
      errEl.classList.remove('hidden');
      return;
    }

    errEl.classList.add('hidden');
    document.getElementById('custom-channel-modal').classList.add('hidden');
    await selectChannel(login, { year, month, day });
  });

  // ===== Выбор диапазона дат парсинга =====

  function initDateRangeUI() {
    const start = AppState.channelStartDate;
    const end = todayUTC();

    document.getElementById('scan-start-day').value = start.day;
    document.getElementById('scan-start-month').value = start.month;
    document.getElementById('scan-start-year').value = start.year;
    document.getElementById('scan-end-day').value = end.day;
    document.getElementById('scan-end-month').value = end.month;
    document.getElementById('scan-end-year').value = end.year;

    updateParseAllTooltip();
  }

  function updateParseAllTooltip() {
    const start = AppState.channelStartDate;
    document.getElementById('parse-all-tooltip-date').textContent = dateToStr(start);
  }

  function readDateFromInputs(prefix) {
    const day = parseInt(document.getElementById(`scan-${prefix}-day`).value, 10);
    const month = parseInt(document.getElementById(`scan-${prefix}-month`).value, 10);
    const year = parseInt(document.getElementById(`scan-${prefix}-year`).value, 10);
    if (isNaN(day) || isNaN(month) || isNaN(year)) return null;
    return { day, month, year };
  }

  document.getElementById('btn-apply-range').addEventListener('click', () => {
    const start = readDateFromInputs('start');
    const end = readDateFromInputs('end');
    if (!start || !end) {
      showSetupError('Укажите корректный диапазон дат.');
      return;
    }
    AppState.scanStartDate = start;
    AppState.scanEndDate = end;
    rawMessagesCache = null;
    startFullLogsScan();
  });

  document.getElementById('btn-parse-all').addEventListener('click', () => {
    AppState.scanStartDate = null;
    AppState.scanEndDate = null;
    rawMessagesCache = null;
    initDateRangeUI();
    startFullLogsScan();
  });

  // ===== Загрузка модов/VIP (с fallback на ручной ввод) =====

  async function loadModsVips() {
    const [modsResult, vipsResult] = await Promise.all([
      TwitchAuth.fetchModerators(AppState.channel),
      TwitchAuth.fetchVips(AppState.channel),
    ]);

    modsOk = modsResult.ok;
    vipsOk = vipsResult.ok;

    if (modsResult.ok) {
      mods = new Set(modsResult.list);
    } else {
      mods = MessagePool.parseChatterList(CONFIG.DEFAULT_MODS);
    }

    if (vipsResult.ok) {
      vips = new Set(vipsResult.list);
    } else {
      vips = MessagePool.parseChatterList(CONFIG.DEFAULT_VIPS);
    }

    updateModVipFallbackUI();
  }

  function updateModVipFallbackUI() {
    const manualModsWrap = document.getElementById('manual-mods-wrap');
    const manualVipsWrap = document.getElementById('manual-vips-wrap');
    const manualModsInput = document.getElementById('manual-mods-input');
    const manualVipsInput = document.getElementById('manual-vips-input');

    const needMods = ['mods', 'vips_mods'].includes(settings.authorFilter);
    const needVips = ['vips', 'vips_mods'].includes(settings.authorFilter);

    if (!modsOk && needMods) {
      manualModsWrap.classList.remove('hidden');
      if (!manualModsInput.value) manualModsInput.value = CONFIG.DEFAULT_MODS;
    } else {
      manualModsWrap.classList.add('hidden');
    }

    if (!vipsOk && needVips) {
      manualVipsWrap.classList.remove('hidden');
      if (!manualVipsInput.value) manualVipsInput.value = CONFIG.DEFAULT_VIPS;
    } else {
      manualVipsWrap.classList.add('hidden');
    }
  }

  // Перечитать ручные поля мод/VIP в Set-ы при нажатии "Начать игру"
  function readManualModsVips() {
    if (!modsOk) {
      const raw = document.getElementById('manual-mods-input').value;
      if (raw.trim()) mods = MessagePool.parseChatterList(raw);
    }
    if (!vipsOk) {
      const raw = document.getElementById('manual-vips-input').value;
      if (raw.trim()) vips = MessagePool.parseChatterList(raw);
    }
  }

  // ===== Полное сканирование логов =====

  const setupErrorEl = document.getElementById('setup-error');
  const loadingStatusEl = document.getElementById('loading-status');
  const btnStart = document.getElementById('btn-start-game');

  function showSetupError(msg) {
    setupErrorEl.textContent = msg;
    setupErrorEl.classList.remove('hidden');
    setupErrorEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function startFullLogsScan() {
    btnStart.disabled = true;
    btnStart.textContent = 'Парсинг логов...';
    setupErrorEl.classList.add('hidden');

    const startDate = AppState.scanStartDate || AppState.channelStartDate;
    const endDate = AppState.scanEndDate || todayUTC();

    logsScanPromise = MessagePool.scanAllMessages(
      { channel: AppState.channel, startDate, endDate },
      ({ daysScanned, totalDays, rawCount, chattersCount }) => {
        loadingStatusEl.textContent =
          `Парсинг: ${daysScanned}/${totalDays} дней · ${rawCount.toLocaleString()} сообщений · ${chattersCount.toLocaleString()} чаттеров`;
      }
    ).then((raw) => {
      rawMessagesCache = raw;
      const uniq = new Set(raw.map((m) => m.user)).size;
      loadingStatusEl.textContent =
        `Готово: ${raw.length.toLocaleString()} сообщений · ${uniq.toLocaleString()} чаттеров`;
      btnStart.disabled = false;
      btnStart.textContent = 'Начать игру';
      return raw;
    }).catch((e) => {
      console.error('[ChatterGuesser] Ошибка парсинга логов:', e);
      setupErrorEl.textContent = `Не удалось загрузить логи: ${e.message}`;
      setupErrorEl.classList.remove('hidden');
      loadingStatusEl.textContent = '';
      btnStart.disabled = true;
      btnStart.textContent = 'Начать игру';
    });
  }

  // ===== Привязка фильтров =====

  function bindRangeAndNumber(rangeId, numberId, onChange) {
    const range = document.getElementById(rangeId);
    const number = document.getElementById(numberId);
    range.addEventListener('input', () => { number.value = range.value; onChange(Number(range.value)); });
    number.addEventListener('input', () => {
      let val = Number(number.value);
      if (isNaN(val)) return;
      val = Math.max(Number(range.min), val);
      range.value = Math.min(val, Number(range.max));
      onChange(val);
    });
  }

  bindRangeAndNumber('range-rounds', 'input-rounds', (v) => { settings.rounds = v; saveSettingsToSession(); });
  bindRangeAndNumber('range-variants', 'input-variants', (v) => { settings.variants = v; saveSettingsToSession(); });

  document.getElementById('input-min-messages').addEventListener('input', (e) => {
    let val = Math.max(100, Number(e.target.value) || 100);
    settings.minMessages = val;
    document.getElementById('range-min-messages').value = Math.min(val, 30000);
    saveSettingsToSession();
  });
  document.getElementById('range-min-messages').addEventListener('input', (e) => {
    settings.minMessages = Number(e.target.value);
    document.getElementById('input-min-messages').value = settings.minMessages;
    saveSettingsToSession();
  });

  document.getElementById('range-min-length').addEventListener('input', (e) => {
    let val = Number(e.target.value);
    if (val > settings.maxLength) { val = settings.maxLength; e.target.value = val; }
    settings.minLength = val;
    document.getElementById('label-min-length').textContent = val;
    saveSettingsToSession();
  });
  document.getElementById('range-max-length').addEventListener('input', (e) => {
    let val = Number(e.target.value);
    if (val < settings.minLength) { val = settings.minLength; e.target.value = val; }
    settings.maxLength = val;
    document.getElementById('label-max-length').textContent = val;
    saveSettingsToSession();
  });

  document.getElementById('input-ignored-chatters').addEventListener('input', (e) => {
    settings.ignoredChatters = e.target.value;
    saveSettingsToSession();
  });

  document.querySelectorAll('.author-toggle-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.author-toggle-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      settings.authorFilter = btn.dataset.author;
      saveSettingsToSession();
      updateModVipFallbackUI();
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

  btnStart.addEventListener('click', async () => {
    setupErrorEl.classList.add('hidden');

    if (!rawMessagesCache) {
      if (logsScanPromise) {
        btnStart.disabled = true;
        btnStart.textContent = 'Парсинг логов...';
        try { await logsScanPromise; } catch (e) { return; }
      } else {
        showSetupError('Логи ещё не загружены. Подождите.');
        return;
      }
    }

    // Живая игра — особый флоу
    if (settings.mode === 'live') {
      showScreen('liveSetup');
      return;
    }

    btnStart.disabled = true;
    btnStart.textContent = 'Формирование раундов...';

    try {
      readManualModsVips();
      const { pool, uniqueAuthorCount } = MessagePool.filterPool(rawMessagesCache, {
        minLength: settings.minLength,
        maxLength: settings.maxLength,
        authorFilter: settings.authorFilter,
        minMessages: settings.minMessages,
        mods,
        vips,
        ignoredChattersStr: settings.ignoredChatters,
      });

      if (pool.length < settings.variants) {
        throw new Error(
          `Недостаточно сообщений под текущие фильтры (найдено ${pool.length} из ${rawMessagesCache.length.toLocaleString()} просканированных). Ослабьте фильтры.`
        );
      }
      if (uniqueAuthorCount < settings.variants) {
        throw new Error(
          `Только ${uniqueAuthorCount} уникальных авторов подходит под фильтры — нужно минимум ${settings.variants} для ${settings.variants} вариантов в раунде. Ослабьте фильтры.`
        );
      }

      const roundsBuilt = GameEngine.startGame(pool, settings, settings.mode);
      if (!roundsBuilt) throw new Error('Не удалось сформировать ни одного раунда. Ослабьте фильтры.');

      renderCurrentRound();
      showScreen('game');
      setupGameUI();
    } catch (e) {
      console.error('[ChatterGuesser] Ошибка запуска:', e);
      showSetupError(e.message);
    } finally {
      btnStart.disabled = false;
      btnStart.textContent = 'Начать игру';
    }
  });

  // ===== Живая игра =====

  let liveMessages = [];
  let liveTimerInterval = null;

  document.getElementById('btn-live-back').addEventListener('click', () => {
    ChatListener.disconnect();
    showScreen('setup');
  });

  document.getElementById('btn-live-start-timer').addEventListener('click', () => {
    liveMessages = [];
    showScreen('liveTimer');
    document.getElementById('live-timer-value').textContent = '60';
    document.getElementById('live-timer-collected').textContent = 'Собрано сообщений: 0';

    // Подключаемся к IRC канала логов (анонимно) и собираем сообщения
    ChatListener.connect(AppState.channel, (msg) => {
      const ignored = MessagePool.parseChatterList(settings.ignoredChatters);
      if (!ignored.has(msg.login)) {
        liveMessages.push({ user: msg.login, text: msg.text, time: new Date().toISOString() });
        document.getElementById('live-timer-collected').textContent =
          `Собрано сообщений: ${liveMessages.length}`;
      }
    });

    let secondsLeft = 60;
    liveTimerInterval = setInterval(() => {
      secondsLeft--;
      document.getElementById('live-timer-value').textContent = secondsLeft;

      // Пульсация цвета таймера в последние 10 секунд
      const circle = document.querySelector('.live-timer-circle');
      if (secondsLeft <= 10) {
        circle.style.borderColor = 'var(--red)';
        circle.style.color = 'var(--red)';
      }

      if (secondsLeft <= 0) {
        clearInterval(liveTimerInterval);
        ChatListener.disconnect();
        startLiveGame();
      }
    }, 1000);
  });

  function startLiveGame() {
    if (liveMessages.length < settings.variants) {
      showScreen('liveSetup');
      document.querySelector('.live-setup-desc').textContent =
        `Собрано только ${liveMessages.length} сообщений — недостаточно для ${settings.variants} вариантов. Уменьшите "Вариантов" в настройках или попробуйте снова.`;
      return;
    }

    // Используем живые сообщения как пул вместо логов
    const roundsBuilt = GameEngine.startGame(liveMessages, settings, 'live');
    if (!roundsBuilt) {
      showScreen('liveSetup');
      return;
    }

    renderCurrentRound();
    showScreen('game');
    setupGameUI();
  }

  // ===== Игровой экран =====

  function setupGameUI() {
    const isChat = settings.mode === 'chat';
    document.getElementById('chat-sidebar').classList.toggle('hidden', !isChat);
    if (isChat) setupChatVoting();
    setupExitButton();
  }

  function renderCurrentRound() {
    const round = GameEngine.getCurrentRound();
    if (!round) return;

    document.getElementById('round-progress-label').textContent =
      `Раунд ${GameEngine.getRoundNumber()} / ${GameEngine.getTotalRounds()}`;

    const score = GameEngine.getStreamerScore();
    document.getElementById('score-progress-label').textContent =
      score.total > 0 ? `✓ ${score.correct} / ${score.total}` : '';

    document.getElementById('target-username').textContent = round.targetUser;

    const optionsListEl = document.getElementById('options-list');
    optionsListEl.innerHTML = '';

    round.options.forEach((opt, idx) => {
      const btn = document.createElement('button');
      btn.className = 'option-row';
      btn.innerHTML = `
        <span class="option-number">${idx + 1}</span>
        <span class="option-text">${escapeHtml(opt.text)}</span>`;
      btn.addEventListener('click', () => handleAnswerSelect(idx));
      optionsListEl.appendChild(btn);
    });

    document.getElementById('btn-next-round').classList.add('hidden');
    resetExitConfirm();
  }

  function handleAnswerSelect(selectedIdx) {
    const result = GameEngine.submitAnswer(selectedIdx);
    if (!result) return;
    revealAnswer(result.correctIndex, selectedIdx);
  }

  function revealAnswer(correctIndex, selectedIndex) {
    const optionsListEl = document.getElementById('options-list');
    const buttons = optionsListEl.querySelectorAll('.option-row');
    const round = GameEngine.getCurrentRound();

    buttons.forEach((btn, idx) => {
      btn.disabled = true;
      const isCorrect = idx === correctIndex;
      const isSelected = idx === selectedIndex;

      if (isCorrect) btn.classList.add('correct');
      else if (isSelected) btn.classList.add('incorrect-selected');

      // Показываем кто написал каждый вариант после ответа
      const opt = round.options[idx];
      if (!isCorrect && opt.user) {
        const authorSpan = document.createElement('span');
        authorSpan.className = 'option-revealed-author';
        authorSpan.innerHTML = `написал: <span class="author-name">${escapeHtml(opt.user)}</span>`;
        btn.appendChild(authorSpan);
      }
    });

    if (settings.mode === 'chat') {
      GameEngine.resolveChatVotesAndUpdateScores();
      renderLeaderboard();
    }

    const score = GameEngine.getStreamerScore();
    document.getElementById('score-progress-label').textContent =
      `✓ ${score.correct} / ${score.total}`;

    const btnNext = document.getElementById('btn-next-round');
    btnNext.textContent = GameEngine.isGameOver() ? 'Посмотреть результаты →' : 'Следующий раунд →';
    btnNext.classList.remove('hidden');
  }

  document.getElementById('btn-next-round').addEventListener('click', () => {
    if (GameEngine.isGameOver()) { showResults(); return; }
    GameEngine.nextRound();
    renderCurrentRound();
  });

  // ===== Кнопка "Выйти" с раздвоением =====

  function setupExitButton() {
    resetExitConfirm();
  }

  function resetExitConfirm() {
    const btnExit = document.getElementById('btn-exit-game');
    const confirmEl = document.getElementById('exit-confirm');
    btnExit.classList.remove('shrunk', 'hidden');
    confirmEl.classList.add('hidden');
  }

  document.getElementById('btn-exit-game').addEventListener('click', () => {
    const btnExit = document.getElementById('btn-exit-game');
    const confirmEl = document.getElementById('exit-confirm');
    btnExit.classList.add('shrunk');
    setTimeout(() => btnExit.classList.add('hidden'), 150);
    confirmEl.classList.remove('hidden');
  });

  document.getElementById('btn-exit-confirm').addEventListener('click', () => {
    ChatListener.disconnect();
    if (liveTimerInterval) { clearInterval(liveTimerInterval); liveTimerInterval = null; }
    showScreen('setup');
  });

  document.getElementById('btn-exit-cancel').addEventListener('click', resetExitConfirm);

  // ===== Режим "играть с чатом" =====

  function setupChatVoting() {
    const statusEl = document.getElementById('connection-status');
    statusEl.textContent = 'подключение...';
    statusEl.className = 'connection-status disconnected';

    ChatListener.connect(AppState.channel, (msg) => {
      const num = parseInt(msg.text.trim(), 10);
      if (!isNaN(num) && num >= 1 && num <= settings.variants) {
        const round = GameEngine.getCurrentRound();
        if (round && !round.answered) GameEngine.registerChatVote(msg.login, num);
      }
    });

    const interval = setInterval(() => {
      const ok = ChatListener.isConnected();
      statusEl.textContent = ok ? 'подключено к чату' : 'переподключение...';
      statusEl.className = `connection-status ${ok ? 'connected' : 'disconnected'}`;
    }, 1000);

    window.addEventListener('beforeunload', () => {
      clearInterval(interval);
      ChatListener.disconnect();
    }, { once: true });
  }

  function renderLeaderboard() {
    const listEl = document.getElementById('leaderboard-list');
    const top = GameEngine.getChatLeaderboard(10);
    listEl.innerHTML = '';
    if (!top.length) {
      listEl.innerHTML = '<div style="color:var(--text-dim);font-size:13px;">Пока никто не угадал</div>';
      return;
    }
    top.forEach((entry, idx) => {
      const row = document.createElement('div');
      row.className = 'leaderboard-row';
      row.innerHTML = `
        <span class="rank">#${idx + 1}</span>
        <span class="name">${escapeHtml(entry.login)}</span>
        <span class="score">${entry.score}</span>`;
      listEl.appendChild(row);
    });
  }

  // ===== Финальный экран =====

  function showResults() {
    ChatListener.disconnect();
    const score = GameEngine.getStreamerScore();
    document.getElementById('final-score').textContent = `${score.correct} / ${score.total}`;
    const pct = score.total > 0 ? score.correct / score.total : 0;
    document.getElementById('final-comment').textContent =
      pct === 1 ? 'Идеальное знание своего чата!' :
      pct >= 0.7 ? 'Отличный результат — чат как на ладони.' :
      pct >= 0.4 ? 'Неплохо, но есть куда расти.' :
      'Похоже, пора почаще читать чат :)';
    showScreen('results');
  }

  document.getElementById('btn-restart').addEventListener('click', () => showScreen('setup'));

  // ===== Запуск =====
  initAuthFlow();

})();
