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

export function setLive(text) {
  LINE = String(text || '').slice(0, 160);
  AT = Date.now();
  pushHistory(LINE);
}

export function clearLive() {
  LINE = '';
  AT = 0;
}

export function getLive() {
  if (!LINE) return null;
  const ageSec = Math.floor((Date.now() - AT) / 1000);
  // Vieja no es "en vivo": si nadie la actualizó en 2 min, fuera.
  if (ageSec > 120) return null;
  return { line: LINE, ageSec };
}
