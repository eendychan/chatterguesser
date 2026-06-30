// ChatterGuesser — конфигурация и константы
const CONFIG = {
  // Twitch OAuth — Implicit Grant Flow
  // ВАЖНО: создайте приложение на https://dev.twitch.tv/console/apps
  // OAuth Redirect URL должен быть: https://eendychan.github.io/chatterguesser/
  TWITCH_CLIENT_ID: 'ss3jhem8l4g1ansfbf50t46s1d7eao',
  TWITCH_REDIRECT_URI: 'https://eendychan.github.io/chatterguesser/',
  TWITCH_SCOPES: ['moderation:read', 'channel:read:vips'],

  // Канал, с которого парсятся логи по умолчанию (можно сменить через UI)
  LOGS_CHANNEL_DEFAULT: 'xah0b',
  LOGS_BASE_URL: 'https://logs.zonian.dev',

  // Готовые пресеты каналов — показываются в выпадающем списке "Свой канал"
  CHANNEL_PRESETS: [
    { login: 'xah0b', startDate: { year: 2025, month: 6, day: 14 } },
    { login: 'stintik', startDate: { year: 2024, month: 6, day: 15 } },
    { login: 'mazellovvv', startDate: { year: 2022, month: 11, day: 29 } },
    { login: 'cacto0o', startDate: { year: 2024, month: 9, day: 11 } },
    { login: 't2x2', startDate: { year: 2021, month: 10, day: 12 } },
    { login: 'bratishkinoff', startDate: { year: 2024, month: 7, day: 30 } },
    { login: '5opka', startDate: { year: 2024, month: 8, day: 4 } },
    { login: 'dragoniil_fff', startDate: { year: 2025, month: 1, day: 14 } },
    { login: 'winx_prinx', startDate: { year: 2026, month: 5, day: 15 } },
    { login: 'olesha', startDate: { year: 2023, month: 2, day: 10 } },
    { login: 'pwgood', startDate: { year: 2023, month: 11, day: 16 } },
  ],

  CUSTOM_LOGS_SITE_URL: 'https://tv.supa.sh/logs',
  LINKS_URL: 'https://bio.site/endychan',

  // CORS fallback — если прямой fetch не проходит, пробуем публичный прокси
  CORS_PROXY: 'https://corsproxy.io/?url=',

  // Начальная и крайняя (по умолчанию) дата логов
  LOGS_START_DATE: { year: 2025, month: 6, day: 14 },
  // Крайняя дата всегда вычисляется как "сегодня" в момент захода на сайт

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

    // Список ников, чьи сообщения никогда не участвуют в игре (боты и т.п.)
    // Вводится через пробел, хранится строкой для удобства редактирования в UI
    ignoredChatters: 'fossabot eendychan linkdrops nightbot potatbotat',
  },

  // Дефолтные списки модераторов/VIP-ов канала xah0b — используются как
  // fallback, если у авторизовавшегося пользователя нет прав на чтение
  // официального списка модов/VIP через Helix API для этого канала.
  DEFAULT_MODS: 'endychann mirronake 4poker_traxodrom adskiy_pro100_andrey ansstsia asasha54 cacto0o cottafruit exx1dae fiveskill fivfiv001 ghghh_ jojohf kwinkir makkkena mazellovvv mishellmer razdva stintik t2x2 xata_natata yaicafonk',

  DEFAULT_VIPS: 'adamsonshow avgust00086 birsenbergg bobrikww colevoy_228 cr1v0y dafevui daniluch__1337 dartmyaso_67 foklgts freneticmustdie glebasagentfsb hytaim i_nasya_2 janiksa4y karlonlyone klybnezhorka korkaflm kunai4ek kuperdb lilsemmi lowhpsher m1lyan makapohbl432 maksklassspaxan_67 mar0ka_67 mellsher meowh0cki misterpyatorka mratizzov nawsechka nazy_33 ne1kuri nepibaro olegus27 outsiderinc qbert_pepsico qwerti7777 rew1nder_ sh1nkaa_lina sisteofrock slaffneft slate993 spokoynich_ ssseki4_tromb_67 the_matr1xgg thepupus trap1n vanya_04 varpeee__ wew__we whykrawomi widze0 wiwertv__________________ wuweeie wwindyxx x1kon_ xlbodlx zela_pro',

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
    /^https:\/\//i,
    /\bwatched \d+ consecutive streams and sparked a watch streak!?\b/i,
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
