// EanIvaScanner — botón inline de escaneo EAN para la pantalla de revisión de IVA.
//
// Sustituye el texto "Sin sugerencia IVA local" cuando no hay sugerencia
// automática. El usuario escanea el código de barras del producto físico
// y, si se encuentra en el catálogo de UNIDE, aparece el IVA con un botón
// "Usar" que llama a onApply(taxRateString).
//
// Los datos se cargan de /unide-iva.json la primera vez que se monta
// cualquier instancia; quedan en DATA_CACHE para toda la sesión.

import { useEffect, useRef, useState } from 'react';
import { ScanLine, X, AlertCircle, CheckCircle } from 'lucide-react';

let DATA_CACHE = null;
let DATA_LOAD_PROMISE = null;

function loadData() {
  if (DATA_CACHE) return Promise.resolve(DATA_CACHE);
  if (!DATA_LOAD_PROMISE) {
    DATA_LOAD_PROMISE = fetch('/unide-iva.json')
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then(d => { DATA_CACHE = d; return d; })
      .catch(err => { DATA_LOAD_PROMISE = null; throw err; });
  }
  return DATA_LOAD_PROMISE;
}

function lookupEan(ean, data) {
  if (!ean || !data) return null;
  return data.find(p => p.e === ean) ?? null;
}

function IvaBadge({ rate }) {
  const cls =
    rate === 4  ? 'bg-green-100 text-green-700' :
    rate === 10 ? 'bg-blue-100 text-blue-700'   :
    rate === 21 ? 'bg-red-100 text-red-700'     : 'bg-gray-100 text-gray-500';
  return (
    <span className={`font-black text-base px-2 py-0.5 rounded-lg ${cls}`}>
      {rate != null ? `${rate}%` : '?'}
    </span>
  );
}

export default function EanIvaScanner({ onApply }) {
  const [phase, setPhase] = useState('idle'); // idle | scanning | found | notfound | error
  const [scanError, setScanError] = useState('');
  const [result, setResult] = useState(null); // { d, i, e }
  const [applied, setApplied] = useState(false);

  const videoRef = useRef(null);
  const controlsRef = useRef(null);

  function stopScanner() {
    try { controlsRef.current?.stop(); } catch (_) { /* ignore */ }
    controlsRef.current = null;
  }

  async function startScan() {
    setResult(null);
    setApplied(false);
    setScanError('');
    setPhase('scanning');

    let data;
    try {
      data = await loadData();
    } catch (_) {
      setScanError('No se pudieron cargar los datos. Comprueba la conexión.');
      setPhase('error');
      return;
    }

    try {
      const { BrowserMultiFormatReader } = await import('@zxing/browser');
      const reader = new BrowserMultiFormatReader();
      controlsRef.current = await reader.decodeFromConstraints(
        { video: { facingMode: { ideal: 'environment' } } },
        videoRef.current,
        (res) => {
          if (!res) return;
          const ean = res.getText?.() ?? '';
          if (!ean) return;
          stopScanner();
          const hit = lookupEan(ean, data);
          if (hit) {
            setResult(hit);
            setPhase('found');
          } else {
            setResult({ e: ean });
            setPhase('notfound');
          }
        }
      );
    } catch (err) {
      stopScanner();
      const msg =
        err?.name === 'NotAllowedError' ? 'Permiso de cámara denegado. Actívalo en el navegador.' :
        err?.name === 'NotFoundError'   ? 'No se encontró cámara en este dispositivo.' :
        'No se pudo abrir la cámara.';
      setScanError(msg);
      setPhase('error');
    }
  }

  function cancel() {
    stopScanner();
    setPhase('idle');
    setResult(null);
    setApplied(false);
  }

  function apply() {
    if (result?.i == null) return;
    onApply(String(result.i));
    setApplied(true);
  }

  // Apaga la cámara si el componente se desmonta (p. ej. se cierra el modal).
  useEffect(() => () => stopScanner(), []);

  // --- Idle: botón compacto de escanear ---
  if (phase === 'idle') {
    return (
      <button
        type="button"
        onClick={startScan}
        className="w-full flex items-center gap-2 rounded-lg border border-dashed border-gray-300 bg-gray-50 px-2.5 py-1.5 text-[11px] text-gray-500 hover:border-gray-400 hover:text-gray-700 transition-colors"
      >
        <ScanLine size={14} className="flex-shrink-0 text-gray-400" />
        Sin sugerencia local · <span className="font-semibold text-gray-700">Escanear EAN del producto</span>
      </button>
    );
  }

  // --- Escáner activo ---
  if (phase === 'scanning') {
    return (
      <div className="rounded-lg border border-gray-200 overflow-hidden">
        <div className="relative bg-black" style={{ aspectRatio: '4/3', maxHeight: 180 }}>
          <video ref={videoRef} className="w-full h-full object-cover" muted playsInline />
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="w-3/4 h-14 border-2 border-red-500 rounded-lg shadow-[0_0_0_100vmax_rgba(0,0,0,0.3)]" />
          </div>
        </div>
        <div className="flex items-center justify-between px-2.5 py-1.5 bg-gray-50">
          <span className="text-[11px] text-gray-500">Apunta al código de barras…</span>
          <button type="button" onClick={cancel} className="p-1 text-gray-400 hover:text-gray-700"><X size={14}/></button>
        </div>
      </div>
    );
  }

  // --- Error de cámara ---
  if (phase === 'error') {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-2.5 py-1.5">
        <AlertCircle size={13} className="text-red-500 flex-shrink-0" />
        <span className="text-[11px] text-red-600 flex-1">{scanError}</span>
        <button type="button" onClick={cancel} className="text-[11px] font-bold text-red-700 underline">Cerrar</button>
      </div>
    );
  }

  // --- Resultado encontrado ---
  if (phase === 'found') {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-1.5">
        <IvaBadge rate={result.i} />
        <span className="text-[11px] text-gray-700 flex-1 min-w-0 truncate">{result.d}</span>
        {applied ? (
          <span className="flex items-center gap-1 text-[11px] font-bold text-green-600 flex-shrink-0">
            <CheckCircle size={13} /> Aplicado
          </span>
        ) : (
          <button
            type="button"
            onClick={apply}
            className="px-2.5 py-1 rounded-lg bg-gray-900 text-white text-xs font-bold hover:bg-gray-800 flex-shrink-0"
          >
            Usar
          </button>
        )}
        <button type="button" onClick={cancel} className="p-1 text-gray-400 hover:text-gray-700 flex-shrink-0"><X size={13}/></button>
      </div>
    );
  }

  // --- EAN no encontrado en UNIDE (comida internacional, etc.) ---
  if (phase === 'notfound') {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5">
        <AlertCircle size={13} className="text-amber-500 flex-shrink-0" />
        <span className="text-[11px] text-amber-700 flex-1">
          EAN <span className="font-mono">{result?.e}</span> no está en catálogo UNIDE. Consulta al gestor.
        </span>
        <button type="button" onClick={cancel} className="p-1 text-amber-400 hover:text-amber-700 flex-shrink-0"><X size={13}/></button>
      </div>
    );
  }

  return null;
}
