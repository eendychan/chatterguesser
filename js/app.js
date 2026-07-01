// ChatterGuesser — главный модуль приложения
(async function () {

  // ===== Глобальное состояние =====
  const AppState = {
    channel:          CONFIG.CHANNEL_PRESETS[0].login,
    channelStartDate: CONFIG.CHANNEL_PRESETS[0].startDate,
    channelAvatarUrl: '',
    scanStartDate:    null,
    scanEndDate:      null,
  };

  // 7TV эмоуты текущего канала (подгружаются при смене канала)
  let channelEmotes = new Set();

  // ===== Экраны =====
  const screens = {
    auth:      document.getElementById('auth-screen'),
    setup:     document.getElementById('setup-screen'),
    liveSetup: document.getElementById('live-setup-screen'),
    liveTimer: document.getElementById('live-timer-screen'),
    game:      document.getElementById('game-screen'),
    results:   document.getElementById('results-screen'),
  };

  function showScreen(name) {
    Object.values(screens).forEach(el => el.classList.add('hidden'));
    document.getElementById('custom-channel-modal').classList.add('hidden');
    screens[name].classList.remove('hidden');
  }

  // ===== Настройки =====
  let settings = {
    rounds:          CONFIG.DEFAULTS.rounds,
    minLength:       CONFIG.DEFAULTS.minLength,
    maxLength:       CONFIG.DEFAULTS.maxLength,
    variants:        CONFIG.DEFAULTS.variants,
    minMessages:     CONFIG.DEFAULTS.minMessages,
    authorFilter:    CONFIG.DEFAULTS.authorFilter,
    ignoredChatters: CONFIG.DEFAULTS.ignoredChatters,
    allowedPhrases:  '',
    emoteFilter:     'off',
    mode:            'solo',
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
    if (TwitchAuth.loadFromSession()) { enterSetupScreen(); return; }
    showScreen('auth');
    const errEl = document.getElementById('auth-error');
    if (window.location.hash.includes('access_token')) {
      const ok = await TwitchAuth.completeLoginIfRedirected();
      if (ok) { enterSetupScreen(); return; }
      errEl.textContent = 'Не удалось завершить авторизацию. Попробуйте снова.';
      errEl.classList.remove('hidden');
    } else if (window.location.hash.includes('error=')) {
      const p = new URLSearchParams(window.location.hash.substring(1));
      errEl.textContent = `Авторизация отменена: ${p.get('error_description') || p.get('error')}`;
      errEl.classList.remove('hidden');
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
    document.querySelectorAll('img[data-badge]').forEach(img => {
      img.src = CONFIG.BADGES[img.getAttribute('data-badge')];
    });
  }

  async function enterSetupScreen() {
    initBadgeImages();
    loadSettingsFromSession();

    const user = TwitchAuth.getState();
    document.getElementById('user-avatar').src = user.profileImageUrl || '';
    document.getElementById('user-name').textContent = user.displayName || user.login;
    document.getElementById('btn-links').href = CONFIG.LINKS_URL;
    document.getElementById('custom-logs-site-link').href = CONFIG.CUSTOM_LOGS_SITE_URL;

    applySettingsToUI();
    initChannelPickerUI();
    showScreen('setup');

    // Инициализируем LazyPool с дефолтным каналом (БЕЗ автоматического старта парсинга)
    initLazyPool();

    // Аватарка канала + моды/VIP (это быстрые API-запросы, не парсинг логов)
    loadChannelAvatar(AppState.channel);
    loadModsVips();
    load7tvEmotes(AppState.channel);

    // Кнопка "Начать игру" сразу доступна — парсинг запустится по требованию
    const btnStart = document.getElementById('btn-start-game');
    btnStart.disabled = false;
    btnStart.textContent = 'Начать игру';
  }

  function applySettingsToUI() {
    document.getElementById('input-rounds').value            = settings.rounds;
    document.getElementById('range-rounds').value            = settings.rounds;
    document.getElementById('range-min-length').value        = settings.minLength;
    document.getElementById('range-max-length').value        = settings.maxLength;
    document.getElementById('label-min-length').textContent  = settings.minLength;
    document.getElementById('label-max-length').textContent  = settings.maxLength;
    document.getElementById('input-variants').value          = settings.variants;
    document.getElementById('range-variants').value          = settings.variants;
    document.getElementById('input-min-messages').value      = settings.minMessages;
    document.getElementById('range-min-messages').value      = Math.min(settings.minMessages, 30000);
    document.getElementById('input-ignored-chatters').value  = settings.ignoredChatters;
    document.getElementById('input-allowed-phrases').value   = settings.allowedPhrases || '';

    document.querySelectorAll('.author-toggle-btn').forEach(b =>
      b.classList.toggle('active', b.dataset.author === settings.authorFilter));
    document.querySelectorAll('.mode-card').forEach(c =>
      c.classList.toggle('active', c.dataset.mode === settings.mode));
    document.querySelectorAll('.emote-filter-btn').forEach(b =>
      b.classList.toggle('active', b.dataset.emoteFilter === settings.emoteFilter));
  }

  // ===== LazyPool инициализация =====

  function getEffectiveDateRange() {
    return {
      startDate: AppState.scanStartDate || AppState.channelStartDate,
      endDate:   AppState.scanEndDate   || todayUTC(),
    };
  }

  function initLazyPool() {
    const { startDate, endDate } = getEffectiveDateRange();
    LazyPool.init(AppState.channel, startDate, endDate);
    updateScanStatus();
  }

  function updateScanStatus() {
    const s = LazyPool.stats();
    const loadingStatusEl = document.getElementById('loading-status');
    if (s.daysLoaded === 0) {
      loadingStatusEl.textContent = `Логи не спаршены. Нажмите "Парсить всё" или выберите диапазон, либо начните игру — логи подгрузятся автоматически.`;
    } else {
      loadingStatusEl.textContent =
        `Спаршено: ${s.daysLoaded}/${s.daysTotal} дней · ${s.msgCount.toLocaleString()} сообщений · ${s.chattersCount.toLocaleString()} чаттеров`;
    }
  }

  // ===== Канальный picker =====

  function initChannelPickerUI() {
    const listEl = document.getElementById('channel-preset-list');
    listEl.innerHTML = '';
    CONFIG.CHANNEL_PRESETS.forEach(preset => {
      const btn = document.createElement('button');
      btn.className = 'channel-preset-item';
      btn.innerHTML = `
        <img src="https://static-cdn.jtvnw.net/user-default-pictures-uv/cdd517fe-def4-11e9-948e-784f43822e80-profile_image-50x50.png"
             class="channel-avatar" style="width:22px;height:22px;" data-login="${preset.login}" alt="">
        <span class="preset-login">${preset.login.toUpperCase()}</span>
        <span class="preset-start">с ${dateToStr(preset.startDate)}</span>`;
      btn.addEventListener('click', () => selectChannel(preset.login, preset.startDate));
      listEl.appendChild(btn);
      if (TwitchAuth.isAuthenticated()) {
        TwitchAuth.fetchChannelInfo(preset.login).then(info => {
          if (info) { const img = btn.querySelector('img'); if (img) img.src = info.profileImageUrl; }
        });
      }
    });
    document.getElementById('logs-channel-label').textContent = AppState.channel;
    updateParseAllTooltip();
    initDateRangeUI();
  }

  async function loadChannelAvatar(login) {
    const avatarEl = document.getElementById('channel-picker-avatar');
    const labelEl  = document.getElementById('channel-picker-label');
    labelEl.textContent = login.toUpperCase();
    if (!TwitchAuth.isAuthenticated()) return;
    const info = await TwitchAuth.fetchChannelInfo(login);
    if (info) { avatarEl.src = info.profileImageUrl; AppState.channelAvatarUrl = info.profileImageUrl; }
  }

  async function selectChannel(login, startDate) {
    AppState.channel          = login;
    AppState.channelStartDate = startDate;
    AppState.scanStartDate    = null;
    AppState.scanEndDate      = null;

    document.getElementById('logs-channel-label').textContent = login;
    document.getElementById('channel-picker-label').textContent = login.toUpperCase();
    loadChannelAvatar(login);
    initDateRangeUI();
    updateParseAllTooltip();
    initLazyPool();       // новый канал = новый LazyPool (старые данные сбрасываются)
    loadModsVips();
    load7tvEmotes(login);

    const btnStart = document.getElementById('btn-start-game');
    btnStart.disabled = false;
    btnStart.textContent = 'Начать игру';
  }

  document.getElementById('btn-add-custom-channel').addEventListener('click', () => {
    document.getElementById('custom-channel-modal').classList.remove('hidden');
  });
  document.getElementById('btn-close-custom-channel').addEventListener('click', () => {
    document.getElementById('custom-channel-modal').classList.add('hidden');
  });
  document.getElementById('custom-channel-modal').addEventListener('click', e => {
    if (e.target === document.getElementById('custom-channel-modal'))
      document.getElementById('custom-channel-modal').classList.add('hidden');
  });
  document.getElementById('btn-confirm-custom-channel').addEventListener('click', async () => {
    const login = document.getElementById('custom-channel-login').value.trim().toLowerCase();
    const day   = parseInt(document.getElementById('custom-channel-day').value, 10);
    const month = parseInt(document.getElementById('custom-channel-month').value, 10);
    const year  = parseInt(document.getElementById('custom-channel-year').value, 10);
    const errEl = document.getElementById('custom-channel-error');
    if (!login || isNaN(day) || isNaN(month) || isNaN(year)) {
      errEl.textContent = 'Заполните ник и все поля даты.'; errEl.classList.remove('hidden'); return;
    }
    errEl.classList.add('hidden');
    document.getElementById('custom-channel-modal').classList.add('hidden');
    await selectChannel(login, { year, month, day });
  });

  // ===== Диапазон дат =====

  function initDateRangeUI() {
    const start = AppState.channelStartDate;
    const end   = todayUTC();
    document.getElementById('scan-start-day').value   = start.day;
    document.getElementById('scan-start-month').value = start.month;
    document.getElementById('scan-start-year').value  = start.year;
    document.getElementById('scan-end-day').value     = end.day;
    document.getElementById('scan-end-month').value   = end.month;
    document.getElementById('scan-end-year').value    = end.year;
  }

  function updateParseAllTooltip() {
    document.getElementById('parse-all-tooltip-date').textContent =
      dateToStr(AppState.channelStartDate);
  }

  function readDateFromInputs(prefix) {
    const day   = parseInt(document.getElementById(`scan-${prefix}-day`).value,   10);
    const month = parseInt(document.getElementById(`scan-${prefix}-month`).value, 10);
    const year  = parseInt(document.getElementById(`scan-${prefix}-year`).value,  10);
    if (isNaN(day) || isNaN(month) || isNaN(year)) return null;
    return { day, month, year };
  }

  document.getElementById('btn-apply-range').addEventListener('click', () => {
    const start = readDateFromInputs('start');
    const end   = readDateFromInputs('end');
    if (!start || !end) { showSetupError('Укажите корректный диапазон дат.'); return; }
    AppState.scanStartDate = start;
    AppState.scanEndDate   = end;
    initLazyPool();
    triggerFullScan();
  });

  document.getElementById('btn-parse-all').addEventListener('click', () => {
    AppState.scanStartDate = null;
    AppState.scanEndDate   = null;
    initLazyPool();
    initDateRangeUI();
    triggerFullScan();
  });

  // Запуск полного сканирования (через кнопки, не автоматически)
  function triggerFullScan() {
    const btnStart = document.getElementById('btn-start-game');
    btnStart.disabled = true;
    btnStart.textContent = 'Парсинг...';
    document.getElementById('setup-error').classList.add('hidden');

    LazyPool.loadAll(({ loaded, total, msgCount, chattersCount }) => {
      document.getElementById('loading-status').textContent =
        `Парсинг: ${loaded}/${total} дней · ${msgCount.toLocaleString()} сообщений · ${chattersCount.toLocaleString()} чаттеров`;
    }).then(({ msgs }) => {
      const uniq = new Set(msgs.map(m => m.user)).size;
      document.getElementById('loading-status').textContent =
        `Готово: ${msgs.length.toLocaleString()} сообщений · ${uniq.toLocaleString()} чаттеров`;
      btnStart.disabled = false;
      btnStart.textContent = 'Начать игру';
    }).catch(e => {
      console.error('[ChatterGuesser] Ошибка парсинга:', e);
      showSetupError(`Не удалось загрузить логи: ${e.message}`);
      btnStart.disabled = false;
      btnStart.textContent = 'Начать игру';
    });
  }

  // ===== 7TV =====

  async function load7tvEmotes(channelLogin) {
    channelEmotes = await SevenTV.fetchEmotes(channelLogin);
    const count = channelEmotes.size;
    const label = document.getElementById('emote-filter-label');
    if (label) label.textContent = count > 0 ? `7TV: ${count} эмоутов` : '7TV: эмоуты не найдены';
  }

  // ===== Моды / VIP =====

  async function loadModsVips() {
    const [mr, vr] = await Promise.all([
      TwitchAuth.fetchModerators(AppState.channel),
      TwitchAuth.fetchVips(AppState.channel),
    ]);
    modsOk = mr.ok; vipsOk = vr.ok;
    mods   = mr.ok ? new Set(mr.list) : MessagePool.parseChatterList(CONFIG.DEFAULT_MODS);
    vips   = vr.ok ? new Set(vr.list) : MessagePool.parseChatterList(CONFIG.DEFAULT_VIPS);
    updateModVipFallbackUI();
  }

  function updateModVipFallbackUI() {
    const needMods = ['mods','vips_mods'].includes(settings.authorFilter);
    const needVips = ['vips','vips_mods'].includes(settings.authorFilter);
    const mw = document.getElementById('manual-mods-wrap');
    const vw = document.getElementById('manual-vips-wrap');
    const mi = document.getElementById('manual-mods-input');
    const vi = document.getElementById('manual-vips-input');
    if (!modsOk && needMods) {
      mw.classList.remove('hidden'); if (!mi.value) mi.value = CONFIG.DEFAULT_MODS;
    } else { mw.classList.add('hidden'); }
    if (!vipsOk && needVips) {
      vw.classList.remove('hidden'); if (!vi.value) vi.value = CONFIG.DEFAULT_VIPS;
    } else { vw.classList.add('hidden'); }
  }

  function readManualModsVips() {
    if (!modsOk) { const r = document.getElementById('manual-mods-input').value; if (r.trim()) mods = MessagePool.parseChatterList(r); }
    if (!vipsOk) { const r = document.getElementById('manual-vips-input').value; if (r.trim()) vips = MessagePool.parseChatterList(r); }
  }

  // ===== Привязка фильтров UI =====

  const setupErrorEl = document.getElementById('setup-error');

  function showSetupError(msg) {
    setupErrorEl.textContent = msg;
    setupErrorEl.classList.remove('hidden');
    setupErrorEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function bindRangeAndNumber(rangeId, numberId, onChange) {
    const range  = document.getElementById(rangeId);
    const number = document.getElementById(numberId);
    range.addEventListener('input', () => { number.value = range.value; onChange(Number(range.value)); });
    number.addEventListener('input', () => {
      let val = Number(number.value); if (isNaN(val)) return;
      val = Math.max(Number(range.min), val);
      range.value = Math.min(val, Number(range.max));
      onChange(val);
    });
  }

  bindRangeAndNumber('range-rounds',   'input-rounds',   v => { settings.rounds   = v; saveSettingsToSession(); });
  bindRangeAndNumber('range-variants', 'input-variants', v => { settings.variants  = v; saveSettingsToSession(); });

  document.getElementById('input-min-messages').addEventListener('input', e => {
    let val = Math.max(100, Number(e.target.value) || 100);
    settings.minMessages = val;
    document.getElementById('range-min-messages').value = Math.min(val, 30000);
    saveSettingsToSession();
  });
  document.getElementById('range-min-messages').addEventListener('input', e => {
    settings.minMessages = Number(e.target.value);
    document.getElementById('input-min-messages').value = settings.minMessages;
    saveSettingsToSession();
  });
  document.getElementById('range-min-length').addEventListener('input', e => {
    let val = Number(e.target.value);
    if (val > settings.maxLength) { val = settings.maxLength; e.target.value = val; }
    settings.minLength = val;
    document.getElementById('label-min-length').textContent = val;
    saveSettingsToSession();
  });
  document.getElementById('range-max-length').addEventListener('input', e => {
    let val = Number(e.target.value);
    if (val < settings.minLength) { val = settings.minLength; e.target.value = val; }
    settings.maxLength = val;
    document.getElementById('label-max-length').textContent = val;
    saveSettingsToSession();
  });
  document.getElementById('input-ignored-chatters').addEventListener('input', e => {
    settings.ignoredChatters = e.target.value; saveSettingsToSession();
  });
  document.getElementById('input-allowed-phrases').addEventListener('input', e => {
    settings.allowedPhrases = e.target.value; saveSettingsToSession();
  });

  document.querySelectorAll('.author-toggle-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.author-toggle-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      settings.authorFilter = btn.dataset.author;
      saveSettingsToSession(); updateModVipFallbackUI();
    });
  });
  document.querySelectorAll('.mode-card').forEach(card => {
    card.addEventListener('click', () => {
      document.querySelectorAll('.mode-card').forEach(c => c.classList.remove('active'));
      card.classList.add('active'); settings.mode = card.dataset.mode; saveSettingsToSession();
    });
  });
  document.querySelectorAll('.emote-filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.emote-filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active'); settings.emoteFilter = btn.dataset.emoteFilter; saveSettingsToSession();
    });
  });

  // ===== Запуск игры =====

  document.getElementById('btn-start-game').addEventListener('click', async () => {
    setupErrorEl.classList.add('hidden');
    if (settings.mode === 'live') { showScreen('liveSetup'); return; }
    await launchGame();
  });

  // Получает пул: либо из уже накопленного LazyPool, либо подгружает
  // случайные дни прямо сейчас (ленивый старт без предварительного парсинга)
  async function buildPoolForGame() {
    const btnStart = document.getElementById('btn-start-game');
    const statusEl = document.getElementById('loading-status');

    function progressCb({ loaded, total, msgCount, chattersCount }) {
      statusEl.textContent =
        `Подгружаем логи: ${loaded}/${total} дней · ${msgCount.toLocaleString()} сообщений · ${chattersCount.toLocaleString()} чаттеров`;
    }

    const raw = LazyPool.getRaw();
    const rawChatters = new Set(raw.map(m => m.user)).size;

    // Первый раунд: нужно минимум 10 000 сообщений и 100 чаттеров
    const needBootstrap = raw.length < 10000 || rawChatters < 100;

    if (needBootstrap && LazyPool.remainingDays() > 0) {
      btnStart.disabled = true;
      btnStart.textContent = 'Загружаем данные...';
      await LazyPool.loadUntil(
        (msgs, chatters) => msgs.length >= 10000 && chatters >= 100,
        progressCb
      );
      btnStart.disabled = false;
      btnStart.textContent = 'Начать игру';
    }

    readManualModsVips();

    const { pool, uniqueAuthorCount } = MessagePool.filterPool(LazyPool.getRaw(), {
      minLength:         settings.minLength,
      maxLength:         settings.maxLength,
      authorFilter:      settings.authorFilter,
      minMessages:       settings.minMessages,
      mods, vips,
      ignoredChattersStr: settings.ignoredChatters,
      allowedPhrasesStr:  settings.allowedPhrases,
      emoteFilter:        settings.emoteFilter,
      emotes:             channelEmotes,
    });

    return { pool, uniqueAuthorCount };
  }

  async function launchGame() {
    const btnStart = document.getElementById('btn-start-game');
    btnStart.disabled = true; btnStart.textContent = 'Формирование...';

    try {
      const { pool, uniqueAuthorCount } = await buildPoolForGame();

      if (pool.length < settings.variants) {
        const raw = LazyPool.getRaw();
        throw new Error(
          `Недостаточно сообщений под фильтры (найдено ${pool.length} из ${raw.length.toLocaleString()} спаршенных). Ослабьте фильтры или спарсите больше логов.`
        );
      }
      if (uniqueAuthorCount < settings.variants) {
        throw new Error(
          `Только ${uniqueAuthorCount} уникальных авторов — нужно минимум ${settings.variants}. Ослабьте фильтры.`
        );
      }

      const roundsBuilt = GameEngine.startGame(pool, settings, settings.mode);
      if (!roundsBuilt) throw new Error('Не удалось сформировать раунды. Ослабьте фильтры.');

      // После первого раунда — запускаем фоновую подгрузку 3 случайных дней
      scheduleBackgroundLoad();

      renderCurrentRound();
      showScreen('game');
      setupGameUI();
    } catch (e) {
      console.error('[ChatterGuesser]', e);
      showSetupError(e.message);
    } finally {
      btnStart.disabled = false; btnStart.textContent = 'Начать игру';
    }
  }

  // Фоновая подгрузка 3 случайных дней после каждого раунда
  function scheduleBackgroundLoad() {
    if (LazyPool.remainingDays() === 0) return;
    LazyPool.loadRandomDays(3, ({ loaded, total, msgCount, chattersCount }) => {
      // Обновляем статус-строку на экране настроек (если он видим)
      const el = document.getElementById('loading-status');
      if (el) el.textContent =
        `Фон: ${loaded}/${total} дней · ${msgCount.toLocaleString()} сообщений · ${chattersCount.toLocaleString()} чаттеров`;
    }).then(() => updateScanStatus());
  }

  // ===== Живая игра =====

  let liveMessages   = [];
  let liveTimerInterval = null;

  document.getElementById('btn-live-back').addEventListener('click', () => {
    ChatListener.disconnect(); showScreen('setup');
  });

  document.getElementById('btn-live-start-timer').addEventListener('click', () => {
    liveMessages = [];
    showScreen('liveTimer');
    document.getElementById('live-timer-value').textContent = '60';
    document.getElementById('live-timer-collected').textContent = 'Собрано сообщений: 0';

    ChatListener.connect(AppState.channel, msg => {
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
        `Собрано только ${liveMessages.length} сообщений — недостаточно. Попробуйте снова.`;
      return;
    }
    const roundsBuilt = GameEngine.startGame(liveMessages, settings, 'live');
    if (!roundsBuilt) { showScreen('liveSetup'); return; }
    renderCurrentRound();
    showScreen('game');
    setupGameUI();
  }

  // ===== Игровой экран =====

  let chatStatusInterval = null;

  function cleanupChatSession() {
    ChatListener.disconnect();
    if (chatStatusInterval) { clearInterval(chatStatusInterval); chatStatusInterval = null; }
  }

  function setupGameUI() {
    const isChat = settings.mode === 'chat';
    const sidebar = document.getElementById('chat-sidebar');
    sidebar.classList.toggle('hidden', !isChat);
    document.getElementById('leaderboard-list').innerHTML = '';
    const statusEl = document.getElementById('connection-status');
    statusEl.textContent = 'подключение...';
    statusEl.className = 'connection-status disconnected';
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

    const listEl = document.getElementById('options-list');
    listEl.innerHTML = '';
    round.options.forEach((opt, idx) => {
      const btn = document.createElement('button');
      btn.className = 'option-row';
      btn.innerHTML = `
        <span class="option-number">${idx + 1}</span>
        <span class="option-text">${escapeHtml(opt.text)}</span>`;
      btn.addEventListener('click', () => handleAnswerSelect(idx));
      listEl.appendChild(btn);
    });

    document.getElementById('btn-next-round').classList.add('hidden');
    resetExitConfirm();

    // Фоновая подгрузка на каждый раунд (3 случайных дня)
    if (settings.mode !== 'live') scheduleBackgroundLoad();
  }

  function handleAnswerSelect(selectedIdx) {
    const result = GameEngine.submitAnswer(selectedIdx);
    if (!result) return;
    revealAnswer(result.correctIndex, selectedIdx);
  }

  function revealAnswer(correctIndex, selectedIndex) {
    const round   = GameEngine.getCurrentRound();
    const buttons = document.getElementById('options-list').querySelectorAll('.option-row');

    buttons.forEach((btn, idx) => {
      btn.disabled = true;
      const isCorrect  = idx === correctIndex;
      const isSelected = idx === selectedIndex;
      if (isCorrect) btn.classList.add('correct');
      else if (isSelected) btn.classList.add('incorrect-selected');

      // Показываем автора каждого варианта после ответа
      const opt = round.options[idx];
      const authorSpan = document.createElement('span');
      authorSpan.className = 'option-revealed-author';
      authorSpan.innerHTML = isCorrect
        ? `написал: <span class="author-name">${escapeHtml(opt.user)}</span> ✓`
        : `написал: <span class="author-name">${escapeHtml(opt.user)}</span>`;
      btn.appendChild(authorSpan);
    });

    if (settings.mode === 'chat') { GameEngine.resolveChatVotesAndUpdateScores(); renderLeaderboard(); }
    const score = GameEngine.getStreamerScore();
    document.getElementById('score-progress-label').textContent = `✓ ${score.correct} / ${score.total}`;
    const btnNext = document.getElementById('btn-next-round');
    btnNext.textContent = GameEngine.isGameOver() ? 'Посмотреть результаты →' : 'Следующий раунд →';
    btnNext.classList.remove('hidden');
  }

  document.getElementById('btn-next-round').addEventListener('click', () => {
    if (GameEngine.isGameOver()) { showResults(); return; }
    GameEngine.nextRound(); renderCurrentRound();
  });

  // ===== Кнопка "Выйти" =====

  function setupExitButton() { resetExitConfirm(); }

  function resetExitConfirm() {
    const btnExit  = document.getElementById('btn-exit-game');
    const confirmEl = document.getElementById('exit-confirm');
    btnExit.classList.remove('shrunk', 'hidden');
    confirmEl.classList.add('hidden');
  }

  document.getElementById('btn-exit-game').addEventListener('click', () => {
    const btnExit  = document.getElementById('btn-exit-game');
    const confirmEl = document.getElementById('exit-confirm');
    btnExit.classList.add('shrunk');
    setTimeout(() => btnExit.classList.add('hidden'), 150);
    confirmEl.classList.remove('hidden');
  });
  document.getElementById('btn-exit-confirm').addEventListener('click', () => {
    cleanupChatSession();
    if (liveTimerInterval) { clearInterval(liveTimerInterval); liveTimerInterval = null; }
    updateScanStatus();
    showScreen('setup');
  });
  document.getElementById('btn-exit-cancel').addEventListener('click', resetExitConfirm);

  // ===== Чат-голосование =====

  function setupChatVoting() {
    cleanupChatSession();
    const statusEl = document.getElementById('connection-status');
    ChatListener.connect(AppState.channel, msg => {
      const num = parseInt(msg.text.trim(), 10);
      if (!isNaN(num) && num >= 1 && num <= settings.variants) {
        const round = GameEngine.getCurrentRound();
        if (round && !round.answered) GameEngine.registerChatVote(msg.login, num);
      }
    });
    chatStatusInterval = setInterval(() => {
      const ok = ChatListener.isConnected();
      statusEl.textContent = ok ? 'подключено к чату' : 'переподключение...';
      statusEl.className = `connection-status ${ok ? 'connected' : 'disconnected'}`;
    }, 1000);
    window.addEventListener('beforeunload', () => cleanupChatSession(), { once: true });
  }

  function renderLeaderboard() {
    const listEl = document.getElementById('leaderboard-list');
    const top    = GameEngine.getChatLeaderboard(10);
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

  // ===== Финал =====

  function showResults() {
    cleanupChatSession();
    const score = GameEngine.getStreamerScore();
    document.getElementById('final-score').textContent = `${score.correct} / ${score.total}`;
    const pct = score.total > 0 ? score.correct / score.total : 0;
    document.getElementById('final-comment').textContent =
      pct === 1   ? 'Идеальное знание своего чата!' :
      pct >= 0.7  ? 'Отличный результат — чат как на ладони.' :
      pct >= 0.4  ? 'Неплохо, но есть куда расти.' :
                    'Похоже, пора почаще читать чат :)';
    showScreen('results');
  }

  document.getElementById('btn-restart').addEventListener('click', () => {
    updateScanStatus(); showScreen('setup');
  });

  // ===== Старт =====
  initAuthFlow();

})();
