// =====================================================================
// IvaLookup.jsx — Consulta de IVA por EAN o nombre (referencia UNIDE)
// =====================================================================
// Herramienta interna del panel de administración para averiguar el tipo
// de IVA (4 % / 10 % / 21 %) de un artículo del catálogo de UNIDE.
//
// TRES FORMAS DE ENTRAR EL CÓDIGO (de más a menos cómoda en tienda):
//   1. PISTOLA USB del mostrador (keyboard wedge): la pistola "teclea" los
//      dígitos muy rápido y termina con Enter. Esta pantalla lo captura
//      GLOBALMENTE — no hace falta tener el campo de búsqueda enfocado.
//      Es el mismo hardware del TPV: instantáneo y sin fallos.
//   2. Cámara del móvil: BarcodeDetector nativo (= motor ML Kit, como las
//      apps de caja) con enfoque continuo, zoom 2× y linterna; quagga2 de
//      fallback donde no existe (p. ej. Chrome de escritorio en Windows).
//      Ver components/BarcodeScannerOverlay.jsx.
//   3. Teclear el EAN o el nombre a mano.
//
// MATCHING DE EAN — NORMALIZACIÓN DE CEROS:
//   El listado UNIDE mezcla longitudes (13 dígitos EAN-13, 12 dígitos
//   UPC-A sin el cero inicial, y códigos internos cortos). Un escáner
//   devuelve EAN-13 con cero delante donde UNIDE guardó 12 dígitos → el
//   match exacto fallaba aunque el código fuera correcto. Por eso el
//   índice y las consultas comparan SIN ceros a la izquierda.
//
// DATOS: /unide-iva.json (~1,3 MB) cargado en diferido y cacheado a nivel
// de módulo. Formato: { e: ean, d: descripción, i: iva, p: pvp, c: código }.
// =====================================================================

import { useEffect, useMemo, useRef, useState } from 'react';
import { ScanLine, Search, X, AlertCircle } from 'lucide-react';
import BarcodeScannerOverlay from './BarcodeScannerOverlay';

// Caché a nivel de módulo: si el usuario cambia de pestaña y vuelve, no
// se vuelve a descargar ni a reindexar el JSON.
let DATA_CACHE = null;

// Clave de comparación de códigos: solo dígitos y sin ceros a la izquierda
// (EAN-13 "0841022452044" y UPC-A "841022452044" son el mismo artículo).
const eanKey = (s) => String(s || '').replace(/\D/g, '').replace(/^0+/, '');

function ivaBadgeClasses(i) {
  if (i === 4) return 'bg-green-100 text-green-700';
  if (i === 10) return 'bg-blue-100 text-blue-700';
  if (i === 21) return 'bg-red-100 text-red-700';
  return 'bg-gray-100 text-gray-500';
}

