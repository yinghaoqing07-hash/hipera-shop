// =====================================================================
// FaqSection — Preguntas frecuentes (accordion)
// =====================================================================
// Acordeón clásico de preguntas habituales sobre el funcionamiento
// de HIPERA. Reemplaza al desaparecido bloque informativo de envío de
// la barra superior y absorbe esa información dentro de respuestas
// más detalladas con enlaces a las políticas legales correspondientes.
//
// Convenciones:
//   - Sólo un item abierto a la vez (estado: openIndex).
//   - Las respuestas pueden contener JSX (enlaces a /?legal=...).
//   - Los enlaces internos a páginas legales reciben handlers (no
//     <a href>) para evitar recargas de página y mantener el estado
//     de cliente (carrito, sesión, favoritos).
//
// Coherencia obligatoria con las políticas legales vigentes:
//   - Plazos / zonas      → Política de Envíos §2, §3
//   - Tarifa / umbral     → Política de Envíos §4
//   - Devoluciones        → Política de Devoluciones §2 (desistimiento)
//   - Garantía            → T&C §9 (3 años, 2 años segunda mano)
//   - Reparación          → T&C §10 + página /repair
// =====================================================================
import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { waLink } from '../config/contact';

export default function FaqSection({ onLegalClick, onRepairClick }) {
  const [openIndex, setOpenIndex] = useState(null);

  const faqs = [
    {
      q: '¿Cuál es el pedido mínimo?',
      a: (
        <>
          No hay pedido mínimo. La <strong>recogida en tienda es gratuita</strong>{' '}
          sin importe mínimo. En envío a domicilio la tarifa es de{' '}
          <strong>4,99 €</strong>, y a partir de <strong>40 €</strong> el envío
          es <strong>gratis</strong>.
        </>
      ),
    },
    {
      q: '¿Puedo recoger en tienda?',
      a: (
        <>
          Sí. Recogida <strong>gratuita y sin mínimo</strong> en Paseo del Sol 1,
          28880 Meco. Te avisamos cuando esté listo, normalmente en 2-4 horas.
        </>
      ),
    },
    {
      q: '¿Hacéis entrega a domicilio?',
      a: (
        <>
          Sí, repartimos en Meco y alrededores (radio de ~10 km), normalmente en
          24-72 horas. Consulta las zonas en nuestra{' '}
          <button
            type="button"
            onClick={() => onLegalClick('envios')}
            className="text-red-600 underline hover:text-red-700"
          >
            Política de Envíos
          </button>
          .
        </>
      ),
    },
    {
      q: '¿Cómo funcionan las devoluciones?',
      a: (
        <>
          Los productos no perecederos admiten devolución en{' '}
          <strong>14 días</strong>. Los frescos (carne, pescado, lácteos,
          congelados…) no admiten desistimiento por su naturaleza, pero
          siempre te devolvemos el dinero o lo reponemos si llega
          defectuoso, caducado o equivocado. Detalle completo en la{' '}
          <button
            type="button"
            onClick={() => onLegalClick('devoluciones')}
            className="text-red-600 underline hover:text-red-700"
          >
            Política de Devoluciones
          </button>
          .
        </>
      ),
    },
    {
      q: '¿Cómo contacto por WhatsApp?',
      a: (
        <>
          Escríbenos directamente por{' '}
          <a
            href={waLink('Hola, tengo una consulta sobre HIPERA.')}
            target="_blank"
            rel="noopener noreferrer"
            className="text-red-600 underline hover:text-red-700"
          >
            WhatsApp
          </a>{' '}
          para dudas sobre tu pedido, disponibilidad o reparaciones. Te
          respondemos rápido en horario de tienda (09:00 – 22:00).
        </>
      ),
    },
    {
      q: '¿También reparáis móviles?',
      a: (
        <>
          Sí, ofrecemos <strong>reparación profesional</strong> de móviles:
          cambio de pantalla, batería y diagnóstico. Elige tu modelo en el{' '}
          <button
            type="button"
            onClick={onRepairClick}
            className="text-red-600 underline hover:text-red-700"
          >
            Centro de Reparación
          </button>{' '}
          y pide presupuesto por WhatsApp.
        </>
      ),
    },
  ];

  return (
    <section className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
      <h2 className="font-bold text-xl text-center text-gray-900 mb-6">
        Preguntas frecuentes
      </h2>
      <div className="divide-y divide-gray-100">
        {faqs.map((faq, i) => {
          const isOpen = openIndex === i;
          return (
            <div key={i}>
              <button
                type="button"
                onClick={() => setOpenIndex(isOpen ? null : i)}
                aria-expanded={isOpen}
                aria-controls={`faq-panel-${i}`}
                className="w-full py-4 px-2 flex items-center justify-between text-left hover:bg-gray-50 transition-colors rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
              >
                <span className="text-sm font-medium text-gray-900 pr-3">
                  {faq.q}
                </span>
                <ChevronDown
                  size={18}
                  className={`text-red-600 transition-transform flex-shrink-0 ${isOpen ? 'rotate-180' : ''}`}
                />
              </button>
              {isOpen && (
                <div
                  id={`faq-panel-${i}`}
                  className="px-2 pb-4 text-sm text-gray-600 leading-relaxed"
                >
                  {faq.a}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
