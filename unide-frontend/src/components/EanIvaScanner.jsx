// EanIvaScanner — escáner EAN inline para la pantalla de revisión de IVA.
//
// La cámara y la detección viven en components/BarcodeScannerOverlay.jsx
// (motor compartido con la pestaña Consulta IVA): BarcodeDetector nativo
// con enfoque continuo/zoom/linterna, y quagga2 de fallback. Aquí queda
// solo el flujo propio de la revisión: buscar el EAN leído en el catálogo
// UNIDE y ofrecer "Usar" para aplicar el tipo al producto.
//
// El match de EAN normaliza ceros a la izquierda: UNIDE mezcla EAN-13 y
// UPC-A de 12 dígitos, y el escáner devuelve 13 → sin normalizar, códigos
// correctos no encontraban su ficha.

import { useState } from 'react';
import { ScanLine, X, AlertCircle, CheckCircle } from 'lucide-react';
import BarcodeScannerOverlay from './BarcodeScannerOverlay';

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

// Solo dígitos y sin ceros a la izquierda (EAN-13 vs UPC-A).
const eanKey = (s) => String(s || '').replace(/\D/g, '').replace(/^0+/, '');

function lookupEan(ean, data) {
  const k = eanKey(ean);
  if (!k || !data) return null;
  return data.find(p => eanKey(p.e) === k) ?? null;
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
  const [phase, setPhase] = useState('idle'); // idle | scanning | found | notfound | error
  const [scanError, setScanError] = useState('');
  const [result, setResult] = useState(null);
  const [applied, setApplied] = useState(false);

  async function startScan() {
    setResult(null);
    setApplied(false);
    setScanError('');
    // El catálogo se precarga ANTES de abrir la cámara: así el resultado
    // del escaneo es instantáneo y un fallo de red se ve sin abrir cámara.
    try { await loadData(); } catch {
      setScanError('No se pudieron cargar los datos. Comprueba la conexión.');
      setPhase('error');
      return;
    }
    setPhase('scanning');
  }

  function handleDetected(code) {
    const hit = lookupEan(code, DATA_CACHE);
    setResult(hit ?? { e: code });
    setPhase(hit ? 'found' : 'notfound');
  }

  function cancel() { setPhase('idle'); setResult(null); setApplied(false); }
  function apply()  { if (result?.i == null) return; onApply(String(result.i)); setApplied(true); }

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

  // ── Error (carga de datos) ──────────────────────────────────────────────────
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

  // ── Escáner activo (overlay compartido) ─────────────────────────────────────
  return <BarcodeScannerOverlay onDetected={handleDetected} onClose={cancel} />;
}
