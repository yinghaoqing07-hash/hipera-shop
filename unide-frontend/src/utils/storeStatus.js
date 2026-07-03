// =====================================================================
// Estado de apertura de la tienda física (zona horaria Europe/Madrid)
// =====================================================================
// Horarios cableados (deben coincidir con COMPANY.hours y con el
// "openingHoursSpecification" del JSON-LD en index.html):
//   - Apertura: 09:00
//   - Cierre:   22:00
//   - Días:     Lunes a Domingo (sin variación semanal)
//
// Importante: usamos minutos enteros para que la frontera sea precisa
// (22:00 cierra justo a las 22:00, no se considera cerrado a las
// 21:59). El navegador del cliente puede estar en cualquier huso
// horario; convertimos a Europe/Madrid antes de comparar para que un
// cliente conectado desde, p. ej., Estados Unidos vea coherente la
// disponibilidad real del comercio.
// =====================================================================
export const STORE_OPEN_HOUR = 9;    // 09:00
export const STORE_CLOSE_HOUR = 22;  // 22:00 (último minuto operativo: 21:59)

// Devuelve { hour, minute } del momento `date` en zona Europe/Madrid,
// independientemente de la zona horaria del navegador. Usamos
// Intl.DateTimeFormat con 'es-ES' y `timeZone: 'Europe/Madrid'`. Es
// barato (no requiere parser custom) y maneja DST automáticamente.
function getMadridHM(date) {
  const fmt = new Intl.DateTimeFormat('es-ES', {
    timeZone: 'Europe/Madrid',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = fmt.formatToParts(date);
  const hh = parts.find(p => p.type === 'hour')?.value || '00';
  const mm = parts.find(p => p.type === 'minute')?.value || '00';
  return { hour: parseInt(hh, 10), minute: parseInt(mm, 10) };
}

// Hora de corte para la preparación EN EL DÍA de los pedidos de recogida
// en tienda. DEBE coincidir con Política de Envíos §3.2: los pedidos
// confirmados a partir de esta hora (hora peninsular) se preparan al día
// hábil siguiente.
const PICKUP_SAMEDAY_CUTOFF_HOUR = 20; // 20:00

// Devuelve un aviso sobre cuándo estará listo un pedido de RECOGIDA
// confirmado AHORA, o null si cae dentro de la franja de preparación del
// mismo día (09:00–20:00, hora de Madrid). Coherente con Política de
// Envíos §3.2. Dos casos fuera de franja:
//   • Antes de la apertura (< 09:00): se prepara hoy al abrir.
//   • A partir de las 20:00: se prepara el día hábil siguiente.
export function getPickupReadinessNote(now = new Date()) {
  const { hour, minute } = getMadridHM(now);
  const m = hour * 60 + minute;
  if (m >= STORE_OPEN_HOUR * 60 && m < PICKUP_SAMEDAY_CUTOFF_HOUR * 60) return null;
  if (m < STORE_OPEN_HOUR * 60) {
    return 'Ahora estamos cerrados. Tu pedido para recoger se preparará hoy en cuanto abramos (09:00); te avisaremos por email cuando esté listo.';
  }
  return 'Ya pasan de las 20:00. Tu pedido para recoger se preparará el día hábil siguiente; te avisaremos por email cuando esté listo.';
}

// Devuelve el estado operativo de la tienda en este momento. La forma
// del objeto se mantuvo retro-compatible con el StoreInfoBar previo
// (isOpen + label), añadiendo campos adicionales que aprovechan los
// avisos de checkout/cart/email:
//
//   isOpen        — booleano principal
//   label         — texto humano: "Abierto · Cierra en 3h 12m" / etc.
//   minutesToOpen — cuánto falta para abrir (0 si ya está abierto)
//   nextOpenLabel — "hoy a las 09:00" / "mañana a las 09:00"
export function getStoreStatus(now = new Date()) {
  const { hour, minute } = getMadridHM(now);
  const minuteOfDay = hour * 60 + minute;
  const openMinute = STORE_OPEN_HOUR * 60;
  const closeMinute = STORE_CLOSE_HOUR * 60;
  const isOpen = minuteOfDay >= openMinute && minuteOfDay < closeMinute;

  if (isOpen) {
    const minutesToClose = closeMinute - minuteOfDay;
    const h = Math.floor(minutesToClose / 60);
    const m = minutesToClose % 60;
    const remaining = h > 0 ? `${h}h ${m}m` : `${m}m`;
    return {
      isOpen: true,
      label: `Abierto · Cierra en ${remaining}`,
      minutesToOpen: 0,
      nextOpenLabel: `hoy a las ${String(STORE_OPEN_HOUR).padStart(2, '0')}:00`,
    };
  }

  // Cerrado: calculamos cuánto falta para que abra. Dos casos:
  //   • Antes de las 09:00 → abre hoy a las 09:00
  //   • Entre 22:00 y 23:59 → abre mañana a las 09:00
  const beforeOpening = minuteOfDay < openMinute;
  const minutesToOpen = beforeOpening
    ? openMinute - minuteOfDay
    : 24 * 60 - minuteOfDay + openMinute;
  const openWhen = beforeOpening ? 'hoy' : 'mañana';
  const h = Math.floor(minutesToOpen / 60);
  const m = minutesToOpen % 60;
  const remaining = h > 0 ? `${h}h ${m}m` : `${m}m`;

  return {
    isOpen: false,
    label: `Cerrado · Abre ${openWhen} a las ${String(STORE_OPEN_HOUR).padStart(2, '0')}:00 (en ${remaining})`,
    minutesToOpen,
    nextOpenLabel: `${openWhen} a las ${String(STORE_OPEN_HOUR).padStart(2, '0')}:00`,
  };
}

