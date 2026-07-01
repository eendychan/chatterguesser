// ChatterGuesser — игровой движок
const GameEngine = (() => {
  let state = {
    rounds: [],
    currentRoundIndex: -1,
    settings: null,
    scores: new Map(), // для режима "играть с чатом": votedUser -> correctGuesses
    mode: 'solo', // 'solo' | 'chat'
  };

  // Строит раунды игры из пула сообщений.
  // Каждый раунд: 1 "целевой" автор + его реальное сообщение, плюс (variants-1)
  // сообщений от ДРУГИХ случайных авторов (отвлекающие варианты).
  function buildRounds(pool, rounds, variants) {
    // Группируем пул по автору, чтобы у каждого раунда был чёткий "целевой" автор
    const byUser = new Map();
    for (const msg of pool) {
      if (!byUser.has(msg.user)) byUser.set(msg.user, []);
      byUser.get(msg.user).push(msg);
    }

    const usersWithEnough = [...byUser.keys()];
    if (usersWithEnough.length < 2) {
      throw new Error('Недостаточно разных чаттеров с сообщениями для формирования раундов. Ослабьте фильтры.');
    }

    const builtRounds = [];
    const usedTargetMessages = new Set(); // чтобы не повторять одно и то же целевое сообщение

    let attempts = 0;
    const maxAttempts = rounds * 50;

    while (builtRounds.length < rounds && attempts < maxAttempts) {
      attempts++;

      // Выбираем случайного целевого автора
      const targetUser = usersWithEnough[Math.floor(Math.random() * usersWithEnough.length)];
      const targetMessages = byUser.get(targetUser).filter((m) => !usedTargetMessages.has(m.time + m.user));
      if (!targetMessages.length) continue;

      const targetMsg = targetMessages[Math.floor(Math.random() * targetMessages.length)];

      // Выбираем (variants - 1) отвлекающих сообщений от ДРУГИХ авторов
      const otherUsers = usersWithEnough.filter((u) => u !== targetUser);
      if (otherUsers.length < variants - 1) continue;

      const shuffledOthers = [...otherUsers].sort(() => Math.random() - 0.5);
      const decoys = [];
      for (const u of shuffledOthers) {
        if (decoys.length >= variants - 1) break;
        const candidates = byUser.get(u);
        const pick = candidates[Math.floor(Math.random() * candidates.length)];
        decoys.push(pick);
      }
      if (decoys.length < variants - 1) continue;

      usedTargetMessages.add(targetMsg.time + targetMsg.user);

      // Перемешиваем варианты так, чтобы правильный был в случайной позиции
      const options = [targetMsg, ...decoys].sort(() => Math.random() - 0.5);
      const correctIndex = options.findIndex((o) => o === targetMsg);

      builtRounds.push({
        targetUser,
        options: options.map((o) => ({ text: o.text, user: o.user, time: o.time })),
        correctIndex,
        answered: false,
        selectedIndex: null,
      });
    }

    if (builtRounds.length < rounds) {
      console.warn(`Удалось сформировать только ${builtRounds.length} из ${rounds} раундов — не хватает разнообразия сообщений.`);
    }

    return builtRounds;
  }

  function startGame(pool, settings, mode) {
    const rounds = buildRounds(pool, settings.rounds, settings.variants);
    state = {
      rounds,
      currentRoundIndex: 0,
      settings,
      scores: new Map(),
      mode,
    };
    return state.rounds.length;
  }

  function getCurrentRound() {
    if (state.currentRoundIndex < 0 || state.currentRoundIndex >= state.rounds.length) return null;
    return state.rounds[state.currentRoundIndex];
  }

  function getRoundNumber() {
    return state.currentRoundIndex + 1;
  }

  function getTotalRounds() {
    return state.rounds.length;
  }

  function submitAnswer(selectedIndex) {
    const round = getCurrentRound();
    if (!round || round.answered) return null;
    round.answered = true;
    round.selectedIndex = selectedIndex;
    return {
      correct: selectedIndex === round.correctIndex,
      correctIndex: round.correctIndex,
    };
  }

  function nextRound() {
    if (state.currentRoundIndex < state.rounds.length - 1) {
      state.currentRoundIndex++;
      return true;
    }
    return false;
  }

  function isGameOver() {
    return state.currentRoundIndex >= state.rounds.length - 1 && getCurrentRound()?.answered;
  }

  function getStreamerScore() {
    let correct = 0;
    for (const r of state.rounds) {
      if (r.answered && r.selectedIndex === r.correctIndex) correct++;
    }
    return { correct, total: state.rounds.filter((r) => r.answered).length };
  }

  // --- Режим "играть с чатом" — подсчёт голосов ---

  function registerChatVote(chatterLogin, optionNumber) {
    const round = getCurrentRound();
    if (!round || round.answered) return;
    if (!round.chatVotes) round.chatVotes = new Map(); // chatterLogin -> optionNumber

    // Каждый чаттер голосует один раз за раунд, последний голос засчитывается
    round.chatVotes.set(chatterLogin, optionNumber);
  }

  function resolveChatVotesAndUpdateScores() {
    const round = getCurrentRound();
    if (!round || !round.chatVotes) return;

    for (const [chatterLogin, optionNumber] of round.chatVotes.entries()) {
      const idx = optionNumber - 1;
      if (idx === round.correctIndex) {
        state.scores.set(chatterLogin, (state.scores.get(chatterLogin) || 0) + 1);
      }
    }
  }

  function getChatLeaderboard(limit = 10) {
    return [...state.scores.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([login, score]) => ({ login, score }));
  }

  function getState() {
    return state;
  }

  return {
    startGame,
    getCurrentRound,
    getRoundNumber,
    getTotalRounds,
    submitAnswer,
    nextRound,
    isGameOver,
    getStreamerScore,
    registerChatVote,
    resolveChatVotesAndUpdateScores,
    getChatLeaderboard,
    getState,
  };
})();
