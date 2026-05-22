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
//     v2 / doc 1.1 — Revisión correctiva (sin cambios materiales):
//                    §10.5 RD 58/1988 sin nº de artículo (Art. 11 era
//                    incorrecto; correcto es Art. 6 pero se evita citar
//                    para robustez); §10.6 reescrito como protección de
//                    datos del dispositivo con compromisos detallados;
//                    §15.3 ODR cerrado (Reglamento UE 2024/3228, vigente
//                    desde 20-jul-2025); §2.1 capacidad sin franjas de
//                    edad concretas; §2.2 sin tabaco; §7.3 y §12.1/§12.3
//                    salvaguardas adicionales para consumidores; T4 fix
//                    de typo de espacio JSX en §8.1. NO requiere
//                    re-aceptación (cambios menores conforme a la
//                    convención superior).
//   Privacidad
//     v1 / doc 0.x — Texto provisional embebido en App.jsx.
//     v2 / doc 1.0 — Primer documento formal completo (11 secciones)
//                    basado en RGPD (UE) 2016/679, LOPDGDD 3/2018,
//                    LSSI-CE 34/2002. Stack real de encargados del
//                    tratamiento (Railway, Vercel, Supabase, Stripe,
//                    Resend). Re-aceptación requerida.
//     v2 / doc 1.1 — Revisión correctiva (sin cambios materiales):
//                    §1.3 DPO con valoración periódica; §6.2 incluye
//                    Meta Platforms Ireland Limited (deep links de
//                    WhatsApp iniciados por el Usuario). Banners de
//                    homepage migrados de Unsplash a /public local
//                    (eliminada transferencia US adicional). NO requiere
//                    re-aceptación.
// =====================================================================

// --- Términos y Condiciones ---
export const TERMS_VERSION = 2;                  // sin cambio (revisión menor 1.0 → 1.1)
export const TERMS_DOCUMENT_VERSION = '1.1';
export const TERMS_UPDATED_AT = '2026-05-22';

// --- Política de Privacidad ---
export const PRIVACY_VERSION = 2;                // sin cambio (revisión menor 1.0 → 1.1)
export const PRIVACY_DOCUMENT_VERSION = '1.1';
export const PRIVACY_UPDATED_AT = '2026-05-22';
