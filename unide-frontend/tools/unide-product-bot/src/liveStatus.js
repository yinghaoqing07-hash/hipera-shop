// Estado vivo COMPARTIDO para el panel JARVIS: cualquier flujo largo
// (rellenar el pedido web, Guardar/Enviar, promociones...) va marcando en
// qué paso está y el panel lo enseña en tiempo real junto al punto de
// estado — la misma línea donde el escritorio pinta sus pasos (aquello lo
// escribe unideges-search.ps1 en logs/desktop-estado.txt; esto es su
// equivalente en memoria para lo que corre dentro del propio bot).
// Convenciones: "[flujo] lo que hace…", "[flujo] listo" al acabar y
// "[flujo] ERROR: ..." si revienta (el panel lo pinta en rojo).
let LINE = '';
let AT = 0;

// Historial para el registro del panel (columna derecha): cada línea nueva
// se acumula con su hora. Consecutivas idénticas no se repiten.
const HISTORY = [];
function pushHistory(line) {
  const l = String(line || '').slice(0, 160);
  if (!l) return;
  const last = HISTORY[HISTORY.length - 1];
  if (last && last.line === l) return;
  HISTORY.push({ t: Date.now(), line: l });
  if (HISTORY.length > 400) HISTORY.splice(0, HISTORY.length - 400);
}

// Para las líneas que NO nacen aquí (las escribe el PS de escritorio en su
// fichero y el bot las ve al leerlo): solo acumular en el historial.
export function noteLive(line) {
  pushHistory(line);
}

export function getLiveLog(limit = 250) {
  return HISTORY.slice(-limit);
}

// Líneas del historial a partir de un instante (t en ms): la "traza" de una
// ejecución web para la caja negra y la evidencia de diagnóstico.
export function getLiveSince(ts) {
  const desde = Number(ts) || 0;
  return HISTORY.filter((h) => h.t >= desde).map((h) => h.line);
}

export function setLive(text) {
  LINE = String(text || '').slice(0, 160);
  AT = Date.now();
  pushHistory(LINE);
}

export function clearLive() {
  LINE = '';
  AT = 0;
}

// Captura que la IA está analizando AHORA: el panel la enseña sobre el
// registro mientras esté fresca (fundido de entrada y salida).
let SHOT = '';
let SHOT_AT = 0;
let SHOT_BUSY = false;

export function setLiveShot(path) {
  SHOT = String(path || '');
  SHOT_AT = SHOT ? Date.now() : 0;
  SHOT_BUSY = Boolean(SHOT);
}

// El análisis terminó: la foto se queda un rato pero deja de "latir".
export function liveShotDone() {
  SHOT_BUSY = false;
}

export function getLiveShot() {
  if (!SHOT) return null;
  const ageSec = Math.floor((Date.now() - SHOT_AT) / 1000);
  if (ageSec > 120) return null;
  return { path: SHOT, at: SHOT_AT, ageSec, busy: SHOT_BUSY };
}

export function getLive() {
  if (!LINE) return null;
  const ageSec = Math.floor((Date.now() - AT) / 1000);
  // Vieja no es "en vivo": si nadie la actualizó en 2 min, fuera.
  if (ageSec > 120) return null;
  return { line: LINE, ageSec };
}
