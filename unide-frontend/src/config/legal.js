// =====================================================================
// Versiones de los documentos legales
// =====================================================================
// El cliente compara la "versión de consentimiento" vigente con la
// última aceptada por el usuario; si difiere, se le pide re-aceptar
// en el siguiente checkout (Art. 7 RGPD: el consentimiento debe ser
// informado y vigente).
//
// Convención:
//   - *_VERSION              número entero. Sube SOLO cuando el cambio
//                            sea material y requiera re-aceptación
//                            por parte del usuario.
//   - *_DOCUMENT_VERSION     versión legible del documento ("1.0", "1.1"...).
//                            Sube en cada publicación del documento.
//                            Convención: cambios mayores (1.x → 2.0)
//                            implican subir también *_VERSION; cambios
//                            menores (1.0 → 1.1, correcciones tipográficas
//                            o aclaraciones) NO suben *_VERSION.
//   - *_UPDATED_AT           fecha ISO de publicación del documento.
//
// Histórico:
//   T&C
//     v1 / doc 0.x — Texto provisional embebido en Aviso Legal.
//     v2 / doc 1.0 — Primer documento formal completo (16 secciones)
//                    basado en RDLeg 1/2007, LSSI-CE, RD 1906/1999.
//                    Re-aceptación requerida.
//   Privacidad
//     v1 / doc 0.x — Texto provisional. Reescritura programada en 1.4.
// =====================================================================

// --- Términos y Condiciones ---
export const TERMS_VERSION = 2;                  // ↑ desde v1 (era texto provisional)
export const TERMS_DOCUMENT_VERSION = '1.0';
export const TERMS_UPDATED_AT = '2026-05-21';

// --- Política de Privacidad ---
export const PRIVACY_VERSION = 1;                // pendiente reescritura en 1.4
export const PRIVACY_DOCUMENT_VERSION = '0.9';   // marcado como provisional hasta 1.4
export const PRIVACY_UPDATED_AT = '2026-05-21';
