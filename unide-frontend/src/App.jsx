// jsPDF + jspdf-autotable + qrcode ahora se cargan a demanda desde
// src/utils/orderDocuments.js (dynamic import) cuando el cliente pulsa
// "Descargar factura/ticket". Mantener estos imports estáticos antes
// metía ~700 KB de PDF tooling en el bundle inicial de la home, pese
// a que la mayoría de visitantes no descarga ningún PDF.
//
// Si necesitas generar PDFs en un nuevo lugar:
//   const { generateDocuments } = await import('./utils/orderDocuments');
//   await generateDocuments(order, 'both');
import { Download } from "lucide-react"; // 记得确保引入了 Download 图标
import { supabase, clearSupabaseLocalSession } from './supabaseClient'; // 保留用于用户认证
import { apiClient } from './api/client'; // 新增：API客户端
import CookieConsent from './components/CookieConsent';
import { useCookieConsent } from './hooks/useCookieConsent';
import { TurnstileGate } from './components/TurnstileGate';
import AddressAutocomplete from './components/AddressAutocomplete';
import TerminosCondiciones from './pages/legal/TerminosCondiciones';
import PoliticaPrivacidad from './pages/legal/PoliticaPrivacidad';
import PoliticaDevoluciones from './pages/legal/PoliticaDevoluciones';
import PoliticaEnvios from './pages/legal/PoliticaEnvios';
import PoliticaCookies from './pages/legal/PoliticaCookies';
import AvisoLegal from './pages/legal/AvisoLegal';
import { TERMS_VERSION, PRIVACY_VERSION } from './config/legal';
import {
  recordAcceptance as recordTermsAcceptance,
  getLatestAcceptance as getLatestTermsAcceptance,
  needsReacceptance as needsTermsReacceptance,
} from './utils/termsAcceptance';
import React, { useCallback, useEffect, useRef, useState } from "react";
import { 
  ShoppingCart, Search, Package, MapPin, Clock, ArrowLeft, ArrowRight,
  Tag, Trash2, ChevronRight, ChevronDown, Home, Gift, Truck, Store, Heart,
  Utensils, Coffee, Apple, Baby, Loader2, Wrench, Smartphone,
  LayoutGrid, Percent, ClipboardList, User, LogOut, Plus, Minus, X, CreditCard, Lock, LogIn,
  Cookie, ShieldCheck, FileText, Info, Users, Wallet, CheckCircle2, RotateCcw, Phone, Mail,
  // --- 新增的超市分类图标 ---
  Beef, Fish, Milk, Wheat, Croissant, Sandwich, Droplet, Candy, 
  Wine, Beer, Salad, Globe, Bone, BriefcaseMedical,
  Snowflake, ShowerHead, SprayCan
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import toast, { Toaster } from 'react-hot-toast';

// Banners servidos desde /public/banners (Vercel CDN, mismo origen).
// El carrusel rota automáticamente sobre BANNERS.length, así que ajustar
// este array es la única operación necesaria para añadir/quitar imágenes.
//
// Estructura por banner:
//   - src           Ruta del archivo (relativa a /public).
//   - alt           Texto alternativo (obligatorio por accesibilidad y SEO).
//   - headline      Array de líneas que se renderiza como <span/> apiladas.
//   - badge         Etiqueta superior pequeña (texto en mayúsculas).
//   - target        Página de destino al hacer clic (acepta cualquier valor
//                   válido para navTo: 'offers', 'main', 'repair', etc.).
//   - selfContained Si true, la imagen YA trae su propio texto/diseño, así
//                   que NO se superpone el overlay (badge + headline +
//                   degradado oscuro). Se ignoran headline/badge.
//
// TODO (post Phase 1): sustituir las imágenes genéricas por fotos reales
// del establecimiento (estanterías, caja, mostrador de reparación).
const BANNERS = [
  {
    src: "/banners/banner-bienvenida.jpg",
    alt: "Bienvenid@ a HIPERA — usa BIENVENIDA10 (10% clientes registrados) o BIENVENIDA5 (5% todos los clientes) en compras desde 30€, y elige un producto gratis en compras desde 65€",
    selfContained: true,
    target: "offers",
  },
  {
    src: "/banners/banner-reparacion.jpg",
    alt: "Reparación de móviles en HIPERA — servicio oficial, cambio de pantalla y batería de todas las marcas, cita previa y consulta de precio por WhatsApp",
    selfContained: true,
    target: "repair",
  },
  // Imágenes genéricas anteriores (banner-1.jpg / banner-2.jpg) retiradas
  // del carrusel a favor de los banners de marca. Los archivos siguen en
  // /public/banners por si se quieren reutilizar en el futuro.
];

// Aviso de vigencia de la promoción bajo el carrusel. El resto de
// condiciones (mínimo, registro, uso único) ya van impresas en la propia
// imagen del banner, así que aquí dejamos sólo la fecha límite para no
// recargar la interfaz.
//
// ⚠️ La fecha DEBE coincidir con `expiresAt` de BIENVENIDA10/BIENVENIDA5
// en backend/services/coupons.js. Si cambias la campaña, actualiza AMBOS
// sitios. Mantener la fecha aquí (y no dentro de la imagen) evita rehacer
// el banner y descarta el riesgo de fecha anunciada ≠ fecha real.
const PROMO_NOTICE = 'Promoción de bienvenida válida hasta el 30/08/2026.';

const ProductSkeleton = () => (
  <div className="bg-white p-3 rounded-xl shadow-sm border border-gray-100 animate-pulse">
    <div className="w-full aspect-square bg-gray-200 rounded-lg mb-2"></div>
    <div className="h-4 bg-gray-200 rounded w-3/4 mb-2"></div>
    <div className="h-6 bg-gray-200 rounded w-1/2"></div>
  </div>
);

// =====================================================================
// StoreInfoBar — estado de apertura de la tienda física
// =====================================================================
// Banda discreta bajo el Header en la página de inicio que muestra si
// el establecimiento físico está abierto o cerrado en este momento,
// junto al tiempo restante hasta el siguiente cambio de estado.
//
// La información detallada de envío (tarifas, plazos, recogida gratis)
// se ha trasladado a la sección "Preguntas frecuentes" (FaqSection),
// que la presenta en formato accordion y permite incluir respuestas
// más completas con enlaces a la Política de Envíos.
//
// Horarios cableados (deben coincidir con COMPANY.hours y con el
// "openingHoursSpecification" del JSON-LD en index.html):
//   - Apertura: 09:00
//   - Cierre:   22:00
//   - Días:     Lunes a Domingo (sin variación semanal)
//
// La cadena de estado se recalcula cada 60 s con setInterval para
// reflejar el paso del tiempo sin necesidad de recargar la página.
// =====================================================================

// =====================================================================
// Horario operativo de la tienda física (zona horaria Europe/Madrid)
// =====================================================================
// Los valores DEBEN coincidir con:
//   - COMPANY.hours (config/company.js)
//   - openingHoursSpecification del JSON-LD (index.html)
//   - Política de Envíos §3 (plazo de preparación)
//
// Importante: usamos minutos enteros para que la frontera sea precisa
// (22:00 cierra justo a las 22:00, no se considera cerrado a las
// 21:59). El navegador del cliente puede estar en cualquier huso
// horario; convertimos a Europe/Madrid antes de comparar para que un
// cliente conectado desde, p. ej., Estados Unidos vea coherente la
// disponibilidad real del comercio.
// =====================================================================
const STORE_OPEN_HOUR = 9;    // 09:00
const STORE_CLOSE_HOUR = 22;  // 22:00 (último minuto operativo: 21:59)

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

// =====================================================================
// Tarifas operativas de envío — single source of truth
// =====================================================================
// Estos valores DEBEN COINCIDIR EXACTAMENTE con los publicados en la
// Política de Envíos §4.1 (tarifa única) y §4.3 (umbral gratuito). El
// histórico previo cobraba 4,50 € con umbral 50 € en el código, pero
// la documentación legal (T&C §7, Política de Envíos, Política de
// Devoluciones §5.5, FaqSection) ya establecía 4,99 € / 40 €. La
// inconsistencia se corrigió el 2026-05-25 alineando el código a la
// documentación.
//
// Cualquier modificación futura requiere actualización síncrona en:
//   - PoliticaEnvios.jsx §4.1 (tarifa) y §4.3 (umbral)
//   - PoliticaDevoluciones.jsx §5.5 (matriz reembolso de envío)
//   - FaqSection (este archivo, respuesta "¿Cuánto cuesta el envío?")
//   - SHIPPING_VERSION en config/legal.js (bump al cambiar valores)
// =====================================================================
const SHIPPING_FEE_STANDARD = 4.99;
const FREE_SHIPPING_THRESHOLD = 40;

// Devuelve el estado operativo de la tienda en este momento. La forma
// del objeto se mantuvo retro-compatible con el StoreInfoBar previo
// (isOpen + label), añadiendo campos adicionales que aprovechan los
// avisos de checkout/cart/email:
//
//   isOpen        — booleano principal
//   label         — texto humano: "Abierto · Cierra en 3h 12m" / etc.
//   minutesToOpen — cuánto falta para abrir (0 si ya está abierto)
//   nextOpenLabel — "hoy a las 09:00" / "mañana a las 09:00"
//
// Convertimos a Europe/Madrid antes de comparar para que un cliente
// conectado desde otro huso horario vea coherente la disponibilidad
// real del comercio.
function getStoreStatus(now = new Date()) {
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

function StoreInfoBar() {
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
function AfterHoursNotice({ context = 'cart' }) {
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

// =====================================================================
// FaqSection — Preguntas frecuentes (accordion)
// =====================================================================
// Acordeón clásico de 8 preguntas habituales sobre el funcionamiento
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

function FaqSection({ onLegalClick, onRepairClick }) {
  const [openIndex, setOpenIndex] = useState(null);

  const faqs = [
    {
      q: '¿Cómo hago un pedido?',
      a: (
        <>
          Navega por las categorías o usa el buscador para encontrar lo que
          necesitas, añade los productos al carrito y completa el proceso de
          compra. Recibirás un correo electrónico con la confirmación del
          pedido y los detalles de entrega.
        </>
      ),
    },
    {
      q: '¿Hasta dónde repartís?',
      a: (
        <>
          Realizamos envío a domicilio en Meco y poblaciones cercanas dentro
          de un radio de aproximadamente 10 km. Consulta la lista completa de
          zonas cubiertas en nuestra{' '}
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
      q: '¿Puedo recoger en tienda?',
      a: (
        <>
          Sí. La recogida en tienda es <strong>gratuita y sin importe mínimo</strong>{' '}
          en Paseo del Sol 1, 28880 Meco. Te avisaremos cuando tu pedido esté
          listo, normalmente en 2-4 horas desde la confirmación.
        </>
      ),
    },
    {
      q: '¿Cuánto cuesta el envío a domicilio?',
      a: (
        <>
          El envío a domicilio tiene una tarifa única de{' '}
          <strong>4,99 €</strong>. Los pedidos a partir de{' '}
          <strong>40 €</strong> (antes de aplicar los gastos de envío)
          disfrutan de <strong>envío gratuito</strong>.
        </>
      ),
    },
    {
      q: '¿En cuánto tiempo recibiré mi pedido?',
      a: (
        <>
          <strong>Recogida en tienda:</strong> 2-4 horas tras la confirmación
          (mismo día si se confirma antes de las 18:00).{' '}
          <strong>Envío a domicilio:</strong> 24-72 horas en la zona local,
          sin perjuicio del plazo legal máximo de 30 días naturales (Art. 66
          bis RDLeg 1/2007).
        </>
      ),
    },
    {
      q: '¿Qué métodos de pago aceptáis?',
      a: (
        <>
          Aceptamos pago en línea con <strong>tarjeta</strong> (Visa, Mastercard),{' '}
          <strong>Bizum</strong>, <strong>Apple Pay</strong> y{' '}
          <strong>Google Pay</strong> a través de pasarela segura (Stripe). También
          ofrecemos <strong>contra reembolso</strong>; y en el establecimiento físico
          aceptamos efectivo y tarjeta.
        </>
      ),
    },
    {
      q: '¿Cómo funcionan las devoluciones?',
      a: (
        <>
          <p className="mb-2">
            <strong>Productos no perecederos</strong> (cereales, conservas,
            snacks, bebidas envasadas, productos de bazar): puedes ejercer
            el derecho de desistimiento durante{' '}
            <strong>14 días naturales</strong> desde la recepción del pedido,
            sin necesidad de justificar el motivo.
          </p>
          <p className="mb-2">
            <strong>Productos frescos y perecederos</strong> (carne, pescado,
            lácteos, frutas y verduras, panadería, comida preparada,
            congelados): <strong>no admiten desistimiento</strong> por su
            propia naturaleza (Art. 103 <em>RDLeg 1/2007</em>), pero puedes
            siempre solicitar devolución, sustitución o reembolso si recibes
            el producto <strong>defectuoso, caducado, dañado durante el
            transporte o distinto al pedido</strong>.
          </p>
          <p>
            Consulta el detalle completo (incluida la lista de excepciones
            legales) en nuestra{' '}
            <button
              type="button"
              onClick={() => onLegalClick('devoluciones')}
              className="text-red-600 underline hover:text-red-700"
            >
              Política de Devoluciones
            </button>
            .
          </p>
        </>
      ),
    },
    {
      q: '¿Ofrecéis reparación de móviles?',
      a: (
        <>
          Sí. Somos servicio oficial de reparación: cambio de pantalla,
          batería y otras intervenciones. Selecciona tu modelo y tipo de
          reparación en el{' '}
          <button
            type="button"
            onClick={onRepairClick}
            className="text-red-600 underline hover:text-red-700"
          >
            Centro de Reparación
          </button>{' '}
          y consulta el precio por WhatsApp.
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

// --- 组件：图标映射 (已扩充全品类) ---
// Algunas categorías llegan de la base de datos con icon='Package' (genérico)
// porque aún no se les asignó un icono concreto. Para que no se vean todas
// como una caja, derivamos el icono por palabras clave del nombre cuando el
// icon es genérico/ausente.
const ICON_BY_KEYWORD = [
  { match: /congelad/i, icon: 'Frozen' },     // Congelados
  { match: /higiene/i, icon: 'Hygiene' },     // Higiene personal
  { match: /limpieza/i, icon: 'Cleaning' },   // Limpieza del hogar
];

const resolveCategoryIcon = (c) => {
  if (c?.icon && c.icon !== 'Package') return c.icon;
  const found = ICON_BY_KEYWORD.find(k => k.match.test(c?.name || ''));
  return found ? found.icon : (c?.icon || 'Package');
};

const IconByName = ({ name, size=24, className }) => {
  const icons = {
    // 现有图标
    Apple: <Apple size={size} className={className}/>,       // Frutas (水果)
    Coffee: <Coffee size={size} className={className}/>,     // Café (咖啡)
    Baby: <Baby size={size} className={className}/>,         // Infantil (婴儿)
    
    // 新增图标 (请在数据库对应填入 key)
    Meat: <Beef size={size} className={className}/>,         // Carne (肉)
    Fish: <Fish size={size} className={className}/>,         // Pescado (鱼)
    Dairy: <Milk size={size} className={className}/>,        // Lácteos (乳制品)
    Bakery: <Croissant size={size} className={className}/>,  // Panadería (面包)
    Cereals: <Wheat size={size} className={className}/>,     // Cereales (谷物)
    Prepared: <Sandwich size={size} className={className}/>, // Comida Prep (熟食)
    Oil: <Droplet size={size} className={className}/>,       // Aceites (油)
    Snacks: <Candy size={size} className={className}/>,      // Snacks (零食)
    Drinks: <Utensils size={size} className={className}/>,   // Bebidas (饮料 - 通用)
    Alcohol: <Wine size={size} className={className}/>,      // Alcohol (酒)
    Beer: <Beer size={size} className={className}/>,         // Cerveza (啤酒)
    Healthy: <Salad size={size} className={className}/>,     // Saludable (健康)
    International: <Globe size={size} className={className}/>, // Internacional (国际)
    Pets: <Bone size={size} className={className}/>,         // Mascotas (宠物)
    Pharmacy: <BriefcaseMedical size={size} className={className}/>, // Farmacia (药房)
    Frozen: <Snowflake size={size} className={className}/>,  // Congelados (冷冻)
    Hygiene: <ShowerHead size={size} className={className}/>, // Higiene personal (个人卫生)
    Cleaning: <SprayCan size={size} className={className}/>,  // Limpieza del hogar (家居清洁)
    
    // 默认
    Package: <Package size={size} className={className}/>,

  };
  return icons[name] || <Package size={size} className={className}/>;
};

// --- [OBSOLETO / SIN USO desde 2026-05-29] PaymentModal ---
// Los métodos de pago se renderizan ahora INLINE en la página de checkout
// (bloque "Método de pago" dentro de {page === "checkout"}). Este modal ya
// NO se monta en ningún sitio: se eliminó porque (a) su botón X no
// respondía con fiabilidad y (b) tras cancelar en Stripe el cliente debe
// volver a esta misma página para reintentar, no a una ventana flotante.
// Se conserva temporalmente como referencia; el bundler lo descarta por
// tree-shaking al no estar referenciado. Eliminar en una limpieza futura.
// eslint-disable-next-line no-unused-vars
const PaymentModal = ({ total, onClose, onConfirm, isProcessing, selectedPayment, setSelectedPayment, isStorePickup = false, isLoggedIn = false, onLoginNeeded }) => {
  const contraReembolsoLocked = !isLoggedIn;
  const handleContraReembolsoClick = () => {
    if (contraReembolsoLocked) {
      if (onLoginNeeded) onLoginNeeded();
      return;
    }
    setSelectedPayment('contra_reembolso');
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-fade-in">
      <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="bg-gray-50 p-4 border-b flex justify-between items-center">
           <div className="flex items-center gap-2">
             <div className="bg-blue-600 text-white p-1 rounded"><Wallet size={18}/></div>
             <span className="font-bold text-gray-800">Método de Pago</span>
           </div>
           <button onClick={onClose} disabled={isProcessing} className="text-gray-400 hover:text-gray-600"><X size={20}/></button>
        </div>
        
        {/* Body */}
        <div className="p-6 space-y-4">
           <div className="text-center mb-6">
              <p className="text-gray-500 text-sm">Total a pagar</p>
              <p className="text-4xl font-extrabold text-gray-900">€{total.toFixed(2)}</p>
           </div>

           {/* 支付方式选择 */}
           <div className="space-y-3">
              {/* Pago online con Stripe (tarjeta / Bizum / Apple-Google Pay).
                  Recomendado: pago anticipado y seguro, sin fricción.
                  Disponible para todos (anónimos incluidos): al cobrarse
                  por adelantado no hay riesgo de abuso por impago. */}
              <button
                onClick={() => setSelectedPayment('stripe')}
                className={`relative w-full p-4 rounded-xl border-2 transition-all text-left ${
                  selectedPayment === 'stripe'
                    ? 'border-indigo-600 bg-indigo-50'
                    : 'border-gray-200 hover:border-gray-300 bg-white'
                }`}
              >
                <span className="absolute -top-2 right-3 bg-indigo-600 text-white text-[10px] font-bold px-2 py-0.5 rounded-full shadow">Recomendado</span>
                <div className="flex items-center gap-3">
                  <div className={`p-2 rounded-lg ${selectedPayment === 'stripe' ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-600'}`}>
                    <CreditCard size={20}/>
                  </div>
                  <div className="flex-1">
                    <p className="font-bold text-gray-900">Tarjeta, Bizum, Apple/Google Pay</p>
                    <p className="text-xs text-gray-500 mt-0.5">Pago seguro online · procesado por Stripe</p>
                  </div>
                  {selectedPayment === 'stripe' && (
                    <CheckCircle2 size={20} className="text-indigo-600"/>
                  )}
                </div>
              </button>

              {/* 货到付款 / Pago en tienda */}
              <button
                onClick={handleContraReembolsoClick}
                aria-disabled={contraReembolsoLocked}
                className={`relative w-full p-4 rounded-xl border-2 transition-all text-left ${
                  contraReembolsoLocked
                    ? 'border-gray-200 bg-gray-50 cursor-pointer'
                    : selectedPayment === 'contra_reembolso'
                      ? 'border-blue-600 bg-blue-50'
                      : 'border-gray-200 hover:border-gray-300 bg-white'
                }`}
              >
                <div className={`flex items-center gap-3 ${contraReembolsoLocked ? 'opacity-60' : ''}`}>
                  <div className={`p-2 rounded-lg ${selectedPayment === 'contra_reembolso' && !contraReembolsoLocked ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600'}`}>
                    <Wallet size={20}/>
                  </div>
                  <div className="flex-1">
                    <p className="font-bold text-gray-900">{isStorePickup ? 'Pagar en tienda al recoger' : 'Pago Contra Reembolso'}</p>
                    <p className="text-xs text-gray-500 mt-0.5">{isStorePickup ? 'En efectivo o tarjeta en HIPERA' : 'Paga cuando recibas tu pedido'}</p>
                  </div>
                  {selectedPayment === 'contra_reembolso' && !contraReembolsoLocked && (
                    <CheckCircle2 size={20} className="text-blue-600"/>
                  )}
                </div>
                {contraReembolsoLocked && (
                  <div className="mt-2 flex items-center justify-between gap-2 text-xs">
                    <span className="inline-flex items-center gap-1 text-amber-700 bg-amber-50 border border-amber-200 px-2 py-1 rounded-md font-semibold">
                      <Lock size={12}/> Requiere cuenta
                    </span>
                    <span className="text-blue-600 font-semibold underline">Iniciar sesión</span>
                  </div>
                )}
              </button>

              {/* Bizum */}
              <button
                onClick={() => setSelectedPayment('bizum')}
                className={`w-full p-4 rounded-xl border-2 transition-all text-left ${
                  selectedPayment === 'bizum'
                    ? 'border-green-600 bg-green-50'
                    : 'border-gray-200 hover:border-gray-300 bg-white'
                }`}
              >
                <div className="flex items-center gap-3">
                  <div className={`p-2 rounded-lg ${selectedPayment === 'bizum' ? 'bg-green-600 text-white' : 'bg-gray-100 text-gray-600'}`}>
                    <Smartphone size={20}/>
                  </div>
                  <div className="flex-1">
                    <p className="font-bold text-gray-900">Bizum manual</p>
                    <p className="text-xs text-gray-500 mt-0.5">Transferencia al número de la tienda</p>
                  </div>
                  {selectedPayment === 'bizum' && (
                    <CheckCircle2 size={20} className="text-green-600"/>
                  )}
                </div>
              </button>
           </div>
           
           {selectedPayment === 'bizum' && (
             <div className="bg-green-50 border border-green-200 rounded-xl p-3 text-xs text-green-700">
               <p className="font-bold mb-1">📱 Instrucciones Bizum:</p>
               <p>Envía el pago al número: <strong>640517893</strong></p>
               <p className="mt-1">Concepto: Pedido HIPERA</p>
             </div>
           )}

           {selectedPayment === 'contra_reembolso' && (
             <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 text-xs text-blue-700">
               <p className="font-bold mb-1">{isStorePickup ? '🏪 Pago en tienda:' : '💵 Pago contra reembolso:'}</p>
               <p>
                 {isStorePickup
                   ? 'Pagarás el importe total cuando recojas el pedido en HIPERA (Paseo del Sol 1, Meco). Aceptamos efectivo y tarjeta.'
                   : 'Pagarás el importe total cuando recibas tu pedido en casa.'}
               </p>
             </div>
           )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t bg-gray-50">
           <button 
             onClick={onConfirm} 
             disabled={isProcessing || !selectedPayment}
             className="w-full bg-blue-600 hover:bg-blue-700 text-white py-4 rounded-xl font-bold text-lg shadow-lg shadow-blue-200 disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none transition-all flex items-center justify-center gap-2"
           >
             {isProcessing ? (
               <><Loader2 className="animate-spin"/> Procesando pedido...</>
             ) : selectedPayment === 'stripe' ? (
               <><Lock size={18}/> Pagar €{total.toFixed(2)} de forma segura</>
             ) : selectedPayment === 'contra_reembolso' ? (
               <>Confirmar Pedido €{total.toFixed(2)}</>
             ) : (
               <>Confirmar con Bizum €{total.toFixed(2)}</>
             )}
           </button>
        </div>
      </div>
    </div>
  );
};

// --- 新增组件：法律条款页面内容 ---
// --- 组件：法律页面 (已更新真实地址) ---
const LegalPage = ({ type, onBack }) => {
  const content = {
    aviso: {
      title: "Aviso Legal",
      icon: <Info/>,
      text: null // 渲染外部组件 AvisoLegal
    },
    privacidad: { 
      title: "Política de Privacidad", 
      icon: <ShieldCheck/>, 
      text: null // 渲染外部组件 PoliticaPrivacidad
    },
    cookies: {
      title: "Política de Cookies",
      icon: <Cookie/>,
      text: null // 渲染外部组件 PoliticaCookies (v1.0, 2026-05-27)
    },
    devoluciones: {
      title: "Política de Devoluciones y Reembolsos",
      icon: <RotateCcw/>,
      text: null // 使用自定义内容
    },
    envios: {
      title: "Política de Envíos",
      icon: <Truck/>,
      text: null // 渲染外部组件 PoliticaEnvios
    },
    terminos: {
      title: "Términos y Condiciones",
      icon: <ClipboardList/>,
      text: null // 渲染外部组件 TerminosCondiciones
    }
  };
  const data = content[type] || content.aviso;

  return (
    <div className="min-h-screen bg-white p-6 animate-fade-in">
       <button onClick={onBack} className="flex items-center gap-2 text-gray-500 mb-6 hover:text-gray-900 font-medium px-2 py-1 rounded-lg hover:bg-gray-100 w-fit transition-colors">
         <ArrowLeft size={18}/> Volver a la tienda
       </button>
       
       <div className="max-w-2xl mx-auto mt-4">
          <div className="flex items-center gap-3 mb-6 pb-4 border-b border-gray-100">
             <div className="text-red-600 p-2 bg-red-50 rounded-xl">{data.icon}</div>
             <h1 className="text-2xl font-bold text-gray-900">{data.title}</h1>
          </div>
          
          <div className="prose text-gray-600 leading-relaxed bg-gray-50 p-8 rounded-2xl border border-gray-100 shadow-sm text-sm md:text-base">
             {type === 'devoluciones' ? (
               <PoliticaDevoluciones />
             ) : type === 'envios' ? (
               <PoliticaEnvios />
             ) : type === 'terminos' ? (
               <TerminosCondiciones />
             ) : type === 'privacidad' ? (
               <PoliticaPrivacidad />
             ) : type === 'cookies' ? (
               <PoliticaCookies />
             ) : type === 'aviso' ? (
               <AvisoLegal />
             ) : (
               <>
                 <p className="font-medium text-gray-800 mb-4">{data.text}</p>

                 {/* 通用的填充文本，增加篇幅感 */}
                 <div className="space-y-4 text-gray-500">
                   <p>El acceso y/o uso de este portal atribuye la condición de USUARIO, que acepta, desde dicho acceso y/o uso, las Condiciones Generales de Uso aquí reflejadas.</p>
                   <p>HIPERA se reserva el derecho de efectuar sin previo aviso las modificaciones que considere oportunas en su portal, pudiendo cambiar, suprimir o añadir tanto los contenidos y servicios que se presten a través de la misma como la forma en la que éstos aparezcan presentados.</p>
                 </div>
               </>
             )}
          </div>
       </div>
    </div>
  );
};

// generateDocuments() vive en src/utils/orderDocuments.js y se carga
// con dynamic import en los call-sites para mantener jsPDF/QRCode
// fuera del bundle inicial.

export default function App() {
  // --- Core Data ---
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [subCategories, setSubCategories] = useState([]);
  const [repairs, setRepairs] = useState([]); 
  
  const [cart, setCart] = useState(() => {
    const saved = localStorage.getItem('cart');
    return saved ? JSON.parse(saved) : [];
  });
  const [favorites, setFavorites] = useState(() => {
    const saved = localStorage.getItem('favorites');
    return saved ? JSON.parse(saved) : [];
  });

  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  
  // --- Navigation ---
  const [page, setPage] = useState("home"); 
  const [history, setHistory] = useState(["home"]); 
  const [mainCat, setMainCat] = useState(null); 
  const [subCat, setSubCat] = useState(null);   
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [bannerIndex, setBannerIndex] = useState(0);
  // Seguimiento del gesto de deslizar (swipe) sobre el carrusel. `swiped`
  // marca que el último toque fue un arrastre, para no disparar la
  // navegación del onClick al soltar (sólo cambiar de banner).
  const bannerTouch = useRef({ x: 0, y: 0, swiped: false });

  // --- Orders & Payment ---
  const [myOrders, setMyOrders] = useState([]);
  const [checkoutForm, setCheckoutForm] = useState({
    address: "",
    phone: "",
    note: "",
    email: "",
    // Modalidad de entrega — alineado con la columna orders.delivery_method
    // del backend. Cumple la promesa expresa de Política de Envíos §2.1
    // (recogida en tienda gratuita) que antes solo existía en el documento
    // legal pero no en la UI. Valores admitidos: 'home_delivery' |
    // 'store_pickup'. El default es envío a domicilio para preservar el
    // comportamiento que conocían los clientes habituales.
    deliveryMethod: "home_delivery",
  });
  
  // New Payment States
  const [isProcessingPayment, setIsProcessingPayment] = useState(false); // 控制支付Loading
  // Aviso de "pago cancelado/incompleto" mostrado en la página de checkout
  // cuando el cliente vuelve de Stripe sin completar el pago (?pago=cancelado).
  const [paymentCancelledNotice, setPaymentCancelledNotice] = useState(false);
  // Modal de confirmación de datos de entrega: tras pulsar "Confirmar"
  // y pasar todas las validaciones, mostramos un resumen de los datos
  // (entrega, dirección, teléfono, email) para que el cliente los
  // revise de un vistazo antes de cobrar/crear el pedido. Reduce
  // direcciones/teléfonos mal escritos sin añadir fricción real.
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  // Campos del checkout que el cliente ya ha "tocado" (onBlur). Permite
  // mostrar errores en vivo bajo cada campo sin marcar en rojo lo que
  // aún no ha rellenado al llegar al formulario.
  const [checkoutTouched, setCheckoutTouched] = useState({ email: false, address: false, phone: false });
  const [selectedPayment, setSelectedPayment] = useState(""); // 选择的支付方式
  // Cloudflare Turnstile: ref al widget invisible montado en checkout.
  // Se ejecuta justo antes de POST /api/orders para acompañar al
  // pedido con un token verificable por el backend. Si la integración
  // no está configurada (sin VITE_TURNSTILE_SITE_KEY), executeAsync
  // resuelve a null y el backend lo aceptará si tampoco tiene
  // TURNSTILE_SECRET_KEY (modo de desarrollo).
  const turnstileRef = useRef(null);
  const [legalType, setLegalType] = useState("aviso"); // 新增法律页面状态
  const [selectedGift, setSelectedGift] = useState(null); // 选中的免费商品
  const { openSettings: openCookieSettings } = useCookieConsent();
  // Aceptación de Términos y Privacidad (RGPD): última registrada en BD y
  // checkbox del checkout cuando hay que re-aceptar (versión actualizada
  // o nunca aceptó). Para invitados, también obliga a marcar.
  const [latestTermsAcceptance, setLatestTermsAcceptance] = useState(null);
  const [checkoutTermsAccepted, setCheckoutTermsAccepted] = useState(false);

  // Cupón de descuento (campaña de lanzamiento). `couponInput` es el texto
  // que el cliente escribe; `appliedCoupon` queda fijado tras validarlo en
  // el backend ({ code, value }). El descuento se recalcula en vivo sobre
  // el subtotal actual y SIEMPRE se revalida en el servidor al pagar.
  const [couponInput, setCouponInput] = useState("");
  const [appliedCoupon, setAppliedCoupon] = useState(null);
  const [couponError, setCouponError] = useState("");
  // Motivo del rechazo del cupón (p. ej. 'LOGIN_REQUIRED') para mostrar
  // un botón de login cuando el cupón exige cuenta y el cliente es invitado.
  const [couponErrorReason, setCouponErrorReason] = useState("");
  const [couponLoading, setCouponLoading] = useState(false);

  // 新增这两个状态用于筛选
  const [selectedBrand, setSelectedBrand] = useState("Apple"); // 默认选 Apple
  const [selectedModel, setSelectedModel] = useState("");
  const [selectedRepairType, setSelectedRepairType] = useState(null); // 'pantalla' | 'bateria' | null

  const navigate = useNavigate();
  const [queryOrderId, setQueryOrderId] = useState(null);
  const [queryOrder, setQueryOrder] = useState(null);
  const [queryLoading, setQueryLoading] = useState(false);

  const fetchOrderById = async (orderId) => {
    setQueryLoading(true);
    try {
      const order = await apiClient.getOrderById(orderId);
      setQueryOrder(order);
    } catch (error) {
      console.error('Error fetching order:', error);
      toast.error('Pedido no encontrado');
      setQueryOrder(null);
    } finally {
      setQueryLoading(false);
    }
  };

  // --- Init ---
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    // 1) 二维码扫描进入的订单查询
    const orderId = urlParams.get('order');
    if (orderId && !queryOrderId) {
      setQueryOrderId(orderId);
      fetchOrderById(orderId);
    }
    // 2) 从外部页面（如 /register 新标签）跳转过来直达某个法律页
    const legalParam = urlParams.get('legal');
    const VALID_LEGAL = ['aviso', 'privacidad', 'cookies', 'devoluciones', 'envios', 'terminos'];
    if (legalParam && VALID_LEGAL.includes(legalParam)) {
      setLegalType(legalParam);
      setPage('legal');
      setHistory(['home', 'legal']);
    }
    // 3) Retorno desde Stripe Checkout (?pago=ok | ?pago=cancelado).
    //    OJO: la success_url NO es prueba de pago (el cliente podría
    //    manipular la URL). La confirmación real la da el webhook. Aquí
    //    sólo damos feedback de UX y limpiamos el carrito en éxito.
    const pago = urlParams.get('pago');
    if (pago === 'ok') {
      try { sessionStorage.removeItem('hipera_pending_stripe'); } catch { /* ignore */ }
      setCart([]);
      setCheckoutForm((prev) => ({ ...prev, note: '' }));
      setSelectedGift(null);
      setAppliedCoupon(null); setCouponInput(''); setCouponError('');
      toast.success('¡Pago recibido! Te hemos enviado la confirmación por email.', { duration: 7000 });
      // Limpiamos los parámetros de la URL para que recargar no repita el toast.
      window.history.replaceState({ app: true }, '', window.location.pathname);
    } else if (pago === 'cancelado') {
      try { sessionStorage.removeItem('hipera_pending_stripe'); } catch { /* ignore */ }
      // Volvemos directamente a la página de checkout (no al inicio) con
      // un aviso persistente para reintentar. El carrito se restaura desde
      // localStorage y los datos de contacto desde lastAddress (otro
      // useEffect), así que el cliente puede reintentar sin reescribir nada.
      setPaymentCancelledNotice(true);
      setPage('checkout');
      setHistory(['home', 'cart', 'checkout']);
      window.history.replaceState({ app: true }, '', window.location.pathname);
    }

    // 4) Retorno tras login/registro iniciado desde el checkout (cupón que
    //    exige cuenta). Si el cliente venía a comprar, lo devolvemos al
    //    checkout en vez de a la home para que pueda pagar de inmediato.
    //    El carrito ya se restaura solo (persistido en localStorage); solo
    //    saltamos al checkout si realmente hay productos.
    try {
      if (sessionStorage.getItem('hipera_post_auth_redirect') === 'checkout') {
        sessionStorage.removeItem('hipera_post_auth_redirect');
        let hasCart = false;
        try { hasCart = (JSON.parse(localStorage.getItem('cart') || '[]') || []).length > 0; } catch { /* ignore */ }
        if (hasCart) {
          setPage('checkout');
          setHistory(['home', 'cart', 'checkout']);
        }
      }
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    const savedAddress = JSON.parse(localStorage.getItem('lastAddress') || '{}');
    if (savedAddress.address) setCheckoutForm(prev => ({...prev, ...savedAddress}));

    const handleSession = async (session) => {
      const u = session?.user ?? null;
      setUser(u);
      // Prefill del email en el checkout cuando el usuario tiene sesión.
      // Sólo se rellena si el campo está vacío para no pisar lo que el
      // cliente haya escrito manualmente (p. ej. quiere recibir la
      // confirmación en otra dirección distinta a la de su cuenta).
      if (u?.email) {
        setCheckoutForm((prev) => (prev.email ? prev : { ...prev, email: u.email }));
      }
      if (!u) {
        setLatestTermsAcceptance(null);
        return;
      }
      // Si el registro dejó una aceptación pendiente (sin sesión en aquel
      // momento), la sincronizamos ahora que ya hay sesión.
      try {
        const pendingRaw = localStorage.getItem('pendingTermsAcceptance');
        if (pendingRaw) {
          const pending = JSON.parse(pendingRaw);
          await recordTermsAcceptance({ source: pending?.source || 'register', userId: u.id });
          localStorage.removeItem('pendingTermsAcceptance');
        }
      } catch (e) {
        if (!import.meta.env.PROD) console.warn('[auth] flush pending acceptance:', e?.message);
      }
      // Cacheamos la última aceptación para que el checkout sepa si hay
      // que volver a pedir consentimiento (Art. 7 RGPD: vigente e informado).
      try {
        const latest = await getLatestTermsAcceptance(u.id);
        setLatestTermsAcceptance(latest);
      } catch { /* ignore */ }
    };

    supabase.auth.getSession().then(({ data: { session } }) => { handleSession(session); });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => handleSession(session));

    fetchData();
    return () => subscription.unsubscribe();
  }, []);

  // 同步应用内导航与浏览器历史：右划返回上一个应用内页面，而不是跳到 /login 或 /admin
  useEffect(() => {
    const url = window.location.pathname + window.location.search;
    window.history.replaceState({ app: true }, '', url);
  }, []);

  const fetchData = async () => {
    setLoading(true);
    try {
      // 使用API客户端获取数据
      const [productsData, categoriesData, subCategoriesData, repairsData] = await Promise.all([
        apiClient.getProducts().catch(e => { console.error("Products API error:", e); return null; }),
        apiClient.getCategories().catch(e => { console.error("Categories API error:", e); return null; }),
        apiClient.getSubCategories().catch(e => { console.error("SubCategories API error:", e); return null; }),
        apiClient.getRepairServices().catch(e => { console.error("Repairs API error:", e); return null; })
      ]);

      if (productsData) {
        setProducts(productsData.map(p => ({
          ...p,
          ofertaType: p.oferta_type,
          ofertaValue: p.oferta_value,
          subCategoryId: p.sub_category_id,
          giftProduct: p.gift_product || false
        })));
      } else {
        const msg = import.meta.env.PROD
          ? "No se pudieron cargar los productos. Compruebe su conexión; si usa Railway, el backend puede estar en reposo (espérale 1 min o revisa el panel)."
          : "No se pudieron cargar los productos. ¿Está el backend en marcha? (npm run dev en /backend)";
        toast.error(msg);
      }

      if (categoriesData) setCategories(categoriesData);
      if (subCategoriesData) setSubCategories(subCategoriesData);
      if (repairsData) setRepairs(repairsData);

    } catch (error) {
      console.error("Data load error:", error);
      const msg = import.meta.env.PROD
        ? "Error al cargar datos. Compruebe su conexión o que el backend (Railway) esté activo."
        : "Error al cargar datos. Compruebe que el backend esté en ejecución (npm run dev en /backend).";
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { localStorage.setItem('cart', JSON.stringify(cart)); }, [cart]);
  useEffect(() => { localStorage.setItem('favorites', JSON.stringify(favorites)); }, [favorites]);
  // Autoavance del carrusel. Depende de bannerIndex para que el contador
  // se reinicie tras cada cambio (también los manuales por swipe/puntos),
  // dando los 6,5 s completos para leer cada banner. Sin carrusel si solo
  // hay una imagen.
  useEffect(() => {
    if (BANNERS.length <= 1) return undefined;
    const timer = setTimeout(() => setBannerIndex(i => (i + 1) % BANNERS.length), 6500);
    return () => clearTimeout(timer);
  }, [bannerIndex]);

  useEffect(() => {
    if (page === "orders" && user) {
      const fetchOrders = async () => {
        try {
          const data = await apiClient.getUserOrders(user.id);
          if (data) setMyOrders(data);
        } catch (error) {
          console.error("Error fetching orders:", error);
        }
      };
      fetchOrders();
    }
  }, [page, user]);

  const goBack = useCallback(() => {
    if (history.length <= 1) return;
    const next = [...history];
    next.pop();
    setHistory(next);
    setPage(next[next.length - 1]);
    window.scrollTo(0, 0);
  }, [history]);

  const handleBack = () => {
    if (history.length > 1) window.history.back();
  };

  const navTo = (newPage) => {
    const nextStack = [...history, newPage];
    setHistory(nextStack);
    setPage(newPage);
    window.scrollTo(0, 0);
    window.history.pushState({ app: true }, '', window.location.pathname + window.location.search);
  };

  useEffect(() => {
    const onPopState = () => { goBack(); };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [goBack]);

  // --- Logic ---
  const addToCart = (item) => {
    const isService = !item.stock && item.title; 
    const stock = Number(item.stock);
    if (!isService && (isNaN(stock) || stock <= 0)) {
      toast.error("Producto agotado");
      return;
    }
    const newItem = { ...item, name: item.name || item.title, id: item.id, isService: isService, stock: isService ? undefined : stock };
    const ex = cart.find(i => i.id === newItem.id && i.name === newItem.name);
    if (ex) {
      const exStock = Number(ex.stock);
      if (!isService && !isNaN(exStock) && ex.quantity >= exStock) { toast.error("Max stock alcanzado"); return; }
      setCart(cart.map(i => (i.id === newItem.id && i.name === newItem.name) ? { ...i, quantity: i.quantity + 1 } : i));
    } else {
      setCart([...cart, { ...newItem, quantity: 1 }]);
    }
    toast.success("Añadido a la cesta");
  };

  const toggleFavorite = (e, productId) => {
    e.stopPropagation();
    setFavorites(prev => prev.includes(productId) ? prev.filter(id=>id!==productId) : [...prev, productId]);
    toast(favorites.includes(productId) ? "Eliminado" : "Guardado", {icon: favorites.includes(productId)?'💔':'❤️'});
  };

  const removeFromCart = (id, name) => setCart(cart.filter(i => !(i.id === id && i.name === name)));
  const updateQty = (id, name, delta) => {
    setCart(cart.map(i => {
      if (i.id === id && i.name === name) {
        const newQty = Math.max(1, i.quantity + delta);
        const stock = Number(i.stock);
        if (!i.isService && !isNaN(stock) && newQty > stock) { toast.error("No hay más stock"); return i; }
        return { ...i, quantity: newQty };
      }
      return i;
    }));
  };

  // generateInvoice — descarga factura A4 + ticket 80mm
  // ----------------------------------------------------
  // Dynamic import de jsPDF + QRCode + autoTable: estas librerías
  // pesan ~700 KB en conjunto y la mayoría de clientes nunca pulsa
  // "Descargar factura". Las cargamos sólo cuando se necesita.
  // El import es muy rápido en segundas llamadas (cacheado por el
  // browser). El toast informativo es opcional pero útil porque
  // en conexiones lentas la primera descarga puede tardar ~1s en
  // empezar.
  const generateInvoice = async (order) => {
    try {
      const mod = await import('./utils/orderDocuments');
      await mod.generateDocuments(order, 'both');
    } catch (e) {
      console.error('[generateInvoice] dynamic import failed:', e?.message);
      toast.error('No se pudieron generar los documentos. Reintenta en unos segundos.');
    }
  };

  const subtotal = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
  // En recogida en tienda (Click & Collect) NUNCA se cobra envío, con
  // independencia del subtotal: no hay transporte físico que repercutir.
  // El cálculo se evalúa cada render porque depende de checkoutForm,
  // que el usuario puede cambiar libremente desde el selector del
  // checkout. Para envío a domicilio se mantiene la regla histórica
  // tarifa única / umbral gratuito definida en Política de Envíos §4.
  const isStorePickup = checkoutForm.deliveryMethod === "store_pickup";
  const shippingFee = isStorePickup
    ? 0
    : (subtotal >= FREE_SHIPPING_THRESHOLD ? 0 : SHIPPING_FEE_STANDARD);
  // Importe ANTES del descuento (subtotal + envío). Es lo que enviamos al
  // backend como `total`; el servidor recalcula y resta el descuento del
  // cupón de forma autoritativa.
  const baseTotal = subtotal + shippingFee;
  // Descuento del cupón, recalculado en vivo sobre el subtotal actual.
  // Mismo cálculo que el backend (value % del subtotal, a céntimos) para
  // que el importe mostrado coincida exactamente con el cobrado. Si el
  // subtotal baja del mínimo del cupón, el descuento deja de aplicarse.
  const discount = (appliedCoupon && subtotal >= appliedCoupon.minSubtotal)
    ? Math.min(Math.round(subtotal * appliedCoupon.value) / 100, subtotal)
    : 0;
  const total = Math.max(0, Math.round((baseTotal - discount) * 100) / 100);
  const minOrderMet = subtotal >= 20;
  const isFreeShipping = subtotal >= FREE_SHIPPING_THRESHOLD;
  const isGiftEligible = subtotal >= 65;

  // --- Step 1: Open Payment Modal ---
  // Mostrar checkbox de aceptación si: a) usuario invitado, b) usuario
  // logueado pero sin aceptación previa, o c) la versión vigente subió.
  const checkoutNeedsTermsCheckbox = !user || needsTermsReacceptance(latestTermsAcceptance);

  // Validador mínimo de email (mismo criterio que el backend: requiere
  // arroba). El input HTML type="email" ya hace una validación más
  // estricta, pero replicamos aquí para evitar enviar al backend
  // strings claramente inválidas.
  const isEmailFormatOk = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(e || '').trim());

  // Validación de teléfono español. Aceptamos prefijo internacional
  // opcional (+34 / 0034 / 34) y separadores habituales (espacios,
  // guiones, puntos, paréntesis). Tras normalizar exigimos 9 dígitos
  // que empiecen por 6/7 (móvil) u 8/9 (fijo) — el rango válido en
  // España. Antes solo se comprobaba que no estuviera vacío, por lo
  // que cualquier garabato pasaba. El backend replica esta regla.
  const isPhoneFormatOk = (raw) => {
    let p = String(raw || '').replace(/[\s.\-()]/g, '');
    p = p.replace(/^\+?(0034|34)/, '');
    return /^[6-9]\d{8}$/.test(p);
  };

  // Validación mínima de dirección (solo envío a domicilio). Exigimos
  // longitud razonable y al menos un dígito (número de portal/piso),
  // lo que descarta entradas tipo "asdf" o "calle". No pretende ser
  // perfecta: el autocompletado de direcciones (Google Places) llegará
  // como mejora posterior; esto es la red de seguridad mínima.
  const isAddressFormatOk = (a) => {
    const v = String(a || '').trim();
    return v.length >= 6 && /\d/.test(v);
  };

  // Mensajes de error por campo del checkout. Solo se muestran si el
  // campo ya fue tocado (onBlur), para feedback en vivo sin agresividad.
  const emailFieldError = checkoutTouched.email
    ? (!checkoutForm.email
        ? 'Indica tu email para enviarte la confirmación.'
        : (!isEmailFormatOk(checkoutForm.email) ? 'Email no válido (ej. nombre@correo.com).' : ''))
    : '';
  const phoneFieldError = checkoutTouched.phone
    ? (!checkoutForm.phone
        ? 'Indica un teléfono de contacto.'
        : (!isPhoneFormatOk(checkoutForm.phone) ? 'Teléfono no válido: 9 cifras (móvil o fijo español).' : ''))
    : '';
  const addressFieldError = (!isStorePickup && checkoutTouched.address)
    ? (!checkoutForm.address
        ? 'Indica la dirección de entrega.'
        : (!isAddressFormatOk(checkoutForm.address) ? 'Incluye calle y número (mín. 6 caracteres).' : ''))
    : '';

  // Valida el cupón contra el backend y, si es correcto, lo fija. El
  // descuento real se vuelve a calcular/validar en el servidor al pagar;
  // esto es solo previsualización para dar feedback inmediato.
  const handleApplyCoupon = async () => {
    const code = couponInput.trim();
    if (!code) { setCouponError('Introduce un código de cupón.'); return; }
    setCouponLoading(true);
    setCouponError('');
    setCouponErrorReason('');
    try {
      const res = await apiClient.validateCoupon({
        code,
        items: cart,
        phone: checkoutForm.phone || null,
      });
      if (res?.valid) {
        setAppliedCoupon({ code: res.code, value: res.value, minSubtotal: res.minSubtotal, type: res.type });
        setCouponInput(res.code);
        setCouponError('');
        setCouponErrorReason('');
        toast.success('¡Cupón aplicado!');
      } else {
        setAppliedCoupon(null);
        setCouponError(res?.message || 'El código no es válido.');
        setCouponErrorReason(res?.reason || '');
      }
    } catch (e) {
      setAppliedCoupon(null);
      setCouponError(e?.message || 'No se pudo validar el cupón. Inténtalo de nuevo.');
      setCouponErrorReason('');
    } finally {
      setCouponLoading(false);
    }
  };

  const handleRemoveCoupon = () => {
    setAppliedCoupon(null);
    setCouponInput('');
    setCouponError('');
    setCouponErrorReason('');
  };

  const handleInitiateCheckout = async () => {
    // Si veníamos de un pago cancelado, ocultamos el aviso al reintentar.
    setPaymentCancelledNotice(false);
    // Marcamos todos los campos como "tocados" para que, si el cliente
    // pulsa el botón con datos incompletos, vea los errores en vivo bajo
    // cada campo (además del toast), en lugar de solo un aviso fugaz.
    setCheckoutTouched({ email: true, address: true, phone: true });
    // Validación específica por modalidad: la dirección sólo es
    // obligatoria para envío a domicilio. En recogida en tienda el
    // pedido se entrega físicamente en HIPERA (Paseo del Sol 1) y la
    // dirección postal del cliente no aporta valor; pedirla obligaría
    // a inventarse una y deteriora la UX prometida en Política de
    // Envíos §2.1.
    if (!checkoutForm.phone) {
      toast.error("Indica un teléfono de contacto para avisarte sobre el pedido.");
      return;
    }
    if (!isPhoneFormatOk(checkoutForm.phone)) {
      toast.error("Teléfono no válido — introduce un número español de 9 cifras (móvil o fijo).");
      return;
    }
    if (checkoutForm.deliveryMethod === "home_delivery" && !checkoutForm.address) {
      toast.error("Faltan datos de envío — indica la dirección o cambia a recogida en tienda.");
      return;
    }
    if (checkoutForm.deliveryMethod === "home_delivery" && !isAddressFormatOk(checkoutForm.address)) {
      toast.error("Indica una dirección completa con número (calle, número y piso si procede).");
      return;
    }
    if (!isEmailFormatOk(checkoutForm.email)) {
      toast.error("Email inválido — necesitamos uno válido para enviarte la confirmación del pedido");
      return;
    }
    if (checkoutNeedsTermsCheckbox && !checkoutTermsAccepted) {
      toast.error("Debes aceptar la Política de Privacidad y los Términos y Condiciones.");
      return;
    }
    // El método de pago ahora se elige en la propia página (sin modal).
    // Exigimos selección explícita antes de confirmar.
    if (!selectedPayment) {
      toast.error("Elige un método de pago para continuar.");
      return;
    }
    // Anti-abuso (2026-05-27): la recogida en tienda implica que el
    // comercio prepara productos sin garantía de pago hasta que el
    // cliente aparece. Para evitar el escenario de no-shows masivos
    // exigimos cuenta. Bizum + envío a domicilio sigue disponible para
    // anónimos (Bizum exige transferencia previa = fricción real).
    // La misma validación se aplica en backend (POST /api/orders),
    // pero la replicamos aquí para mejor UX (mensaje claro antes
    // de abrir el modal de pago).
    if (!user && checkoutForm.deliveryMethod === 'store_pickup') {
      toast.error('Para recoger en tienda necesitas una cuenta. Inicia sesión o regístrate.');
      // Pequeño delay para que el toast sea legible antes del redirect.
      setTimeout(() => navigate('/login'), 800);
      return;
    }
    // Todas las validaciones han pasado: mostramos el resumen de datos
    // para que el cliente confirme de un vistazo (dirección/teléfono/
    // email correctos) antes de cobrar o crear el pedido. El envío real
    // se dispara en handleConfirmedSubmit al pulsar "Confirmar".
    // Pre-calentamos el backend (Railway) mientras el cliente revisa el
    // resumen, para que el request de pago no sufra el arranque en frío.
    apiClient.warmup();
    setShowConfirmModal(true);
  };

  // Confirmación final desde el modal de revisión de datos. Aquí
  // registramos la (re)aceptación de términos si procede y lanzamos el
  // pago/creación del pedido.
  const handleConfirmedSubmit = async () => {
    setShowConfirmModal(false);
    // Si hay que re-aceptar y el usuario está logueado, registrar la
    // aceptación en segundo plano. IMPORTANTE: NO usar await aquí — el
    // historial de incidencias (2026-05-26) mostró que, cuando el token
    // de Supabase queda corrupto en el navegador del cliente, cualquier
    // llamada a supabase se queda colgada hasta el timeout interno (30s).
    // Si esperásemos a recordTermsAcceptance, el botón quedaría sin
    // respuesta visible durante esos 30 s y los clientes lo interpretan
    // como un fallo total. Lanzamos la promesa, actualizamos el estado
    // local de forma optimista y continuamos. Si la persistencia falla,
    // la próxima sesión simplemente volverá a pedir la aceptación.
    if (user && needsTermsReacceptance(latestTermsAcceptance) && checkoutTermsAccepted) {
      setLatestTermsAcceptance({
        terms_version: TERMS_VERSION,
        privacy_version: PRIVACY_VERSION,
        accepted_at: new Date().toISOString(),
        source: 'checkout',
      });
      recordTermsAcceptance({ source: 'checkout', userId: user.id }).catch((e) => {
        if (!import.meta.env.PROD) console.warn('[checkout] recordAcceptance:', e?.message);
      });
    }
    await handleConfirmPayment();
  };

  // --- Step 2: Simulate Payment & Save Order ---
  const handleConfirmPayment = async () => {
    setIsProcessingPayment(true);

    try {
      // No guardamos la modalidad de entrega en lastAddress: queremos
      // que cada nuevo pedido vuelva a decidir si es envío o recogida
      // (no es razonable «recordar» que la última vez fue store_pickup
      // y obligar al cliente a desmarcarlo cada vez).
      localStorage.setItem('lastAddress', JSON.stringify({
        address: checkoutForm.address,
        phone: checkoutForm.phone,
        email: checkoutForm.email,
      }));

      // 创建订单（通过API，后端会处理库存检查和扣减）
      const paymentMethodName = selectedPayment === 'contra_reembolso' ? 'Contra Reembolso' : selectedPayment === 'bizum' ? 'Bizum' : 'Pendiente';
      
      // 如果有选中的免费商品，添加到订单中（价格为0）
      const finalCart = [...cart];
      if (selectedGift) {
        finalCart.push({
          ...selectedGift,
          quantity: 1,
          price: 0, // 免费商品价格为0
          isGift: true // 标记为免费商品
        });
      }

      // Anti-bot (Cloudflare Turnstile): ejecutamos el widget para
      // obtener un token verificable. Si la integración no está
      // configurada en el frontend (sin VITE_TURNSTILE_SITE_KEY) o el
      // script no cargó, executeAsync devuelve null y el backend
      // decidirá: lo acepta si tampoco tiene TURNSTILE_SECRET_KEY
      // configurado (entorno de desarrollo), o lo rechazará con 403.
      // El token expira en 5 min y es de un sólo uso.
      let turnstileToken = null;
      try {
        turnstileToken = (await turnstileRef.current?.executeAsync?.()) || null;
      } catch {
        turnstileToken = null;
      }

      // --- Rama Stripe: pago anticipado online (tarjeta/Bizum/wallets) ---
      // No creamos el pedido aquí: el backend lo crea en 'Esperando pago'
      // y nos devuelve la URL de Checkout. Redirigimos a Stripe; la
      // confirmación llega por webhook. NO vaciamos el carrito todavía
      // (si el cliente cancela en Stripe, lo conserva para reintentar;
      // el pedido 'Esperando pago' es inofensivo y caduca en 1 h).
      if (selectedPayment === 'stripe') {
        const { url } = await apiClient.createStripeSession({
          user_id: user?.id || null,
          customer_email: checkoutForm.email,
          address: isStorePickup ? '' : checkoutForm.address,
          phone: checkoutForm.phone,
          note: checkoutForm.note,
          total: baseTotal, // SIN descuento: el backend lo resta tras validar el cupón
          coupon_code: appliedCoupon?.code || null,
          delivery_method: checkoutForm.deliveryMethod,
          items: finalCart,
          turnstile_token: turnstileToken,
        });
        if (!url) throw new Error('No se pudo iniciar el pago. Inténtalo de nuevo.');
        // Marca para mostrar feedback al volver y limpiar el carrito.
        try { sessionStorage.setItem('hipera_pending_stripe', '1'); } catch { /* ignore */ }
        toast.loading('Redirigiendo al pago seguro…', { duration: 4000 });
        window.location.href = url; // salida de la SPA → Stripe Checkout
        return; // no seguimos con el flujo de pedido normal
      }

      // Para recogida en tienda dejamos address en blanco en el payload:
      // el backend (server.js, POST /api/orders) lo normaliza a una
      // etiqueta estable («Recogida en tienda — Paseo del Sol 1, 28880
      // Meco …») para que cualquier consumidor del registro de la BBDD
      // muestre texto legible sin necesidad de leer delivery_method.
      const orderData = await apiClient.createOrder({
        user_id: user?.id || null,
        customer_email: checkoutForm.email,
        address: isStorePickup ? '' : checkoutForm.address,
        phone: checkoutForm.phone,
        note: checkoutForm.note,
        total: baseTotal, // SIN descuento: el backend lo resta tras validar el cupón
        coupon_code: appliedCoupon?.code || null,
        status: selectedPayment === 'contra_reembolso' ? "Pendiente de Pago" : "Procesando",
        payment_method: paymentMethodName,
        delivery_method: checkoutForm.deliveryMethod,
        items: finalCart,
        turnstile_token: turnstileToken,
      });

      // Mensaje matizado por método de pago + modalidad de entrega.
      // En contra_reembolso + store_pickup se paga en mostrador, no al
      // repartidor; el copy "Paga al recibir" sería desconcertante.
      const successMsg = selectedPayment === 'contra_reembolso'
        ? (isStorePickup
            ? "¡Pedido Confirmado! Pagarás al recoger en la tienda."
            : "¡Pedido Confirmado! Paga al recibir.")
        : "¡Pedido Confirmado! Revisa tu Bizum.";
      toast.success(successMsg);
      
      // 重置免费商品选择
      setSelectedGift(null);
      
      // 询问用户是否下载票据
      if(window.confirm("Pago completado. ¿Quieres descargar los recibos?")) {
         // Cargamos el módulo de generación de PDFs UNA SOLA VEZ
         // aquí; las llamadas siguientes a generateDocuments en este
         // bloque ya tienen el chunk cacheado. Esto evita downloads
         // duplicados del bundle PDF cuando hay productos+servicios.
         const { generateDocuments } = await import('./utils/orderDocuments');

         // 分离商品和服务（包括免费商品）
         const productItems = finalCart.filter(item => !item.isService);
         const serviceItems = finalCart.filter(item => item.isService);
         
         const productTotal = productItems.reduce((sum, item) => sum + (item.price * item.quantity), 0);
         const serviceTotal = serviceItems.reduce((sum, item) => sum + (item.price * item.quantity), 0);
         
         // 如果同时有商品和服务，生成两张发票
         if (productItems.length > 0 && serviceItems.length > 0) {
            // 商品发票 — el descuento del cupón (sobre el subtotal) se
            // refleja en la factura de productos.
            const productOrder = {
               id: orderData?.id || Math.random().toString(36).substr(2, 9),
               created_at: orderData?.created_at || new Date().toISOString(),
               items: productItems,
               // El envío (si lo hay) se factura junto a los productos.
               total: Math.max(0, Math.round((productTotal - discount + shippingFee) * 100) / 100),
               discount,
               couponCode: appliedCoupon?.code || null,
               address: checkoutForm.address,
               phone: checkoutForm.phone,
               payment_method: paymentMethodName
            };
            await generateDocuments(productOrder, 'both');
            
            // 稍等片刻，避免浏览器阻止多个下载
            await new Promise(resolve => setTimeout(resolve, 500));
            
            // 维修服务发票
            const serviceOrder = {
               id: (orderData?.id || Math.random().toString(36).substr(2, 9)) + '-SERV',
               created_at: orderData?.created_at || new Date().toISOString(),
               items: serviceItems,
               total: serviceTotal,
               address: checkoutForm.address,
               phone: checkoutForm.phone,
               payment_method: paymentMethodName
            };
            await generateDocuments(serviceOrder, 'both');
         } else {
            // 只有一种类型，生成一张发票（必须用 finalCart 才能包含礼品）
            const orderForDocuments = {
               id: orderData?.id || Math.random().toString(36).substr(2, 9),
               created_at: orderData?.created_at || new Date().toISOString(),
               items: finalCart,
               total: total, // ya incluye el descuento del cupón
               discount,
               couponCode: appliedCoupon?.code || null,
               address: checkoutForm.address,
               phone: checkoutForm.phone,
               payment_method: paymentMethodName
            };
            await generateDocuments(orderForDocuments, 'both');
         }
      }
      
      setCart([]);
      setCheckoutForm(prev => ({ ...prev, note: "" }));
      setSelectedPayment(""); // 重置支付方式
      setAppliedCoupon(null); setCouponInput(""); setCouponError(""); // 重置优惠码
      
      // 刷新产品列表（通过API）
      const pData = await apiClient.getProducts();
      if(pData) setProducts(pData.map(p => ({...p, ofertaType: p.oferta_type, ofertaValue: p.oferta_value, subCategoryId: p.sub_category_id, giftProduct: p.gift_product || false})));
      
      navTo("home"); 
    } catch (e) {
      // Anti-abuso: el backend puede rechazar el pedido por varias
      // razones específicas que merecen UX dedicada (no un toast
      // genérico).
      if (e?.status === 401 && (e?.code === 'AUTH_REQUIRED' || e?.code === 'AUTH_INVALID')) {
        toast.error(e.message || 'Inicia sesión para continuar');
        setSelectedPayment('');
        setTimeout(() => navigate('/login'), 600);
      } else if (e?.status === 429) {
        // Rate limit (IP) o limite por teléfono — mensaje servido por
        // backend. El cliente puede revisar/editar el carrito antes de
        // reintentar (los métodos de pago siguen visibles en la página).
        toast.error(e.message || 'Demasiados pedidos. Espera unos minutos.', { duration: 6000 });
        setSelectedPayment('');
      } else if (e?.code === 'COUPON_INVALID') {
        // El cupón dejó de ser válido entre la previsualización y el pago
        // (caducó, se usó, o cambió el carrito). Lo quitamos para que el
        // cliente pueda reintentar sin descuento.
        toast.error(e.message || 'El cupón ya no es válido.', { duration: 6000 });
        setAppliedCoupon(null);
        setCouponError(e.message || 'El cupón ya no es válido.');
      } else {
        toast.error(e.message);
      }
    } finally {
      setIsProcessingPayment(false);
    }
  };

  // --- Renders ---
  /** Calcula el precio original (antes del descuento). p.price = precio de venta. */
  const getOriginalPrice = (p) => {
    if (!p?.oferta) return null;
    const salePrice = p.price || 0;
    const type = p.ofertaType || 'percent';
    const val = parseFloat(p.ofertaValue) || 0;
    if (type === 'percent') {
      if (val <= 0) return salePrice;
      if (val >= 100) return null;
      return salePrice / (1 - val / 100); // ej: 7.69 / 0.9 = 8.54 (-10%)
    }
    if (type === 'second') return salePrice / 0.75; // 2ª -50% → efectivo 25% off
    if (type === 'gift') return salePrice * 2; // 2x1
    return null;
  };

  const renderProductCard = (p) => (
    <div key={p.id} className="bg-white p-3 rounded-2xl shadow-sm border border-gray-100 active:scale-95 transition-transform relative group" onClick={() => {setSelectedProduct(p); navTo("detail");}}>
      <button onClick={(e) => toggleFavorite(e, p.id)} className="absolute top-2 right-2 z-20 bg-white/80 p-1.5 rounded-full shadow-sm backdrop-blur-sm text-gray-400 hover:text-red-500 transition-colors">
        <Heart size={16} fill={favorites.includes(p.id) ? "currentColor" : "none"} className={favorites.includes(p.id) ? "text-red-500" : ""}/>
      </button>
      <div className="relative mb-2">
        {renderDiscountTag(p)}
        <img src={p.image} alt={p.name} loading="lazy" decoding="async" className="w-full aspect-square rounded-xl object-cover bg-gray-50" />
      </div>
      <p className="font-medium text-gray-800 text-sm line-clamp-2 mb-1 break-words">{p.name}</p>
      <div className="flex justify-between items-end">
        <div>
          <p className="font-extrabold text-red-600 text-lg leading-none">€{p.price.toFixed(2)}</p>
          {p.oferta && (() => { const orig = getOriginalPrice(p); return orig != null ? <p className="text-[10px] text-gray-400 line-through mt-0.5">€{orig.toFixed(2)}</p> : null; })()}
        </div>
        <button onClick={(e) => {e.stopPropagation(); addToCart(p);}} className="bg-gray-900 text-white w-8 h-8 rounded-full flex items-center justify-center shadow-lg active:bg-red-600 transition-colors"><Plus size={16}/></button>
      </div>
    </div>
  );

  const renderDiscountTag = (p) => {
    // 只有当 oferta 为 true 时才显示标签
    if (!p.oferta || !p.ofertaType) return null;
    let text = "";
    if (p.ofertaType === "percent") {
      // 只有当 ofertaValue 大于 0 时才显示百分比
      if (!p.ofertaValue || p.ofertaValue <= 0) return null;
      text = `-${p.ofertaValue}%`;
    }
    if (p.ofertaType === "second") text = "2ª -50%";
    if (p.ofertaType === "gift") text = "2x1";
    // 如果 text 为空，不显示标签
    if (!text) return null;
    return <span className="absolute top-2 left-2 bg-red-600 text-white text-[10px] px-2 py-1 rounded-full font-bold shadow-sm z-10">{text}</span>;
  };

  const filteredProducts = products.filter(p => {
    if (page === "favorites") return favorites.includes(p.id);
    const mainMatch = mainCat ? p.category === mainCat.id : true;
    const subMatch = subCat ? p.subCategoryId === subCat.id : true;
    const searchMatch = p.name?.toLowerCase().includes(searchQuery.toLowerCase());
    return mainMatch && subMatch && searchMatch;
  });

  return (
    <div className="min-h-screen bg-gray-50 pb-20 font-sans selection:bg-red-100 max-w-md mx-auto relative shadow-2xl">
      <Toaster position="top-center" toastOptions={{style:{borderRadius:'12px', background:'#333', color:'#fff'}}}/>
      <CookieConsent onShowPolicy={() => { setLegalType("cookies"); navTo("legal"); }} />

      {/* Payment Modal */}
      {/* HEADER */}
      <header className="bg-white/80 backdrop-blur-md shadow-sm sticky top-0 z-40 transition-all">
        <div className="px-4 py-3">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-3" onClick={() => navTo("home")}>
              <div className="w-10 h-10 bg-red-600 rounded-xl flex items-center justify-center text-white font-extrabold shadow-lg shadow-red-200">H</div>
              <div><h1 className="font-bold text-lg leading-none text-gray-900">HIPERA</h1><p className="text-[10px] text-gray-500 tracking-wider font-medium">MERCADO ONLINE</p></div>
            </div>
            <div className="flex items-center gap-4">
               {user ? (
                 <div className="flex items-center gap-2 cursor-pointer" onClick={() => navTo("orders")}>
                    <div className="w-9 h-9 bg-gray-900 text-white rounded-full flex items-center justify-center text-sm font-bold border-2 border-transparent hover:border-red-500 transition-colors">{user.email[0].toUpperCase()}</div>
                 </div>
               ) : (
                 <button onClick={() => navigate("/login")} className="text-xs font-bold text-gray-600 bg-gray-100 px-3 py-1.5 rounded-lg hover:bg-gray-200 transition-colors">Entrar</button>
               )}
               <div className="relative p-1 cursor-pointer transition-transform active:scale-90" onClick={() => navTo("cart")}>
                 <ShoppingCart className="text-gray-700" size={24} />
                 {cart.length > 0 && <span className="absolute -top-1 -right-1 bg-red-600 text-white text-[10px] w-5 h-5 rounded-full flex items-center justify-center border-2 border-white animate-bounce">{cart.length}</span>}
               </div>
            </div>
          </div>
          {page !== 'checkout' && page !== 'repair' && (
            <div className="relative group">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 group-focus-within:text-red-500 transition-colors" size={16} />
              <input id="search" name="search" placeholder="Buscar productos..." value={searchQuery} onChange={e => {setSearchQuery(e.target.value); if(e.target.value.length >= 2 && page==='home') navTo("products");}} className="w-full pl-10 pr-4 py-2.5 bg-gray-100 border-none rounded-xl text-sm focus:bg-white focus:ring-2 focus:ring-red-100 outline-none transition-all shadow-inner" />
            </div>
          )}
        </div>
      </header>

      {/* Estado de apertura de la tienda física (solo Home) */}
      {page === 'home' && <StoreInfoBar />}

      {/* ⚖️ 法律页面 */}
      {page === "legal" && <LegalPage type={legalType} onBack={handleBack}/>}

      {/* --- HOME PAGE --- */}
      {page === "home" && (
        <div className="p-4 space-y-6 animate-fade-in">
          <div className="grid grid-cols-4 gap-2">
            <button onClick={() => navTo("main")} className="bg-white p-2 rounded-xl shadow-sm flex flex-col items-center justify-center gap-1 active:scale-95 transition-transform aspect-square"><div className="p-2 bg-blue-50 text-blue-600 rounded-full"><LayoutGrid size={18} /></div><span className="text-[10px] font-bold text-gray-700">Todo</span></button>
            <button onClick={() => navTo("offers")} className="bg-white p-2 rounded-xl shadow-sm flex flex-col items-center justify-center gap-1 active:scale-95 transition-transform aspect-square"><div className="p-2 bg-red-50 text-red-600 rounded-full"><Percent size={18} /></div><span className="text-[10px] font-bold text-gray-700">Ofertas</span></button>
            <button onClick={() => navTo("favorites")} className="bg-white p-2 rounded-xl shadow-sm flex flex-col items-center justify-center gap-1 active:scale-95 transition-transform aspect-square"><div className="p-2 bg-pink-50 text-pink-600 rounded-full"><Heart size={18} /></div><span className="text-[10px] font-bold text-gray-700">Favs</span></button>
            <button onClick={() => navTo("orders")} className="bg-white p-2 rounded-xl shadow-sm flex flex-col items-center justify-center gap-1 active:scale-95 transition-transform aspect-square"><div className="p-2 bg-green-50 text-green-600 rounded-full"><ClipboardList size={18} /></div><span className="text-[10px] font-bold text-gray-700">Pedidos</span></button>
          </div>
          <div className="space-y-2">
          <button
            type="button"
            onClick={() => {
              // Si el gesto fue un swipe, no navegamos: sólo cambiamos de
              // banner (la navegación se reserva para un toque limpio).
              if (bannerTouch.current.swiped) { bannerTouch.current.swiped = false; return; }
              navTo(BANNERS[bannerIndex].target);
            }}
            onTouchStart={(e) => {
              const t = e.changedTouches[0];
              bannerTouch.current = { x: t.clientX, y: t.clientY, swiped: false };
            }}
            onTouchEnd={(e) => {
              const t = e.changedTouches[0];
              const dx = t.clientX - bannerTouch.current.x;
              const dy = t.clientY - bannerTouch.current.y;
              // Umbral 40px y predominio horizontal para distinguir de un
              // scroll vertical de la página.
              if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) {
                bannerTouch.current.swiped = true;
                setBannerIndex(i => (i + (dx < 0 ? 1 : -1) + BANNERS.length) % BANNERS.length);
              }
            }}
            aria-label={BANNERS[bannerIndex].alt}
            className="relative rounded-2xl overflow-hidden shadow-lg aspect-[2.2/1] w-full block text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2"
          >
            <img
              src={BANNERS[bannerIndex].src}
              alt={BANNERS[bannerIndex].alt}
              width="1320"
              height="600"
              loading="eager"
              fetchpriority="high"
              decoding="async"
              className="w-full h-full object-cover transition-all duration-700 group-hover:scale-105"
            />
            {!BANNERS[bannerIndex].selfContained && (
              <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent flex items-end p-5">
                <div>
                  <span className="bg-red-600 text-white text-[10px] px-2 py-1 rounded font-bold mb-1 inline-block">
                    {BANNERS[bannerIndex].badge}
                  </span>
                  <p className="text-white font-bold text-xl leading-tight">
                    {BANNERS[bannerIndex].headline.map((line, i) => (
                      <span key={i} className="block">{line}</span>
                    ))}
                  </p>
                </div>
              </div>
            )}
          </button>
          {BANNERS.length > 1 && (
            <div className="flex justify-center gap-1.5 mt-2">
              {BANNERS.map((_, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => setBannerIndex(i)}
                  aria-label={`Ir al banner ${i + 1}`}
                  className={`h-1.5 rounded-full transition-all ${i === bannerIndex ? 'w-5 bg-red-600' : 'w-1.5 bg-gray-300'}`}
                />
              ))}
            </div>
          )}
          <p className="text-[11px] text-gray-400 px-1 leading-snug text-center mt-1">{PROMO_NOTICE}</p>
          </div>

          {/* Categorías — acceso directo a lo que busca el cliente nada más entrar */}
          <div>
             <h4 className="text-sm font-bold text-gray-400 uppercase tracking-wide mb-3">Categorías</h4>
             <div className="flex gap-3 overflow-x-auto pb-4 -mx-4 px-4 scrollbar-hide">
               {categories.map(c => (
                 <button 
                   key={c.id} 
                   onClick={() => {setMainCat(c); setSubCat(null); navTo("sub");}} 
                   className="flex flex-col items-center gap-2 group w-24 flex-shrink-0"
                 >
                   <div className="w-20 h-20 bg-white p-4 rounded-2xl shadow-sm border border-gray-100 flex items-center justify-center text-red-600 group-active:scale-95 transition-transform">
                     <IconByName name={resolveCategoryIcon(c)} size={32}/>
                   </div>
                   <span className="text-xs font-bold text-gray-800 text-center leading-tight line-clamp-2 h-8 flex items-start justify-center">
                     {c.name}
                   </span>
                 </button>
               ))}
             </div>
          </div>

          {/* Ofertas Flash — productos visibles cuanto antes */}
          {(loading || products.filter(p => p.oferta).length > 0) && (
            <div>
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-bold text-xl text-gray-800">Ofertas Flash</h3>
              </div>
              <div className="grid grid-cols-2 gap-3">
                {loading ? (
                  [1,2,3,4,5,6].map(i => <ProductSkeleton key={i}/>)
                ) : (
                  products.filter(p => p.oferta).slice(0, 6).map(p => renderProductCard(p))
                )}
              </div>
              {!loading && products.filter(p => p.oferta).length > 6 && (
                <button
                  onClick={() => navTo("offers")}
                  className="w-full mt-4 bg-red-600 text-white py-3 rounded-xl font-bold text-sm shadow-lg hover:bg-red-700 active:scale-95 transition-all flex items-center justify-center gap-2"
                >
                  Ver más ofertas <ChevronRight size={18}/>
                </button>
              )}
            </div>
          )}

          {/* Reparación móvil — entrada compacta (el detalle vive en /repair y en el banner del carrusel) */}
          <button
            onClick={() => navTo("repair")}
            className="w-full bg-gray-900 text-white rounded-2xl shadow-sm px-4 py-3 flex items-center justify-between gap-3 active:scale-95 transition-transform"
          >
            <span className="flex items-center gap-3 min-w-0">
              <span className="w-9 h-9 rounded-full bg-white/10 flex items-center justify-center flex-shrink-0"><Wrench size={18} className="text-red-500"/></span>
              <span className="text-left min-w-0">
                <span className="block text-sm font-bold leading-tight">Reparación de móviles</span>
                <span className="block text-[11px] text-gray-400 leading-tight truncate">Pantalla y batería · Cita previa · WhatsApp</span>
              </span>
            </span>
            <ChevronRight size={18} className="text-gray-400 flex-shrink-0"/>
          </button>

          {/* Preguntas frecuentes (FAQ accordion) — final del Home */}
          <FaqSection
            onLegalClick={(type) => { setLegalType(type); navTo('legal'); }}
            onRepairClick={() => navTo('repair')}
          />
        </div>
      )}

{/* --- REPAIR PAGE (已修正：深色风格 + 完整购买须知) --- */}
      {page === "repair" && (
        <div className="min-h-screen bg-gray-900 text-white animate-fade-in pb-24">
           {/* Header */}
           <div className="px-4 py-4 flex items-center gap-3 sticky top-0 bg-gray-900/95 backdrop-blur z-20 border-b border-gray-800">
             <button onClick={handleBack} className="w-10 h-10 bg-white/10 rounded-full flex items-center justify-center hover:bg-white/20 transition-colors"><ArrowLeft size={20}/></button>
             <h2 className="text-xl font-bold">Centro de Reparación</h2>
           </div>
           
           <div className="p-4 space-y-6">
              {/* 1. 顶部 Banner */}
              <div className="bg-gradient-to-br from-gray-800 to-gray-900 p-6 rounded-3xl border border-gray-700 text-center relative overflow-hidden shadow-2xl">
                 <div className="absolute top-0 right-0 w-24 h-24 bg-red-600 blur-[60px] opacity-20"></div>
                 <Wrench size={40} className="mx-auto text-red-500 mb-4"/>
                 <h3 className="text-xl font-bold mb-2">Reparación por cita</h3>
                 <p className="text-gray-400 text-sm leading-relaxed">Elige modelo y tipo de reparación, luego consulta el precio por WhatsApp.</p>
              </div>

              {/* 2. 核心：智能筛选器 (改为深色风格) */}
              <div className="bg-gray-800/40 p-2 rounded-3xl border border-gray-700 backdrop-blur-sm">
                 
                 {/* 品牌 Tabs (黑底) */}
                 <div className="flex p-1 bg-gray-900 rounded-2xl mb-4 overflow-x-auto border border-gray-800">
                    {['Apple', 'Samsung', 'Xiaomi', 'Oppo'].map(brand => (
                      <button 
                        key={brand}
                        onClick={() => { setSelectedBrand(brand); setSelectedModel(""); setSelectedRepairType(null); }} 
                        className={`flex-1 py-3 rounded-xl text-sm font-bold transition-all whitespace-nowrap px-4 ${selectedBrand === brand ? 'bg-gray-800 text-white shadow-lg border border-gray-700' : 'text-gray-500 hover:text-gray-300'}`}
                      >
                        {brand}
                      </button>
                    ))}
                 </div>

                 <div className="px-2 pb-2">
                    {/* 型号选择 (已修改：增加"找不到型号"选项) */}
                    <div className="mb-6">
                       <label className="text-xs font-bold text-gray-500 uppercase ml-2 mb-2 block">Selecciona Modelo</label>
                       <div className="relative">
                         <select 
                           value={selectedModel} 
                           onChange={e => { setSelectedModel(e.target.value); setSelectedRepairType(null); }}
                           className="w-full p-4 bg-gray-900 border border-gray-700 rounded-xl text-white font-bold outline-none focus:ring-2 focus:ring-red-900/50 appearance-none transition-all"
                         >
                           <option value="" className="text-gray-500">-- Elige tu dispositivo --</option>
                           
                           {/* 1. 正常的数据库型号 */}
                           {[...new Set(repairs.filter(r => r.brand?.toLowerCase() === selectedBrand.toLowerCase()).map(r => r.model))].sort().map(model => (
                              <option key={model} value={model}>{model}</option>
                           ))}

                           {/* 2. 👇 新增：兜底选项 (手动加上去的) */}
                           <option value="others" className="text-red-400 font-bold">❓ No encuentro mi modelo</option>
                         </select>
                         <ChevronRight className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-500 rotate-90 pointer-events-none" size={16}/>
                       </div>
                    </div>

                    {/* 预约制：选型号 → 简单信息 + Cambiar pantalla / batería → WhatsApp 咨询价格 */}
                    <div className="space-y-3">
                       {/* A: 未选型号 */}
                       {!selectedModel && (
                         <div className="text-center py-10 border-2 border-dashed border-gray-800 rounded-2xl">
                            <Smartphone size={32} className="mx-auto mb-3 text-gray-700"/>
                            <p className="text-sm text-gray-500">👆 Selecciona un modelo arriba</p>
                         </div>
                       )}

                       {/* B: "找不到型号" → 直接 WhatsApp */}
                       {selectedModel === 'others' && (
                         <div className="bg-gray-800 p-6 rounded-2xl text-center border border-gray-700 animate-fade-in">
                            <div className="w-16 h-16 bg-gray-700 rounded-full flex items-center justify-center mx-auto mb-4 text-yellow-400">
                               <Info size={32} />
                            </div>
                            <h3 className="text-xl font-bold text-white mb-2">¿Tu modelo no está en la lista?</h3>
                            <p className="text-gray-400 text-sm mb-6 leading-relaxed">
                               Trabajamos con casi todas las marcas. Contáctanos por WhatsApp para consultar precio.
                            </p>
                            <a 
                              href="https://wa.me/34612466034?text=Hola,%20quiero%20reparar%20un%20móvil%20que%20no%20aparece%20en%20la%20web.%20Quisiera%20consultar%20precio."
                              target="_blank" 
                              rel="noreferrer"
                              className="bg-[#25D366] hover:bg-[#20bd5a] text-white py-3 px-6 rounded-xl font-bold flex items-center justify-center gap-2 shadow-lg transition-transform active:scale-95 mx-auto w-full"
                            >
                               <Smartphone size={20}/> Consultar precio por WhatsApp
                            </a>
                         </div>
                       )}

                       {/* C: 已选型号 → 简单信息 + Cambiar pantalla / batería（点击仅选中）→ 再显示 Consultar / Pedir cita → WhatsApp */}
                       {selectedModel && selectedModel !== 'others' && (
                         <div className="space-y-4 animate-fade-in">
                           {(() => {
                             const modelRepair = repairs.find(r => r.brand?.toLowerCase() === selectedBrand.toLowerCase() && r.model === selectedModel);
                             const desc = modelRepair?.description;
                             return (
                           <div className="bg-gray-800 p-4 rounded-2xl border border-gray-700">
                             <p className="text-xs text-gray-500 uppercase font-bold mb-1">{selectedBrand}</p>
                             <h3 className="text-lg font-bold text-white">{selectedModel}</h3>
                             {desc ? <p className="text-gray-400 text-sm mt-1">{desc}</p> : null}
                             <p className="text-gray-400 text-sm mt-1">
                               {!selectedRepairType
                                 ? "Elige el tipo de reparación."
                                 : `Has elegido: Cambiar ${selectedRepairType === 'pantalla' ? 'pantalla' : 'batería'}. Pulsa abajo para consultar o pedir cita.`}
                             </p>
                           </div>
                           ); })()}

                           {!selectedRepairType ? (
                             <>
                               <div className="grid grid-cols-1 gap-3">
                                 <button
                                   type="button"
                                   onClick={() => setSelectedRepairType('pantalla')}
                                   className="bg-gray-800 hover:bg-gray-700 p-4 rounded-2xl border border-gray-700 flex items-center gap-4 transition-all active:scale-[0.98] w-full text-left"
                                 >
                                   <div className="w-12 h-12 bg-gray-900 rounded-xl flex items-center justify-center text-red-400">
                                     <Smartphone size={24}/>
                                   </div>
                                   <div className="flex-1">
                                     <h4 className="font-bold text-white">Cambiar pantalla</h4>
                                     <p className="text-gray-500 text-xs">Seleccionar</p>
                                   </div>
                                   <ChevronRight className="text-gray-500" size={20}/>
                                 </button>
                                 <button
                                   type="button"
                                   onClick={() => setSelectedRepairType('bateria')}
                                   className="bg-gray-800 hover:bg-gray-700 p-4 rounded-2xl border border-gray-700 flex items-center gap-4 transition-all active:scale-[0.98] w-full text-left"
                                 >
                                   <div className="w-12 h-12 bg-gray-900 rounded-xl flex items-center justify-center text-amber-400">
                                     <Wrench size={24}/>
                                   </div>
                                   <div className="flex-1">
                                     <h4 className="font-bold text-white">Cambiar batería</h4>
                                     <p className="text-gray-500 text-xs">Seleccionar</p>
                                   </div>
                                   <ChevronRight className="text-gray-500" size={20}/>
                                 </button>
                               </div>
                             </>
                           ) : (
                             <a
                               href={`https://wa.me/34612466034?text=${encodeURIComponent(`Hola, quiero consultar precio para ${selectedBrand} ${selectedModel} - cambiar ${selectedRepairType === 'pantalla' ? 'pantalla' : 'batería'}.`)}`}
                               target="_blank"
                               rel="noreferrer"
                               className="bg-[#25D366] hover:bg-[#20bd5a] text-white py-3 px-6 rounded-xl font-bold flex items-center justify-center gap-2 shadow-lg transition-transform active:scale-95 w-full"
                             >
                               <Smartphone size={20}/> Consultar / Pedir cita por WhatsApp
                             </a>
                           )}
                         </div>
                       )}
                    </div>
                 </div>
              </div>

              {/* 3. 购买须知 (完整版 - 5条) */}
              <div className="bg-gray-900/50 p-5 rounded-3xl border border-gray-800 mt-4">
                 <h3 className="font-bold text-gray-200 mb-5 text-sm flex items-center gap-2">
                    <Info size={16} className="text-red-500"/> Información Importante
                 </h3>
                 
                 <div className="space-y-5">
                    {/* 时间 */}
                    <div className="flex gap-4">
                       <div className="w-8 h-8 bg-gray-800 rounded-full flex items-center justify-center flex-shrink-0 border border-gray-700 text-yellow-400"><Clock size={14}/></div>
                       <div><p className="text-xs font-bold text-gray-300 uppercase tracking-wide">Horario</p><p className="text-xs text-gray-500 mt-0.5">Lunes a Domingo, de 9:00 a 22:00.</p></div>
                    </div>
                    {/* 库存等待时间 */}
                    <div className="flex gap-4">
                       <div className="w-8 h-8 bg-gray-800 rounded-full flex items-center justify-center flex-shrink-0 border border-gray-700 text-orange-400"><Package size={14}/></div>
                       <div><p className="text-xs font-bold text-gray-300 uppercase tracking-wide">Disponibilidad de Piezas</p><p className="text-xs text-gray-500 mt-0.5">Algunos modelos pueden requerir <strong>2-3 días</strong> para disponibilidad de piezas. Le notificaremos cuando esté listo.</p></div>
                    </div>
                    {/* 保修 */}
                    <div className="flex gap-4">
                       <div className="w-8 h-8 bg-gray-800 rounded-full flex items-center justify-center flex-shrink-0 border border-gray-700 text-red-400"><ShieldCheck size={14}/></div>
                       <div><p className="text-xs font-bold text-gray-300 uppercase tracking-wide">Garantía Extendida</p><p className="text-xs text-gray-500 mt-0.5">Cobertura total de <strong>6 meses</strong>.</p></div>
                    </div>
                 </div>
              </div>
           </div>
        </div>
      )}

      {/* --- ORDER QUERY PAGE (escaneo de QR de ticket o enlace del email) ---
          Decisión 2026-05-27: este bloque NO es mutuamente excluyente con el
          resto de pantallas (home/cart/products/...): cuando se entra desde
          el email transaccional, el state inicial sigue siendo `page: 'home'`,
          así que la home se renderizaba simultáneamente y ocupaba el viewport.
          El cliente veía la home y creía que el enlace estaba roto, cuando en
          realidad la consulta de pedido estaba debajo (había que hacer scroll).
          Solución: forzamos overlay a pantalla completa con `fixed inset-0`
          y `z-50` (sobre header y todo lo demás) más `overflow-y-auto` para
          que el contenido largo se desplace dentro del propio overlay. */}
      {queryOrderId && (
        <div className="fixed inset-0 z-50 bg-gray-50 overflow-y-auto p-4">
          <div className="flex items-center gap-2 mb-6 sticky top-0 bg-gray-50 z-10 py-2">
            <button onClick={() => { setQueryOrderId(null); setQueryOrder(null); navTo("home"); }} className="p-2 bg-white rounded-full shadow-sm text-gray-700">
              <ArrowLeft size={20}/>
            </button>
            <h2 className="font-bold text-xl text-gray-800">Consulta de Pedido</h2>
          </div>
          
          {queryLoading ? (
            <div className="text-center py-20">
              <Loader2 className="animate-spin mx-auto mb-4 text-red-500" size={32}/>
              <p className="text-gray-500">Cargando pedido...</p>
            </div>
          ) : queryOrder ? (
            <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 space-y-4">
              <div className="flex justify-between items-start mb-4">
                <div>
                  <span className="font-bold text-gray-800 block text-sm font-mono bg-gray-100 px-3 py-1.5 rounded-lg mb-2">
                    #{queryOrder.id.slice(0, 8).toUpperCase()}
                  </span>
                  <span className="text-xs text-gray-400">
                    {new Date(queryOrder.created_at).toLocaleString('es-ES')}
                  </span>
                </div>
                <span className={`text-xs uppercase tracking-wider px-3 py-1.5 rounded-lg font-bold ${
                  queryOrder.status === 'Entregado' ? 'bg-green-100 text-green-700' :
                  queryOrder.status === 'Pendiente de Pago' ? 'bg-orange-100 text-orange-700' :
                  'bg-blue-100 text-blue-700'
                }`}>
                  {queryOrder.status}
                </span>
              </div>

              <div className="border-t pt-4 space-y-3">
                {/* Bloque de entrega adaptado al método.
                    GET /api/orders/:orderId (público) sólo devuelve
                    delivery_method, address es opcional en respuesta;
                    si delivery_method viniera como null por datos
                    legacy lo tratamos como envío a domicilio. */}
                {queryOrder.delivery_method === 'store_pickup' ? (
                  <div>
                    <p className="text-xs font-bold text-gray-500 uppercase mb-1 flex items-center gap-1.5">
                      <Store size={12}/> Recogida en tienda
                    </p>
                    <p className="text-sm text-gray-800">HIPERA · Paseo del Sol 1, 28880 Meco (Madrid)</p>
                    <p className="text-xs text-gray-500 mt-1">Te avisaremos cuando esté listo para recoger.</p>
                  </div>
                ) : (
                  <div>
                    <p className="text-xs font-bold text-gray-500 uppercase mb-1 flex items-center gap-1.5">
                      <Truck size={12}/> Envío a domicilio
                    </p>
                    <p className="text-sm text-gray-800">{queryOrder.address || 'Cliente General'}</p>
                  </div>
                )}

                <div>
                  <p className="text-xs font-bold text-gray-500 uppercase mb-2">Productos</p>
                  <div className="space-y-2">
                    {queryOrder.items?.map((item, idx) => (
                      <div key={idx} className="flex justify-between items-center py-2 border-b border-gray-100 last:border-0">
                        <div className="flex-1">
                          <p className="text-sm font-medium text-gray-800">{item.name}</p>
                          <p className="text-xs text-gray-500">€{item.price.toFixed(2)} x {item.quantity}</p>
                        </div>
                        <p className="text-sm font-bold text-gray-900">€{(item.price * item.quantity).toFixed(2)}</p>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="flex justify-between items-center pt-3 border-t">
                  <span className="text-sm font-bold text-gray-700">Total</span>
                  <span className="text-xl font-extrabold text-gray-900">€{queryOrder.total?.toFixed(2)}</span>
                </div>

                {queryOrder.payment_method && (
                  <div className="pt-2">
                    <p className="text-xs font-bold text-gray-500 uppercase mb-1">Forma de Pago</p>
                    <p className="text-sm text-gray-800">{queryOrder.payment_method}</p>
                  </div>
                )}

                {queryOrder.note && (
                  <div className="pt-2">
                    <p className="text-xs font-bold text-gray-500 uppercase mb-1">Nota</p>
                    <p className="text-sm text-gray-600 bg-yellow-50 p-2 rounded-lg">{queryOrder.note}</p>
                  </div>
                )}

                <button 
                  onClick={() => generateInvoice(queryOrder)} 
                  className="mt-4 w-full border-2 border-red-600 text-red-600 py-3 rounded-xl text-sm font-bold flex items-center justify-center gap-2 hover:bg-red-50 transition-colors"
                >
                  <Download size={18}/> Descargar Factura / Ticket
                </button>
              </div>
            </div>
          ) : (
            <div className="text-center py-20 bg-white rounded-2xl shadow-sm">
              <div className="w-20 h-20 bg-red-100 text-red-600 rounded-full mx-auto mb-4 flex items-center justify-center">
                <X size={32}/>
              </div>
              <p className="text-gray-600 font-medium mb-2">Pedido no encontrado</p>
              <p className="text-sm text-gray-400 mb-6">Verifica que el número de pedido sea correcto</p>
              <button 
                onClick={() => { setQueryOrderId(null); navTo("home"); }} 
                className="bg-red-600 text-white px-6 py-2 rounded-xl font-bold"
              >
                Volver al inicio
              </button>
            </div>
          )}
        </div>
      )}
      
      {/* --- FAVORITES / ORDERS --- */}
      {(page === "orders" || page === "favorites") && (
        <div className="p-4 min-h-screen bg-gray-50">
          <div className="flex items-center gap-2 mb-6 sticky top-0 bg-gray-50 z-10 py-2"><button onClick={handleBack} className="p-2 bg-white rounded-full shadow-sm text-gray-700"><ArrowLeft size={20}/></button><h2 className="font-bold text-xl text-gray-800">{page === "orders" ? "Mis Pedidos" : "Mis Favoritos"}</h2></div>
          {page === "favorites" ? (
             <div className="grid grid-cols-2 gap-3">{filteredProducts.length === 0 ? <div className="col-span-2 text-center py-20 text-gray-400">No tienes favoritos aún 💔</div> : filteredProducts.map(p => renderProductCard(p))}</div>
          ) : (
             !user ? (
               <div className="text-center py-20"><div className="w-20 h-20 bg-gray-200 rounded-full mx-auto mb-4 flex items-center justify-center text-gray-400"><User size={32}/></div><p className="text-gray-500 mb-6">Inicia sesión para ver tu historial</p><button onClick={() => navigate("/login")} className="bg-gray-900 text-white px-8 py-3 rounded-xl font-bold shadow-lg">Login</button></div>
            ) : (
              <div className="space-y-4">
                <div className="bg-white p-4 rounded-xl flex justify-between items-center mb-6 border border-gray-100 shadow-sm">
                   <div className="flex items-center gap-3"><div className="w-10 h-10 bg-red-100 text-red-600 rounded-full flex items-center justify-center font-bold">{user.email[0].toUpperCase()}</div><div className="flex flex-col"><span className="text-xs text-gray-400 uppercase font-bold">Cuenta</span><span className="font-bold text-gray-800 text-sm">{user.email.split('@')[0]}</span></div></div>
                   <button
                     onClick={() => {
                       // Cierre de sesion robusto (2026-05-27, fix b):
                       // limpiamos PRIMERO los tokens de Supabase en
                       // localStorage de forma sincrona, y solo despues
                       // disparamos signOut() para revocar el token en
                       // el servidor y forzamos full reload.
                       //
                       // El intento anterior (signOut() + location.href)
                       // fallaba porque signOut() limpia localStorage de
                       // forma asincrona DESPUES de recibir la respuesta
                       // del endpoint /logout; cuando el location.href
                       // descarga la pagina, esa respuesta aun no ha
                       // llegado y localStorage conserva el token, asi
                       // que la pagina recargada vuelve a quedar
                       // logueada. Limpiar de forma sincrona elimina
                       // toda dependencia del round-trip a Supabase.
                       clearSupabaseLocalSession();
                       supabase.auth.signOut().catch(() => {});
                       window.location.href = '/';
                     }}
                     className="text-red-600 bg-red-50 p-2 rounded-lg"
                     aria-label="Cerrar sesión"
                   >
                     <LogOut size={18}/>
                   </button>
                </div>
                {myOrders.length === 0 ? <p className="text-center text-gray-400 py-10">No tienes pedidos aún.</p> : myOrders.map(order => (
                  <div key={order.id} className="bg-white p-5 rounded-2xl shadow-sm border border-gray-100">
                    <div className="flex justify-between items-start mb-3"><div><span className="font-bold text-gray-800 block text-xs font-mono bg-gray-100 px-2 py-1 rounded w-fit mb-1">#{order.id.slice(0,8)}</span><span className="text-xs text-gray-400">{new Date(order.created_at).toLocaleDateString()}</span></div><span className={`text-[10px] uppercase tracking-wider px-2 py-1 rounded-lg font-bold ${order.status==='Entregado'?'bg-green-100 text-green-700':'bg-blue-100 text-blue-700'}`}>{order.status}</span></div>
                    <div className="flex justify-between items-end border-t pt-3 border-gray-50">
                      <div className="flex items-center gap-2 text-sm text-gray-500">
                        {order.delivery_method === 'store_pickup' ? (
                          <span className="inline-flex items-center gap-1 text-blue-700 bg-blue-50 px-2 py-0.5 rounded text-[11px] font-semibold"><Store size={12}/> Recogida</span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-gray-600 bg-gray-100 px-2 py-0.5 rounded text-[11px] font-semibold"><Truck size={12}/> Envío</span>
                        )}
                        <span>· {order.items?.length || 0} productos</span>
                      </div>
                      <span className="font-extrabold text-lg text-gray-900">€{order.total?.toFixed(2)}</span>
                    </div>
                    <button 
                      onClick={() => generateInvoice(order)} 
                      className="mt-4 w-full border border-gray-200 py-2 rounded-xl text-sm font-bold text-gray-600 flex items-center justify-center gap-2 hover:bg-gray-50 transition-colors"
                    >
                      <Download size={16}/> Descargar Factura / Ticket
                    </button>
                  </div>
                ))}
              </div>
            )
          )}
        </div>
      )}

{/* --- CART PAGE (已修改：商品与服务分组显示) --- */}
      {page === "cart" && (
        <div className="flex flex-col h-[calc(100vh-80px)]">
          {/* Header */}
          <div className="p-4 bg-white shadow-sm flex items-center gap-2">
            <button onClick={handleBack} className="p-2 hover:bg-gray-100 rounded-full"><ArrowLeft className="text-gray-600"/></button>
            <h2 className="font-bold text-lg">Mi Cesta ({cart.reduce((a,b)=>a+b.quantity,0)})</h2>
            {cart.length > 0 && <button onClick={() => setCart([])} className="ml-auto text-xs text-red-500 font-bold bg-red-50 px-2 py-1 rounded">Vaciar</button>}
          </div>

          {/* Body: 分组显示逻辑 */}
          <div className="flex-1 overflow-y-auto p-4">
            {cart.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-64 text-gray-400">
                <ShoppingCart size={64} className="mb-4 text-gray-200"/>
                <p className="font-medium">Tu cesta está vacía</p>
                <button onClick={() => navTo("home")} className="mt-6 bg-red-600 text-white px-8 py-3 rounded-xl font-bold shadow-lg shadow-red-200">Empezar a comprar</button>
              </div>
            ) : (
              <div className="space-y-6">
                {/* Aviso de cierre (oculto en horario laboral) */}
                <AfterHoursNotice context="cart" />
                {/* 1. 普通商品部分 */}
                {cart.filter(i => !i.isService).length > 0 && (
                   <div className="space-y-3">
                      {/* 如果同时有服务，加个小标题区分，否则不加 */}
                      {cart.some(i => i.isService) && <h3 className="font-bold text-gray-800 text-sm flex items-center gap-2"><Package size={16}/> Productos para envío</h3>}
                      
                      {cart.filter(i => !i.isService).map(item => (
                        <div key={`${item.id}-${item.name}`} className={`flex gap-3 p-3 rounded-2xl shadow-sm border ${item.isGift ? 'bg-pink-50 border-pink-200' : 'bg-white border-gray-100'}`}>
                           <img src={item.image} alt={item.name} loading="lazy" decoding="async" className="w-20 h-20 object-cover rounded-xl bg-gray-50"/>
                           <div className="flex-1 flex flex-col justify-between py-1">
                              <div>
                                <p className="font-bold text-gray-800 line-clamp-2">{item.name}</p>
                                {item.isGift ? (
                                  <p className="text-pink-600 font-extrabold text-sm">🎁 GRATIS</p>
                                ) : (
                                  <p className="text-red-600 font-extrabold">€{item.price}</p>
                                )}
                              </div>
                              <div className="flex items-center justify-between">
                                 <div className="flex items-center gap-3 bg-gray-50 rounded-lg p-1">
                                    <button onClick={() => updateQty(item.id, item.name, -1)} className="w-7 h-7 bg-white rounded shadow-sm flex items-center justify-center text-gray-600 active:scale-90 transition-transform"><Minus size={14}/></button>
                                    <span className="text-sm font-bold w-4 text-center">{item.quantity}</span>
                                    <button onClick={() => updateQty(item.id, item.name, 1)} className="w-7 h-7 bg-gray-900 text-white rounded shadow-sm flex items-center justify-center active:scale-90 transition-transform"><Plus size={14}/></button>
                                 </div>
                                 <button onClick={() => removeFromCart(item.id, item.name)} className="text-gray-300 hover:text-red-500 p-2"><Trash2 size={18}/></button>
                              </div>
                           </div>
                        </div>
                      ))}
                   </div>
                )}

                {/* 分隔线 (只有当两种都有时才显示) */}
                {cart.some(i => !i.isService) && cart.some(i => i.isService) && (
                  <div className="border-t-2 border-dashed border-gray-200 my-4 relative">
                     <div className="absolute left-1/2 -translate-x-1/2 -top-3 bg-gray-50 px-2 text-xs text-gray-400 font-bold uppercase">Y</div>
                  </div>
                )}

                {/* 2. 维修服务部分 (强制在最下面) */}
                {cart.filter(i => i.isService).length > 0 && (
                   <div className="space-y-3">
                      <h3 className="font-bold text-gray-800 text-sm flex items-center gap-2"><Wrench size={16}/> Servicios de Taller</h3>
                      {cart.filter(i => i.isService).map(item => (
                        <div key={`${item.id}-${item.name}`} className="flex gap-3 bg-gray-800 p-3 rounded-2xl shadow-lg border border-gray-700 text-white relative overflow-hidden">
                           <div className="absolute right-0 top-0 w-20 h-20 bg-blue-500 blur-[40px] opacity-20"></div>
                           <div className="w-20 h-20 bg-gray-700 rounded-xl flex items-center justify-center text-gray-400 flex-shrink-0"><Wrench size={24}/></div>
                           <div className="flex-1 flex flex-col justify-between py-1 relative z-10">
                              <div><p className="font-bold text-gray-100 line-clamp-2">{item.name}</p><p className="text-blue-400 font-extrabold">€{item.price}</p></div>
                              <div className="flex items-center justify-between">
                                 <div className="flex items-center gap-3 bg-gray-700 rounded-lg p-1">
                                    <button onClick={() => updateQty(item.id, item.name, -1)} className="w-7 h-7 bg-gray-600 rounded shadow-sm flex items-center justify-center text-gray-300 active:scale-90 transition-transform"><Minus size={14}/></button>
                                    <span className="text-sm font-bold w-4 text-center">{item.quantity}</span>
                                    <button onClick={() => updateQty(item.id, item.name, 1)} className="w-7 h-7 bg-white text-gray-900 rounded shadow-sm flex items-center justify-center active:scale-90 transition-transform"><Plus size={14}/></button>
                                 </div>
                                 <button onClick={() => removeFromCart(item.id, item.name)} className="text-gray-500 hover:text-red-400 p-2"><Trash2 size={18}/></button>
                              </div>
                           </div>
                        </div>
                      ))}
                   </div>
                )}
              </div>
            )}
          </div>

          {/* Footer 结算区域 */}
          {cart.length > 0 && (
            <div className="bg-white p-5 shadow-[0_-4px_30px_rgba(0,0,0,0.05)] rounded-t-3xl z-20">
               <div className="space-y-2 mb-6">
                  {!isFreeShipping && (
                    <div className="text-xs text-gray-600 bg-blue-50 p-2 rounded-lg flex items-center gap-2">
                      <div className="flex-1">
                        Faltan <span className="font-bold text-blue-600">€{(FREE_SHIPPING_THRESHOLD - subtotal).toFixed(2)}</span> para envío GRATIS
                        <div className="h-1.5 w-full bg-blue-100 rounded-full mt-1 overflow-hidden">
                          <div className="h-full bg-blue-500 rounded-full transition-all duration-500" style={{width: `${Math.min((subtotal/50)*100, 100)}%`}}></div>
                        </div>
                      </div>
                      <Truck size={16} className="text-blue-400"/>
                    </div>
                  )}
                  
                  {/* 达到免运费后，显示免费商品进度条 */}
                  {isFreeShipping && !isGiftEligible && (
                    <>
                      <div className="text-xs bg-green-50 text-green-700 p-2 rounded-lg font-bold flex items-center gap-2">
                        <Truck size={14}/> ¡Envío GRATIS activado!
                      </div>
                      <div className="text-xs text-gray-600 bg-pink-50 p-2 rounded-lg flex items-center gap-2 border border-pink-200">
                        <div className="flex-1">
                          Faltan <span className="font-bold text-pink-600">€{(65 - subtotal).toFixed(2)}</span> para elegir un regalo GRATIS
                          <div className="h-1.5 w-full bg-pink-100 rounded-full mt-1 overflow-hidden">
                            <div 
                              className="h-full bg-pink-500 rounded-full transition-all duration-500" 
                              style={{width: `${Math.min(((subtotal - 50) / 15) * 100, 100)}%`}}
                            ></div>
                          </div>
                        </div>
                        <Gift size={16} className="text-pink-400 flex-shrink-0"/>
                      </div>
                    </>
                  )}
                  
                  {isFreeShipping && isGiftEligible && (
                    <>
                      <div className="text-xs bg-green-50 text-green-700 p-2 rounded-lg font-bold flex items-center gap-2">
                        <Truck size={14}/> ¡Envío GRATIS activado!
                      </div>
                      <div className="text-xs bg-pink-50 text-pink-700 p-2 rounded-lg font-bold flex items-center gap-2 border border-pink-300">
                        <Gift size={14}/> ¡Puedes elegir un regalo GRATIS en el checkout!
                      </div>
                    </>
                  )}
               </div>
               <div className="space-y-1 text-sm text-gray-500 mb-6"><div className="flex justify-between"><span>Subtotal</span><span>€{subtotal.toFixed(2)}</span></div><div className="flex justify-between"><span>Envío</span><span className={shippingFee === 0 ? "text-green-600 font-bold" : ""}>{shippingFee === 0 ? "GRATIS" : `€${shippingFee.toFixed(2)}`}</span></div><div className="flex justify-between font-extrabold text-xl text-gray-900 pt-3 border-t border-dashed"><span>Total</span><span>€{total.toFixed(2)}</span></div></div>
               {minOrderMet ? (
                 <button onClick={() => navTo("checkout")} className="w-full bg-gray-900 text-white py-4 rounded-xl font-bold text-lg shadow-xl shadow-gray-300 flex items-center justify-center gap-2 active:scale-95 transition-transform">Tramitar Pedido <ArrowRight size={20}/></button>
               ) : (
                 <button disabled className="w-full bg-gray-200 text-gray-400 py-4 rounded-xl font-bold cursor-not-allowed">Mínimo €20 (Faltan €{(20-subtotal).toFixed(2)})</button>
               )}
            </div>
          )}
        </div>
      )}

      {/* --- CHECKOUT --- */}
      {page === "checkout" && (
        <div className="p-4 bg-gray-50 min-h-screen animate-slide-up">
          <div className="flex items-center gap-2 mb-6"><button onClick={handleBack} className="p-2 bg-white rounded-full shadow-sm"><ArrowLeft size={20}/></button><h2 className="font-bold text-xl">Finalizar Compra</h2></div>
          <div className="space-y-6">
             {/* Aviso si el cliente intenta comprar fuera de horario */}
             <AfterHoursNotice context="checkout" />
             {/* Aviso de pago cancelado/incompleto al volver de Stripe */}
             {paymentCancelledNotice && (
               <div className="bg-red-50 border-2 border-red-200 rounded-2xl p-4 flex items-start gap-3">
                 <div className="p-2 bg-red-100 text-red-600 rounded-lg flex-shrink-0"><X size={18}/></div>
                 <div className="text-sm">
                   <p className="font-bold text-red-800">El pago no se completó</p>
                   <p className="text-red-700 mt-0.5">Tu carrito y tus datos siguen aquí. Revisa el método de pago y vuelve a intentarlo cuando quieras.</p>
                 </div>
               </div>
             )}
             {/* =====================================================
                 Selector de modalidad de entrega (Click & Collect)
                 -----------------------------------------------------
                 Cumple la promesa expresa de Política de Envíos §2.1
                 (recogida gratuita en HIPERA). Hasta este commit la UI
                 sólo permitía envío a domicilio y la documentación
                 legal prometía una opción que no existía. Mantener la
                 coherencia documento/UI es exigencia AEPD/LSSI y reduce
                 riesgo contractual.

                 Decisión UX: dos botones grandes apilados verticalmente
                 con icono, título y descripción de coste/plazo. La
                 modalidad activa se distingue por borde rojo y fondo
                 leve; el estado es accesible mediante aria-pressed. */}
             <div className="bg-white p-5 rounded-2xl shadow-sm space-y-3 border border-gray-100">
                <h3 className="font-bold flex items-center gap-2 text-gray-800">
                  <Truck size={18} className="text-red-600"/> Modalidad de entrega
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <button
                    type="button"
                    aria-pressed={checkoutForm.deliveryMethod === 'home_delivery'}
                    onClick={() => setCheckoutForm({...checkoutForm, deliveryMethod: 'home_delivery'})}
                    className={`text-left p-4 rounded-xl border-2 transition-all ${
                      checkoutForm.deliveryMethod === 'home_delivery'
                        ? 'border-red-500 bg-red-50/50 shadow-sm'
                        : 'border-gray-200 bg-white hover:border-gray-300'
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <Truck size={18} className={checkoutForm.deliveryMethod === 'home_delivery' ? 'text-red-600' : 'text-gray-500'}/>
                      <span className="font-bold text-gray-900 text-sm">Envío a domicilio</span>
                    </div>
                    <p className="text-xs text-gray-600 leading-relaxed">
                      {subtotal >= FREE_SHIPPING_THRESHOLD
                        ? <span className="text-green-700 font-semibold">GRATIS</span>
                        : <>€{SHIPPING_FEE_STANDARD.toFixed(2)} · GRATIS desde €{FREE_SHIPPING_THRESHOLD}</>
                      }
                    </p>
                    <p className="text-[11px] text-gray-500 mt-1">Meco y zona local. 24–72 h.</p>
                  </button>
                  <button
                    type="button"
                    aria-pressed={checkoutForm.deliveryMethod === 'store_pickup'}
                    onClick={() => setCheckoutForm({...checkoutForm, deliveryMethod: 'store_pickup'})}
                    className={`text-left p-4 rounded-xl border-2 transition-all ${
                      checkoutForm.deliveryMethod === 'store_pickup'
                        ? 'border-red-500 bg-red-50/50 shadow-sm'
                        : 'border-gray-200 bg-white hover:border-gray-300'
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <Store size={18} className={checkoutForm.deliveryMethod === 'store_pickup' ? 'text-red-600' : 'text-gray-500'}/>
                      <span className="font-bold text-gray-900 text-sm">Recoger en tienda</span>
                    </div>
                    <p className="text-xs text-gray-600 leading-relaxed">
                      <span className="text-green-700 font-semibold">GRATIS</span> · Sin envío
                    </p>
                    <p className="text-[11px] text-gray-500 mt-1">Listo en 2–4 h en horario comercial.</p>
                    {/* Anti-abuso (2026-05-27): la recogida en tienda
                        requiere cuenta. No bloqueamos la selección
                        aquí (sería confuso desactivar un botón sin
                        explicar) — al pulsar "Continuar al Pago"
                        handleInitiateCheckout muestra toast + redirect
                        a /login. Pero sí avisamos visualmente con un
                        badge para que el cliente entienda el requisito
                        antes de llegar a ese punto. */}
                    {!user && (
                      <p className="mt-2 inline-flex items-center gap-1 text-[11px] text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded font-semibold">
                        <Lock size={10}/> Requiere cuenta
                      </p>
                    )}
                  </button>
                </div>
             </div>

             <div className="bg-white p-5 rounded-2xl shadow-sm space-y-4 border border-gray-100">
                <h3 className="font-bold flex items-center gap-2 text-gray-800">
                  <MapPin size={18} className="text-red-600"/>
                  {isStorePickup ? 'Datos de contacto' : 'Datos de entrega'}
                </h3>
                <div>
                  <input id="email" name="email" type="email" autoComplete="email" inputMode="email" value={checkoutForm.email} onChange={e => setCheckoutForm({...checkoutForm, email: e.target.value})} onBlur={() => setCheckoutTouched(t => ({...t, email: true}))} placeholder="Email para la confirmación *" className={`w-full p-3.5 bg-gray-50 rounded-xl font-medium outline-none focus:ring-2 transition-all ${emailFieldError ? 'ring-2 ring-red-300 bg-red-50' : 'ring-red-100'}`}/>
                  {emailFieldError && <p className="text-xs text-red-500 mt-1 px-1">{emailFieldError}</p>}
                </div>
                {/* En recogida en tienda no se pide dirección postal: el
                    pedido se entrega físicamente en HIPERA. Mostramos en
                    su lugar una tarjeta informativa con la ubicación
                    exacta. */}
                {isStorePickup ? (
                  <div className="p-3.5 bg-blue-50 border border-blue-200 rounded-xl flex items-start gap-3">
                    <Store size={18} className="text-blue-600 mt-0.5 flex-shrink-0"/>
                    <div className="text-sm text-gray-700 leading-relaxed">
                      <p className="font-semibold text-gray-900">Recogida en HIPERA</p>
                      <p className="text-xs text-gray-600 mt-0.5">Paseo del Sol 1, 28880 Meco (Madrid)</p>
                      <p className="text-xs text-gray-500 mt-1">Te avisaremos por email o teléfono cuando esté listo.</p>
                    </div>
                  </div>
                ) : (
                  <div>
                    {/* El propio campo de dirección muestra sugerencias de
                        Google Places debajo mientras se escribe. Si no hay API
                        key, funciona como un input normal. */}
                    <AddressAutocomplete
                      value={checkoutForm.address}
                      hasError={!!addressFieldError}
                      onChange={(val) => setCheckoutForm(f => ({ ...f, address: val }))}
                      onBlur={() => setCheckoutTouched(t => ({ ...t, address: true }))}
                      onSelect={() => setCheckoutTouched(t => ({ ...t, address: true }))}
                    />
                    {addressFieldError && <p className="text-xs text-red-500 mt-1 px-1">{addressFieldError}</p>}
                    <p className="text-[11px] text-gray-400 mt-1 px-1">Escribe tu calle y elige una opción; luego añade piso/puerta si hace falta.</p>
                  </div>
                )}
                <div>
                  <input id="phone" name="phone" type="tel" autoComplete="tel" inputMode="tel" value={checkoutForm.phone} onChange={e => setCheckoutForm({...checkoutForm, phone: e.target.value})} onBlur={() => setCheckoutTouched(t => ({...t, phone: true}))} placeholder="Teléfono *" className={`w-full p-3.5 bg-gray-50 rounded-xl font-medium outline-none focus:ring-2 transition-all ${phoneFieldError ? 'ring-2 ring-red-300 bg-red-50' : 'ring-red-100'}`}/>
                  {phoneFieldError && <p className="text-xs text-red-500 mt-1 px-1">{phoneFieldError}</p>}
                </div>
                <textarea id="note" name="note" value={checkoutForm.note} onChange={e => setCheckoutForm({...checkoutForm, note: e.target.value})} placeholder={isStorePickup ? "Nota para la recogida (opcional)" : "Nota para repartidor (opcional)"} className="w-full p-3.5 bg-gray-50 rounded-xl font-medium outline-none focus:ring-2 ring-red-100 transition-all" rows={2}/>
             </div>

             {/* 免费商品选择 - 当订单 >= 65 欧元时显示 */}
             {subtotal >= 65 && (
               <div className="bg-gradient-to-br from-red-50 to-pink-50 p-5 rounded-2xl shadow-sm border-2 border-red-200">
                 <div className="flex items-center gap-2 mb-3">
                   <Gift size={20} className="text-red-600"/>
                   <h3 className="font-bold text-gray-800">¡Elige un regalo gratis!</h3>
                 </div>
                 <p className="text-sm text-gray-600 mb-4">Tu pedido supera €65. Puedes elegir un producto gratis:</p>
                 {selectedGift ? (
                   <div className="bg-white p-4 rounded-xl border-2 border-red-500 flex items-center justify-between">
                     <div className="flex items-center gap-3 flex-1">
                       <img src={selectedGift.image} alt={selectedGift.name} loading="lazy" decoding="async" className="w-16 h-16 object-cover rounded-lg"/>
                       <div className="flex-1">
                         <p className="font-bold text-gray-800 text-sm">{selectedGift.name}</p>
                         <p className="text-xs text-red-600 font-bold">GRATIS</p>
                       </div>
                     </div>
                     <button 
                       onClick={() => setSelectedGift(null)}
                       className="text-gray-400 hover:text-red-600 p-2"
                       title="Cambiar regalo"
                     >
                       <X size={18}/>
                     </button>
                   </div>
                 ) : (
                   <div className="grid grid-cols-2 gap-3 max-h-64 overflow-y-auto">
                     {(() => {
                       const giftProducts = products.filter(p => p.giftProduct && p.stock > 0);
                       return giftProducts.length > 0 ? (
                         giftProducts.map(p => (
                           <button
                             key={p.id}
                             onClick={() => setSelectedGift(p)}
                             className="bg-white p-3 rounded-xl border-2 border-gray-200 hover:border-red-500 transition-all text-left active:scale-95"
                           >
                             <img src={p.image} alt={p.name} loading="lazy" decoding="async" className="w-full h-20 object-cover rounded-lg mb-2"/>
                             <p className="text-xs font-bold text-gray-800 line-clamp-3 mb-1">{p.name}</p>
                             <p className="text-xs text-red-600 font-bold">GRATIS</p>
                           </button>
                         ))
                       ) : (
                         <div className="col-span-2 text-center py-4 text-gray-400 text-sm space-y-2">
                           <p>No hay productos de regalo disponibles</p>
                           <p className="text-xs text-gray-500">提示：需要在后台将产品标记为"Producto de Regalo"</p>
                         </div>
                       );
                     })()}
                   </div>
                 )}
               </div>
             )}

            {/* =====================================================
                Método de pago (inline, en la propia página).
                -----------------------------------------------------
                Antes vivía en un modal aparte (PaymentModal). Se movió
                aquí (2026-05-29) por dos motivos de UX reportados:
                  - El modal tenía una X que no respondía bien.
                  - Tras cancelar en Stripe, el cliente quería volver a
                    ESTA página y reintentar, no a un modal/inicio.
                Disponibilidad por método:
                  - Stripe: todos (pago anticipado, sin riesgo de abuso).
                  - Contra reembolso / pago en tienda: requiere cuenta
                    (sin prepago → riesgo de no-show). Anónimo: al pulsar
                    redirige a /login.
                  - Bizum manual: todos (transferencia previa = fricción).*/}
            <div className="bg-white p-5 rounded-2xl shadow-sm space-y-3 border border-gray-100">
               <h3 className="font-bold flex items-center gap-2 text-gray-800">
                 <Wallet size={18} className="text-red-600"/> Método de pago
               </h3>

               {/* Stripe (tarjeta / Bizum / Apple-Google Pay) */}
               <button
                 type="button"
                 onClick={() => setSelectedPayment('stripe')}
                 className={`relative w-full p-4 rounded-xl border-2 transition-all text-left ${
                   selectedPayment === 'stripe'
                     ? 'border-indigo-600 bg-indigo-50'
                     : 'border-gray-200 hover:border-gray-300 bg-white'
                 }`}
               >
                 <span className="absolute -top-2 right-3 bg-indigo-600 text-white text-[10px] font-bold px-2 py-0.5 rounded-full shadow">Recomendado</span>
                 <div className="flex items-center gap-3">
                   <div className={`p-2 rounded-lg ${selectedPayment === 'stripe' ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-600'}`}>
                     <CreditCard size={20}/>
                   </div>
                   <div className="flex-1">
                     <p className="font-bold text-gray-900">Tarjeta, Bizum, Apple/Google Pay</p>
                     <p className="text-xs text-gray-500 mt-0.5">Pago seguro online · procesado por Stripe</p>
                   </div>
                   {selectedPayment === 'stripe' && <CheckCircle2 size={20} className="text-indigo-600"/>}
                 </div>
               </button>

               {/* Contra reembolso / pago en tienda (requiere cuenta) */}
               <button
                 type="button"
                 aria-disabled={!user}
                 onClick={() => {
                   if (!user) {
                     toast('Inicia sesión para usar este método de pago', { icon: 'ℹ️' });
                     setTimeout(() => navigate('/login'), 800);
                     return;
                   }
                   setSelectedPayment('contra_reembolso');
                 }}
                 className={`relative w-full p-4 rounded-xl border-2 transition-all text-left ${
                   !user
                     ? 'border-gray-200 bg-gray-50 cursor-pointer'
                     : selectedPayment === 'contra_reembolso'
                       ? 'border-blue-600 bg-blue-50'
                       : 'border-gray-200 hover:border-gray-300 bg-white'
                 }`}
               >
                 <div className={`flex items-center gap-3 ${!user ? 'opacity-60' : ''}`}>
                   <div className={`p-2 rounded-lg ${selectedPayment === 'contra_reembolso' && user ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600'}`}>
                     <Wallet size={20}/>
                   </div>
                   <div className="flex-1">
                     <p className="font-bold text-gray-900">{isStorePickup ? 'Pagar en tienda al recoger' : 'Pago Contra Reembolso'}</p>
                     <p className="text-xs text-gray-500 mt-0.5">{isStorePickup ? 'En efectivo o tarjeta en HIPERA' : 'Paga cuando recibas tu pedido'}</p>
                   </div>
                   {selectedPayment === 'contra_reembolso' && user && <CheckCircle2 size={20} className="text-blue-600"/>}
                 </div>
                 {!user && (
                   <div className="mt-2 flex items-center justify-between gap-2 text-xs">
                     <span className="inline-flex items-center gap-1 text-amber-700 bg-amber-50 border border-amber-200 px-2 py-1 rounded-md font-semibold">
                       <Lock size={12}/> Requiere cuenta
                     </span>
                     <span className="text-blue-600 font-semibold underline">Iniciar sesión</span>
                   </div>
                 )}
               </button>

               {/* Bizum manual */}
               <button
                 type="button"
                 onClick={() => setSelectedPayment('bizum')}
                 className={`w-full p-4 rounded-xl border-2 transition-all text-left ${
                   selectedPayment === 'bizum'
                     ? 'border-green-600 bg-green-50'
                     : 'border-gray-200 hover:border-gray-300 bg-white'
                 }`}
               >
                 <div className="flex items-center gap-3">
                   <div className={`p-2 rounded-lg ${selectedPayment === 'bizum' ? 'bg-green-600 text-white' : 'bg-gray-100 text-gray-600'}`}>
                     <Smartphone size={20}/>
                   </div>
                   <div className="flex-1">
                     <p className="font-bold text-gray-900">Bizum manual</p>
                     <p className="text-xs text-gray-500 mt-0.5">Transferencia al número de la tienda</p>
                   </div>
                   {selectedPayment === 'bizum' && <CheckCircle2 size={20} className="text-green-600"/>}
                 </div>
               </button>

               {selectedPayment === 'bizum' && (
                 <div className="bg-green-50 border border-green-200 rounded-xl p-3 text-xs text-green-700">
                   <p className="font-bold mb-1">📱 Instrucciones Bizum:</p>
                   <p>Envía el pago al número: <strong>640517893</strong></p>
                   <p className="mt-1">Concepto: Pedido HIPERA</p>
                 </div>
               )}
               {selectedPayment === 'contra_reembolso' && user && (
                 <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 text-xs text-blue-700">
                   <p className="font-bold mb-1">{isStorePickup ? '🏪 Pago en tienda:' : '💵 Pago contra reembolso:'}</p>
                   <p>
                     {isStorePickup
                       ? 'Pagarás el importe total cuando recojas el pedido en HIPERA (Paseo del Sol 1, Meco). Aceptamos efectivo y tarjeta.'
                       : 'Pagarás el importe total cuando recibas tu pedido en casa.'}
                   </p>
                 </div>
               )}
            </div>

             {checkoutNeedsTermsCheckbox && (
               <label className="flex items-start gap-3 p-3 rounded-xl border border-gray-200 bg-white">
                 <input
                   type="checkbox"
                   checked={checkoutTermsAccepted}
                   onChange={e => setCheckoutTermsAccepted(e.target.checked)}
                   className="mt-1 h-4 w-4 accent-red-600 cursor-pointer flex-shrink-0"
                 />
                 <span className="text-xs text-gray-600 leading-relaxed">
                   He leído y acepto la{' '}
                   <button type="button" onClick={() => { setLegalType('privacidad'); navTo('legal'); }} className="text-red-600 font-medium underline">
                     Política de Privacidad
                   </button>{' '}
                   y los{' '}
                   <button type="button" onClick={() => { setLegalType('terminos'); navTo('legal'); }} className="text-red-600 font-medium underline">
                     Términos y Condiciones
                   </button>
                   .
                 </span>
               </label>
             )}

             {/* Resumen del pedido: visible justo antes de pagar para que
                 el cliente confirme productos e importe sin volver atrás. */}
             <div className="bg-white p-5 rounded-2xl shadow-sm space-y-3 border border-gray-100">
               <h3 className="font-bold flex items-center gap-2 text-gray-800">
                 <ClipboardList size={18} className="text-red-600"/> Resumen del pedido
               </h3>
               <div className="space-y-2">
                 {cart.map(item => (
                   <div key={item.id} className="flex items-center gap-3 text-sm">
                     <img src={item.image} alt={item.name} loading="lazy" decoding="async" className="w-10 h-10 object-cover rounded-lg flex-shrink-0"/>
                     <div className="flex-1 min-w-0">
                       <p className="font-medium text-gray-800 truncate">{item.name}</p>
                       <p className="text-xs text-gray-500">{item.quantity} × €{item.price.toFixed(2)}</p>
                     </div>
                     <span className="font-semibold text-gray-800 flex-shrink-0">€{(item.price * item.quantity).toFixed(2)}</span>
                   </div>
                 ))}
                 {selectedGift && (
                   <div className="flex items-center gap-3 text-sm">
                     <img src={selectedGift.image} alt={selectedGift.name} loading="lazy" decoding="async" className="w-10 h-10 object-cover rounded-lg flex-shrink-0"/>
                     <div className="flex-1 min-w-0">
                       <p className="font-medium text-gray-800 truncate">{selectedGift.name}</p>
                       <p className="text-xs text-red-600 font-bold">Regalo</p>
                     </div>
                     <span className="font-semibold text-red-600 flex-shrink-0">GRATIS</span>
                   </div>
                 )}
               </div>

               {/* Cupón de descuento */}
               <div className="border-t border-gray-100 pt-3">
                 {appliedCoupon ? (
                   <div className="flex items-center justify-between gap-2 bg-green-50 border border-green-200 rounded-xl px-3 py-2">
                     <span className="inline-flex items-center gap-1.5 text-sm font-bold text-green-700">
                       <Percent size={14}/> {appliedCoupon.code}
                       {subtotal < appliedCoupon.minSubtotal && (
                         <span className="text-[11px] font-medium text-amber-700">
                           (mín. €{appliedCoupon.minSubtotal.toFixed(2)})
                         </span>
                       )}
                     </span>
                     <button type="button" onClick={handleRemoveCoupon} className="text-gray-400 hover:text-red-600 p-1" title="Quitar cupón">
                       <X size={16}/>
                     </button>
                   </div>
                 ) : (
                   <div className="flex items-stretch gap-2">
                     <input
                      value={couponInput}
                      onChange={e => { setCouponInput(e.target.value); if (couponError) { setCouponError(''); setCouponErrorReason(''); } }}
                       onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleApplyCoupon(); } }}
                       placeholder="Código de descuento"
                       autoCapitalize="characters"
                       className="flex-1 min-w-0 p-2.5 bg-gray-50 rounded-xl text-sm font-medium outline-none focus:ring-2 ring-red-100 uppercase placeholder:normal-case placeholder:font-normal"
                     />
                     <button
                       type="button"
                       onClick={handleApplyCoupon}
                       disabled={couponLoading || !couponInput.trim()}
                       className="px-4 rounded-xl bg-gray-800 text-white text-sm font-bold active:scale-95 transition-transform disabled:opacity-40 disabled:active:scale-100 flex items-center justify-center"
                     >
                       {couponLoading ? <Loader2 size={16} className="animate-spin"/> : 'Aplicar'}
                     </button>
                   </div>
                 )}
                {couponError && <p className="text-xs text-red-600 mt-1.5">{couponError}</p>}
                {couponErrorReason === 'LOGIN_REQUIRED' && (
                  <div className="mt-2 bg-red-50 border border-red-100 rounded-xl p-3">
                    <p className="text-xs text-gray-600 mb-2">
                      Inicia sesión para usar este cupón. <span className="font-semibold">Tu carrito se mantiene.</span> ¿Prefieres no registrarte? Prueba el código <span className="font-bold">BIENVENIDA5</span> (5 %, válido sin cuenta).
                    </p>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => { try { sessionStorage.setItem('hipera_post_auth_redirect', 'checkout'); } catch { /* ignore */ } navigate('/login'); }}
                        className="flex-1 inline-flex items-center justify-center gap-1.5 bg-red-600 text-white text-sm font-bold py-2 rounded-lg hover:bg-red-700 transition-colors"
                      >
                        <LogIn size={16}/> Iniciar sesión
                      </button>
                      <button
                        type="button"
                        onClick={() => { try { sessionStorage.setItem('hipera_post_auth_redirect', 'checkout'); } catch { /* ignore */ } navigate('/register'); }}
                        className="flex-1 inline-flex items-center justify-center gap-1.5 border border-red-200 text-red-700 text-sm font-bold py-2 rounded-lg hover:bg-red-50 transition-colors"
                      >
                        Crear cuenta
                      </button>
                    </div>
                  </div>
                )}
              </div>

               <div className="border-t border-gray-100 pt-3 space-y-1.5 text-sm">
                 <div className="flex justify-between text-gray-600">
                   <span>Subtotal</span>
                   <span className="font-medium text-gray-800">€{subtotal.toFixed(2)}</span>
                 </div>
                 {discount > 0 && (
                   <div className="flex justify-between text-green-700">
                     <span>Descuento ({appliedCoupon?.code})</span>
                     <span className="font-semibold">−€{discount.toFixed(2)}</span>
                   </div>
                 )}
                 <div className="flex justify-between text-gray-600">
                   <span>{isStorePickup ? 'Recogida en tienda' : 'Envío'}</span>
                   <span className="font-medium">{shippingFee === 0 ? <span className="text-green-700 font-semibold">GRATIS</span> : `€${shippingFee.toFixed(2)}`}</span>
                 </div>
                 <div className="flex justify-between items-center pt-1.5 border-t border-gray-100">
                   <span className="font-bold text-gray-900">Total</span>
                   <span className="font-bold text-lg text-red-600">€{total.toFixed(2)}</span>
                 </div>
               </div>
             </div>

            {/* Botón de acción.
                Decisión UX (2026-05-26): NO usamos `disabled` nativo (salvo
                mientras procesa). Si el botón quedaba bloqueado el cliente no
                veía por qué; en su lugar `handleInitiateCheckout` muestra
                toasts específicos por cada requisito faltante (email,
                dirección, teléfono, consentimiento, método de pago).
                Mantenemos el efecto visual de "no listo" con opacidad. */}
            {(() => {
              // En store_pickup no se exige address. El resto de campos +
              // método de pago son obligatorios para considerar "listo".
              const checkoutReady =
                isEmailFormatOk(checkoutForm.email) &&
                (isStorePickup || isAddressFormatOk(checkoutForm.address)) &&
                isPhoneFormatOk(checkoutForm.phone) &&
                (!checkoutNeedsTermsCheckbox || checkoutTermsAccepted) &&
                !!selectedPayment;
              const label = isProcessingPayment
                ? 'Procesando…'
                : !selectedPayment
                  ? 'Elige un método de pago'
                  : selectedPayment === 'stripe'
                    ? `Pagar €${total.toFixed(2)} de forma segura`
                    : selectedPayment === 'contra_reembolso'
                      ? `Confirmar Pedido €${total.toFixed(2)}`
                      : `Confirmar con Bizum €${total.toFixed(2)}`;
              return (
                <button
                  onClick={handleInitiateCheckout}
                  disabled={isProcessingPayment}
                  aria-disabled={!checkoutReady}
                  className={`w-full bg-red-600 text-white py-4 rounded-xl font-bold text-lg shadow-xl shadow-red-200 active:scale-95 transition-transform flex justify-center items-center gap-2 disabled:active:scale-100 ${checkoutReady && !isProcessingPayment ? '' : 'opacity-50 shadow-none cursor-not-allowed'}`}
                >
                  {isProcessingPayment
                    ? <Loader2 size={20} className="animate-spin"/>
                    : selectedPayment === 'stripe'
                      ? <Lock size={18}/>
                      : <Wallet size={20}/>}
                  {label}
                </button>
              );
            })()}
            {/* Cloudflare Turnstile montado al entrar al checkout para
                que esté listo cuando el cliente pulse "Confirmar".
                El widget es invisible salvo que Cloudflare decida
                desafiar (raro en clientes humanos). */}
            <TurnstileGate ref={turnstileRef} />
          </div>

          {/* Modal de confirmación de datos de entrega. Se abre tras pasar
              todas las validaciones y antes de cobrar/crear el pedido. */}
          {showConfirmModal && (
            <div
              className="fixed inset-0 z-[60] bg-black/50 flex items-end sm:items-center justify-center p-0 sm:p-4"
              onClick={() => { if (!isProcessingPayment) setShowConfirmModal(false); }}
            >
              <div
                className="bg-white w-full sm:max-w-md rounded-t-3xl sm:rounded-2xl shadow-2xl max-h-[90vh] overflow-y-auto"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="p-5 border-b border-gray-100 flex items-center justify-between sticky top-0 bg-white">
                  <h3 className="font-bold text-lg text-gray-800 flex items-center gap-2">
                    <CheckCircle2 size={20} className="text-red-600"/> Revisa tus datos
                  </h3>
                  <button
                    onClick={() => setShowConfirmModal(false)}
                    disabled={isProcessingPayment}
                    className="text-gray-400 hover:text-gray-700 p-1 disabled:opacity-40"
                    aria-label="Cerrar"
                  >
                    <X size={22}/>
                  </button>
                </div>
                <div className="p-5 space-y-3 text-sm">
                  <p className="text-gray-500 text-xs">
                    Comprueba que todo es correcto antes de confirmar. Si algo está mal, pulsa «Editar».
                  </p>
                  <div className="flex items-start gap-3">
                    {isStorePickup
                      ? <Store size={18} className="text-red-600 mt-0.5 flex-shrink-0"/>
                      : <Truck size={18} className="text-red-600 mt-0.5 flex-shrink-0"/>}
                    <div>
                      <p className="text-gray-400 text-xs">Entrega</p>
                      <p className="font-semibold text-gray-800">
                        {isStorePickup
                          ? 'Recogida en tienda (HIPERA, Paseo del Sol 1, Meco)'
                          : 'Envío a domicilio'}
                      </p>
                    </div>
                  </div>
                  {!isStorePickup && (
                    <div className="flex items-start gap-3">
                      <MapPin size={18} className="text-red-600 mt-0.5 flex-shrink-0"/>
                      <div>
                        <p className="text-gray-400 text-xs">Dirección</p>
                        <p className="font-semibold text-gray-800 break-words">{checkoutForm.address}</p>
                      </div>
                    </div>
                  )}
                  <div className="flex items-start gap-3">
                    <Phone size={18} className="text-red-600 mt-0.5 flex-shrink-0"/>
                    <div>
                      <p className="text-gray-400 text-xs">Teléfono</p>
                      <p className="font-semibold text-gray-800">{checkoutForm.phone}</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <Mail size={18} className="text-red-600 mt-0.5 flex-shrink-0"/>
                    <div>
                      <p className="text-gray-400 text-xs">Email</p>
                      <p className="font-semibold text-gray-800 break-words">{checkoutForm.email}</p>
                    </div>
                  </div>
                  {checkoutForm.note?.trim() && (
                    <div className="flex items-start gap-3">
                      <FileText size={18} className="text-red-600 mt-0.5 flex-shrink-0"/>
                      <div>
                        <p className="text-gray-400 text-xs">Nota</p>
                        <p className="font-semibold text-gray-800 break-words">{checkoutForm.note}</p>
                      </div>
                    </div>
                  )}
                  <div className="flex items-center justify-between pt-3 border-t border-gray-100">
                    <span className="text-gray-500">Total</span>
                    <span className="font-bold text-lg text-red-600">€{total.toFixed(2)}</span>
                  </div>
                </div>
                <div className="p-5 pt-0 flex gap-3">
                  <button
                    onClick={() => setShowConfirmModal(false)}
                    disabled={isProcessingPayment}
                    className="flex-1 py-3 rounded-xl font-bold border border-gray-200 text-gray-700 hover:bg-gray-50 disabled:opacity-40 transition-colors"
                  >
                    Editar
                  </button>
                  <button
                    onClick={handleConfirmedSubmit}
                    disabled={isProcessingPayment}
                    className="flex-1 py-3 rounded-xl font-bold bg-red-600 text-white shadow-lg shadow-red-200 hover:bg-red-700 flex items-center justify-center gap-2 disabled:opacity-60 transition-colors"
                  >
                    {isProcessingPayment
                      ? <Loader2 size={18} className="animate-spin"/>
                      : (selectedPayment === 'stripe' ? <Lock size={16}/> : <CheckCircle2 size={16}/>)}
                    {isProcessingPayment
                      ? 'Procesando…'
                      : (selectedPayment === 'stripe' ? 'Pagar' : 'Confirmar')}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* --- PRODUCT LIST PAGES --- */}
      {(page === "offers" || page === "products" || page === "sub" || page === "main") && (
        <div className="p-4 min-h-screen">
          <div className="flex items-center gap-2 mb-4 sticky top-20 z-30 bg-gray-50/90 backdrop-blur-sm py-2">
            <button onClick={handleBack} className="w-8 h-8 bg-white rounded-full shadow-sm flex items-center justify-center text-gray-700 active:scale-90 transition-transform"><ArrowLeft size={18}/></button>
            <h2 className="font-bold text-lg text-gray-800">{page === "offers" && "Todas las Ofertas"}{page === "main" && "Categorías"}{page === "sub" && mainCat?.name}{page === "products" && subCat?.name}</h2>
          </div>
          {page === "main" ? (
             <div className="grid grid-cols-2 gap-3">{categories.map(c => <button key={c.id} className="bg-white p-4 rounded-xl shadow-sm text-left flex flex-col justify-between h-24 border-l-4 border-red-500 active:scale-95 transition-transform" onClick={() => {setMainCat(c); setSubCat(null); navTo("sub");}}><span className="font-bold text-lg text-gray-800">{c.name}</span><ChevronRight size={18} className="text-gray-300 self-end"/></button>)}</div>
          ) : page === "sub" ? (
             <div className="space-y-6">
               {/* 子类别选项 - 固定在顶部 */}
               <div className="sticky top-20 z-20 bg-gray-50/95 backdrop-blur-sm -mx-4 px-4 pt-2 pb-4 border-b border-gray-200">
                 <h3 className="text-sm font-bold text-gray-500 mb-3 uppercase">Subcategorías</h3>
                 <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide snap-x snap-mandatory -mx-1 px-1">
                   {subCategories.filter(s => s.parent_id === mainCat?.id).map(s => (
                     <button 
                       key={s.id} 
                       className={`px-4 py-2 rounded-xl font-medium text-sm whitespace-nowrap snap-start flex-shrink-0 transition-all ${
                         subCat?.id === s.id 
                           ? 'bg-red-600 text-white shadow-md' 
                           : 'bg-white text-gray-700 hover:bg-gray-100'
                       }`}
                       onClick={() => {
                         if (subCat?.id === s.id) {
                           setSubCat(null); // 取消选择
                         } else {
                           setSubCat(s); // 选择子类别
                         }
                       }}
                     >
                       {s.name}
                     </button>
                   ))}
                 </div>
               </div>
               {/* 商品列表 - 显示这个大类别下的所有商品 */}
               <div>
                 <h3 className="text-sm font-bold text-gray-500 mb-3 uppercase">
                   {subCat ? `Productos: ${subCat.name}` : 'Todos los productos'}
                 </h3>
                 <div className="grid grid-cols-2 gap-3">
                   {loading ? (
                     <div className="col-span-2 text-center py-20">
                       <Loader2 className="animate-spin mx-auto mb-2 text-red-500"/>Cargando...
                     </div>
                   ) : (
                     products.filter(p => {
                       const mainMatch = mainCat ? p.category === mainCat.id : true;
                       const subMatch = subCat ? p.subCategoryId === subCat.id : true;
                       const searchMatch = p.name?.toLowerCase().includes(searchQuery.toLowerCase());
                       return mainMatch && subMatch && searchMatch;
                     }).map(p => renderProductCard(p))
                   )}
                 </div>
               </div>
             </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">{loading ? <div className="col-span-2 text-center py-20"><Loader2 className="animate-spin mx-auto mb-2 text-red-500"/>Cargando...</div> : products.filter(p => { const mainMatch = mainCat ? p.category === mainCat.id : true; const subMatch = subCat ? p.subCategoryId === subCat.id : true; const searchMatch = p.name?.toLowerCase().includes(searchQuery.toLowerCase()); return mainMatch && subMatch && searchMatch && (page === "offers" ? p.oferta : true); }).map(p => renderProductCard(p))}</div>
          )}
        </div>
      )}

{/* --- DETAIL PAGE (已修正：显示真实描述) --- */}
      {page === "detail" && selectedProduct && (
        <div className="bg-white min-h-screen pb-24">
          {/* 顶部商品图：完整展示，下拉可看全图 */}
          <div className="relative bg-gray-50">
            <img
              src={selectedProduct.image}
              alt={selectedProduct.name}
              className="w-full h-auto max-h-[85vh] object-contain object-center block"
            />
            <div className="absolute bottom-0 left-0 right-0 h-20 bg-gradient-to-t from-black/25 to-transparent pointer-events-none" aria-hidden="true" />
            <button onClick={handleBack} className="absolute top-4 left-4 w-10 h-10 bg-white/20 backdrop-blur-md rounded-full flex items-center justify-center text-white active:bg-white/40"><ArrowLeft size={24}/></button>
          </div>
          
          {/* 内容卡片 */}
          <div className="p-6 -mt-10 bg-white rounded-t-[2.5rem] relative z-10 min-h-[50vh] shadow-[0_-10px_40px_rgba(0,0,0,0.1)]">
             <div className="w-12 h-1.5 bg-gray-200 rounded-full mx-auto mb-8"></div>
             
             {/* 标题和价格 */}
             <div className="flex justify-between items-start mb-2">
               <h2 className="text-2xl font-extrabold text-gray-900 w-3/4 leading-tight">{selectedProduct.name}</h2>
               <div className="text-right">
                 <p className="text-3xl font-extrabold text-red-600">€{selectedProduct.price.toFixed(2)}</p>
                 {selectedProduct.oferta && (() => { const orig = getOriginalPrice(selectedProduct); return orig != null ? <p className="text-sm text-gray-400 line-through">€{orig.toFixed(2)}</p> : null; })()}
               </div>
             </div>
             
             {/* 标签 */}
             <div className="flex gap-2 mb-6">
               {selectedProduct.stock > 0 ? <span className="text-[10px] uppercase bg-green-100 text-green-700 px-2 py-1 rounded-lg font-bold">En Stock: {selectedProduct.stock}</span> : <span className="text-[10px] uppercase bg-red-100 text-red-700 px-2 py-1 rounded-lg font-bold">Agotado</span>}
               {selectedProduct.oferta && <span className="text-[10px] uppercase bg-red-100 text-red-600 px-2 py-1 rounded-lg font-bold">Oferta</span>}
             </div>
             
             {/* 👇👇👇 这里是关键修改：描述区域 👇👇👇 */}
             <div className="bg-gray-50 p-5 rounded-2xl mb-6">
               <h4 className="font-bold text-gray-800 text-sm mb-2">Descripción</h4>
               <p className="text-gray-500 text-sm leading-relaxed whitespace-pre-line">
                 {/* 如果数据库有描述，显示数据库的；如果没有，显示默认的废话 */}
                 {selectedProduct.description || "Producto seleccionado por su calidad y frescura. Ideal para el consumo diario de toda la familia."}
               </p>
             </div>
             {/* 👆👆👆 修改结束 👆👆👆 */}

             {/* 推荐商品 - 手机端缩小卡片 */}
             <div className="mb-8">
               <h4 className="font-bold text-gray-800 text-sm mb-3">Quizás te interese</h4>
               <div className="flex gap-2 md:gap-3 overflow-x-auto pb-4 -mx-1 px-1 scrollbar-hide snap-x snap-mandatory">
                 {products.filter(p => p.category === selectedProduct.category && p.id !== selectedProduct.id).slice(0, 4).map(p => (
                   <div key={p.id} onClick={() => {setSelectedProduct(p); window.scrollTo(0,0);}} className="min-w-[100px] sm:min-w-[120px] md:min-w-[140px] w-[100px] sm:w-[120px] md:w-[140px] flex-shrink-0 snap-start bg-gray-50 p-1.5 md:p-2 rounded-xl border border-gray-100 cursor-pointer active:scale-95 transition-transform">
                     <img src={p.image} alt={p.name} loading="lazy" decoding="async" className="w-full aspect-square object-cover rounded-lg mb-1.5 md:mb-2"/>
                     <p className="text-[11px] md:text-xs font-bold text-gray-700 line-clamp-2">{p.name}</p>
                     <p className="text-[11px] md:text-xs font-bold text-red-600">€{p.price}</p>
                   </div>
                 ))}
               </div>
             </div>
          </div>
          
          {/* 底部加购栏 — centrado y con el ancho de la columna en pantallas anchas */}
          <div className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-md p-4 bg-white border-t border-gray-100 z-20">
            <button onClick={() => { addToCart(selectedProduct); handleBack(); }} disabled={selectedProduct.stock <= 0} className="w-full bg-gray-900 text-white py-4 rounded-2xl font-bold text-lg shadow-xl shadow-gray-300 disabled:bg-gray-300 disabled:shadow-none active:scale-95 transition-transform flex justify-center items-center gap-2">
              {selectedProduct.stock > 0 ? <><Plus size={20}/> Añadir a la cesta</> : "Agotado"}
            </button>
          </div>
        </div>
      )}
      
      {/* --- FOOTER --- */}
      {page === "home" && (
        <footer className="bg-white mt-10 p-8 border-t border-gray-100 text-center">
          <div className="w-10 h-10 bg-gray-900 rounded-xl flex items-center justify-center text-white font-bold mx-auto mb-4 shadow-lg">H</div>
          <h3 className="font-bold text-gray-900 mb-1">HIPERA</h3>
          <p className="text-gray-400 text-xs mb-6">Tu mercado de confianza desde 2024</p>
          <div className="mb-8 space-y-2 border-b border-gray-50 pb-6 mx-auto max-w-xs">
             <a
               href="https://www.google.com/maps/search/?api=1&query=Paseo+del+Sol+1%2C+28880+Meco%2C+Madrid"
               target="_blank"
               rel="noopener noreferrer"
               className="flex items-center justify-center gap-2 text-xs font-medium text-gray-600 hover:text-red-600 transition-colors"
             >
                <MapPin size={14} className="text-red-600"/>
                <span>Paseo del Sol 1, 28880 Meco</span>
             </a>
             <a
               href="tel:+34918782602"
               className="flex items-center justify-center gap-2 text-xs font-medium text-gray-600 hover:text-red-600 transition-colors"
             >
                <Phone size={14} className="text-red-600"/>
                <span>+34 918 782 602</span>
             </a>
             <div className="flex items-center justify-center gap-2 text-xs font-medium text-gray-600">
                <Clock size={14} className="text-red-600"/>
                <span>Lunes a Domingo: 9:00 - 22:00</span>
             </div>
          </div>

          {/* 新增的法律链接区 */}
          <div className="flex flex-wrap justify-center gap-4 text-xs font-bold text-gray-400">
             <button onClick={() => { setLegalType("aviso"); navTo("legal"); }} className="hover:text-gray-900 transition-colors">Aviso Legal</button>
             <button onClick={() => { setLegalType("privacidad"); navTo("legal"); }} className="hover:text-gray-900 transition-colors">Privacidad</button>
             <button onClick={() => { setLegalType("terminos"); navTo("legal"); }} className="hover:text-gray-900 transition-colors">Términos y Condiciones</button>
             <button onClick={() => { setLegalType("cookies"); navTo("legal"); }} className="hover:text-gray-900 transition-colors">Cookies</button>
             <button onClick={() => { setLegalType("devoluciones"); navTo("legal"); }} className="hover:text-gray-900 transition-colors">Devoluciones</button>
             <button onClick={() => { setLegalType("envios"); navTo("legal"); }} className="hover:text-gray-900 transition-colors">Envíos</button>
             <button onClick={openCookieSettings} className="hover:text-gray-900 transition-colors">Gestionar cookies</button>
          </div>
          
          <p className="text-[10px] text-gray-300 mt-6">© {new Date().getFullYear()} QIANG GUO SL. Todos los derechos reservados.</p>
        </footer>
      )}
    </div>
  );
}