// Board content: the Russian texts that explain tokens and the demo data of the editor patterns.
// No design values here — colours, sizes and type come from DESIGN.md through tokens.js.

// the reference cards of the Scapes style, served from the repository root (see README.md)
const REF = '../../../styles/scapes/references/';
export const CARDS = [
  { id: '017', name: 'Бутылка для воды', check: 'pass' },
  { id: '003', name: 'Уличный фонарь', check: 'pass' },
  { id: '024', name: 'Калькулятор', check: 'warn' },
  { id: '041', name: 'Вентилятор', check: 'pass' },
  { id: '055', name: 'Дверь с венком', check: 'pass' },
  { id: '068', name: 'Маяк', check: 'pass' },
  { id: '092', name: 'Пляжный зонт', check: 'pass' },
  { id: '101', name: 'Гитара', check: 'fail' },
  { id: '116', name: 'Батискаф', check: 'pass' },
  { id: '157', name: 'Гамак в саду', check: 'pass' },
  { id: '126', name: 'Карты', check: 'pass' },
  { id: '146', name: 'Открытка', check: 'warn' },
].map((c) => ({ ...c, src: `${REF}card-${c.id}.png` }));

export const CHECK = {
  pass: { word: 'PASS', title: 'Проверки библии пройдены' },
  warn: { word: 'WARN', title: 'Есть замечание — посмотрите глазами' },
  fail: { word: 'FAIL', title: 'Проверка не пройдена' },
};

// what each colour token is for, by job; the order of the board
export const COLOR_GROUPS = [
  { title: 'Воздух', note: 'страница и поверхности, на которых оценивают карточки', tokens: [
    ['background', 'Фон страницы, воздух вокруг сетки карточек'],
    ['surface', 'Панели, поля, строки очереди'],
    ['surface-sunken', 'Дорожки, оболочки переключателей, пустые места, заготовки'],
    ['line', 'Волосяные разделители — только декор'],
    ['line-strong', 'Кромка поля и бегунка, не меньше 3:1'],
  ] },
  { title: 'Чернила', note: 'текст; чёрного нет', tokens: [
    ['ink-1', 'Заголовки и основной текст'],
    ['ink-2', 'Вторичный текст, подписи полей'],
    ['ink-3', 'Пояснения, метки, номера'],
    ['ink-4', 'Только декор и неактивное — не для чтения'],
  ] },
  { title: 'Действие — фирменный зелёный', note: 'одно главное действие на экране', tokens: [
    ['accent', 'Заливка главной кнопки'],
    ['accent-hover', 'Главная кнопка при наведении'],
    ['on-accent', 'Текст на зелёном — тёмный, не белый'],
    ['accent-ink', 'Зелёный текст: слово PASS'],
    ['accent-tint', 'Подложка значка PASS'],
  ] },
  { title: 'Состояние — фирменный синий', note: 'выделение, фокус, ход работы, ссылки', tokens: [
    ['state', 'Кольцо выделения и фокуса, полоса хода, ползунок'],
    ['state-ink', 'Ссылки и текстовые кнопки'],
    ['state-tint', 'Выбранная строка, место для перетаскивания'],
  ] },
  { title: 'Внимание', note: 'WARN — янтарный (выведен), FAIL — фирменный красный', tokens: [
    ['warning', 'Точка предупреждения'],
    ['warning-ink', 'Текст предупреждения, слово WARN'],
    ['warning-tint', 'Подложка значка WARN'],
    ['error', 'Точка и полоса ошибки'],
    ['error-ink', 'Текст ошибки, слово FAIL'],
    ['error-tint', 'Подложка значка FAIL'],
  ] },
];

// window templates: the switcher's names; the swatch colour is a stand-in until the style supplies its templates
export const WINDOWS = [
  { id: 'blue', name: 'Синий', swatch: '#3A78E0' },
  { id: 'purple', name: 'Фиолетовый', swatch: '#8A55D6' },
  { id: 'crimson', name: 'Малиновый', swatch: '#D2416F' },
  { id: 'orange', name: 'Оранжевый', swatch: '#F08A2A' },
];

export const QUEUE = [
  { card: '017', name: 'Бутылка для воды', status: 'done', word: 'Готово', attempt: '1 / 3', p: 100, cost: '$0.04' },
  { card: '101', name: 'Гитара', status: 'work', word: 'Рисуется', attempt: '2 / 3', p: 62, cost: '$0.08' },
  { card: '055', name: 'Дверь с венком', status: 'fail', word: 'Не прошла проверки', attempt: '3 / 3', p: 100, cost: '$0.12' },
  { card: null, name: 'Сундук с картами', status: 'idle', word: 'В очереди', attempt: '— / 3', p: 0, cost: '—' },
];

export const LOG = [
  { t: '14:02:11', k: 'done', m: 'Бутылка для воды: готово с первой попытки' },
  { t: '14:02:40', k: 'work', m: 'Гитара: попытка 2 из 3 — модель рисует' },
  { t: '14:03:05', k: 'warn', m: 'Калькулятор: фон светлее нормы библии' },
  { t: '14:03:52', k: 'fail', m: 'Дверь с венком: 3 попытки не прошли проверки, нужен взгляд человека' },
  { t: '14:04:10', k: 'idle', m: 'Сундук с картами: ждёт очереди' },
];

export const VARIANTS = [
  { name: 'Вариант A', cards: ['017', '003', '024', '041', '055', '068', '092', '101', '116', '157'] },
  { name: 'Вариант B', cards: ['041', '126', '003', '092', '017', '146', '068', '055', '157', '116'] },
  { name: 'Вариант C', cards: ['126', '146', '017', '068', '003', '092', '024', '041', '101', '157'] },
];
