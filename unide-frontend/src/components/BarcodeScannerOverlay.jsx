// =====================================================================
// BarcodeScannerOverlay — escáner de códigos de barras a pantalla completa
// =====================================================================
// Motor compartido por EanIvaScanner (revisión de productos) e IvaLookup
// (pestaña Consulta IVA). UN solo camino de código con dos motores:
//
//   - BarcodeDetector NATIVO donde existe (Android Chrome = ML Kit, el
//     mismo decodificador que las apps de caja). Badge "Modo rápido".
//   - Ponyfill `barcode-detector` (zxing-wasm, ZXing C++ compilado a
//     WebAssembly) donde no: iPhone/Safari y Chrome de escritorio en
//     Windows. Misma API, calidad de decodificación de nivel SDK — el
//     sustituto de quagga2, que en condiciones reales de tienda fallaba
//     (probado en iPhone: "escaneo y no entra").
//
// Mejoras de cámara (aplican a ambos motores):
//   - Resolución ideal 1920×1080 (`ideal`, nunca `exact`: no provoca
//     OverconstrainedError ni el bug portrait/landscape).
//   - Enfoque continuo si la cámara lo expone (muchos Android); el iPhone
//     ya enfoca continuo por defecto.
//   - Zoom inicial 2× cuando la cámara lo permite (los EAN pequeños a un
//     palmo son ilegibles a 1×) + control manual. iOS 17+ expone zoom.
//   - Linterna (torch) para estanterías oscuras, si el hardware la tiene.
//
// Props:
//   onDetected(code: string) — se llama UNA vez con el código leído.
//   onClose()                — cerrar sin leer.
// =====================================================================

import { useEffect, useRef, useState } from 'react';
import { X, AlertCircle, Zap, ZoomIn, ZoomOut, Flashlight } from 'lucide-react';

const FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39'];

// Devuelve la clase detectora: nativa si existe Y decodifica EAN-13;
// si no, el ponyfill WASM (import diferido: solo se paga al escanear).
async function resolveDetectorClass() {
  if ('BarcodeDetector' in window) {
    try {
      const supported = await window.BarcodeDetector.getSupportedFormats();
      if (supported?.includes('ean_13')) {
        return { Detector: window.BarcodeDetector, native: true };
      }
    } catch { /* raro: nativo roto → ponyfill */ }
  }
  const { BarcodeDetector } = await import('barcode-detector/ponyfill');
  return { Detector: BarcodeDetector, native: false };
}

