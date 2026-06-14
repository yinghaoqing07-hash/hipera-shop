// EanIvaScanner — escáner EAN inline para la pantalla de revisión de IVA.
//
// Estrategia de detección (de más rápido a más lento):
//   1. BarcodeDetector nativo (iOS 17+ Safari / Android Chrome) → casi instantáneo.
//   2. @zxing/browser como fallback (JS puro, sin WASM, funciona en todos).
//
// El escáner se muestra a pantalla completa para maximizar la resolución
// que el navegador envía a la cámara. Guía visual de esquinas (como POS
// físicos), sin marco opaco que tape el código.

import { useEffect, useRef, useState } from 'react';
import { ScanLine, X, AlertCircle, CheckCircle, Zap } from 'lucide-react';

// ─── Catálogo UNIDE (caché compartida por toda la sesión) ────────────────────
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

// ─── Motor de detección ──────────────────────────────────────────────────────
// Devuelve una función de cleanup. Dos caminos:
//   1. BarcodeDetector nativo (iOS 17+ / Chrome Android): abre stream propio,
//      hace polling a 80 ms — casi instantáneo porque usa hardware del chip.
//   2. @zxing/browser fallback: deja que la librería abra su propio stream
//      con decodeFromConstraints (la API estable y bien probada de zxing).
async function startDetection(videoEl, onFound) {
  // Sin restricciones de resolución explícitas: el navegador elige la
  // orientación correcta según cómo se sujeta el móvil. Forzar 1920×1080
  // en portrait hace que iOS abra el stream en landscape internamente y
  // el barcode quede girado 90° en los frames que lee el decodificador.
  const VIDEO_CONSTRAINTS = { facingMode: { ideal: 'environment' } };

  // — 1. BarcodeDetector nativo —
  if ('BarcodeDetector' in window) {
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: VIDEO_CONSTRAINTS });
    } catch (err) {
      const code =
        err?.name === 'NotAllowedError' ? 'permission' :
        err?.name === 'NotFoundError'   ? 'nocamera'   : 'error';
      throw Object.assign(new Error(err?.message), { code });
    }
    videoEl.srcObject = stream;
    await videoEl.play();

    let active = true;
    let detector;
    try {
      detector = new window.BarcodeDetector({
        formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'itf'],
      });
    } catch (_) {
      detector = new window.BarcodeDetector();
    }

    const poll = async () => {
      if (!active) return;
      if (videoEl.readyState >= 2) {
        try {
          const results = await detector.detect(videoEl);
          if (results?.length > 0 && active) {
            active = false;
            onFound(results[0].rawValue);
            return;
          }
        } catch (_) { /* frame descartado */ }
      }
      if (active) setTimeout(poll, 80);
    };
    poll();

    return () => {
      active = false;
      stream.getTracks().forEach(t => t.stop());
      videoEl.srcObject = null;
    };
  }

  // — 2. Fallback: zxing gestiona su propio stream (decodeFromConstraints) —
  // Aquí NO pre-abrimos la cámara; dejamos que zxing lo haga internamente
  // para evitar conflictos con el stream ya abierto.
  const { BrowserMultiFormatReader } = await import('@zxing/browser');
  const reader = new BrowserMultiFormatReader();
  let active = true;
  let controls;

  try {
    controls = await reader.decodeFromConstraints(
      { video: VIDEO_CONSTRAINTS },
      videoEl,
      (result) => {
        if (result && active) {
          active = false;
          onFound(result.getText?.() ?? '');
        }
      }
    );
  } catch (err) {
    const code =
      err?.name === 'NotAllowedError' ? 'permission' :
      err?.name === 'NotFoundError'   ? 'nocamera'   : 'error';
    throw Object.assign(new Error(err?.message), { code });
  }

  return () => {
    active = false;
    try { controls?.stop(); } catch (_) { /* ignore */ }
  };
}

// ─── Badge de IVA ────────────────────────────────────────────────────────────
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

