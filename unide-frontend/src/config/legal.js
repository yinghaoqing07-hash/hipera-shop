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
//   Devoluciones
//     v0 / doc 0.x — Texto provisional embebido en App.jsx
//                    (renderDevolucionesContent), con bloque "sin usar"
//                    contrario a Art. 108.2 y sin Anexo B.
//     v1 / doc 1.0 — Primer documento formal completo (11 secciones)
//                    como manual operativo complementario a T&C §8,
//                    basado en RDLeg 1/2007 (Arts. 102-108 + 114-127)
//                    y Directiva 2011/83/UE. Incluye criterio Art.
//                    108.2 (no exige "sin usar"), modelo Anexo B
//                    imprimible, tabla comparativa desistimiento vs
//                    garantía y excepciones del Art. 103.
//                    NO se requiere consentimiento explícito en
//                    checkout: la Política es informativa y se acepta
//                    indirectamente al aceptar T&C §8 (la base
//                    contractual). Versionado preparado para futuros
//                    cambios materiales.
//   Envíos
//     v0 / doc 0.x — Sin documento dedicado. T&C §7 prometía remitirse
//                    a la "Política de Envíos" sin que ésta existiese.
//     v1 / doc 1.0 — Primer documento formal completo (8 secciones)
//                    como manual operativo complementario a T&C §7,
//                    basado en RDLeg 1/2007 (Arts. 66 bis, 66 ter,
//                    97 y 60.2.e) y Directiva 2011/83/UE.
//                    Cumple las cuatro promesas explícitas de T&C §7:
//                    zonas de cobertura (Meco + zona local ~10 km),
//                    plazos estimados (recogida 2-4h / domicilio
//                    24-72h, sin perjuicio del legal 30 días),
//                    tarifa única (4,99 €) y umbral gratuito (40 €).
//                    Operador logístico genérico para evitar bump de
//                    PRIVACY_VERSION; si se firma contrato con un
//                    operador concreto, actualizar Privacy §6.
//                    NO requiere consentimiento explícito en checkout:
//                    la Política es informativa y se acepta
//                    indirectamente al aceptar T&C §7 (la base
//                    contractual).
//   Aviso Legal
//     v0 / doc 0.x — Texto provisional embebido en App.jsx
//                    (LegalPage.content.aviso.text), ~50 palabras,
//                    sin estructura de secciones y sin la mayor parte
//                    del contenido obligatorio del Art. 10 LSSI-CE.
//     v1 / doc 1.0 — Primer documento formal completo (8 secciones,
//                    ~21 subsections) basado en Art. 10 LSSI-CE
//                    34/2002 + RDLeg 1/1996 LPI + Ley 17/2001 Marcas
//                    + Reg. UE 524/2013 + Reg. UE 2024/3228 ODR
//                    (cross-ref a T&C §15.3).
//                    Cubre identificación, condiciones de uso del sitio,
//                    propiedad intelectual e industrial, política de
//                    enlaces (salientes y entrantes/hotlinking),
//                    exención de responsabilidad y jurisdicción.
//                    No reproduce contenido de T&C/Privacy/Cookies/
//                    Devoluciones/Envíos; sólo cross-ref breve.
//                    Mientras COMPANY.registry contenga "[PENDIENTE]"
//                    se muestra automáticamente un aviso al Usuario
//                    en §1.2 (datos en trámite de verificación).
//                    NO requiere consentimiento explícito en checkout:
//                    es un aviso informativo de cumplimiento LSSI-CE.
// =====================================================================

// --- Términos y Condiciones ---
// 1.2 → 1.3 (2026-05-26): revisión correctiva no material:
//   • §5.1 menciona el remitente operativo pedidos@hipera.es para
//     que el cliente pueda whitelistarlo y evitar spam.
//   • §6 actualiza la descripción de Bizum (de "(cuando esté
//     disponible)" a operativo con verificación manual de la
//     transferencia), reflejando el estado real del checkout.
//   • Tarjeta se mantiene como "cuando esté disponible" hasta que
//     se integre Stripe.
// NO requiere re-aceptación: ningún cambio modifica la base
// económica, las obligaciones de las partes ni las garantías.
export const TERMS_VERSION = 3;
export const TERMS_DOCUMENT_VERSION = '1.3';
export const TERMS_UPDATED_AT = '2026-05-26';

// --- Política de Privacidad ---
// 1.2 → 1.3 (2026-05-26): revisión correctiva no material que
// precisa la operativa de Resend tras su activación:
//   • §6.1 indica que el remitente operativo es pedidos@hipera.es
//     y que el almacenamiento físico se realiza en la región
//     eu-west-1 (Irlanda) del proveedor.
//   • §7.1 reformula la transferencia internacional: el
//     procesamiento ordinario tiene lugar en el EEE (Irlanda) y la
//     calificación como transferencia internacional se mantiene
//     únicamente por la matriz estadounidense del proveedor y los
//     posibles accesos puntuales de soporte técnico.
//   • Las SCC y demás salvaguardas listadas en §7.1 NO cambian.
// NO requiere re-aceptación: las finalidades, bases jurídicas,
// destinatarios y garantías del tratamiento son las mismas
// publicadas en 1.2; sólo se aporta mayor precisión geográfica.
export const PRIVACY_VERSION = 3;
export const PRIVACY_DOCUMENT_VERSION = '1.3';
export const PRIVACY_UPDATED_AT = '2026-05-26';

// --- Política de Devoluciones ---
// Documento informativo (manual operativo complementario a T&C §8),
// no requiere consentimiento explícito en checkout. El versionado se
// mantiene por si futuros cambios materiales obligan a notificar.
// 1.0 → 1.1 (2026-05-25): aclaración §5.4 (alcance: desistimiento
// total) y nuevo §5.5 (matriz reembolso de envío × umbral 40 € ×
// tipo de devolución, con 3 ejemplos). Cambio material por afectar
// al cálculo económico del reembolso.
export const RETURNS_VERSION = 2;
export const RETURNS_DOCUMENT_VERSION = '1.1';
export const RETURNS_UPDATED_AT = '2026-05-25';

// --- Política de Envíos ---
// Documento informativo (manual operativo complementario a T&C §7),
// no requiere consentimiento explícito en checkout. El versionado se
// mantiene por si futuros cambios materiales (ampliación de zona,
// nueva tarifa, contratación de operador logístico concreto, etc.)
// obligan a notificar.
export const SHIPPING_VERSION = 1;
export const SHIPPING_DOCUMENT_VERSION = '1.0';
export const SHIPPING_UPDATED_AT = '2026-05-23';

// --- Aviso Legal ---
// Documento informativo de cumplimiento LSSI-CE (Art. 10), no requiere
// consentimiento explícito en checkout. El versionado se mantiene por si
// futuros cambios materiales (completar Registro Mercantil, ampliación
// de actividad, cambio de denominación social, etc.) obligan a notificar.
// 1.0 → 1.1 (2026-05-26): actualización del campo "Sitio web" del
// titular para reflejar el dominio definitivo https://hipera.es
// (registrado en Cloudflare el 2026-05-25). El alias técnico de
// despliegue (hipera-shop.vercel.app) deja de exponerse como URL
// canónica en este aviso y en los metadatos SEO (index.html). El
// resto del documento no varía.
export const LEGAL_NOTICE_VERSION = 1;
export const LEGAL_NOTICE_DOCUMENT_VERSION = '1.1';
export const LEGAL_NOTICE_UPDATED_AT = '2026-05-26';
