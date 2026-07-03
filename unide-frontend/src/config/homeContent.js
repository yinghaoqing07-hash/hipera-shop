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
export const BANNERS = [
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
export const PROMO_NOTICE = 'Promoción de bienvenida válida hasta el 30/08/2026.';

// "Más vendidos" en la home: oculto hasta tener datos REALES de ventas.
// Hoy sólo mostraría "productos sin oferta" etiquetados como populares, lo
// cual es información inventada. Poner a true cuando exista ranking real.
export const SHOW_MAS_VENDIDOS = false;
