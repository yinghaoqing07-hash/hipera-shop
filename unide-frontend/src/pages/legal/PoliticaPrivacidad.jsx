// =====================================================================
// Política de Privacidad — RGPD (UE) 2016/679 + LOPDGDD 3/2018
// =====================================================================
// 11 secciones conforme a los artículos 13 y 14 RGPD (información que
// debe facilitarse cuando los datos se obtienen del interesado).
//
// Estructura:
//   §1  Identidad del Responsable           [Art. 13.1.a RGPD]
//   §2  Finalidades del Tratamiento         [Art. 13.1.c]
//   §3  Base Jurídica                       [Art. 6 + 13.1.c/d]
//   §4  Categorías de Datos                 [Art. 13.1 + 14.1.d]
//   §5  Plazos de Conservación              [Art. 13.2.a]
//   §6  Destinatarios y Encargados          [Art. 13.1.e + 28]
//   §7  Transferencias Internacionales      [Art. 13.1.f + 44-49]
//   §8  Derechos de los Usuarios            [Art. 15-22 + 7.3]
//   §9  Cómo Ejercer los Derechos           [Art. 12]
//   §10 Reclamaciones ante la AEPD          [Art. 77]
//   §11 Modificaciones de la Política       [Art. 13.3]
//
// Stack de encargados del tratamiento: Railway, Vercel, Supabase,
// Stripe (futuro), Resend (futuro). Mantener sincronizado con la
// realidad operativa. Cualquier nuevo proveedor obliga a actualizar §6.
//
// Coherencia con Política de Cookies (App.jsx → LegalPage.content.cookies):
//   - Actualmente sólo cookies técnicas imprescindibles.
//   - Categorías "analítica" y "marketing" del banner están preparadas
//     para activación futura pero NO se utilizan a día de hoy.
// =====================================================================

