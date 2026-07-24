import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
export const toolRoot = path.resolve(path.dirname(__filename), '..');

const defaultOrderApplySteps = [
  { type: 'focus' },
  { type: 'click', name: 'Nuevo pedido', x: 327, y: 177 },
  { type: 'wait', ms: 1000 },
  { type: 'setField', name: 'Nombre del Pedido', x: 486, y: 267, value: '{{orderName}}' },
  { type: 'wait', ms: 300 },
  { type: 'click', name: 'Primera linea articulo', x: 694, y: 615 },
  { type: 'wait', ms: 200 },
  {
    type: 'orderLines',
    selectKeys: '{ENTER}',
    quantityKeys: '{TAB}',
    finishLineKeys: '{ENTER}{ENTER}',
    autocompleteMs: 700,
    selectedMs: 300,
    betweenLinesMs: 700
  },
  { type: 'screenshot', name: 'Order filled screenshot' }
];

const defaultConfig = {
  telegram: {
    allowedChatIds: [],
    pollTimeoutSeconds: 25,
    maxItemsPerMessage: 5
  },
  supplierCsv: 'data/supplier_products_clean.csv',
  storeCsv: 'data/store_products_clean.csv',
  logsDir: 'logs',
  llm: {
    enabled: true,
    provider: '',              // '' = Claude (Anthropic); 'kimi' = Kimi/Moonshot (API compatible OpenAI, mejor precio)
    apiKey: '',                // o variables de entorno ANTHROPIC_API_KEY / MOONSHOT_API_KEY
    baseUrl: '',               // kimi: https://api.moonshot.ai/v1 (internacional; China: api.moonshot.cn)
    model: '',                 // kimi: por defecto 'kimi-latest'; claude: 'claude-opus-4-8'
    visionModel: '',           // kimi: modelo para MIRAR capturas ('' = el mismo model)
    // Personalidad del bot: va en TODOS los prompts que redactan texto para
    // la dueña. Editable en caliente con /estilo (persiste en logs/).
    personalidad: '干脆利落的贫嘴老伙计。像在店里搭档了十年的老伙计那样说话：直接、简短、偶尔调侃一句，但正事永远第一时间说清楚。绝对禁止：「我是小助手」这类自我介绍、每次罗列一遍功能菜单、客套话和空洞的欢迎语、连环感叹号。有数据就直接报数据，没事就一句话收尾。可以叫用户「老板」。',
    allRepliesViaApi: true,
    replyTimeoutMs: 60000,
    replyMaxTokens: 2400
  },
  // Bucle semi-automatico de reparacion: al fallar una accion de UnideGes
  // se empaqueta la evidencia (caja negra + capturas + codigo + ultimo
  // exito), el modelo la diagnostica y la propuesta llega a Telegram con
  // botones. NADA se aplica sin confirmar; maxCiclos y a humano.
  diagnostico: {
    enabled: true,
    maxCiclos: 2
  },
  // GitHub: para que el bucle de diagnostico proponga su reparacion como PR
  // revisable en vez de solo parchear el PC. NUNCA toca main: crea una rama
  // y abre el PR; el merge es SIEMPRE humano. Token en config.github.token o
  // env GITHUB_TOKEN — usa un PAT FINO: solo este repo, permisos Contents +
  // Pull requests (read/write). Sin token, el boton de PR no aparece.
  github: {
    token: '',
    repo: 'yinghaoqing07-hash/hipera-shop',
    base: 'main',
    repoPathPrefix: 'unide-frontend/tools/unide-product-bot'
  },
  memory: {
    enabled: true,
    path: 'data/bot-memory.json',
    autoLearn: true,
    autoNotify: false,
    maxEntries: 500,
    contextLimit: 12,
    extractionTimeoutMs: 45000
  },
  operationLedger: {
    enabled: true,
    path: 'data/operation-ledger.json',
    maxEntries: 10000,
    timeZone: 'Europe/Madrid',
    importRecentChat: true
  },
  scheduledTasks: {
    enabled: true,
    path: 'data/scheduled-tasks.json',
    timeZone: 'Europe/Madrid',
    maxEntries: 500,
    maxLateMinutes: 360
  },
  ordering: {
    enabled: true,
    timezone: 'Europe/Madrid',
    reminderTime: '10:00',
    reminderWindowMinutes: 180,
    reminderChatIds: []
  },
  // Lista de comprobación de LLEGADA: los pedidos que el bot rellena se
  // registran en logs/orders-history.json; el día estimado de llegada
  // (fecha del pedido + offsetDays) se imprime una lista con casillas en
  // la impresora del PC y se manda también por Telegram. /llegada la
  // saca a demanda.
  arrival: {
    enabled: true,
    printTime: '08:30',        // hora local (Europe/Madrid) de impresión
    windowMinutes: 180,        // margen si el PC estaba apagado a esa hora
    offsetDays: 2,             // pedido lunes → llega miércoles, etc.
    printerName: '',           // '' = impresora predeterminada de Windows
    autoPrint: true,           // false = solo Telegram, sin imprimir
    chatIds: [],               // vacío = los de ordering.reminderChatIds
    excludeStates: ['Alta'],   // estados que NO llegan (Alta = borrador)
    maxOrders: 8               // tope de pedidos a abrir por día
  },
  // /promociones: lee la lista de Promociones de UnideGes, filtra las NO
  // caducadas (por fecha Hasta/Fin) y abre cada una para sacar sus
  // artículos; escribe un CSV y manda un resumen. Solo lectura: nunca
  // guarda ni modifica. Los tiempos son configurables por si la red va
  // lenta; los que preceden a una espera con sondeo se dejan cortos.
  promotions: {
    listUrl: '',               // vacío = probar menú + URLs candidatas
    candidatePaths: [],        // vacío = lista interna de rutas *_ListView
    maxPreview: 25,            // filas de muestra en el mensaje (el CSV va completo)
    maxPages: 50,              // tope de páginas de la lista
    maxDetailPromotions: 500,  // tope de promociones que se abren al detalle
    detailOpenMs: 400,         // gracia tras abrir el detalle (luego se sondea)
    pageTurnMs: 1200,          // entre páginas de la lista
    detailPageTurnMs: 1600,    // entre páginas del detalle (evita releer la página vieja)
    detailRowsTimeoutMs: 9000, // espera MÁX a que aparezcan las filas del detalle
    detailOpenTimeoutMs: 3000, // espera del 1er clic (simple) antes de probar doble clic
    rowWaitMs: 3000,           // espera a que la fila aparezca en la página actual
    outputDir: 'promotions'    // carpeta del CSV (junto al bot)
  },
  desktop: {
    enabled: false,
    script: 'desktop/unideges-search.ps1',
    windowTitleRegex: 'UNIDEGES|Articulos|Artículos',
    excludedProcessNames: ['chrome', 'msedge', 'firefox'],
    screenshotDir: 'screenshots',
    expectedScreen: { width: 0, height: 0 },
    steps: [],
    // Búsqueda por CÓDIGO (fruta/verdura): en Artículos el código no se teclea
    // en el catalejo/EAN sino en su propio campo "Código". Si se calibra aquí
    // (focus → click en el campo Código → text {{query}} → Enter), el cambio
    // de precio de fruta usa estos pasos; si se deja vacío, cae en `steps`
    // (el catalejo de siempre), sin romper nada.
    codeSearchSteps: [],
    orderApplySteps: defaultOrderApplySteps
  },
  // Menú principal de la app de escritorio UnideGes (ventana "MadisaNet"):
  // el bot puede abrirla, traerla al frente y entrar a los módulos por su
  // tecla F (F1 Inicio de día, F3 Artículos, F6 Utilidades, F7 Albaranes,
  // F12 Fin de día) — comando /unideges. exePath vacío = buscar un acceso
  // directo (madisa|unide) en el Escritorio o el Menú Inicio.
  unideges: {
    script: 'desktop/unideges-menu.ps1',
    menuTitleRegex: '^MadisaNet',
    exePath: '',
    shortcutRegex: 'madisa|unide',
    loginUser: '1'             // diálogo de acceso: usuario + Enter x2; '' = no auto-login
  },
  // Panel de escritorio: mini web SOLO en 127.0.0.1 con botones para las
  // acciones diarias. panel.cmd la abre en el navegador del PC de la tienda.
  panel: {
    enabled: true,
    port: 8765,
    // Acceso remoto (móvil) vía Cloudflare Tunnel + Access. El panel SIGUE
    // atado a 127.0.0.1; cloudflared corre en el mismo PC y lo saca fuera,
    // con Cloudflare Access de portero. Cuando 'remotoEmails' tiene correos,
    // toda petición que llegue con la cabecera de Access
    // (Cf-Access-Authenticated-User-Email, que Cloudflare inyecta y el
    // navegador local NUNCA trae) debe pertenecer a esa lista; si no, 403.
    // Vacío = comportamiento de siempre (solo local, sin puerta).
    remotoEmails: []
  },
  // Tarea diaria automática: a esta hora el bot refresca las promociones y
  // busca pedidos PDA nuevos; si hay, corre /ahorro_pedido solo y manda el
  // resultado a los chats de arrival/ordering. Necesita webOrder.enabled y
  // el Edge en modo depuración abierto.
  autoAdvisor: {
    enabled: true,
    time: '07:15',             // hora local MÁS TEMPRANA; corre al primer arranque del día pasada esta hora
    windowMinutes: 0,          // 0 = sin límite superior (el PC se enciende cuando se enciende)
    lookbackDays: 2            // qué tan atrás mirar pedidos PDA nuevos
  },
  // Automatización de Pedidos por NAVEGADOR (Edge) vía CDP.
  // Pedidos es una página web (DevExpress XAF: unideges30.unide.es),
  // no la app de escritorio; por eso se conduce el DOM directamente,
  // no con clics por coordenadas. Se conecta a un Edge lanzado con
  // --remote-debugging-port (ver desktop/launch-edge-debug.cmd).
  //   enabled            → si true, el botón "确认填入" usa el navegador.
  //   debugUrl           → endpoint de depuración del Edge dedicado.
  //   pageUrlIncludes    → subcadena para localizar la pestaña correcta.
  //   dumpFile           → dónde vuelca /pedido_web_test el HTML de la página.
  webOrder: {
    enabled: false,
    debugUrl: 'http://127.0.0.1:9222',
    pageUrlIncludes: 'unideges',
    dumpFile: 'order-page-dump.html',
    // Tiempos de espera (ms) del rellenado de líneas. Subir si la red/el
    // servidor van lentos y el autocompletado tarda en aparecer.
    formRenderMs: 2800,        // tras pulsar "Nuevo", esperar el DetailView
    autocompleteTimeoutMs: 5000, // espera MÁX a que aparezca el desplegable
    autocompleteMs: 900,       // espera tras aparecer, para que cargue todo
    betweenLinesMs: 400,       // entre línea y línea (poll de la fila nueva cubre el resto)
    // Navegación a la lista de Pedidos (page.goto directo, no clic en menú).
    pageNavigationTimeoutMs: 20000, // espera MÁX a que cargue la lista
    pedidoListUrl: '',         // vacío = derivar del origen + /OrderT_ListView
    // Búsqueda por nombre: máximo de opciones a devolver para que elijas.
    maxSearchOptions: 20,
    // Conexión CDP: margen por si la pestaña estaba dormida y reintentos.
    protocolTimeoutMs: 90000,
    connectRetries: 3,
    // Espera tras elegir el artículo, para que Blazor enlace la fila antes
    // de confirmarla (evita líneas con Código Unide en blanco). Mantener
    // generosa: prevenir un blanco es más rápido que dispararle la reparación.
    selectSettleMs: 500,
    nextFieldMs: 140,          // Tab artículo→Cajas antes de teclear la cantidad
    // Si una línea queda en blanco igualmente, repararla sola con el gesto
    // del usuario (lápiz Editar → reescribir código → Enter Enter).
    repairBlankLines: true
  }
};