export default function BarcodeScannerOverlay({ onDetected, onClose }) {
  const [scanError, setScanError] = useState('');
  const [usingNative, setUsingNative] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const [torchAvailable, setTorchAvailable] = useState(false);
  const [zoomCaps, setZoomCaps] = useState(null); // {min,max,step} si hay zoom
  const [zoom, setZoom] = useState(1);

  const videoRef = useRef(null);
  const stopRef = useRef(null);
  const trackRef = useRef(null);
  const firedRef = useRef(false); // garantiza onDetected una sola vez

  useEffect(() => {
    let cancelled = false;

    const fire = (code) => {
      if (firedRef.current || cancelled) return;
      firedRef.current = true;
      try { stopRef.current?.(); } catch { /* ignore */ }
      onDetected(code);
    };

    const fail = (errName) => {
      if (cancelled) return;
      setScanError(
        errName === 'NotAllowedError' ? 'Permiso de cámara denegado. Actívalo en el navegador.' :
        errName === 'NotFoundError' ? 'No se encontró cámara en este dispositivo.' :
        'No se pudo abrir la cámara.'
      );
    };

    (async () => {
      // Motor de detección (nativo o WASM) y cámara en paralelo.
      let DetectorInfo;
      try { DetectorInfo = await resolveDetectorClass(); }
      catch { fail('error'); return; }
      if (cancelled) return;
      setUsingNative(DetectorInfo.native);

      // Espera a que React monte el <video>.
      await new Promise((r) => setTimeout(r, 50));
      if (cancelled) return;
      const el = videoRef.current;
      if (!el) return;

      let stream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          },
        });
      } catch (err) { fail(err?.name); return; }
      if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }

      el.srcObject = stream;
      await el.play().catch(() => {});

      // Mejoras de cámara (best-effort: cada una en su try, hay cámaras
      // que soportan una y no la otra).
      const track = stream.getVideoTracks()[0];
      trackRef.current = track;
      const caps = track.getCapabilities?.() || {};
      try {
        if (Array.isArray(caps.focusMode) && caps.focusMode.includes('continuous')) {
          await track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] });
        }
      } catch { /* sin autofocus configurable */ }
      if (caps.torch) setTorchAvailable(true);
      if (caps.zoom && caps.zoom.max > caps.zoom.min) {
        setZoomCaps(caps.zoom);
        // Zoom inicial 2× (o el máximo si es menor): el punto dulce para
        // códigos EAN a 15-25 cm sin tener que acercar el móvil.
        const initial = Math.min(2, caps.zoom.max);
        if (initial > caps.zoom.min) {
          try { await track.applyConstraints({ advanced: [{ zoom: initial }] }); setZoom(initial); }
          catch { /* ignore */ }
        }
      }

      let detector;
      try { detector = new DetectorInfo.Detector({ formats: FORMATS }); }
      catch { detector = new DetectorInfo.Detector(); }

      // Bucle de detección SECUENCIAL: se lanza el siguiente frame cuando
      // termina el anterior (el detect del WASM puede tardar más que el
      // nativo; así nunca se encolan detecciones).
      let active = true;
      const DELAY = DetectorInfo.native ? 80 : 60;
      const poll = async () => {
        if (!active || cancelled) return;
        if (el.readyState >= 2) {
          try {
            const hits = await detector.detect(el);
            if (hits?.length > 0 && active) { active = false; fire(hits[0].rawValue); return; }
          } catch { /* frame descartado */ }
        }
        setTimeout(poll, DELAY);
      };
      poll();

      stopRef.current = () => {
        active = false;
        stream.getTracks().forEach((t) => t.stop());
        if (videoRef.current) videoRef.current.srcObject = null;
      };
    })();

    return () => {
      cancelled = true;
      try { stopRef.current?.(); } catch { /* ignore */ }
      stopRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function toggleTorch() {
    const track = trackRef.current;
    if (!track) return;
    try {
      await track.applyConstraints({ advanced: [{ torch: !torchOn }] });
      setTorchOn(!torchOn);
    } catch { /* ignore */ }
  }

  async function applyZoom(next) {
    const track = trackRef.current;
    if (!track || !zoomCaps) return;
    const clamped = Math.max(zoomCaps.min, Math.min(zoomCaps.max, next));
    try {
      await track.applyConstraints({ advanced: [{ zoom: clamped }] });
      setZoom(clamped);
    } catch { /* ignore */ }
  }

  const zoomStep = zoomCaps ? Math.max(zoomCaps.step || 0.5, (zoomCaps.max - zoomCaps.min) / 8) : 0;

  return (
    <div className="fixed inset-0 z-[60] bg-black" style={{ touchAction: 'none' }}>
      <video
        ref={videoRef}
        className="absolute inset-0 w-full h-full object-cover"
        muted
        playsInline
      />

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

      {/* Barra superior: cerrar + modo */}
      <div className="absolute top-0 left-0 right-0 z-10 flex items-center justify-between px-4 pt-12 pb-2">
        <button type="button" onClick={onClose} className="p-2 rounded-full bg-black/50 text-white">
          <X size={20} />
        </button>
        {usingNative && (
          <span className="flex items-center gap-1 text-[11px] font-bold text-cyan-300 bg-black/50 px-2 py-1 rounded-full">
            <Zap size={11} /> Modo rápido
          </span>
        )}
      </div>

      {/* Controles de cámara (si el hardware los expone) */}
      {(torchAvailable || zoomCaps) && (
        <div className="absolute bottom-28 left-0 right-0 z-10 flex items-center justify-center gap-3">
          {zoomCaps && (
            <>
              <button type="button" onClick={() => applyZoom(zoom - zoomStep)} className="p-3 rounded-full bg-black/50 text-white" aria-label="Alejar">
                <ZoomOut size={18} />
              </button>
              <span className="text-white/80 text-xs font-bold w-10 text-center">{zoom.toFixed(1)}×</span>
              <button type="button" onClick={() => applyZoom(zoom + zoomStep)} className="p-3 rounded-full bg-black/50 text-white" aria-label="Acercar">
                <ZoomIn size={18} />
              </button>
            </>
          )}
          {torchAvailable && (
            <button
              type="button"
              onClick={toggleTorch}
              className={`p-3 rounded-full ${torchOn ? 'bg-yellow-400 text-black' : 'bg-black/50 text-white'}`}
              aria-label="Linterna"
            >
              <Flashlight size={18} />
            </button>
          )}
        </div>
      )}

      {/* Error o instrucción */}
      {scanError ? (
        <div className="absolute bottom-14 left-4 right-4 flex items-center justify-center gap-2 text-red-300 text-sm bg-black/60 rounded-xl px-3 py-2">
          <AlertCircle size={16} /> {scanError}
        </div>
      ) : (
        <p className="absolute bottom-16 left-0 right-0 text-center text-white/60 text-sm pointer-events-none">
          Apunta al código de barras del producto
        </p>
      )}
    </div>
  );
}