import {
  PRIVACY_DOCUMENT_VERSION,
  PRIVACY_UPDATED_AT,
  PRIVACY_VERSION,
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

export default function PoliticaPrivacidad() {
  return (
    <div className="space-y-6 text-gray-700">
      <VersionBanner
        docVersion={PRIVACY_DOCUMENT_VERSION}
        consentVersion={PRIVACY_VERSION}
        updatedAt={PRIVACY_UPDATED_AT}
      />

      <Intro />

      {/* ===================================================== */}
      <Section number="1" title="Identidad del Responsable del Tratamiento">
        <p>
          En cumplimiento del <Lit>Reglamento (UE) 2016/679, de 27 de abril, General
          de Protección de Datos</Lit> («RGPD») y de la{' '}
          <Lit>Ley Orgánica 3/2018, de 5 de diciembre, de Protección de Datos Personales
          y garantía de los derechos digitales</Lit> («LOPDGDD»), se informa al
          interesado de los siguientes datos identificativos del Responsable:
        </p>

        <Subsection title="1.1. Datos del Responsable">
          <ul className="list-disc pl-5 space-y-1">
            <li>
              <strong>Razón social:</strong> {COMPANY.name}
            </li>
            <li>
              <strong>NIF:</strong> {COMPANY.nif}
            </li>
            <li>
              <strong>Nombre comercial:</strong> HIPERA
            </li>
            <li>
              <strong>Domicilio social:</strong> {COMPANY.address}
            </li>
            <li>
              <strong>Teléfono:</strong> {COMPANY.phone}
            </li>
            <li>
              <strong>Sitio web:</strong> {COMPANY.website}
            </li>
            <li>
              <strong>Inscripción:</strong> {COMPANY.registry}
            </li>
            <li>
              <strong>Actividad:</strong> {COMPANY.activity}
            </li>
          </ul>
        </Subsection>

        <Subsection title="1.2. Canales de contacto en materia de protección de datos">
          <ul className="list-disc pl-5 space-y-1">
            <li>
              <strong>Privacidad y ejercicio de derechos:</strong>{' '}
              <Email addr={COMPANY.emailPrivacy} />
            </li>
            <li>
              <strong>Atención al cliente:</strong> <Email addr={COMPANY.emailGeneral} />
            </li>
            <li>
              <strong>Reclamaciones:</strong> <Email addr={COMPANY.emailComplaints} />
            </li>
          </ul>
        </Subsection>

        <Subsection title="1.3. Delegado de Protección de Datos (DPO)">
          <p>
            Tras analizar la naturaleza, alcance, contexto y finalidades de los
            tratamientos realizados actualmente, HIPERA considera que no está
            obligada a designar Delegado de Protección de Datos en aplicación del{' '}
            <Lit>Art. 37 RGPD</Lit> ni del <Lit>Art. 34 LOPDGDD</Lit>, dado que:
            (i) no es autoridad ni organismo público; (ii) sus actividades
            principales no consisten en operaciones de tratamiento que requieran
            una observación habitual y sistemática a gran escala; y (iii) no trata
            a gran escala categorías especiales de datos del <Lit>Art. 9 RGPD</Lit>.
          </p>
          <p>
            Esta valoración se revisa periódicamente. En caso de modificación
            sustancial de la actividad o de los tratamientos realizados, HIPERA
            reevaluará la necesidad de designar un DPO. Todas las consultas en
            materia de privacidad se gestionan a través de{' '}
            <Email addr={COMPANY.emailPrivacy} />.
          </p>
        </Subsection>
      </Section>

      {/* ===================================================== */}
      <Section number="2" title="Finalidades del Tratamiento">
        <p>
          HIPERA trata los datos personales del Usuario para las siguientes
          finalidades, todas ellas necesarias para la prestación del servicio o
          amparadas en una base jurídica del <Lit>Art. 6 RGPD</Lit>:
        </p>

        <ul className="list-decimal pl-5 space-y-2">
          <li>
            <strong>Gestión de pedidos y entregas:</strong> tramitación de la
            compra, preparación, facturación, envío o recogida en tienda (Click &
            Collect) y servicio postventa.
          </li>
          <li>
            <strong>Servicios de reparación de dispositivos:</strong> gestión de
            citas, registro del dispositivo y avería, comunicación del diagnóstico
            y del presupuesto, custodia del equipo durante la reparación y entrega
            final con garantía.
          </li>
          <li>
            <strong>Cuenta de usuario:</strong> alta, autenticación, recuperación
            de contraseña, gestión del perfil y del historial de pedidos.
          </li>
          <li>
            <strong>Atención al cliente y reclamaciones:</strong> respuesta a
            consultas, gestión de incidencias y reclamaciones formales, incluido el
            modelo oficial de desistimiento y la hoja de reclamaciones.
          </li>
          <li>
            <strong>Cumplimiento de obligaciones legales y fiscales:</strong>{' '}
            emisión de facturas, conservación contable, declaración de IVA,
            justificantes de garantía y atención de requerimientos de autoridades
            competentes.
          </li>
          <li>
            <strong>Seguridad y prevención del fraude:</strong> detección de
            actividad sospechosa, protección de la cuenta del Usuario y de los
            sistemas de HIPERA.
          </li>
          <li>
            <strong>Comunicaciones comerciales</strong> (sólo con consentimiento
            previo): envío de promociones, novedades y boletines por correo
            electrónico.
          </li>
          <li>
            <strong>Mejora del servicio mediante analítica</strong> (sólo con
            consentimiento previo): análisis estadístico agregado del uso del sitio
            para mejorar la experiencia. <em>Actualmente no se realiza ningún
            tratamiento analítico</em>; la categoría está reservada por si se
            activa en el futuro mediante el banner de cookies.
          </li>
        </ul>

        <p className="text-xs text-gray-500">
          HIPERA <strong>no realiza decisiones automatizadas con efectos jurídicos
          significativos</strong> sobre los Usuarios, ni elaboración de perfiles
          en el sentido del <Lit>Art. 22 RGPD</Lit>.
        </p>
      </Section>

      {/* ===================================================== */}
      <Section number="3" title="Base Jurídica del Tratamiento">
        <p>
          Cada finalidad del §2 se ampara en una base de licitud específica del{' '}
          <Lit>Art. 6 RGPD</Lit>, conforme a la siguiente correspondencia:
        </p>

        <div className="grid grid-cols-1 gap-2 mt-2">
          <MatrixRow
            left="Gestión de pedidos y entregas"
            right="Ejecución de contrato"
            hint="Art. 6.1.b RGPD"
          />
          <MatrixRow
            left="Servicios de reparación"
            right="Ejecución de contrato"
            hint="Art. 6.1.b RGPD"
          />
          <MatrixRow
            left="Cuenta de usuario"
            right="Ejecución de contrato + Consentimiento (alta)"
            hint="Art. 6.1.b y 6.1.a RGPD"
          />
          <MatrixRow
            left="Atención al cliente y reclamaciones"
            right="Ejecución de contrato + Interés legítimo"
            hint="Art. 6.1.b y 6.1.f RGPD"
          />
          <MatrixRow
            left="Facturación, contabilidad y obligaciones fiscales"
            right="Obligación legal"
            hint="Art. 6.1.c RGPD; Código de Comercio Art. 30; Ley 58/2003 General Tributaria"
          />
          <MatrixRow
            left="Seguridad y prevención del fraude"
            right="Interés legítimo"
            hint="Art. 6.1.f RGPD (Cons. 47-49)"
          />
          <MatrixRow
            left="Comunicaciones comerciales por email"
            right="Consentimiento"
            hint="Art. 6.1.a RGPD + Art. 21 LSSI-CE"
          />
          <MatrixRow
            left="Analítica del sitio web (futuro)"
            right="Consentimiento"
            hint="Art. 6.1.a RGPD + Art. 22 LSSI-CE"
          />
        </div>

        <p className="text-xs text-gray-500">
          El Usuario puede retirar en cualquier momento los consentimientos
          prestados, sin que ello afecte a la licitud de los tratamientos
          realizados antes de la retirada (<Lit>Art. 7.3 RGPD</Lit>). Véase §8 y §9.
        </p>
      </Section>

      {/* ===================================================== */}
      <Section number="4" title="Categorías de Datos Personales Tratados">
        <Subsection title="4.1. Datos que recopila HIPERA">
          <ul className="list-disc pl-5 space-y-1">
            <li>
              <strong>Datos identificativos y de contacto:</strong> nombre,
              apellidos, dirección postal, código postal, localidad, provincia,
              país, teléfono, correo electrónico.
            </li>
            <li>
              <strong>Datos fiscales</strong> (sólo cuando se solicita factura
              nominal): NIF/NIE/CIF, razón social.
            </li>
            <li>
              <strong>Datos de cuenta:</strong> identificador de usuario, contraseña
              almacenada en forma cifrada (hash bcrypt o equivalente gestionado por
              Supabase Auth — HIPERA nunca tiene acceso a la contraseña en claro).
            </li>
            <li>
              <strong>Datos transaccionales:</strong> historial de pedidos, productos
              comprados, importes, fecha y hora, dirección de envío, método de
              entrega, método de pago (sin almacenar el número completo de tarjeta,
              que es procesado únicamente por el pasarela de pagos).
            </li>
            <li>
              <strong>Datos del servicio de reparación:</strong> modelo y marca del
              dispositivo, descripción de la avería, número de serie o IMEI cuando
              proceda, fecha y hora de la cita, fotografía del estado inicial del
              equipo si se considera oportuno.
            </li>
            <li>
              <strong>Datos de comunicaciones:</strong> mensajes intercambiados con
              atención al cliente, contenido de reclamaciones, hojas oficiales de
              reclamación.
            </li>
            <li>
              <strong>Datos técnicos y de navegación:</strong> dirección IP, tipo
              de navegador, sistema operativo, idioma, fechas y horas de acceso,
              páginas visitadas. Véase la <Lit>Política de Cookies</Lit> para más
              detalle.
            </li>
            <li>
              <strong>Registros de consentimientos y aceptaciones legales:</strong>{' '}
              fecha, hora, versión del documento y categorías aceptadas, tanto en
              relación con los Términos y Condiciones (tabla{' '}
              <code>user_terms_acceptances</code>) como con las preferencias de
              cookies (tabla <code>user_consents</code>).
            </li>
          </ul>
        </Subsection>

        <Subsection title="4.2. Origen de los datos">
          <p>
            Todos los datos personales tratados son <strong>facilitados directamente
            por el Usuario</strong> a través de los formularios del sitio web,
            durante la realización de un pedido, la solicitud de una reparación o
            la comunicación con atención al cliente. HIPERA no obtiene datos de
            fuentes accesibles al público ni de terceros.
          </p>
        </Subsection>

        <Subsection title="4.3. Datos NO tratados">
          <p>HIPERA no recoge ni trata:</p>
          <ul className="list-disc pl-5 space-y-1">
            <li>
              Categorías especiales de datos del <Lit>Art. 9 RGPD</Lit> (origen
              racial o étnico, opiniones políticas, convicciones religiosas o
              filosóficas, afiliación sindical, datos genéticos o biométricos,
              datos de salud, vida u orientación sexual). Excepción puntual: en el
              servicio de reparación pueden aparecer incidentalmente datos relativos
              al uso del dispositivo (p. ej. aplicaciones instaladas); HIPERA
              instruye al Cliente para que retire toda información sensible antes
              de entregar el equipo y se compromete a no consultarla deliberadamente
              salvo en lo estrictamente necesario para la reparación.
            </li>
            <li>
              Datos de menores de 14 años sin consentimiento de sus progenitores o
              tutores legales (<Lit>Art. 7 LOPDGDD</Lit>). HIPERA no dirige sus
              servicios a menores de 14 años.
            </li>
            <li>Datos biométricos para identificación.</li>
            <li>
              Datos completos de tarjeta bancaria: HIPERA <strong>nunca</strong>{' '}
              almacena el PAN ni el CVV; éstos son tratados directamente por la
              pasarela de pagos certificada PCI-DSS (véase §6).
            </li>
          </ul>
        </Subsection>
      </Section>

      {/* ===================================================== */}
      <Section number="5" title="Plazos de Conservación">
        <p>
          Los datos se conservan durante el tiempo estrictamente necesario para
          cumplir la finalidad por la que se recogieron, y posteriormente durante
          los plazos legalmente exigidos para hacer frente a posibles
          responsabilidades:
        </p>

        <div className="grid grid-cols-1 gap-2 mt-2">
          <MatrixRow
            left="Pedidos, facturas y datos contables"
            right="6 años desde el cierre del ejercicio"
            hint="Art. 30 Código de Comercio; Ley 58/2003 General Tributaria (4 años) extendido a 6 por prelación mercantil"
          />
          <MatrixRow
            left="Cuenta de usuario"
            right="Mientras esté activa + 1 año tras la última actividad o solicitud de baja"
            hint="Conservación contractual; tras este plazo, anonimización o supresión salvo obligación legal"
          />
          <MatrixRow
            left="Garantía de reparación"
            right="3 años desde la entrega del dispositivo reparado"
            hint="Art. 120 RDLeg 1/2007 (LGDCU): plazo de garantía legal"
          />
          <MatrixRow
            left="Reclamaciones y disputas"
            right="4 años desde su resolución firme"
            hint="Art. 1964 Código Civil (acciones personales)"
          />
          <MatrixRow
            left="Datos de navegación / técnicos"
            right="24 meses máximo"
            hint="Plazo conforme a la Guía AEPD sobre el uso de cookies"
          />
          <MatrixRow
            left="Registros de consentimientos legales y de cookies"
            right="Durante toda la vida de la cuenta (audit trail). Eliminados por cascada al borrarla."
            hint="Art. 7.1 RGPD: el responsable debe poder demostrar el consentimiento"
          />
          <MatrixRow
            left="Datos para comunicaciones comerciales (marketing)"
            right="Hasta la retirada del consentimiento o solicitud de baja"
            hint="Art. 21 LSSI-CE; Art. 6.1.a y 7 RGPD"
          />
        </div>

        <p>
          Transcurridos los plazos indicados, los datos serán eliminados o
          anonimizados de forma irreversible mediante procedimientos seguros, salvo
          que una obligación legal exija un periodo de conservación adicional. En
          tal caso se conservarán bloqueados, accesibles únicamente para atender
          requerimientos de Juzgados, Tribunales o Administración Pública (<Lit>
            Art. 32 LOPDGDD
          </Lit>).
        </p>
      </Section>

      {/* ===================================================== */}
      <Section number="6" title="Destinatarios y Encargados del Tratamiento">
        <Subsection title="6.1. Encargados del tratamiento">
          <p>
            HIPERA presta sus servicios apoyándose en un conjunto de proveedores
            tecnológicos que actúan como <Lit>Encargados del Tratamiento</Lit>{' '}
            (<Lit>Art. 28 RGPD</Lit>) y con los que se ha firmado el correspondiente
            Contrato de Encargo de Tratamiento (DPA, <em>Data Processing
            Agreement</em>):
          </p>

          <div className="grid grid-cols-1 gap-2 mt-2">
            <MatrixRow
              left="Railway Corp."
              right="Alojamiento del backend (API Express) y de la base de datos PostgreSQL principal."
              hint="Procesamiento en UE — región europe-west4 (Países Bajos, Ámsterdam). DPA con SCC como salvaguarda adicional."
            />
            <MatrixRow
              left="Vercel Inc."
              right="Alojamiento del frontend (sitio web público) y entrega CDN."
              hint="Procesamiento en UE — región cdg1 (París, Francia). DPA con SCC como salvaguarda adicional."
            />
            <MatrixRow
              left="Supabase Inc."
              right="Servicio de autenticación de usuarios, almacenamiento de imágenes y base de datos complementaria."
              hint="Procesamiento en UE — región eu-west-1 (Irlanda). DPA con SCC como salvaguarda adicional."
            />
            <MatrixRow
              left="Stripe Payments Europe, Ltd. (cuando esté disponible)"
              right="Procesamiento de pagos con tarjeta y otros medios electrónicos."
              hint="Entidad UE con sede en Dublín (Irlanda). Certificación PCI-DSS nivel 1. Sin transferencia internacional para clientes europeos."
            />
            <MatrixRow
              left="Resend Inc."
              right="Envío de correos electrónicos transaccionales (confirmaciones de pedido, recuperación de contraseña, notificaciones de reparación)."
              hint="Procesamiento en EE.UU. Transferencia amparada por SCC (véase §7). Únicamente datos imprescindibles (email destinatario y contenido del mensaje)."
            />
          </div>
        </Subsection>

        <Subsection title="6.2. Otros destinatarios">
          <p>
            Adicionalmente, los datos personales pueden ser comunicados a:
          </p>
          <ul className="list-disc pl-5 space-y-1">
            <li>
              <strong>Empresas de transporte y mensajería</strong> (Correos, MRW,
              SEUR o equivalentes) en lo estrictamente necesario para entregar el
              pedido. Estas entidades actúan como responsables del tratamiento
              autónomos respecto de la prestación del servicio de mensajería.
            </li>
            <li>
              <strong>Administraciones Públicas competentes</strong> en cumplimiento
              de obligaciones legales: Agencia Tributaria, Seguridad Social,
              Juzgados, Cuerpos y Fuerzas de Seguridad del Estado, AEPD, OMIC u
              otras, cuando exista requerimiento legal o normativo.
            </li>
            <li>
              <strong>Asesoría fiscal y contable</strong> de HIPERA, bajo deber de
              secreto profesional.
            </li>
            <li>
              <strong>Servicios oficiales técnicos</strong> de los fabricantes,
              únicamente cuando una reparación deba escalarse al fabricante en
              garantía, y limitado a los datos imprescindibles (modelo, número de
              serie y descripción de la avería).
            </li>
            <li>
              <strong>Meta Platforms Ireland Limited (WhatsApp):</strong> cuando el
              Usuario decide voluntariamente contactar con HIPERA a través de los
              enlaces directos a WhatsApp disponibles en el sitio web, su número
              de teléfono y el contenido del mensaje son tratados por Meta conforme
              a su propia política de privacidad. HIPERA no comparte datos del
              Usuario con Meta proactivamente; la comunicación se inicia
              exclusivamente por decisión del Usuario.
            </li>
          </ul>
          <p className="text-xs text-gray-500">
            HIPERA <strong>no vende ni cede</strong> datos personales a terceros con
            fines publicitarios o comerciales.
          </p>
        </Subsection>
      </Section>

      {/* ===================================================== */}
      <Section number="7" title="Transferencias Internacionales de Datos">
        <p>
          Por defecto, todos los datos personales tratados por HIPERA se procesan
          dentro del <strong>Espacio Económico Europeo (EEE)</strong>. No obstante,
          algunos encargados pueden requerir, en su funcionamiento ordinario o como
          medida técnica de respaldo, el tratamiento de datos en países fuera del
          EEE. En tal caso, HIPERA garantiza que toda transferencia internacional
          se realiza únicamente con las salvaguardas previstas en los{' '}
          <Lit>Arts. 44 a 49 RGPD</Lit>:
        </p>

        <Subsection title="7.1. Transferencias a EE.UU.: Resend Inc.">
          <p>
            El envío de correos electrónicos transaccionales (confirmación de
            pedidos y comunicaciones operativas necesarias para la ejecución
            del contrato) se realiza a través de <strong>Resend Inc.</strong>,
            entidad con domicilio en los Estados Unidos. Esta transferencia se
            ampara en las siguientes garantías acumulativas:
          </p>
          <ul className="list-disc pl-5 space-y-1">
            <li>
              <strong>Cláusulas Contractuales Tipo (SCC)</strong> aprobadas por la
              Comisión Europea mediante <Lit>Decisión de Ejecución (UE) 2021/914,
              de 4 de junio de 2021</Lit>, en su Módulo 2 (responsable-encargado),
              firmadas con el proveedor.
            </li>
            <li>
              <strong>EU-U.S. Data Privacy Framework (DPF)</strong>: cuando el
              proveedor esté efectivamente certificado bajo el marco aprobado por la{' '}
              <Lit>Decisión de Adecuación de 10 de julio de 2023</Lit>, dicha
              certificación operará como salvaguarda adicional. La adscripción
              vigente puede consultarse en{' '}
              <a
                href="https://www.dataprivacyframework.gov"
                target="_blank"
                rel="noopener noreferrer"
                className="text-red-600 underline hover:text-red-700"
              >
                dataprivacyframework.gov
              </a>
              .
            </li>
            <li>
              <strong>Medidas técnicas y organizativas</strong> adicionales:
              cifrado en tránsito (TLS 1.2+), minimización del contenido (sólo email
              de destinatario y cuerpo del mensaje transaccional, sin datos
              fiscales ni bancarios) y limitación del acceso a personal autorizado.
            </li>
          </ul>
        </Subsection>

        <Subsection title="7.2. Otros proveedores con matriz en EE.UU.">
          <p>
            Railway, Vercel y Supabase prestan sus servicios desde regiones del
            EEE seleccionadas expresamente por HIPERA (Países Bajos, Francia,
            Irlanda) y la operación habitual no implica transferencia internacional.
            No obstante, en la medida en que sus sociedades matrices se encuentren
            constituidas fuera del EEE y pudieran existir accesos puntuales de
            soporte técnico desde dichos territorios, los DPA firmados incluyen las
            SCC de la <Lit>Decisión (UE) 2021/914</Lit> y, cuando proceda, la
            adhesión al EU-U.S. Data Privacy Framework como salvaguarda adicional.
          </p>
        </Subsection>

        <Subsection title="7.3. Solicitud de información adicional">
          <p>
            El Usuario puede solicitar copia de las salvaguardas aplicadas
            (<Lit>Art. 46 RGPD</Lit>) escribiendo a{' '}
            <Email addr={COMPANY.emailPrivacy} />.
          </p>
        </Subsection>
      </Section>

      {/* ===================================================== */}
      <Section number="8" title="Derechos del Usuario">
        <p>
          El Reglamento General de Protección de Datos reconoce al Usuario los
          siguientes derechos, que puede ejercer gratuitamente frente a HIPERA en
          cualquier momento:
        </p>

        <ul className="list-decimal pl-5 space-y-2">
          <li>
            <strong>Derecho de acceso</strong> (<Lit>Art. 15 RGPD</Lit>): conocer
            qué datos personales se están tratando, las finalidades, las
            categorías de destinatarios y los plazos previstos de conservación,
            así como obtener una copia de los mismos.
          </li>
          <li>
            <strong>Derecho de rectificación</strong> (<Lit>Art. 16 RGPD</Lit>):
            solicitar la corrección de datos inexactos o el complemento de datos
            incompletos.
          </li>
          <li>
            <strong>Derecho de supresión («derecho al olvido»)</strong>{' '}
            (<Lit>Art. 17 RGPD</Lit>): solicitar la eliminación de los datos
            cuando ya no resulten necesarios para la finalidad para la que se
            recogieron, se retire el consentimiento, se haya formulado oposición
            o el tratamiento sea ilícito. Este derecho está limitado por las
            obligaciones legales de conservación (véase §5).
          </li>
          <li>
            <strong>Derecho a la limitación del tratamiento</strong>{' '}
            (<Lit>Art. 18 RGPD</Lit>): solicitar la suspensión temporal del
            tratamiento en supuestos concretos (impugnación de la exactitud,
            oposición pendiente de verificación, tratamiento ilícito o
            conservación para reclamaciones).
          </li>
          <li>
            <strong>Derecho a la portabilidad</strong>{' '}
            (<Lit>Art. 20 RGPD</Lit>): recibir los datos personales facilitados
            por el Usuario, en un formato estructurado, de uso común y lectura
            mecánica, y transmitirlos a otro responsable cuando sea técnicamente
            posible.
          </li>
          <li>
            <strong>Derecho de oposición</strong> (<Lit>Art. 21 RGPD</Lit>):
            oponerse al tratamiento basado en interés legítimo y, en cualquier
            momento y sin necesidad de motivación, oponerse al tratamiento con
            fines de mercadotecnia directa.
          </li>
          <li>
            <strong>Derecho a no ser objeto de decisiones automatizadas</strong>{' '}
            (<Lit>Art. 22 RGPD</Lit>): HIPERA confirma que <strong>no realiza
            decisiones automatizadas con efectos jurídicos significativos</strong>{' '}
            ni elaboración de perfiles en el sentido del Art. 22, por lo que este
            derecho se garantiza por defecto.
          </li>
          <li>
            <strong>Derecho a retirar el consentimiento</strong>{' '}
            (<Lit>Art. 7.3 RGPD</Lit>): retirar en cualquier momento los
            consentimientos prestados (comunicaciones comerciales, cookies no
            esenciales, etc.), sin que ello afecte a la licitud del tratamiento
            previo a su retirada.
          </li>
        </ul>

        <p>
          Cuando el ejercicio de uno de estos derechos pudiera afectar a derechos
          de terceros o concurra con una obligación legal de HIPERA, ésta lo
          comunicará motivadamente al Usuario en el plazo previsto en §9.
        </p>
      </Section>

      {/* ===================================================== */}
      <Section number="9" title="Cómo Ejercer los Derechos">
        <Subsection title="9.1. Canales de ejercicio">
          <ul className="list-disc pl-5 space-y-1">
            <li>
              <strong>Por correo electrónico:</strong>{' '}
              <Email addr={COMPANY.emailPrivacy} /> (canal preferente).
            </li>
            <li>
              <strong>Por correo postal:</strong> {COMPANY.name}, {COMPANY.address},
              indicando «Ejercicio de derechos RGPD» en el sobre.
            </li>
          </ul>
          <p className="text-xs text-gray-500 mt-2">
            <em>Nota:</em> para garantizar la correcta tramitación de las
            solicitudes RGPD y la verificación de identidad, se ruega utilizar
            los canales por escrito indicados. El personal del establecimiento
            puede orientar al cliente sobre cómo presentar la solicitud pero no
            tramita directamente las peticiones RGPD.
          </p>
        </Subsection>

        <Subsection title="9.2. Información a aportar">
          <p>Para tramitar la solicitud, el Usuario debe facilitar:</p>
          <ul className="list-disc pl-5 space-y-1">
            <li>
              Nombre y apellidos y copia del documento identificativo
              (DNI/NIE/Pasaporte) o sistema equivalente que permita comprobar la
              identidad.
            </li>
            <li>
              Derecho o derechos que desea ejercer y descripción concreta de la
              petición.
            </li>
            <li>
              Domicilio o medio de contacto a efectos de notificaciones.
            </li>
            <li>
              Documentación acreditativa adicional cuando proceda (p. ej.
              representación legal).
            </li>
          </ul>
        </Subsection>

        <Subsection title="9.3. Plazo de respuesta">
          <p>
            HIPERA responderá en el plazo máximo de <strong>un (1) mes</strong>{' '}
            desde la recepción de la solicitud (<Lit>Art. 12.3 RGPD</Lit>). Este
            plazo podrá prorrogarse <strong>dos (2) meses adicionales</strong>{' '}
            cuando sea necesario, atendida la complejidad y al número de
            solicitudes; en tal caso, se informará al Usuario de la prórroga
            dentro del primer mes.
          </p>
        </Subsection>

        <Subsection title="9.4. Coste">
          <p>
            El ejercicio de los derechos es <strong>gratuito</strong>. Únicamente
            cuando las solicitudes sean manifiestamente infundadas o excesivas,
            especialmente por su carácter repetitivo, HIPERA podrá: (i) cobrar un
            canon razonable basado en los costes administrativos; o (ii)
            negarse a actuar respecto de la solicitud (<Lit>Art. 12.5 RGPD</Lit>).
          </p>
        </Subsection>

        <Subsection title="9.5. Cancelación de la cuenta">
          <p>
            El Usuario puede solicitar la baja de su cuenta y la eliminación
            (supresión) de sus datos personales en cualquier momento. Determinados
            datos se conservarán bloqueados conforme a los plazos legales
            indicados en §5 (p. ej. facturación durante 6 años).
          </p>
        </Subsection>
      </Section>

      {/* ===================================================== */}
      <Section number="10" title="Reclamaciones ante la Autoridad de Control (AEPD)">
        <p>
          Si el Usuario considera que el tratamiento de sus datos personales por
          parte de HIPERA infringe la normativa vigente, o que no ha obtenido
          satisfacción tras el ejercicio de sus derechos, tiene derecho a
          presentar una <strong>reclamación ante la Agencia Española de
          Protección de Datos (AEPD)</strong> (<Lit>Art. 77 RGPD</Lit>):
        </p>

        <Subsection title="10.1. Datos de contacto de la AEPD">
          <ul className="list-disc pl-5 space-y-1">
            <li>
              <strong>Sede física:</strong> C/ Jorge Juan, 6, 28001 Madrid
              (España).
            </li>
            <li>
              <strong>Teléfono:</strong> 901 100 099 / +34 912 663 517.
            </li>
            <li>
              <strong>Sitio web:</strong>{' '}
              <a
                href="https://www.aepd.es"
                target="_blank"
                rel="noopener noreferrer"
                className="text-red-600 underline hover:text-red-700"
              >
                www.aepd.es
              </a>
            </li>
            <li>
              <strong>Sede electrónica:</strong>{' '}
              <a
                href="https://sedeagpd.gob.es"
                target="_blank"
                rel="noopener noreferrer"
                className="text-red-600 underline hover:text-red-700"
              >
                sedeagpd.gob.es
              </a>{' '}
              — presentación de reclamaciones online con certificado digital o
              Cl@ve.
            </li>
          </ul>
        </Subsection>

        <Subsection title="10.2. Reclamación previa recomendada">
          <p>
            Sin perjuicio del derecho a acudir directamente a la AEPD, se
            recomienda al Usuario dirigirse previamente a HIPERA mediante{' '}
            <Email addr={COMPANY.emailPrivacy} /> para procurar una resolución
            amistosa y rápida.
          </p>
        </Subsection>
      </Section>

      {/* ===================================================== */}
      <Section number="11" title="Modificaciones de la Política de Privacidad">
        <Subsection title="11.1. Causas de actualización">
          <p>
            HIPERA podrá modificar la presente Política de Privacidad por motivos
            legales (cambios normativos), tecnológicos (incorporación o
            sustitución de encargados del tratamiento) o comerciales (nuevas
            funcionalidades del servicio).
          </p>
        </Subsection>

        <Subsection title="11.2. Comunicación de los cambios">
          <p>
            Cuando los cambios sean <strong>materiales</strong> —p. ej.: nueva
            finalidad, nueva categoría de datos, nuevo encargado fuera de la UE,
            modificación de plazos de conservación—, HIPERA comunicará la
            actualización mediante: (i) aviso visible en el sitio web durante un
            mínimo de 30 días naturales; (ii) notificación por correo
            electrónico a los usuarios registrados; y (iii) requerimiento de
            re-aceptación expresa en el siguiente inicio de sesión o checkout
            cuando proceda.
          </p>
          <p>
            Los cambios menores (correcciones tipográficas, aclaraciones o
            actualizaciones de domicilio sin afectar al fondo) se publicarán
            directamente, indicando la nueva fecha de vigencia.
          </p>
        </Subsection>

        <Subsection title="11.3. Versionado">
          <p>
            Cada publicación lleva asociada una versión del documento
            (<Lit>{PRIVACY_DOCUMENT_VERSION}</Lit> en el presente texto) y una
            versión de consentimiento (<Lit>v{PRIVACY_VERSION}</Lit>). El histórico
            de versiones anteriores puede solicitarse en cualquier momento a{' '}
            <Email addr={COMPANY.emailPrivacy} />.
          </p>
        </Subsection>

        <Subsection title="11.4. Coherencia con la Política de Cookies">
          <p>
            La presente Política se complementa con la <Lit>Política de Cookies</Lit>{' '}
            y los <Lit>Términos y Condiciones</Lit>. En caso de discrepancia
            aparente, prevalecerá lo dispuesto en el documento más específico para
            la materia tratada. HIPERA mantiene sincronizados los tres documentos.
          </p>
        </Subsection>
      </Section>

      <DocFooter
        docVersion={PRIVACY_DOCUMENT_VERSION}
        consentVersion={PRIVACY_VERSION}
        updatedAt={PRIVACY_UPDATED_AT}
      />
    </div>
  );
}

// ---------------------------------------------------------------------
// Intro (texto introductorio específico de la Política de Privacidad)
// ---------------------------------------------------------------------

function Intro() {
  return (
    <p className="text-sm text-gray-700 leading-relaxed">
      La presente <strong>Política de Privacidad</strong> describe cómo {COMPANY.name}{' '}
      (en adelante, <strong>«HIPERA»</strong>) trata los datos personales de las
      personas físicas (en adelante, los <strong>«Usuarios»</strong>) que
      interactúan con el sitio web {COMPANY.website}, contratan productos o
      servicios o se ponen en contacto con HIPERA por cualquier vía. Esta Política
      se redacta en cumplimiento del <em>Reglamento (UE) 2016/679 (RGPD)</em>, la{' '}
      <em>Ley Orgánica 3/2018 (LOPDGDD)</em> y la{' '}
      <em>Ley 34/2002 de Servicios de la Sociedad de la Información y de Comercio
      Electrónico (LSSI-CE)</em>.
    </p>
  );
}