export function loadDotEnv(envPath = path.join(toolRoot, '.env')) {
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const index = line.indexOf('=');
    if (index === -1) continue;
    const key = line.slice(0, index).trim();
    const value = line.slice(index + 1).trim().replace(/^["']|["']$/g, '');
    if (!process.env[key]) process.env[key] = value;
  }
}

export function resolveToolPath(value) {
  if (!value) return value;
  if (path.isAbsolute(value)) return value;
  return path.resolve(toolRoot, value);
}

export function loadConfig(configPath) {
  loadDotEnv();

  const configFile = configPath ? path.resolve(configPath) : path.join(toolRoot, 'config.local.json');
  const userConfig = fs.existsSync(configFile)
    ? JSON.parse(fs.readFileSync(configFile, 'utf8').replace(/^\uFEFF/, ''))
    : {};

  const config = mergeDeep(defaultConfig, userConfig);
  config.__configFile = configFile;
  config.__toolRoot = toolRoot;
  config.supplierCsv = resolveToolPath(config.supplierCsv);
  config.storeCsv = resolveToolPath(config.storeCsv);
  config.logsDir = resolveToolPath(config.logsDir);
  config.memory.path = resolveToolPath(config.memory.path);
  config.operationLedger.path = resolveToolPath(config.operationLedger.path);
  config.scheduledTasks.path = resolveToolPath(config.scheduledTasks.path);
  config.desktop.script = resolveToolPath(config.desktop.script);
  config.unideges.script = resolveToolPath(config.unideges.script);
  config.desktop.screenshotDir = resolveToolPath(config.desktop.screenshotDir);
  normalizeDesktopDefaults(config);

  tryMkdir(config.logsDir);
  tryMkdir(path.dirname(config.memory.path));
  tryMkdir(path.dirname(config.operationLedger.path));
  tryMkdir(path.dirname(config.scheduledTasks.path));
  tryMkdir(config.desktop.screenshotDir);

  return config;
}

function normalizeDesktopDefaults(config) {
  if (
    !Array.isArray(config.desktop.orderApplySteps) ||
    isZeroCoordinateOrderFlow(config.desktop.orderApplySteps) ||
    isLegacyOrderFlow(config.desktop.orderApplySteps)
  ) {
    config.desktop.orderApplySteps = defaultOrderApplySteps;
  }
}

function isZeroCoordinateOrderFlow(steps) {
  const coordinateSteps = steps.filter((step) => ['click', 'setField'].includes(step?.type));
  if (!coordinateSteps.length) return false;
  return coordinateSteps.every((step) => Number(step.x || 0) === 0 || Number(step.y || 0) === 0);
}

function isLegacyOrderFlow(steps) {
  const hasOrderLines = steps.some((step) => step?.type === 'orderLines');
  const hasNuevoClick = steps.some((step) => step?.type === 'click' && /nuevo/i.test(String(step.name || '')));
  return hasOrderLines && !hasNuevoClick;
}

function tryMkdir(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {
    // The logger and desktop scripts will continue without blocking startup.
  }
}

function mergeDeep(base, override) {
  if (Array.isArray(base) || Array.isArray(override)) {
    return override === undefined ? base : override;
  }
  if (!isPlainObject(base) || !isPlainObject(override)) {
    return override === undefined ? base : override;
  }
  const output = { ...base };
  for (const [key, value] of Object.entries(override)) {
    output[key] = mergeDeep(base[key], value);
  }
  return output;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function readArg(name, fallback = undefined) {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  return process.argv[index + 1] ?? fallback;
}


