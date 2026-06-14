// EanIvaScanner — escáner EAN inline para la pantalla de revisión de IVA.
//
// Dos caminos de detección:
//   1. BarcodeDetector nativo (iOS 17+ / Android Chrome): hardware-level,
//      casi instantáneo. Se activa automáticamente si está disponible.
//   2. @ericblade/quagga2 (fallback): librería especializada en códigos 1D
//      (EAN-13, EAN-8, UPC), con algoritmo de detección por bordes mucho
//      más robusto que zxing-js en condiciones reales de tienda.
//
// El escáner ocupa la pantalla completa para maximizar el área de captura.

import { useEffect, useRef, useState } from 'react';
import { ScanLine, X, AlertCircle, CheckCircle, Zap } from 'lucide-react';

// ─── Catálogo UNIDE ──────────────────────────────────────────────────────────
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

// ─── Badge IVA ───────────────────────────────────────────────────────────────
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

// ─── Componente ──────────────────────────────────────────────────────────────
export default function EanIvaScanner({ onApply }) {
  const [phase, setPhase]     = useState('idle');
  const [scanError, setScanError] = useState('');
  const [result, setResult]   = useState(null);
  const [applied, setApplied] = useState(false);
  const [usingNative, setUsingNative] = useState(false);

  // videoRef → BarcodeDetector path (manejamos el stream nosotros)
  // containerRef → quagga2 path (quagga inyecta su propio <video> aquí)
  const videoRef     = useRef(null);
  const containerRef = useRef(null);
  const stopRef      = useRef(null);

  function stopAll() {
    try { stopRef.current?.(); } catch (_) { /* ignore */ }
    stopRef.current = null;
  }

  async function startScan() {
    setResult(null);
    setApplied(false);
    setScanError('');
    const native = 'BarcodeDetector' in window;
    setUsingNative(native);
    setPhase('scanning');

    let data;
    try { data = await loadData(); }
    catch (_) { setScanError('No se pudieron cargar los datos. Comprueba la conexión.'); setPhase('error'); return; }

    // Esperar a que React monte la UI de escáner (video o container)
    await new Promise(r => setTimeout(r, 100));

    const handleFound = (ean) => {
      const hit = lookupEan(ean, data);
      setResult(hit ?? { e: ean });
      setPhase(hit ? 'found' : 'notfound');
    };

    const handleError = (errName) => {
      const msg =
        errName === 'NotAllowedError' ? 'Permiso de cámara denegado. Actívalo en Ajustes > Safari.' :
        errName === 'NotFoundError'   ? 'No se encontró cámara en este dispositivo.' :
        'No se pudo abrir la cámara.';
      setScanError(msg);
      setPhase('error');
    };

    if (native) {
      // ── Camino 1: BarcodeDetector nativo ──────────────────────────────
      const el = videoRef.current;
      if (!el) return;
      let stream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' } },
        });
      } catch (err) { handleError(err?.name); return; }

      el.srcObject = stream;
      await el.play();

      let active = true;
      let detector;
      try {
        detector = new window.BarcodeDetector({
          formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39'],
        });
      } catch (_) { detector = new window.BarcodeDetector(); }

      const poll = async () => {
        if (!active) return;
        if (el.readyState >= 2) {
          try {
            const hits = await detector.detect(el);
            if (hits?.length > 0 && active) { active = false; handleFound(hits[0].rawValue); return; }
          } catch (_) { /* frame descartado */ }
        }
        if (active) setTimeout(poll, 80);
      };
      poll();

      stopRef.current = () => {
        active = false;
        stream.getTracks().forEach(t => t.stop());
        if (videoRef.current) videoRef.current.srcObject = null;
      };

    } else {
      // ── Camino 2: @ericblade/quagga2 ──────────────────────────────────
      // Quagga inyecta su propio <video> y <canvas> dentro del container.
      const container = containerRef.current;
      if (!container) return;
      let active = true;

      try {
        const { default: Quagga } = await import('@ericblade/quagga2');

        await new Promise((resolve, reject) => {
          Quagga.init(
            {
              inputStream: {
                type: 'LiveStream',
                target: container,
                constraints: { facingMode: 'environment' },
              },
              locate: true,
              decoder: {
                readers: ['ean_reader', 'ean_8_reader', 'upc_reader', 'code_128_reader'],
                multiple: false,
              },
              // Sin workers extras para evitar problemas de CORS con workers en Safari
              numOfWorkers: 0,
              frequency: 10,
            },
            (err) => (err ? reject(err) : resolve())
          );
        });

        Quagga.start();

        const handler = ({ codeResult }) => {
          if (codeResult?.code && active) {
            active = false;
            try { Quagga.stop(); } catch (_) { /* ignore */ }
            handleFound(codeResult.code);
          }
        };
        Quagga.onDetected(handler);

        stopRef.current = () => {
          active = false;
          try { Quagga.offDetected(handler); Quagga.stop(); } catch (_) { /* ignore */ }
        };

      } catch (err) {
        const name = err?.name || (err?.message?.includes('Permission') ? 'NotAllowedError' : 'error');
        handleError(name);
      }
    }
  }

  function cancel() { stopAll(); setPhase('idle'); setResult(null); setApplied(false); }
  function apply()  { if (result?.i == null) return; onApply(String(result.i)); setApplied(true); }
  useEffect(() => () => stopAll(), []);

  // ── Idle ────────────────────────────────────────────────────────────────────
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

  // ── Error ───────────────────────────────────────────────────────────────────
  if (phase === 'error') {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-2.5 py-1.5">
        <AlertCircle size={13} className="text-red-500 flex-shrink-0" />
        <span className="text-[11px] text-red-600 flex-1">{scanError}</span>
        <button type="button" onClick={cancel} className="text-[11px] font-bold text-red-700 underline">Cerrar</button>
      </div>
    );
  }

  // ── Resultado encontrado ────────────────────────────────────────────────────
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

  // ── EAN no encontrado ───────────────────────────────────────────────────────
  if (phase === 'notfound') {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5">
        <AlertCircle size={13} className="text-amber-500 flex-shrink-0" />
        <span className="text-[11px] text-amber-700 flex-1">
          EAN <span className="font-mono">{result?.e}</span> no está en catálogo UNIDE.
        </span>
        <button type="button" onClick={cancel} className="p-1 text-amber-400 hover:text-amber-700 flex-shrink-0">
          <X size={13} />
        </button>
      </div>
    );
  }

  // ── Escáner activo (pantalla completa) ─────────────────────────────────────
  return (
    <div className="fixed inset-0 z-[60] bg-black" style={{ touchAction: 'none' }}>

      {/* Vídeo (path nativo BarcodeDetector) */}
      <video
        ref={videoRef}
        className={`absolute inset-0 w-full h-full object-cover${usingNative ? '' : ' hidden'}`}
        muted
        playsInline
      />

      {/* Container quagga2: inyecta su propio <video> aquí */}
      {!usingNative && (
        <>
          {/* Forzamos que el video y canvas de quagga llenen la pantalla */}
          <style>{`
            .qs-container video,
            .qs-container canvas { position:absolute!important;inset:0!important;width:100%!important;height:100%!important;object-fit:cover!important; }
            .qs-container canvas { opacity:0.35; }
          `}</style>
          <div ref={containerRef} className="qs-container absolute inset-0 overflow-hidden" />
        </>
      )}

      {/* Esquinas del visor */}
      {[
        'top-[36%] left-[10%] border-t-2 border-l-2 rounded-tl-md',
        'top-[36%] right-[10%] border-t-2 border-r-2 rounded-tr-md',
        'top-[56%] left-[10%] border-b-2 border-l-2 rounded-bl-md',
        'top-[56%] right-[10%] border-b-2 border-r-2 rounded-br-md',
      ].map((cls, i) => (
        <div key={i} className={`absolute w-7 h-7 border-cyan-400 pointer-events-none ${cls}`} />
      ))}

      {/* Línea de escaneo */}
      <div
        className="absolute left-[10%] right-[10%] pointer-events-none"
        style={{ top: '36%', animation: 'qs-scan 1.8s ease-in-out infinite' }}
      >
        <div className="h-0.5 bg-cyan-400 opacity-80" />
      </div>
      <style>{`@keyframes qs-scan{0%,100%{transform:translateY(0)}50%{transform:translateY(20vh)}}`}</style>

      {/* Botón cerrar + badge modo */}
      <div className="absolute top-0 left-0 right-0 z-10 flex items-center justify-between px-4 pt-12 pb-2">
        <button type="button" onClick={cancel} className="p-2 rounded-full bg-black/50 text-white">
          <X size={20} />
        </button>
        {usingNative && (
          <span className="flex items-center gap-1 text-[11px] font-bold text-cyan-300 bg-black/50 px-2 py-1 rounded-full">
            <Zap size={11} /> Modo rápido
          </span>
        )}
      </div>

      {/* Instrucción */}
      <p className="absolute bottom-16 left-0 right-0 text-center text-white/60 text-sm pointer-events-none">
        Apunta al código de barras del producto
      </p>
    </div>
  );
}
