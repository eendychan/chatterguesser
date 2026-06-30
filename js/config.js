// ChatterGuesser — конфигурация и константы
const CONFIG = {
  // Twitch OAuth — Implicit Grant Flow
  // ВАЖНО: создайте приложение на https://dev.twitch.tv/console/apps
  // OAuth Redirect URL должен быть: https://eendychan.github.io/chatterguesser/
  TWITCH_CLIENT_ID: 'ss3jhem8l4g1ansfbf50t46s1d7eao',
  TWITCH_REDIRECT_URI: 'https://eendychan.github.io/chatterguesser/',
  TWITCH_SCOPES: ['moderation:read', 'channel:read:vips'],

  // Канал, с которого парсятся логи (можно сменить в будущем через настройки)
  LOGS_CHANNEL: 'xah0b',
  LOGS_BASE_URL: 'https://logs.zonian.dev',

  // CORS fallback — если прямой fetch не проходит, пробуем публичный прокси
  CORS_PROXY: 'https://corsproxy.io/?url=',

  // Начальная дата логов
  LOGS_START_DATE: { year: 2025, month: 6, day: 14 },

  // Сколько дней максимум назад можно "досканировать" в глубину,
  // если сообщений не хватает под фильтры
  MAX_DAYS_LOOKBACK_EXPANSION: 365,

  // Дефолтные значения фильтров
  DEFAULTS: {
    rounds: 10,
    minRounds: 5,
    maxRounds: 50,

    minLength: 50,
    maxLength: 150,
    minLengthBound: 1,
    maxLengthBound: 500,

    variants: 3,
    minVariants: 3,
    maxVariants: 6,

    minMessages: 5000,
    minMessagesBound: 100,
    maxMessagesBound: 30000,

    authorFilter: 'all', // all | regulars | vips | mods | vips_mods
  },

  // Бейджи фильтра по типу автора
  BADGES: {
    all: 'https://static-cdn.jtvnw.net/badges/v1/ca3db7f7-18f5-487e-a329-cd0b538ee979/2',
    regulars: 'https://static-cdn.jtvnw.net/badges/v1/5d9f2208-5dd8-11e7-8513-2ff4adfae661/2',
    vips: 'https://static-cdn.jtvnw.net/badges/v1/b817aba4-fad8-49e2-b88a-7cc744dfa6ec/2',
    mods: 'https://static-cdn.jtvnw.net/badges/v1/3267646d-33f0-4b17-b3df-f923a41db1d0/2',
  },

  // Паттерны системных сообщений, которые не считаются "реальным" чат-сообщением
  SYSTEM_MESSAGE_PATTERNS: [
    /\bsubscribed at Tier \d/i,
    /\bsubscribed with Prime\b/i,
    /\bgifted a Tier \d sub to\b/i,
    /\bis gifting \d+ Tier \d Subs?\b/i,
    /\bhas been timed out for\b/i,
    /\bhas been banned\b/i,
    /\bis paying forward the Gift\b/i,
    /\bThis is their first Gift Sub\b/i,
    /\bThey have given \d+ Gift Subs?\b/i,
    /\bThey've gifted a total of \d+\b/i,
    /\braided .* with \d+ viewers?\b/i,
  ],

  // sessionStorage keys
  STORAGE_KEYS: {
    AUTH: 'cg_auth',
    SETTINGS: 'cg_settings',
  },
};

// Twitch IRC (анонимный read-only слушатель для режима "Играть с чатом")
const IRC_CONFIG = {
  WS_URL: 'wss://irc-ws.chat.twitch.tv:443',
  ANON_USERNAME_PREFIX: 'justinfan',
};