// ─── Componente principal ────────────────────────────────────────────────────
export default function EanIvaScanner({ onApply }) {
  const [phase, setPhase] = useState('idle'); // idle|scanning|found|notfound|error
  const [scanError, setScanError] = useState('');
  const [result, setResult] = useState(null);
  const [applied, setApplied] = useState(false);
  const [usingNative, setUsingNative] = useState(false);

  const videoRef = useRef(null);
  const stopRef  = useRef(null); // función de cleanup del motor activo

  function stopAll() {
    try { stopRef.current?.(); } catch (_) { /* ignore */ }
    stopRef.current = null;
  }

  async function startScan() {
    setResult(null);
    setApplied(false);
    setScanError('');
    setUsingNative('BarcodeDetector' in window);
    setPhase('scanning');

    let data;
    try {
      data = await loadData();
    } catch (_) {
      setScanError('No se pudieron cargar los datos. Comprueba la conexión.');
      setPhase('error');
      return;
    }

    // Esperamos al frame siguiente para que el <video> esté montado
    await new Promise(r => setTimeout(r, 50));
    if (!videoRef.current) return;

    try {
      stopRef.current = await startDetection(videoRef.current, (ean) => {
        const hit = lookupEan(ean, data);
        setResult(hit ?? { e: ean });
        setPhase(hit ? 'found' : 'notfound');
      });
    } catch (err) {
      const msg =
        err?.code === 'permission' ? 'Permiso de cámara denegado. Actívalo en Ajustes > Safari.' :
        err?.code === 'nocamera'   ? 'No se encontró cámara en este dispositivo.' :
        'No se pudo abrir la cámara.';
      setScanError(msg);
      setPhase('error');
    }
  }

  function cancel() {
    stopAll();
    setPhase('idle');
    setResult(null);
    setApplied(false);
  }

  function apply() {
    if (result?.i == null) return;
    onApply(String(result.i));
    setApplied(true);
  }

  useEffect(() => () => stopAll(), []);

  // ── Idle ──
  if (phase === 'idle') {
    return (
      <button
        type="button"
        onClick={startScan}
        className="w-full flex items-center gap-2 rounded-lg border border-dashed border-gray-300 bg-gray-50 px-2.5 py-1.5 text-[11px] text-gray-500 hover:border-gray-400 hover:text-gray-700 transition-colors"
      >
        <ScanLine size={14} className="flex-shrink-0 text-gray-400" />
        Sin sugerencia local ·{' '}
        <span className="font-semibold text-gray-700">Escanear EAN del producto</span>
      </button>
    );
  }

  // ── Error ──
  if (phase === 'error') {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-2.5 py-1.5">
        <AlertCircle size={13} className="text-red-500 flex-shrink-0" />
        <span className="text-[11px] text-red-600 flex-1">{scanError}</span>
        <button type="button" onClick={cancel} className="text-[11px] font-bold text-red-700 underline">Cerrar</button>
      </div>
    );
  }

  // ── Resultado encontrado ──
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
        <button type="button" onClick={cancel} className="p-1 text-gray-400 hover:text-gray-700 flex-shrink-0">
          <X size={13} />
        </button>
      </div>
    );
  }

  // ── EAN no encontrado en UNIDE ──
  if (phase === 'notfound') {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5">
        <AlertCircle size={13} className="text-amber-500 flex-shrink-0" />
        <span className="text-[11px] text-amber-700 flex-1">
          EAN <span className="font-mono">{result?.e}</span> no está en catálogo UNIDE. Consulta al gestor.
        </span>
        <button type="button" onClick={cancel} className="p-1 text-amber-400 hover:text-amber-700 flex-shrink-0">
          <X size={13} />
        </button>
      </div>
    );
  }

  // ── Escáner activo (pantalla completa) ──
  return (
    <div className="fixed inset-0 z-[60] bg-black flex flex-col" style={{ touchAction: 'none' }}>
      {/* Vídeo a pantalla completa */}
      <video
        ref={videoRef}
        className="absolute inset-0 w-full h-full object-cover"
        muted
        playsInline
      />

      {/* Overlay oscuro con recorte central transparente (efecto visor) */}
      <div className="absolute inset-0 pointer-events-none" style={{
        background: 'radial-gradient(ellipse 65% 22% at 50% 50%, transparent 100%, rgba(0,0,0,0.55) 100%)',
      }} />

      {/* Esquinas del visor (estilo POS) */}
      {[
        'top-[35%] left-[12%]  border-t-2 border-l-2 rounded-tl-md',
        'top-[35%] right-[12%] border-t-2 border-r-2 rounded-tr-md',
        'top-[57%] left-[12%]  border-b-2 border-l-2 rounded-bl-md',
        'top-[57%] right-[12%] border-b-2 border-r-2 rounded-br-md',
      ].map((cls, i) => (
        <div key={i} className={`absolute w-7 h-7 border-cyan-400 ${cls}`} />
      ))}

      {/* Línea de escaneo animada */}
      <div className="absolute left-[12%] right-[12%] top-[35%]" style={{ animation: 'scanline 1.8s ease-in-out infinite' }}>
        <div className="h-0.5 bg-cyan-400 opacity-80" />
      </div>
      <style>{`
        @keyframes scanline {
          0%   { transform: translateY(0); }
          50%  { transform: translateY(calc((57vh - 35vh))); }
          100% { transform: translateY(0); }
        }
      `}</style>

      {/* Barra superior */}
      <div className="relative z-10 flex items-center justify-between px-4 pt-safe pt-4 pb-2">
        <button
          type="button"
          onClick={cancel}
          className="p-2 rounded-full bg-black/40 text-white"
          aria-label="Cerrar escáner"
        >
          <X size={20} />
        </button>
        {usingNative && (
          <span className="flex items-center gap-1 text-[11px] font-bold text-cyan-300 bg-black/40 px-2 py-1 rounded-full">
            <Zap size={11} /> Modo rápido
          </span>
        )}
      </div>

      {/* Etiqueta central */}
      <div className="relative z-10 flex-1 flex items-center justify-center">
        <span className="text-white/70 text-sm mt-[22vh]">
          Apunta al código de barras
        </span>
      </div>
    </div>
  );
}
