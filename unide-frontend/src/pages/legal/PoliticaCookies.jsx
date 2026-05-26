// =====================================================================
// Política de Cookies — LSSI-CE Art. 22.2 + Guía AEPD julio 2023
// =====================================================================
// Documento exigible por el Art. 22.2 de la Ley 34/2002, de Servicios
// de la Sociedad de la Información y de Comercio Electrónico (LSSI-CE)
// y desarrollado conforme a la "Guía sobre el uso de las cookies" de
// la Agencia Española de Protección de Datos (AEPD), última versión
// vigente (julio 2023).
//
// HIPERA NO utiliza cookies HTTP propias del backend para la gestión
// de la sesión (la autenticación se realiza con JSON Web Tokens
// transmitidos en la cabecera Authorization, no en cookies). No
// obstante, la AEPD aclara que el concepto de "cookie" del Art. 22.2
// LSSI-CE abarca cualquier tecnología que almacene o acceda a
// información en el equipo terminal del usuario, lo que incluye
// localStorage y sessionStorage. Por tanto, este documento describe:
//
//   • Cookies estrictamente necesarias (Art. 22.2 LSSI-CE no requiere
//     consentimiento previo): autenticación, carrito, sincronización
//     de aceptación de términos y registro del propio consentimiento.
//   • Cookies de preferencias / funcionales (favoritos, dirección
//     guardada para conveniencia del cliente registrado). Se tratan
//     como necesarias de la experiencia solicitada por el usuario.
//   • Cookies de análisis y marketing preparadas en el banner pero
//     desactivadas por defecto. Si en el futuro se activan, se
//     pedirá nuevo consentimiento granular y se publicará el detalle
//     técnico en esta misma Política.
//
// Coherencia con:
//   - Política de Privacidad §4 (cookies y tecnologías similares)
//     y §11.4 (cross-reference explícito a este documento).
//   - Aviso Legal §6 (enlace a la presente Política).
//   - useCookieConsent.js (estado del banner, claves cookieConsentV2
//     en localStorage y user_consents en Supabase).
//   - LegalPage de App.jsx (renderiza este componente cuando
//     ?legal=cookies).
//
// Versión y bumps:
//   - Si se añade analytics/marketing/terceros: bump COOKIES_VERSION
//     (requiere re-consent) + DOCUMENT_VERSION + UPDATED_AT.
//   - Si se cambia sólo la redacción: bump DOCUMENT_VERSION y
//     UPDATED_AT, mantener COOKIES_VERSION.
// =====================================================================

import {
  COOKIES_DOCUMENT_VERSION,
  COOKIES_UPDATED_AT,
  COOKIES_VERSION,
} from '../../config/legal';
import { COMPANY } from '../../config/company';
import {
  Section,
  Subsection,
  Lit,
  Email,
  VersionBanner,
  DocFooter,
  MatrixRow,
} from './_components';

// ---------------------------------------------------------------------
// CookieRow — fila de la tabla detallada de cookies/almacenamiento.
// Pensada para ser legible en móvil (apila las columnas) y precisa
// para inspección por la AEPD (incluye titular y categoría AEPD).
// ---------------------------------------------------------------------
function CookieRow({ name, owner, category, purpose, lifespan, type }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-[1.1fr_0.9fr_0.9fr_1.6fr_1fr] gap-2 md:gap-4 p-3 rounded-xl bg-gray-50 border border-gray-100 text-sm">
      <div>
        <p className="font-mono text-xs text-gray-900 break-all">{name}</p>
        <p className="text-[11px] text-gray-500 mt-0.5">{type}</p>
      </div>
      <div className="text-gray-700">{owner}</div>
      <div className="text-gray-700">
        <span className="inline-block px-2 py-0.5 rounded-md bg-white border border-gray-200 text-xs font-medium">
          {category}
        </span>
      </div>
      <div className="text-gray-700">{purpose}</div>
      <div className="text-gray-600 text-xs md:text-sm">{lifespan}</div>
    </div>
  );
}

function CookieTableHeader() {
  return (
    <div className="hidden md:grid grid-cols-[1.1fr_0.9fr_0.9fr_1.6fr_1fr] gap-4 px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-gray-500">
      <div>Nombre / tipo</div>
      <div>Titular</div>
      <div>Categoría</div>
      <div>Finalidad</div>
      <div>Duración</div>
    </div>
  );
}

