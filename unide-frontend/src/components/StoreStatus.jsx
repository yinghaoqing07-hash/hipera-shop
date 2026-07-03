// Componentes de estado de tienda (la lógica de horario vive en
// src/utils/storeStatus.js para poder reutilizarla sin montar UI).
import { useEffect, useState } from 'react';
import { Clock } from 'lucide-react';
import { getStoreStatus } from '../utils/storeStatus';

// =====================================================================
// StoreInfoBar — banda discreta bajo el Header en la página de inicio
// que muestra si el establecimiento físico está abierto o cerrado en
// este momento, junto al tiempo restante hasta el siguiente cambio de
// estado. La cadena se recalcula cada 60 s con setInterval.
// =====================================================================
export function StoreInfoBar() {
  const [status, setStatus] = useState(() => getStoreStatus());

  useEffect(() => {
    const id = setInterval(() => setStatus(getStoreStatus()), 60000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="bg-white border-b border-gray-100">
      <div className="px-4 py-2 flex items-center gap-2 text-xs">
        <span
          aria-hidden="true"
          className={`inline-block w-2 h-2 rounded-full ${status.isOpen ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`}
        />
        <span aria-live="polite" className="font-medium text-gray-800">
          {status.label}
        </span>
      </div>
    </div>
  );
}

// =====================================================================
// AfterHoursNotice — aviso para clientes que compran fuera de horario
// =====================================================================
// El StoreInfoBar muestra el estado de forma discreta en home, pero
// alguien que llega directo al carrito o al checkout fuera de horario
// puede no haberlo visto. Este componente es un banner más visible
// que aparece SOLO cuando la tienda está cerrada, en las páginas
// donde la expectativa de tiempo es crítica (cart / checkout).
//
// Decisión de diseño: NO bloqueamos la compra. Eso destruiría
// conversión y va contra LSSI Art. 27 (el comercio puede aceptar
// pedidos 24/7 mientras los confirme cuando proceda). Nos limitamos
// a informar de cuándo se procesará realmente el pedido, para que
// el cliente no se quede esperando a media noche pensando que llega
// en una hora.
// =====================================================================
export function AfterHoursNotice({ context = 'cart' }) {
  const [status, setStatus] = useState(() => getStoreStatus());

  useEffect(() => {
    const id = setInterval(() => setStatus(getStoreStatus()), 60000);
    return () => clearInterval(id);
  }, []);

  if (status.isOpen) return null;

  const ctxLabel = context === 'checkout'
    ? 'Tu pedido se procesará'
    : 'Los pedidos hechos fuera de horario se procesan';

  return (
    <div
      role="status"
      aria-live="polite"
      className="bg-amber-50 border border-amber-200 rounded-xl p-3 flex items-start gap-2.5 text-amber-900"
    >
      <Clock size={18} className="text-amber-600 mt-0.5 flex-shrink-0" aria-hidden="true" />
      <div className="text-sm leading-relaxed">
        <p className="font-semibold mb-0.5">Estamos cerrados ahora mismo</p>
        <p className="text-amber-800">
          {ctxLabel} <strong>{status.nextOpenLabel}</strong> cuando abramos. Horario habitual: <strong>09:00 – 22:00</strong>.
          {context === 'checkout' && ' Puedes completar el pedido con normalidad.'}
        </p>
      </div>
    </div>
  );
}
