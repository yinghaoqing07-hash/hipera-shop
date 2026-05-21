// =====================================================================
// Componentes compartidos para páginas legales
// =====================================================================
// Usados por TerminosCondiciones, PoliticaPrivacidad y futuras páginas
// legales (Aviso Legal, Devoluciones, Envíos) para mantener un estilo
// y semántica consistentes en todos los documentos.
// =====================================================================

import { COMPANY } from '../../config/company';

export function Section({ number, title, children }) {
  return (
    <section className="border-t border-gray-100 pt-5 first:border-t-0 first:pt-0">
      <h2 className="font-bold text-base md:text-lg text-gray-900 mb-3">
        {number}. {title}
      </h2>
      <div className="text-sm text-gray-700 leading-relaxed space-y-3">{children}</div>
    </section>
  );
}

export function Subsection({ title, children }) {
  return (
    <div className="ml-1 mt-3">
      <h3 className="font-semibold text-sm text-gray-900 mb-1">{title}</h3>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

/** Referencia legal en cursiva discreta (no semántica, sólo estilo). */
export function Lit({ children }) {
  return <em className="text-gray-900 not-italic font-medium">{children}</em>;
}

export function Email({ addr }) {
  return (
    <a href={`mailto:${addr}`} className="text-red-600 underline hover:text-red-700">
      {addr}
    </a>
  );
}

/**
 * Banner de versión que se muestra al principio del documento.
 * Acepta cualquier par documento/consentimiento.
 */
export function VersionBanner({ docVersion, consentVersion, updatedAt }) {
  return (
    <div className="bg-gray-50 border border-gray-200 p-4 rounded-xl text-xs text-gray-600">
      <div className="flex flex-wrap justify-between gap-2">
        <span>
          Versión del documento: <strong>{docVersion}</strong>
        </span>
        <span>
          Versión de consentimiento: <strong>v{consentVersion}</strong>
        </span>
        <span>
          Vigente desde: <strong>{updatedAt}</strong>
        </span>
      </div>
    </div>
  );
}

/**
 * Pie del documento con datos identificativos y referencias de versión.
 * Toma las versiones del documento concreto que lo renderiza.
 */
export function DocFooter({ docVersion, consentVersion, updatedAt }) {
  return (
    <div className="mt-6 pt-4 border-t border-gray-200 text-xs text-gray-500 space-y-1">
      <p>
        <strong>{COMPANY.name}</strong> · NIF {COMPANY.nif} · {COMPANY.address}
      </p>
      <p>
        Documento legal vinculante. Documento v{docVersion} · Consentimiento v
        {consentVersion} · Vigente desde {updatedAt}.
      </p>
    </div>
  );
}

/**
 * Fila de una "tabla" con dos columnas para uso en RGPD (Finalidad↔Base,
 * Datos↔Plazo, etc.). Apilada en móvil, en grid en escritorio.
 */
export function MatrixRow({ left, right, hint }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-[1fr_1.2fr] gap-2 md:gap-4 p-3 rounded-xl bg-gray-50 border border-gray-100">
      <div className="font-semibold text-gray-900 text-sm">{left}</div>
      <div className="text-gray-700 text-sm space-y-1">
        <div>{right}</div>
        {hint && <div className="text-xs text-gray-500">{hint}</div>}
      </div>
    </div>
  );
}