export default function IvaLookup() {
  const [data, setData] = useState(DATA_CACHE);
  const [loading, setLoading] = useState(!DATA_CACHE);
  const [loadError, setLoadError] = useState('');
  const [query, setQuery] = useState('');
  const [scanning, setScanning] = useState(false);
  const inputRef = useRef(null);

  // --- Carga diferida del JSON de referencia -------------------------
  useEffect(() => {
    if (DATA_CACHE) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/unide-iva.json');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        DATA_CACHE = json;
        if (!cancelled) { setData(json); setLoading(false); }
      } catch (err) {
        if (!cancelled) { setLoadError(err.message || 'Error de carga'); setLoading(false); }
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Índice por clave normalizada → item, para match exacto instantáneo.
  const eanIndex = useMemo(() => {
    const idx = new Map();
    if (data) {
      for (const p of data) {
        const k = eanKey(p.e);
        if (k) idx.set(k, p);
      }
    }
    return idx;
  }, [data]);

  // --- Pistola de códigos USB (keyboard wedge) ------------------------
  // La pistola emite los dígitos con <50 ms entre teclas y remata con
  // Enter. Capturamos esa ráfaga a nivel de ventana: funciona aunque el
  // campo no esté enfocado (p. ej. tras hacer scroll por los resultados).
  // La escritura humana (>80 ms entre teclas) nunca dispara esto.
  useEffect(() => {
    let buf = '';
    let last = 0;
    const onKey = (e) => {
      const now = performance.now();
      if (now - last > 80) buf = '';
      last = now;
      if (e.key === 'Enter') {
        if (buf.length >= 6) {
          setQuery(buf);
          setScanning(false); // si la cámara estaba abierta, la pistola gana
          e.preventDefault();
        }
        buf = '';
        return;
      }
      if (/^\d$/.test(e.key)) buf += e.key;
      else if (e.key.length === 1) buf = ''; // letras = escritura humana
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  // --- Búsqueda ------------------------------------------------------
  const results = useMemo(() => {
    const q = query.trim();
    if (!q || !data) return null;

    // Si parece un código (solo dígitos): match exacto normalizado y
    // luego por prefijo (útil con códigos internos cortos de UNIDE).
    if (/^\d{4,}$/.test(q)) {
      const exact = eanIndex.get(eanKey(q));
      if (exact) return [exact];
      const byPrefix = data.filter(p => p.e && p.e.startsWith(q)).slice(0, 30);
      if (byPrefix.length) return byPrefix;
    }

    // Búsqueda por nombre: todas las palabras deben aparecer (AND).
    const words = q.toUpperCase().split(/\s+/);
    return data.filter(p => words.every(w => p.d.includes(w))).slice(0, 60);
  }, [query, data, eanIndex]);

  // --- Render --------------------------------------------------------
  return (
    <div className="max-w-3xl">
      <div className="mb-5">
        <h1 className="text-2xl font-black text-gray-900">Consulta de IVA</h1>
        <p className="text-sm text-gray-500 mt-1">
          Busca el tipo de IVA por código de barras o por nombre. En el
          mostrador puedes usar la pistola del TPV directamente: escanea y
          el resultado aparece aquí.
        </p>
      </div>

      {/* Barra de búsqueda + botón de escanear con cámara */}
      <div className="flex gap-2 mb-2">
        <div className="relative flex-1">
          <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            id="search-iva"
            ref={inputRef}
            type="text"
            inputMode="search"
            autoComplete="off"
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="EAN o nombre del producto…"
            className="w-full pl-10 pr-9 py-3 border-2 border-gray-200 rounded-xl focus:border-red-500 focus:outline-none text-base"
          />
          {query && (
            <button
              type="button"
              onClick={() => { setQuery(''); inputRef.current?.focus(); }}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-600"
              aria-label="Borrar"
            >
              <X size={18} />
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={() => setScanning(true)}
          className="flex items-center gap-2 px-4 py-3 bg-red-600 hover:bg-red-700 text-white rounded-xl font-bold whitespace-nowrap"
        >
          <ScanLine size={20} />
          <span className="hidden sm:inline">Escanear</span>
        </button>
      </div>

      {/* Estado de carga del catálogo */}
      {loading && (
        <p className="text-sm text-gray-400 py-6 text-center">Cargando catálogo de referencia…</p>
      )}
      {loadError && (
        <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">
          <AlertCircle size={16} /> No se pudo cargar el catálogo ({loadError}).
        </div>
      )}

      {/* Resultados */}
      {!loading && !loadError && (
        <>
          {results === null && (
            <p className="text-sm text-gray-400 py-10 text-center">
              Escribe o escanea para buscar entre {data ? data.length.toLocaleString('es-ES') : '—'} artículos.
            </p>
          )}
          {results !== null && results.length === 0 && (
            <p className="text-sm text-gray-500 py-10 text-center">
              Sin resultados para «{query.trim()}». Puede que sea un producto sin ficha en UNIDE
              (p. ej. comida internacional).
            </p>
          )}
          {results !== null && results.length > 0 && (
            <>
              <p className="text-xs text-gray-400 mt-3 mb-2">
                {results.length} resultado{results.length !== 1 ? 's' : ''}
                {results.length >= 60 ? ' (afina la búsqueda para ver más)' : ''}
              </p>
              <div className="space-y-2">
                {results.map((p, idx) => (
                  <div key={`${p.c}-${p.e}-${idx}`} className="flex items-center gap-3 bg-white border border-gray-100 rounded-xl p-3 shadow-sm">
                    <div className={`flex-shrink-0 w-14 h-14 rounded-lg flex flex-col items-center justify-center font-black ${ivaBadgeClasses(p.i)}`}>
                      <span className="text-xl leading-none">{p.i != null ? `${p.i}%` : '?'}</span>
                      <span className="text-[9px] tracking-wide mt-0.5">IVA</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-gray-900 text-sm leading-snug break-words">{p.d}</p>
                      <div className="flex flex-wrap gap-2 mt-1 text-xs text-gray-500">
                        {p.e && <span className="font-mono bg-gray-100 rounded px-1.5 py-0.5">{p.e}</span>}
                        {p.p && <span className="text-red-600 font-semibold">{p.p} €</span>}
                        <span className="text-gray-400">Cód. {p.c}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      )}

      {/* Escáner de cámara (motor compartido) */}
      {scanning && (
        <BarcodeScannerOverlay
          onDetected={(code) => { setQuery(code); setScanning(false); }}
          onClose={() => setScanning(false)}
        />
      )}
    </div>
  );
}