// ---------------------------------------------------------------------
// Intro — bloque introductorio fuera de las secciones numeradas
// ---------------------------------------------------------------------
function Intro() {
  return (
    <section>
      <h1 className="font-extrabold text-2xl text-gray-900 mb-2">
        Política de Cookies
      </h1>
      <p className="text-sm text-gray-600 leading-relaxed">
        En cumplimiento del <Lit>Art. 22.2 de la Ley 34/2002</Lit>, de Servicios
        de la Sociedad de la Información y de Comercio Electrónico (en
        adelante, <Lit>«LSSI-CE»</Lit>), y de la <strong>Guía sobre el uso
        de las cookies</strong> de la Agencia Española de Protección de Datos
        (en adelante, <Lit>«AEPD»</Lit>), HIPERA informa de forma transparente
        sobre los dispositivos de almacenamiento y recuperación de datos que
        utiliza en su sitio web {COMPANY.website}.
      </p>
    </section>
  );
}

export default function PoliticaCookies() {
  return (
    <div className="space-y-6 text-gray-700">
      <VersionBanner
        docVersion={COOKIES_DOCUMENT_VERSION}
        consentVersion={COOKIES_VERSION}
        updatedAt={COOKIES_UPDATED_AT}
      />

      <Intro />

      {/* ===================================================== */}
      <Section number="1" title="Identificación del responsable y objeto del documento">
        <Subsection title="1.1. Titular del sitio web">
          <ul className="list-disc pl-5 space-y-1">
            <li><strong>Denominación social:</strong> {COMPANY.name}</li>
            <li><strong>NIF:</strong> {COMPANY.nif}</li>
            <li><strong>Domicilio:</strong> {COMPANY.address}</li>
            <li><strong>Sitio web:</strong> {COMPANY.website}</li>
            <li>
              <strong>Contacto en materia de protección de datos:</strong>{' '}
              <Email addr={COMPANY.emailPrivacy} />
            </li>
          </ul>
        </Subsection>

        <Subsection title="1.2. Concepto de «cookie» a efectos de esta Política">
          <p>
            A efectos del Art. 22.2 LSSI-CE y de la Guía AEPD, se entiende por{' '}
            <Lit>cookie</Lit> cualquier fichero o tecnología equivalente
            (incluidos <code>localStorage</code>, <code>sessionStorage</code>,
            <em> Web Beacons</em>, <em>pixels</em>, <em>fingerprinting</em>,
            etiquetas y plug-ins de terceros) que almacene información en el
            terminal del Usuario o acceda a información ya almacenada en él.
            HIPERA <strong>no</strong> autentica al Usuario mediante cookies
            HTTP propias del backend (la sesión se gestiona con <Lit>JSON Web
            Tokens</Lit> en la cabecera <code>Authorization</code>), pero sí
            utiliza tecnologías de almacenamiento local descritas en §3 y
            sujetas al mismo régimen legal.
          </p>
        </Subsection>

        <Subsection title="1.3. Objeto del documento">
          <p>
            La presente Política tiene por objeto:
          </p>
          <ul className="list-disc pl-5 space-y-1">
            <li>
              Informar al Usuario del tipo de cookies y tecnologías
              equivalentes utilizadas por el sitio web, su finalidad concreta
              y su duración.
            </li>
            <li>
              Identificar al titular de cada cookie (propia o de tercero) y,
              en su caso, las transferencias internacionales asociadas.
            </li>
            <li>
              Describir los mecanismos de prestación, gestión y revocación del
              consentimiento, así como su conservación con fines probatorios
              (<Lit>Art. 7 RGPD</Lit>).
            </li>
            <li>
              Facilitar instrucciones para que el Usuario controle el
              tratamiento desde su navegador.
            </li>
          </ul>
        </Subsection>
      </Section>

      {/* ===================================================== */}
      <Section number="2" title="Marco jurídico y base de licitud">
        <p>
          El uso de cookies en HIPERA se rige por el siguiente marco
          normativo:
        </p>
        <ul className="list-disc pl-5 space-y-1">
          <li>
            <Lit>Art. 22.2 LSSI-CE</Lit> (Ley 34/2002), que exige consentimiento
            informado y previo del Usuario salvo que la cookie sea estrictamente
            necesaria para la prestación del servicio expresamente solicitado.
          </li>
          <li>
            <Lit>Reglamento (UE) 2016/679</Lit> (RGPD) y <Lit>Ley Orgánica
            3/2018</Lit> (LOPDGDD), cuando el uso de la cookie implique el
            tratamiento de datos personales.
          </li>
          <li>
            <strong>Guía AEPD sobre el uso de las cookies</strong>, edición de
            julio de 2023, y las <Lit>Directrices 03/2022 del Comité Europeo
            de Protección de Datos</Lit> sobre patrones engañosos en
            interfaces de redes sociales (aplicadas analógicamente al diseño
            de los banners de cookies, prohibiendo el sesgo a aceptar).
          </li>
        </ul>
        <Subsection title="2.1. Bases de licitud aplicables">
          <div className="grid grid-cols-1 gap-2 mt-2">
            <MatrixRow
              left="Cookies estrictamente necesarias"
              right="Exención del Art. 22.2 LSSI-CE."
              hint="Indispensables para prestar el servicio expresamente solicitado por el Usuario (login, carrito de la compra, registro del propio consentimiento)."
            />
            <MatrixRow
              left="Cookies funcionales / de preferencias"
              right="Ejecución de una funcionalidad solicitada por el Usuario (carrito persistente, favoritos, dirección recordada)."
              hint="HIPERA las trata bajo la exención del Art. 22.2 al tratarse de funcionalidades pedidas activamente por el Usuario al registrarse o interactuar con el sitio."
            />
            <MatrixRow
              left="Cookies de análisis o marketing"
              right="Consentimiento previo, granular, específico y revocable (Art. 22.2 LSSI-CE + Art. 6.1.a RGPD)."
              hint="Actualmente NO se cargan cookies de análisis ni de marketing. Las categorías aparecen en el banner sólo en modo «desactivadas por defecto» para que el Usuario tenga visibilidad anticipada del modelo de consentimiento."
            />
          </div>
        </Subsection>
      </Section>

      {/* ===================================================== */}
      <Section number="3" title="Detalle de cookies y tecnologías utilizadas">
        <p>
          A continuación se relacionan todas las cookies y dispositivos de
          almacenamiento local que el sitio puede instalar o leer en el
          terminal del Usuario, con indicación de su titular, categoría
          AEPD, finalidad y duración.
        </p>

        <Subsection title="3.1. Cookies estrictamente necesarias">
          <p className="text-xs text-gray-500 mb-2">
            No requieren consentimiento (Art. 22.2 LSSI-CE) por ser
            indispensables para el funcionamiento del servicio. Si el
            Usuario las bloquea desde el navegador, no podrá iniciar
            sesión, mantener productos en la cesta ni completar pedidos.
          </p>
          <CookieTableHeader />
          <div className="space-y-2">
            <CookieRow
              name="sb-yscoewxnmsfpebfwwios-auth-token"
              type="localStorage"
              owner="HIPERA · Supabase"
              category="Propia · Técnica"
              purpose="Autenticación del Usuario. Almacena el token JWT y el refresh token emitidos tras el inicio de sesión para mantener al Usuario identificado entre páginas y refrescar la sesión sin pedir credenciales en cada navegación."
              lifespan="Persistente. Caduca aprox. 1 h por refresh; se elimina al cerrar sesión."
            />
            <CookieRow
              name="cookieConsentV2"
              type="localStorage"
              owner="HIPERA"
              category="Propia · Técnica"
              purpose="Almacena la decisión del Usuario sobre el banner de cookies (necesarias / análisis / marketing) y la fecha de prestación del consentimiento. Es indispensable para no volver a mostrar el banner en cada visita y para acreditar el cumplimiento del Art. 7 RGPD."
              lifespan="Persistente. 24 meses desde la última decisión (criterio AEPD)."
            />
            <CookieRow
              name="cart"
              type="localStorage"
              owner="HIPERA"
              category="Propia · Técnica"
              purpose="Carrito de la compra. Conserva los productos seleccionados por el Usuario hasta que finaliza la compra o vacía la cesta."
              lifespan="Persistente hasta que el Usuario complete o vacíe el carrito."
            />
            <CookieRow
              name="pendingTermsAcceptance"
              type="localStorage"
              owner="HIPERA"
              category="Propia · Técnica"
              purpose="Sincroniza la aceptación de Términos y Condiciones y Política de Privacidad realizada en el formulario de registro con el primer inicio de sesión, para que quede registrada en la base de datos del responsable."
              lifespan="Sesión. Se elimina automáticamente tras la sincronización."
            />
          </div>
        </Subsection>

        <Subsection title="3.2. Cookies funcionales / de preferencias">
          <p className="text-xs text-gray-500 mb-2">
            Sirven a funcionalidades activadas explícitamente por el
            Usuario. Se asimilan a necesarias bajo la exención del Art.
            22.2 cuando responden a una funcionalidad expresamente
            solicitada por el Usuario (Guía AEPD §3.1). Puede desactivarlas
            borrando el almacenamiento local del navegador.
          </p>
          <CookieTableHeader />
          <div className="space-y-2">
            <CookieRow
              name="favorites"
              type="localStorage"
              owner="HIPERA"
              category="Propia · Funcional"
              purpose="Lista personal de productos favoritos del Usuario, gestionada exclusivamente desde el dispositivo. No se comparte con terceros ni se asocia automáticamente a la cuenta."
              lifespan="Persistente hasta que el Usuario la borre o limpie el navegador."
            />
            <CookieRow
              name="lastAddress"
              type="localStorage"
              owner="HIPERA"
              category="Propia · Funcional"
              purpose="Recuerda la última dirección de entrega, teléfono y correo electrónico utilizados por el Usuario para agilizar futuras compras. Sólo se utiliza para prerellenar el formulario de pago."
              lifespan="Persistente hasta que el Usuario la borre o limpie el navegador."
            />
          </div>
        </Subsection>

        <Subsection title="3.3. Cookies de análisis y marketing">
          <p>
            En la fecha de actualización de esta Política (véase pie del
            documento), HIPERA <strong>no instala cookies de análisis ni de
            marketing</strong>. El banner de consentimiento expone ambas
            categorías como informativas y permanecen <strong>desactivadas
            por defecto</strong>. Cuando una de estas categorías se active
            efectivamente, la presente Política se actualizará con el
            detalle técnico de cada cookie (nombre, titular, finalidad,
            duración y, en su caso, transferencias internacionales) y se
            solicitará nuevo consentimiento granular.
          </p>
        </Subsection>

        <Subsection title="3.4. Cookies de terceros y redes sociales">
          <p>
            Actualmente, el sitio <strong>no</strong> embebe contenido de
            terceros que instale cookies en el navegador del Usuario sin su
            interacción explícita. En particular:
          </p>
          <ul className="list-disc pl-5 space-y-1">
            <li>
              <strong>Redes sociales (WhatsApp, Facebook, Instagram):</strong>{' '}
              los iconos del pie de página son enlaces externos
              tradicionales (<code>&lt;a href&gt;</code>). Sólo se contacta
              con los servidores de terceros cuando el Usuario hace clic
              activamente sobre ellos, momento en que se aplica la política
              de cookies del tercero correspondiente.
            </li>
            <li>
              <strong>Pasarela de pago:</strong> en el momento de
              integración de una pasarela externa (p. ej. Stripe), las
              cookies de la pasarela se instalarán únicamente dentro de la
              ventana o iframe de pago, conforme a su propia política, y
              esta sección se actualizará con la información detallada.
            </li>
            <li>
              <strong>Mapas, vídeos embebidos, análisis externos:</strong>{' '}
              no se utilizan.
            </li>
          </ul>
        </Subsection>
      </Section>

      {/* ===================================================== */}
      <Section number="4" title="Gestión del consentimiento">
        <Subsection title="4.1. Banner de información y opciones">
          <p>
            Al acceder por primera vez al sitio (o tras revocar el
            consentimiento), HIPERA muestra un banner que cumple las
            exigencias del Art. 22.2 LSSI-CE y la Guía AEPD:
          </p>
          <ul className="list-disc pl-5 space-y-1">
            <li>
              <strong>Aceptar todo:</strong> consiente las categorías de
              análisis y marketing (cuando estén disponibles) además de las
              necesarias y funcionales.
            </li>
            <li>
              <strong>Rechazar todo:</strong> opción equivalente en
              prominencia visual a «Aceptar todo» (Guía AEPD §4). Mantiene
              activas únicamente las categorías estrictamente necesarias y
              funcionales descritas en §3.1 y §3.2.
            </li>
            <li>
              <strong>Configurar:</strong> permite aceptar o rechazar cada
              categoría no necesaria de forma granular. La elección del
              Usuario se respeta exactamente como se haya indicado.
            </li>
          </ul>
          <p>
            Mientras el Usuario no se haya pronunciado, <strong>no se
            cargan</strong> cookies sujetas a consentimiento (categorías de
            análisis y marketing). Continuar navegando, hacer <em>scroll</em>{' '}
            o cerrar el banner <strong>no</strong> equivalen a consentimiento.
          </p>
        </Subsection>

        <Subsection title="4.2. Validez del consentimiento">
          <p>
            El consentimiento se considera válido durante un período máximo
            de <strong>24 meses</strong> desde su prestación (criterio
            recogido en la Guía AEPD). Transcurrido ese plazo, o cuando se
            produzca un cambio material en las cookies utilizadas, HIPERA
            volverá a solicitar el consentimiento del Usuario.
          </p>
        </Subsection>

        <Subsection title="4.3. Revocación y modificación">
          <p>
            El Usuario puede retirar o modificar su consentimiento en
            cualquier momento, sin necesidad de justificación, mediante:
          </p>
          <ul className="list-disc pl-5 space-y-1">
            <li>
              El enlace <strong>«Gestionar cookies»</strong> disponible de
              forma permanente en el pie de página del sitio web.
            </li>
            <li>
              La eliminación de las cookies y del almacenamiento local
              desde la configuración del navegador (véase §6).
            </li>
            <li>
              Escribiendo a <Email addr={COMPANY.emailPrivacy} /> para
              ejercer los derechos del Capítulo III del RGPD relativos a
              los datos personales recogidos a través de cookies.
            </li>
          </ul>
          <p>
            La retirada del consentimiento no afectará a la licitud del
            tratamiento basado en el consentimiento previo a su retirada
            (<Lit>Art. 7.3 RGPD</Lit>).
          </p>
        </Subsection>

        <Subsection title="4.4. Registro probatorio del consentimiento">
          <p>
            Conforme al <Lit>Art. 7.1 RGPD</Lit>, HIPERA conserva prueba del
            consentimiento prestado por el Usuario:
          </p>
          <ul className="list-disc pl-5 space-y-1">
            <li>
              <strong>En el terminal:</strong> objeto{' '}
              <code>cookieConsentV2</code> en <code>localStorage</code>, que
              incluye la decisión por categoría, la fecha de prestación y
              la versión del documento de cookies vigente en ese momento.
            </li>
            <li>
              <strong>En la base de datos del responsable:</strong> si el
              Usuario está identificado, la decisión se sincroniza en la
              tabla <code>user_consents</code> con sello temporal,{' '}
              <code>user-agent</code> abreviado y origen (banner / panel de
              configuración).
            </li>
          </ul>
          <p className="text-xs text-gray-500">
            El plazo de conservación de estos registros y los datos
            asociados se detalla en la Política de Privacidad §5
            («Conservación de los datos»).
          </p>
        </Subsection>
      </Section>

      {/* ===================================================== */}
      <Section number="5" title="Transferencias internacionales asociadas a cookies">
        <p>
          Las cookies y almacenamiento local descritos en §3 son{' '}
          <strong>cookies propias</strong>, gestionadas desde la
          infraestructura europea contratada por HIPERA. Las
          transferencias internacionales potencialmente asociadas se
          limitan a:
        </p>
        <ul className="list-disc pl-5 space-y-1">
          <li>
            <strong>Supabase Inc.</strong> (autenticación, región
            eu-west-1 / Irlanda; matriz en EE.UU.). Las cookies de
            autenticación nunca abandonan el terminal del Usuario; el
            token incluido en ellas se valida contra la infraestructura
            del proveedor en el EEE. Las garantías aplicables (SCC y EU-US
            DPF cuando proceda) se desarrollan en la Política de
            Privacidad §7.
          </li>
          <li>
            <strong>Resend Inc.</strong> (envío de correos transaccionales,
            región eu-west-1 / Irlanda; matriz en EE.UU.).{' '}
            <strong>No</strong> instala cookies en el navegador del
            Usuario; se cita aquí únicamente por exhaustividad. El detalle
            de las garantías SCC se desarrolla en la Política de Privacidad
            §7.
          </li>
        </ul>
      </Section>

      {/* ===================================================== */}
      <Section number="6" title="Configuración desde el navegador">
        <p>
          Con independencia de las herramientas que ofrece HIPERA (§4), el
          Usuario puede bloquear, eliminar o consultar las cookies y el
          almacenamiento local directamente desde su navegador:
        </p>
        <ul className="list-disc pl-5 space-y-1">
          <li>
            <strong>Google Chrome:</strong>{' '}
            <a
              href="https://support.google.com/chrome/answer/95647"
              target="_blank"
              rel="noopener noreferrer"
              className="text-red-600 underline hover:text-red-700"
            >
              support.google.com/chrome/answer/95647
            </a>
          </li>
          <li>
            <strong>Mozilla Firefox:</strong>{' '}
            <a
              href="https://support.mozilla.org/es/kb/proteccion-antirrastreo-mejorada-firefox-escritorio"
              target="_blank"
              rel="noopener noreferrer"
              className="text-red-600 underline hover:text-red-700"
            >
              support.mozilla.org · Protección antirrastreo
            </a>
          </li>
          <li>
            <strong>Safari (macOS / iOS):</strong>{' '}
            <a
              href="https://support.apple.com/es-es/guide/safari/sfri11471/mac"
              target="_blank"
              rel="noopener noreferrer"
              className="text-red-600 underline hover:text-red-700"
            >
              support.apple.com/es-es/guide/safari/sfri11471/mac
            </a>
          </li>
          <li>
            <strong>Microsoft Edge:</strong>{' '}
            <a
              href="https://support.microsoft.com/es-es/microsoft-edge/eliminar-las-cookies-en-microsoft-edge-63947406-40ac-c3b8-57b9-2a946a29ae09"
              target="_blank"
              rel="noopener noreferrer"
              className="text-red-600 underline hover:text-red-700"
            >
              support.microsoft.com · Eliminar cookies en Edge
            </a>
          </li>
        </ul>
        <p className="text-xs text-gray-500">
          <strong>Aviso:</strong> deshabilitar las cookies y el
          almacenamiento local clasificados como estrictamente necesarios
          impedirá iniciar sesión, mantener la cesta entre páginas y
          completar pedidos. La funcionalidad del sitio quedará gravemente
          limitada.
        </p>
      </Section>

      {/* ===================================================== */}
      <Section number="7" title="Cookies y menores">
        <p>
          HIPERA no dirige sus servicios a menores de 14 años (Art. 7
          LOPDGDD). En la medida en que pueda accederse al sitio desde un
          terminal compartido con menores, se recomienda a los
          representantes legales:
        </p>
        <ul className="list-disc pl-5 space-y-1">
          <li>
            Supervisar las visitas a sitios de comercio electrónico desde
            el equipo familiar.
          </li>
          <li>
            Mantener cerrada la sesión de HIPERA cuando el menor pueda
            acceder al terminal.
          </li>
          <li>
            Configurar perfiles de usuario diferenciados en el sistema
            operativo o el navegador.
          </li>
        </ul>
      </Section>

      {/* ===================================================== */}
      <Section number="8" title="Derechos del Usuario y vía de contacto">
        <p>
          En la medida en que las cookies puedan implicar tratamiento de
          datos personales (p. ej. el token de autenticación se asocia a
          la cuenta del Usuario), éste puede ejercer los derechos de
          acceso, rectificación, supresión, oposición, limitación y
          portabilidad reconocidos por el Capítulo III del RGPD, así como
          retirar el consentimiento prestado a esta Política. Para ello,
          puede dirigirse a:
        </p>
        <ul className="list-disc pl-5 space-y-1">
          <li>
            <strong>Privacidad:</strong> <Email addr={COMPANY.emailPrivacy} />
          </li>
          <li>
            <strong>Reclamaciones:</strong>{' '}
            <Email addr={COMPANY.emailComplaints} />
          </li>
        </ul>
        <p className="text-xs text-gray-500">
          El procedimiento completo para el ejercicio de derechos se
          describe en la Política de Privacidad §§8 y 9. El Usuario tiene
          asimismo derecho a presentar reclamación ante la Agencia
          Española de Protección de Datos (
          <a
            href="https://www.aepd.es"
            target="_blank"
            rel="noopener noreferrer"
            className="text-red-600 underline hover:text-red-700"
          >
            www.aepd.es
          </a>
          ).
        </p>
      </Section>

      {/* ===================================================== */}
      <Section number="9" title="Modificaciones de la Política">
        <p>
          HIPERA podrá modificar esta Política para adaptarla a cambios
          normativos, jurisprudenciales o tecnológicos, así como a las
          recomendaciones publicadas por la AEPD. Cualquier modificación
          se notificará a través del sitio web; las modificaciones que
          afecten al tipo o al titular de las cookies utilizadas
          conllevarán además la solicitud de nuevo consentimiento al
          Usuario en su próxima visita.
        </p>
        <p className="text-xs text-gray-500">
          La fecha de última actualización figura en el banner de versión
          al inicio del documento y en el pie del mismo.
        </p>
      </Section>

      <DocFooter
        docVersion={COOKIES_DOCUMENT_VERSION}
        consentVersion={COOKIES_VERSION}
        updatedAt={COOKIES_UPDATED_AT}
      />
    </div>
  );
}
