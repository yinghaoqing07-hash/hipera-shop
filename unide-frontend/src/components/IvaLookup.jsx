// =====================================================================
// IvaLookup.jsx — Consulta de IVA por EAN o nombre (referencia UNIDE)
// =====================================================================
// Herramienta interna del panel de administración para averiguar el tipo
// de IVA (4 % / 10 % / 21 %) de un artículo del catálogo de UNIDE.
//
// POR QUÉ EXISTE:
//   Para clasificar correctamente el IVA de cada producto (requisito de
//   VeriFactu) hay que saber qué tipo aplica a cada artículo. El dato
//   oficial está en el listado de UNIDE (UNIDE_LISTADO.xls, ~16 900
//   referencias). Antes había que ir a la oficina a consultarlo; ahora
//   se consulta desde el móvil, incluso en el mostrador.
//
// POR QUÉ ESCANEAR EL EAN ES LO MÁS FIABLE:
//   Los nombres de los productos online NO coinciden con los del listado
//   de UNIDE, así que casar por nombre puede fallar. El código de barras
//   (EAN) es único: si escaneas el producto físico, el match es exacto y
//   el IVA que sale es 100 % correcto. Por eso el botón de escanear es la
//   forma recomendada de verificar.
//
// DATOS:
//   Se cargan de /unide-iva.json (público, ~1,3 MB) de forma diferida:
//   sólo se descarga la primera vez que se abre esta pestaña, y el
//   navegador lo cachea. No entra en el bundle del panel.
//   Formato de cada item: { e: ean, d: descripción, i: iva, p: pvp, c: código }
//
// ESCÁNER:
//   Usa @zxing/browser (importado dinámicamente, sólo al pulsar escanear)
//   con la cámara trasera. Funciona en iPhone (Safari) y Android.
// =====================================================================

import { useEffect, useMemo, useRef, useState } from 'react';
import { ScanLine, Search, X, Camera, AlertCircle } from 'lucide-react';

// Caché a nivel de módulo: si el usuario cambia de pestaña y vuelve, no
// se vuelve a descargar ni a reindexar el JSON.
let DATA_CACHE = null;

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
  const [scanError, setScanError] = useState('');

  const videoRef = useRef(null);
  const controlsRef = useRef(null); // IScannerControls de zxing, para parar la cámara

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

  // Índice EAN → item, para búsqueda exacta instantánea.
  const eanIndex = useMemo(() => {
    const idx = new Map();
    if (data) for (const p of data) { if (p.e) idx.set(p.e, p); }
    return idx;
  }, [data]);

  // --- Búsqueda ------------------------------------------------------
  const results = useMemo(() => {
    const q = query.trim();
    if (!q || !data) return null;

    // Si parece un EAN (sólo dígitos), priorizamos coincidencia exacta y
    // luego por prefijo (útil cuando el escáner aún no leyó el código entero).
    if (/^\d{4,}$/.test(q)) {
      const exact = eanIndex.get(q);
      if (exact) return [exact];
      const byPrefix = data.filter(p => p.e && p.e.startsWith(q)).slice(0, 30);
      if (byPrefix.length) return byPrefix;
    }

    // Búsqueda por nombre: todas las palabras deben aparecer (AND).
    const words = q.toUpperCase().split(/\s+/);
    return data.filter(p => words.every(w => p.d.includes(w))).slice(0, 60);
  }, [query, data, eanIndex]);

  // --- Escáner de cámara (zxing) -------------------------------------
  function stopScanner() {
    try { controlsRef.current?.stop(); } catch (_) { /* ignore */ }
    controlsRef.current = null;
  }

  async function startScanner() {
    setScanError('');
    setScanning(true);
    try {
      const { BrowserMultiFormatReader } = await import('@zxing/browser');
      const reader = new BrowserMultiFormatReader();
      // Cámara trasera (ideal) para apuntar al código de barras del producto.
      controlsRef.current = await reader.decodeFromConstraints(
        { video: { facingMode: { ideal: 'environment' } } },
        videoRef.current,
        (result) => {
          if (result) {
            const text = result.getText?.() ?? '';
            if (text) {
              setQuery(text);
              stopScanner();
              setScanning(false);
            }
          }
        }
      );
    } catch (err) {
      const name = err?.name || '';
      if (name === 'NotAllowedError') {
        setScanError('Permiso de cámara denegado. Actívalo en el navegador o escribe el EAN a mano.');
      } else if (name === 'NotFoundError' || name === 'OverconstrainedError') {
        setScanError('No se encontró cámara. Escribe el EAN o el nombre a mano.');
      } else {
        setScanError('No se pudo abrir la cámara. Escribe el EAN o el nombre a mano.');
      }
    }
  }

  function closeScanner() {
    stopScanner();
    setScanning(false);
    setScanError('');
  }

  // Asegura que la cámara se apaga al desmontar el componente.
  useEffect(() => () => stopScanner(), []);

  // --- Render --------------------------------------------------------
  return (
    <div className="max-w-3xl">
      <div className="mb-5">
        <h1 className="text-2xl font-black text-gray-900">Consulta de IVA</h1>
        <p className="text-sm text-gray-500 mt-1">
          Busca el tipo de IVA de un artículo por código de barras o por nombre.
          Escanear el EAN del producto físico es la forma más fiable.
        </p>
      </div>

      {/* Barra de búsqueda + botón de escanear */}
      <div className="flex gap-2 mb-2">
        <div className="relative flex-1">
          <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            id="search-iva"
            type="text"
            inputMode="search"
            autoComplete="off"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="EAN o nombre del producto…"
            className="w-full pl-10 pr-9 py-3 border-2 border-gray-200 rounded-xl focus:border-red-500 focus:outline-none text-base"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-600"
              aria-label="Borrar"
            >
              <X size={18} />
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={startScanner}
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
              Escribe para buscar entre {data ? data.length.toLocaleString('es-ES') : '—'} artículos.
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

      {/* Modal del escáner */}
      {scanning && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl overflow-hidden w-full max-w-md">
            <div className="flex items-center justify-between px-4 py-3 border-b">
              <span className="font-bold text-gray-900 flex items-center gap-2">
                <Camera size={18} /> Escanear código de barras
              </span>
              <button type="button" onClick={closeScanner} className="p-1 text-gray-400 hover:text-gray-700" aria-label="Cerrar">
                <X size={20} />
              </button>
            </div>
            <div className="relative bg-black aspect-[4/3]">
              <video ref={videoRef} className="w-full h-full object-cover" muted playsInline />
              {/* Guía visual de encuadre */}
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="w-3/4 h-20 border-2 border-red-500 rounded-lg shadow-[0_0_0_100vmax_rgba(0,0,0,0.25)]" />
              </div>
            </div>
            <div className="px-4 py-3">
              {scanError ? (
                <p className="text-sm text-red-600 flex items-center gap-2">
                  <AlertCircle size={16} /> {scanError}
                </p>
              ) : (
                <p className="text-xs text-gray-500 text-center">
                  Apunta al código de barras del producto. Se detecta automáticamente.
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
