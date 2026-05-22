// =====================================================================
// Aviso Legal — Art. 10 LSSI-CE 34/2002 + RDLeg 1/1996 LPI + Ley 17/2001
// =====================================================================
// Este documento cumple las obligaciones de información general del
// prestador de servicios de la sociedad de la información establecidas
// en el Art. 10 de la Ley 34/2002, de 11 de julio, de servicios de la
// sociedad de la información y de comercio electrónico (LSSI-CE) y
// regula el uso del SITIO WEB en sí mismo (no la relación contractual
// de compraventa, que se rige por los Términos y Condiciones).
//
// Estructura:
//   §1  Información general                     [Art. 10.1 a/b/c/f LSSI-CE]
//   §2  Objeto y ámbito de aplicación           [Delimitación de alcance]
//   §3  Condiciones de uso del sitio web        [LSSI-CE Arts. 12-17]
//   §4  Propiedad intelectual e industrial      [RDLeg 1/1996 LPI + Ley 17/2001]
//   §5  Política de enlaces                     [LSSI-CE Art. 17]
//   §6  Exención de responsabilidad             [LSSI-CE Arts. 16-17 + RDLeg 1/2007]
//   §7  Protección de datos y cookies           [Cross-ref Privacidad + Cookies]
//   §8  Modificaciones, legislación y juris.    [LSSI-CE Art. 26 + Reg. UE 524/2013 + 2024/3228]
//
// Coherencia obligatoria con:
//   - Términos y Condiciones: §15 (legislación y jurisdicción contractual).
//     Aviso §8.3 cita brevemente y remite a T&C §15 para detalle.
//   - Política de Privacidad: §7.1 remisión breve, sin reproducir el
//     contenido del RGPD ni los datos del responsable (ya están allí).
//   - Política de Cookies: §7.2 remisión breve.
//   - Política de Devoluciones / Envíos: NO se mencionan en este Aviso;
//     §2.2 excluye expresamente las cuestiones contractuales.
//   - COMPANY: fuente única de verdad de los datos de identificación.
//     Si COMPANY.registry contiene "[PENDIENTE]" se muestra un aviso
//     visible al Usuario en §1.2 (decisión D1=B aprobada).
//
// ⚠️ PENDIENTE: el campo COMPANY.registry debe completarse con los
// datos exactos del Registro Mercantil de Madrid (Tomo, Folio, Hoja,
// Sección) antes del lanzamiento público del sitio. Mientras tanto,
// §1.2 muestra automáticamente un aviso al Usuario indicando que los
// datos están en trámite de verificación y pueden solicitarse por
// correo electrónico. AEPD/LSSI no sanciona en sí la ausencia de datos
// concretos si se informa al Usuario y se ofrece un canal de obtención;
// sí sancionaría la ausencia total de mención o el dato falso.
//
// Esta página no requiere consentimiento explícito en checkout: es un
// aviso informativo de cumplimiento LSSI-CE que el Usuario acepta
// implícitamente al utilizar el sitio web.
// =====================================================================

import {
  LEGAL_NOTICE_DOCUMENT_VERSION,
  LEGAL_NOTICE_UPDATED_AT,
  LEGAL_NOTICE_VERSION,
} from '../../config/legal';
import { COMPANY } from '../../config/company';
import {
  Section,
  Subsection,
  Lit,
  Email,
  VersionBanner,
  DocFooter,
} from './_components';

export default function AvisoLegal() {
  const registryPending = COMPANY.registry.includes('[PENDIENTE]');

  return (
    <div className="space-y-6 text-gray-700">
      <VersionBanner
        docVersion={LEGAL_NOTICE_DOCUMENT_VERSION}
        consentVersion={LEGAL_NOTICE_VERSION}
        updatedAt={LEGAL_NOTICE_UPDATED_AT}
      />

      <Intro />

      {/* ===================================================== */}
      <Section number="1" title="Información general del prestador de servicios">
        <p>
          En cumplimiento del Art. 10 de la <Lit>Ley 34/2002</Lit>, de 11 de
          julio, de servicios de la sociedad de la información y de comercio
          electrónico (<Lit>LSSI-CE</Lit>), se ponen a disposición de los
          usuarios y de las autoridades competentes los siguientes datos
          identificativos del titular del sitio web.
        </p>

        <Subsection title="1.1. Identificación del titular">
          <ul className="list-disc list-inside space-y-1 ml-2">
            <li>
              <strong>Denominación social:</strong> {COMPANY.name}
            </li>
            <li>
              <strong>NIF:</strong> {COMPANY.nif}
            </li>
            <li>
              <strong>Domicilio social:</strong> {COMPANY.address}
            </li>
          </ul>
        </Subsection>

        <Subsection title="1.2. Inscripción en el Registro Mercantil">
          <p>{COMPANY.registry}</p>
          {registryPending && (
            <div className="text-xs bg-amber-50 border-l-4 border-amber-400 p-3 mt-2 text-amber-900">
              <p>
                <strong>Aviso al Usuario:</strong> los datos completos de
                inscripción registral (Tomo, Folio, Hoja, Sección) se
                encuentran en trámite de verificación y serán publicados en
                este apartado tan pronto se complete dicha verificación.
                Mientras tanto, el Usuario puede solicitar los datos
                actualizados a través de <Email addr={COMPANY.emailGeneral} />,
                o consultarlos directamente en el portal público{' '}
                <a
                  href="https://www.registradores.org"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline"
                >
                  www.registradores.org
                </a>{' '}
                mediante el NIF {COMPANY.nif}.
              </p>
            </div>
          )}
        </Subsection>

        <Subsection title="1.3. Actividad del titular">
          <p>{COMPANY.activity}.</p>
          <p className="text-xs text-gray-500">
            La actividad indicada no está sujeta a un régimen de autorización
            administrativa previa de carácter general en el sentido del Art.
            10.1.d <Lit>LSSI-CE</Lit>. Los servicios concretos de venta de
            productos sujetos a impuestos especiales (bebidas alcohólicas) se
            prestan en establecimiento físico autorizado conforme a la
            normativa autonómica y municipal aplicable.
          </p>
        </Subsection>

        <Subsection title="1.4. Canales de contacto">
          <ul className="list-disc list-inside space-y-1 ml-2">
            <li>
              <strong>Correo electrónico (general):</strong>{' '}
              <Email addr={COMPANY.emailGeneral} />
            </li>
            <li>
              <strong>Correo electrónico (privacidad / RGPD):</strong>{' '}
              <Email addr={COMPANY.emailPrivacy} />
            </li>
            <li>
              <strong>Correo electrónico (reclamaciones):</strong>{' '}
              <Email addr={COMPANY.emailComplaints} />
            </li>
            <li>
              <strong>Teléfono:</strong> {COMPANY.phone}
            </li>
            <li>
              <strong>Horario de atención:</strong> {COMPANY.hours}
            </li>
            <li>
              <strong>Sitio web:</strong>{' '}
              <a
                href={COMPANY.website}
                target="_blank"
                rel="noopener noreferrer"
                className="text-red-600 underline hover:text-red-700"
              >
                {COMPANY.website}
              </a>
            </li>
          </ul>
        </Subsection>
      </Section>

      {/* ===================================================== */}
      <Section number="2" title="Objeto y ámbito de aplicación">
        <Subsection title="2.1. Objeto del Aviso Legal">
          <p>
            El presente <strong>Aviso Legal</strong> regula las condiciones
            generales de acceso y utilización del sitio web{' '}
            <strong>{COMPANY.website}</strong> (en adelante, el{' '}
            <strong>«Sitio Web»</strong>), titularidad de {COMPANY.name} (en
            adelante, <strong>«HIPERA»</strong>), por parte de cualquier
            persona física o jurídica que acceda al mismo (en adelante, el{' '}
            <strong>«Usuario»</strong>), en cumplimiento del deber de
            información establecido en el Art. 10 <Lit>LSSI-CE</Lit>.
          </p>
        </Subsection>

        <Subsection title="2.2. Ámbito — qué regula y qué no regula este Aviso">
          <p>
            Este Aviso Legal regula <strong>exclusivamente</strong> el uso del
            Sitio Web como recurso digital (acceso, navegación, condiciones de
            uso, propiedad intelectual, política de enlaces y exención de
            responsabilidad). <strong>No regula</strong> la relación
            contractual de compraventa o prestación de servicios entre HIPERA
            y el Cliente, que se rige por los siguientes documentos:
          </p>
          <ul className="list-disc list-inside space-y-1 ml-2">
            <li>
              <strong>Términos y Condiciones:</strong> base contractual de la
              compraventa, pago, entrega, garantías y servicios de reparación
              (<a href="/?legal=terminos" className="text-red-600 underline hover:text-red-700">
                /?legal=terminos
              </a>).
            </li>
            <li>
              <strong>Política de Privacidad:</strong> tratamiento de datos
              personales conforme al <Lit>RGPD</Lit> (UE) 2016/679 y a la{' '}
              <Lit>LOPDGDD 3/2018</Lit> (<a href="/?legal=privacidad" className="text-red-600 underline hover:text-red-700">
                /?legal=privacidad
              </a>).
            </li>
            <li>
              <strong>Política de Cookies:</strong> tecnologías de seguimiento
              y consentimiento conforme al Art. 22.2 <Lit>LSSI-CE</Lit> (
              <a href="/?legal=cookies" className="text-red-600 underline hover:text-red-700">
                /?legal=cookies
              </a>).
            </li>
            <li>
              <strong>Política de Devoluciones:</strong> manual operativo de
              desistimiento y garantías (<a href="/?legal=devoluciones" className="text-red-600 underline hover:text-red-700">
                /?legal=devoluciones
              </a>).
            </li>
            <li>
              <strong>Política de Envíos:</strong> zonas de cobertura, plazos,
              tarifas y umbrales gratuitos (<a href="/?legal=envios" className="text-red-600 underline hover:text-red-700">
                /?legal=envios
              </a>).
            </li>
          </ul>
        </Subsection>

        <Subsection title="2.3. Aceptación del Usuario">
          <p>
            El acceso, la navegación y la utilización del Sitio Web atribuyen
            al visitante la condición de <strong>«Usuario»</strong> e implican
            la aceptación plena y sin reservas de todas y cada una de las
            disposiciones contenidas en este Aviso Legal en la versión
            publicada por HIPERA en cada momento. En consecuencia, el Usuario
            debe leer atentamente el presente Aviso Legal en cada una de las
            ocasiones en que se proponga utilizar el Sitio Web, ya que puede
            sufrir modificaciones (véase §8).
          </p>
          <p className="text-xs text-gray-500">
            La aceptación del presente Aviso Legal no constituye consentimiento
            para el tratamiento de datos personales (regulado por separado en
            la Política de Privacidad y por el banner de consentimiento de
            cookies), ni vincula al Usuario a las condiciones contractuales
            de compraventa (que requieren aceptación expresa de los Términos y
            Condiciones en el proceso de pedido).
          </p>
        </Subsection>
      </Section>

      {/* ===================================================== */}
      <Section number="3" title="Condiciones de uso del Sitio Web">
        <Subsection title="3.1. Uso conforme a la ley y a la buena fe">
          <p>
            El Usuario se compromete a hacer un uso del Sitio Web conforme a
            la legislación vigente, a la buena fe, a los usos generalmente
            aceptados y al presente Aviso Legal, absteniéndose de cualquier
            conducta que pueda dañar la imagen, los intereses o los derechos
            de HIPERA, de terceros o, en general, el normal funcionamiento del
            Sitio Web.
          </p>
        </Subsection>

        <Subsection title="3.2. Conductas prohibidas">
          <p>
            Con carácter enunciativo y no limitativo, el Usuario{' '}
            <strong>no podrá</strong>:
          </p>
          <ul className="list-disc list-inside space-y-1 ml-2">
            <li>
              Utilizar el Sitio Web con fines o efectos ilícitos, lesivos de
              derechos e intereses de terceros, o que de cualquier forma puedan
              dañar, inutilizar, sobrecargar, deteriorar o impedir la normal
              utilización del Sitio Web.
            </li>
            <li>
              Acceder o intentar acceder a recursos o áreas restringidas del
              Sitio Web sin cumplir las condiciones exigidas para dicho acceso
              (p. ej.: paneles de administración, cuentas de otros usuarios).
            </li>
            <li>
              Introducir o difundir en el Sitio Web programas, datos, virus,
              código o cualquier otro dispositivo electrónico o físico que sea
              susceptible de causar daños en los sistemas de HIPERA, de sus
              proveedores o de terceros usuarios.
            </li>
            <li>
              Realizar actividades de extracción, reproducción o reutilización
              sistemática y/o sustancial del contenido del Sitio Web (incluidas
              técnicas de <em>web scraping</em>, <em>data mining</em>,{' '}
              <em>crawling</em> o automatizaciones similares) sin la
              autorización expresa y por escrito de HIPERA.
            </li>
            <li>
              Realizar técnicas de ingeniería inversa,{' '}
              <em>reverse engineering</em>, descompilación, desensamblado o
              cualquier otra acción dirigida a obtener el código fuente del
              Sitio Web, salvo en los supuestos permitidos por la legislación
              imperativa aplicable.
            </li>
            <li>
              Suplantar la identidad de otro Usuario, de HIPERA, de su personal
              o de cualquier tercero, o utilizar identidades, direcciones de
              correo o datos de pago de los que no se sea legítimo titular.
            </li>
            <li>
              Difundir contenidos o propaganda de carácter racista, xenófobo,
              pornográfico, de apología del terrorismo, contrarios a los
              derechos humanos, a la dignidad de las personas o a los menores.
            </li>
            <li>
              Utilizar el Sitio Web para enviar comunicaciones comerciales no
              solicitadas (<em>spam</em>), cadenas de mensajes, esquemas
              piramidales o cualquier forma de fraude o ingeniería social.
            </li>
            <li>
              Utilizar los formularios, funcionalidades de pedido o servicios
              de reparación del Sitio Web con finalidad distinta de la
              estrictamente contractual (p. ej.: pedidos ficticios, pruebas
              de tarjetas robadas, abuso del derecho de desistimiento con fines
              especulativos).
            </li>
          </ul>
        </Subsection>

        <Subsection title="3.3. Edad mínima y capacidad">
          <p>
            La consulta del Sitio Web está abierta a cualquier persona. La
            contratación de productos o servicios a través del Sitio Web exige
            ser mayor de edad o, en su defecto, contar con la autorización de
            quien ejerza la patria potestad o tutela, conforme a lo previsto
            en el apartado §2.1 de los Términos y Condiciones. La adquisición
            de productos sujetos a restricciones por edad (p. ej.: bebidas
            alcohólicas) requiere acreditar la mayoría de edad en el momento
            de la entrega.
          </p>
        </Subsection>

        <Subsection title="3.4. Consecuencias del incumplimiento">
          <p>
            En caso de incumplimiento por parte del Usuario de las condiciones
            establecidas en este Aviso Legal, HIPERA{' '}
            <strong>podrá</strong>, sin necesidad de preaviso y sin que ello
            genere derecho a indemnización alguna a favor del Usuario:
          </p>
          <ul className="list-disc list-inside space-y-1 ml-2">
            <li>
              Suspender, restringir o cancelar, total o parcialmente, el
              acceso del Usuario al Sitio Web o a determinadas
              funcionalidades del mismo.
            </li>
            <li>
              Retirar, total o parcialmente, los contenidos aportados por el
              Usuario al Sitio Web cuando dichos contenidos sean contrarios a
              la legislación vigente o al presente Aviso Legal.
            </li>
            <li>
              Comunicar los hechos a las autoridades administrativas o
              judiciales competentes y, en su caso, ejercitar las acciones
              civiles, penales o administrativas que procedan en defensa de
              sus derechos o los de terceros.
            </li>
          </ul>
          <p className="text-xs text-gray-500">
            Las medidas indicadas se aplicarán de forma proporcionada a la
            gravedad del incumplimiento y se entienden sin perjuicio de los
            derechos del Usuario consumidor reconocidos por el{' '}
            <Lit>RDLeg 1/2007</Lit>, que en ningún caso pueden ser limitados
            por este Aviso Legal.
          </p>
        </Subsection>
      </Section>

      {/* ===================================================== */}
      <Section number="4" title="Propiedad intelectual e industrial">
        <Subsection title="4.1. Titularidad de los derechos">
          <p>
            Todos los contenidos del Sitio Web, entendiendo por tales —con
            carácter enunciativo y no limitativo— los textos, fotografías,
            gráficos, imágenes, iconos, tecnología, software, código fuente y
            objeto, diseños, estructura de navegación, bases de datos y
            cualesquiera otros elementos del Sitio Web, son propiedad de
            HIPERA o de terceros que han autorizado a HIPERA su uso, y se
            encuentran protegidos por la legislación nacional e internacional
            sobre propiedad intelectual e industrial, en particular el{' '}
            <Lit>Real Decreto Legislativo 1/1996</Lit>, de 12 de abril, por el
            que se aprueba el texto refundido de la Ley de Propiedad
            Intelectual, y la <Lit>Ley 17/2001</Lit>, de 7 de diciembre, de
            Marcas.
          </p>
          <p>
            En particular, y a los efectos de eliminar cualquier duda, las{' '}
            <strong>fotografías y descripciones de los productos</strong>{' '}
            publicadas en el Sitio Web (incluidos los productos del catálogo
            del supermercado y los servicios de reparación) son obras
            elaboradas por o por encargo de HIPERA y se encuentran sometidas
            a los derechos de propiedad intelectual del titular del Sitio
            Web. La reproducción, comunicación pública o explotación comercial
            de dichas fotografías y descripciones por terceros sin la
            autorización expresa de HIPERA constituye una infracción de
            derechos de propiedad intelectual e industrial.
          </p>
        </Subsection>

        <Subsection title="4.2. Marcas y signos distintivos">
          <p>
            La denominación <strong>HIPERA</strong>, el logotipo asociado, así
            como los signos distintivos y diseños identificativos que aparecen
            en el Sitio Web son propiedad de HIPERA o de terceros titulares
            que han autorizado su uso. Quedan reservados todos los derechos.
            El uso del nombre HIPERA, su logotipo o cualquier signo
            distintivo asociado sin autorización expresa y por escrito
            constituye una infracción de los derechos reconocidos en la{' '}
            <Lit>Ley 17/2001</Lit> de Marcas y podrá ser perseguido conforme
            a la legislación aplicable.
          </p>
          <p className="text-xs text-gray-500">
            Las marcas de terceros que puedan aparecer en el Sitio Web (por
            ejemplo, marcas de productos comercializados por HIPERA o marcas
            de fabricantes de dispositivos sobre los que HIPERA presta
            servicios de reparación) son propiedad de sus respectivos
            titulares y se utilizan en el Sitio Web con fines exclusivamente
            identificativos del producto o servicio, sin ánimo de apropiación
            ni sugerencia de patrocinio inexistente.
          </p>
        </Subsection>

        <Subsection title="4.3. Excepciones de uso por el Usuario">
          <p>
            Quedan expresamente <strong>reservados</strong> todos los derechos
            de explotación sobre los contenidos del Sitio Web. No obstante,
            HIPERA autoriza al Usuario, exclusivamente y en los términos
            estrictamente previstos a continuación:
          </p>
          <ul className="list-disc list-inside space-y-1 ml-2">
            <li>
              <strong>Uso personal y no comercial:</strong> el Usuario podrá
              visualizar, descargar de forma puntual e imprimir contenidos
              del Sitio Web exclusivamente para su uso personal y privado,
              siempre que no sean alterados, modificados, ni utilizados con
              finalidad comercial directa o indirecta.
            </li>
            <li>
              <strong>Cita académica o periodística:</strong> el Usuario podrá
              citar fragmentos del Sitio Web en trabajos académicos,
              periodísticos, científicos o de investigación, siempre que la
              cita esté justificada, sea proporcionada al fin perseguido y
              vaya acompañada de la <strong>atribución expresa de la fuente</strong>{' '}
              (HIPERA — {COMPANY.website}), conforme al Art. 32 del{' '}
              <Lit>RDLeg 1/1996</Lit>.
            </li>
          </ul>
          <p>
            Cualquier otro uso, en particular la reproducción total o parcial,
            la transformación, la distribución, la comunicación pública o la
            explotación comercial de cualquier contenido del Sitio Web,
            requiere autorización previa, expresa y por escrito de HIPERA.
          </p>
        </Subsection>

        <Subsection title="4.4. Notificación de infracciones">
          <p>
            Si cualquier Usuario o tercero considera que algún contenido
            publicado en el Sitio Web infringe sus derechos de propiedad
            intelectual o industrial, podrá comunicarlo a HIPERA mediante{' '}
            <Email addr={COMPANY.emailGeneral} /> con el asunto «
            <strong>Notificación PI</strong>», indicando: (i) identificación
            del titular del derecho infringido, (ii) URL exacta del contenido
            presuntamente infractor, (iii) descripción del derecho que se
            considera vulnerado y (iv) datos de contacto del reclamante.
            HIPERA estudiará la solicitud y, si procede, retirará el contenido
            o adoptará las medidas oportunas en un plazo razonable, conforme
            al régimen de responsabilidad de los prestadores de servicios de
            la sociedad de la información previsto en los Arts. 13 a 17 de la{' '}
            <Lit>LSSI-CE</Lit>.
          </p>
        </Subsection>
      </Section>

      {/* ===================================================== */}
      <Section number="5" title="Política de enlaces">
        <Subsection title="5.1. Enlaces salientes — del Sitio Web a terceros">
          <p>
            El Sitio Web puede contener enlaces a páginas o recursos de
            terceros (por ejemplo, enlaces directos al servicio de mensajería
            <em> WhatsApp</em> para iniciar una conversación con HIPERA,
            enlaces a perfiles oficiales de HIPERA en redes sociales o
            referencias a portales públicos de información, como{' '}
            <em>www.registradores.org</em> en §1.2). Dichos enlaces se
            facilitan con finalidad meramente informativa o de comunicación
            directa con el Usuario.
          </p>
          <p>
            HIPERA <strong>no asume responsabilidad alguna</strong> por los
            contenidos, productos, servicios, prácticas de privacidad o
            condiciones de uso de las páginas o recursos de terceros a los
            que el Usuario pueda acceder desde el Sitio Web, ni sobre las
            modificaciones que dichas páginas puedan sufrir, sin perjuicio
            de la obligación de retirada o bloqueo del enlace cuando HIPERA
            tenga conocimiento efectivo de la ilicitud del contenido enlazado,
            conforme al Art. 17 <Lit>LSSI-CE</Lit>.
          </p>
          <p className="text-xs text-gray-500">
            La existencia de un enlace en el Sitio Web no implica ningún tipo
            de relación, asociación, recomendación o patrocinio entre HIPERA
            y la entidad titular del recurso enlazado, salvo declaración
            expresa en sentido contrario.
          </p>
        </Subsection>

        <Subsection title="5.2. Enlaces entrantes — de terceros al Sitio Web">
          <p>
            Cualquier tercero que desee establecer un enlace que apunte al
            Sitio Web desde su propia página deberá respetar las siguientes
            condiciones:
          </p>
          <ul className="list-disc list-inside space-y-1 ml-2">
            <li>
              El enlace deberá dirigirse a la página de inicio o a una página
              interna del Sitio Web sin reproducir, enmarcar (<em>framing</em>)
              ni alterar de cualquier modo el contenido del Sitio Web.
            </li>
            <li>
              El enlace no podrá sugerir, dar a entender o transmitir la
              existencia de una relación comercial, vínculo, asociación,
              patrocinio o aprobación por parte de HIPERA que no exista en la
              realidad.
            </li>
            <li>
              El enlace no podrá utilizarse desde páginas cuyos contenidos
              resulten contrarios a la legislación vigente, a la moral o al
              orden público, ni desde páginas que vulneren los derechos de
              terceros.
            </li>
            <li>
              HIPERA no autoriza el uso de su nombre comercial, su denominación
              social, su logotipo ni cualquier otro signo distintivo en el
              cuerpo del enlace, salvo que el uso resulte estrictamente
              necesario para identificar el recurso enlazado y se realice con
              fines descriptivos y no comerciales.
            </li>
          </ul>
          <p>
            HIPERA se reserva el derecho de solicitar en cualquier momento, y
            sin necesidad de motivación, la retirada de un enlace entrante
            que considere contrario a las anteriores condiciones, debiendo el
            tercero proceder a su eliminación de forma diligente.
          </p>
        </Subsection>

        <Subsection title="5.3. Limitación de responsabilidad sobre enlaces">
          <p>
            En relación con los enlaces salientes y entrantes regulados en
            esta sección, la responsabilidad de HIPERA se rige por el régimen
            previsto en los Arts. 16 y 17 de la <Lit>LSSI-CE</Lit>, conforme
            al cual el prestador de servicios de la sociedad de la información
            no es responsable de la información a la que dirija a los
            destinatarios de sus servicios siempre que no tenga conocimiento
            efectivo de la ilicitud de dicha información o, en caso de tenerlo,
            actúe con diligencia para retirar el enlace o impedir el acceso.
          </p>
        </Subsection>
      </Section>

      {/* ===================================================== */}
      <Section number="6" title="Exención de responsabilidad">
        <Subsection title="6.1. Disponibilidad técnica del Sitio Web">
          <p>
            HIPERA realiza sus mejores esfuerzos para mantener el Sitio Web
            operativo y accesible de forma continuada. No obstante, el Sitio
            Web depende del funcionamiento de servidores y servicios de
            terceros, así como de las redes de telecomunicaciones, por lo que
            HIPERA <strong>no garantiza</strong> la disponibilidad,
            continuidad o ausencia de errores en el acceso al Sitio Web, ni
            asume responsabilidad por interrupciones, retrasos, fallos
            técnicos, pérdida de datos o cualquier otra incidencia derivada
            de causas ajenas a su control, incluyendo —con carácter
            enunciativo— ataques informáticos, fuerza mayor, caso fortuito y
            actuaciones de terceros proveedores de infraestructura.
          </p>
          <p className="text-xs text-gray-500">
            HIPERA podrá interrumpir temporalmente el acceso al Sitio Web por
            razones técnicas, de mantenimiento, de seguridad o de mejora del
            servicio, sin que ello genere derecho a indemnización a favor
            del Usuario. Cuando sea razonablemente posible, HIPERA anunciará
            las paradas programadas con antelación suficiente.
          </p>
        </Subsection>

        <Subsection title="6.2. Contenidos del Sitio Web">
          <p>
            HIPERA actúa con la diligencia razonable para que la información
            publicada en el Sitio Web sea exacta, completa y se mantenga
            actualizada. Sin embargo, pueden producirse erratas, omisiones o
            desfases entre la información publicada y la realidad del
            establecimiento físico (por ejemplo, en relación con la
            disponibilidad concreta de un producto, su precio puntual o las
            características de un servicio de reparación).
          </p>
          <p>
            En caso de discrepancia entre la información del Sitio Web y la
            información proporcionada por HIPERA en el establecimiento físico
            o mediante comunicación directa al Cliente, prevalecerá esta
            última, sin perjuicio de los derechos del Cliente como consumidor
            reconocidos por el <Lit>RDLeg 1/2007</Lit> y, en particular, del
            derecho a recibir información veraz y suficiente antes de la
            contratación (Art. 60).
          </p>
        </Subsection>

        <Subsection title="6.3. Seguridad y software malicioso">
          <p>
            HIPERA adopta las medidas técnicas y organizativas razonables
            para preservar la seguridad del Sitio Web y prevenir la
            existencia de virus, troyanos o cualquier otro componente
            informático susceptible de causar daños. No obstante, HIPERA{' '}
            <strong>no puede garantizar</strong> la ausencia absoluta de
            elementos lesivos, especialmente cuando dichos elementos hayan
            sido introducidos por terceros ajenos a HIPERA o tengan origen
            en los equipos o redes del propio Usuario. El Usuario es
            responsable de mantener actualizados sus equipos, sistemas
            operativos, navegadores y herramientas de protección
            antimalware.
          </p>
        </Subsection>

        <Subsection title="6.4. Información orientativa, no asesoramiento profesional">
          <p>
            Los contenidos publicados en el Sitio Web (incluidas, en su caso,
            recomendaciones nutricionales, consejos sobre cuidado o uso de
            productos, descripciones de servicios de reparación o
            indicaciones sobre la garantía legal) tienen carácter meramente
            informativo y orientativo. No constituyen asesoramiento
            profesional médico, sanitario, jurídico, fiscal o de cualquier
            otra naturaleza, ni sustituyen la consulta con el profesional
            cualificado correspondiente cuando ésta sea necesaria.
          </p>
        </Subsection>
      </Section>

      {/* ===================================================== */}
      <Section number="7" title="Protección de datos personales y cookies">
        <Subsection title="7.1. Tratamiento de datos personales">
          <p>
            El tratamiento de los datos personales que el Usuario facilite a
            HIPERA con ocasión del acceso, registro o utilización del Sitio
            Web se rige por la <strong>Política de Privacidad</strong>{' '}
            (disponible en{' '}
            <a
              href="/?legal=privacidad"
              className="text-red-600 underline hover:text-red-700"
            >
              /?legal=privacidad
            </a>
            ), publicada conforme al <Lit>Reglamento (UE) 2016/679</Lit>{' '}
            (RGPD) y a la <Lit>Ley Orgánica 3/2018</Lit>, de Protección de
            Datos Personales y garantía de los derechos digitales (LOPDGDD).
            En dicha política se informa de la identidad del responsable del
            tratamiento, las finalidades, las bases jurídicas, los plazos de
            conservación, los destinatarios, las transferencias internacionales,
            los derechos del Usuario y los canales para su ejercicio.
          </p>
        </Subsection>

        <Subsection title="7.2. Uso de cookies">
          <p>
            El uso de cookies y de tecnologías similares en el Sitio Web se
            rige por la <strong>Política de Cookies</strong> (disponible en{' '}
            <a
              href="/?legal=cookies"
              className="text-red-600 underline hover:text-red-700"
            >
              /?legal=cookies
            </a>
            ), publicada conforme al Art. 22.2 de la <Lit>LSSI-CE</Lit> y a
            las directrices de la <Lit>Agencia Española de Protección de
            Datos</Lit> en materia de cookies. El Usuario puede, en cualquier
            momento, revisar y modificar sus preferencias mediante el enlace
            «Gestionar cookies» disponible en el pie de página del Sitio Web.
          </p>
        </Subsection>
      </Section>

      {/* ===================================================== */}
      <Section number="8" title="Modificaciones, legislación aplicable y jurisdicción">
        <Subsection title="8.1. Modificaciones del Aviso Legal">
          <p>
            HIPERA se reserva el derecho de modificar, en cualquier momento y
            sin necesidad de previo aviso, el contenido del presente Aviso
            Legal, así como el diseño, la presentación y la configuración del
            Sitio Web. Las modificaciones entrarán en vigor desde su
            publicación en el Sitio Web, indicándose la nueva fecha de
            vigencia en la cabecera del documento. Las modificaciones{' '}
            <strong>materiales</strong> que afecten al fondo del documento
            implicarán el incremento de la versión de consentimiento.
          </p>
          <p className="text-xs text-gray-500">
            La presente Política se identifica mediante una versión de
            documento ({LEGAL_NOTICE_DOCUMENT_VERSION}) y una versión de
            consentimiento (v{LEGAL_NOTICE_VERSION}).
          </p>
        </Subsection>

        <Subsection title="8.2. Legislación aplicable">
          <p>
            El presente Aviso Legal y, en general, las relaciones del Usuario
            con HIPERA en su condición de usuario del Sitio Web, se rigen por
            la <strong>legislación española</strong>, en particular por la{' '}
            <Lit>Ley 34/2002, de servicios de la sociedad de la información
            y de comercio electrónico</Lit> (LSSI-CE), por el{' '}
            <Lit>Real Decreto Legislativo 1/2007</Lit>, de 16 de noviembre,
            por el que se aprueba el texto refundido de la Ley General para
            la Defensa de los Consumidores y Usuarios (cuando el Usuario
            tenga la condición de consumidor), por el <Lit>Reglamento (UE)
            2016/679</Lit> (RGPD) y por la restante normativa nacional y
            europea aplicable.
          </p>
        </Subsection>

        <Subsection title="8.3. Jurisdicción">
          <p>
            Las cuestiones relativas al uso del Sitio Web se someten a los
            <strong> Juzgados y Tribunales competentes</strong> conforme a la
            legislación aplicable. Cuando el Usuario tenga la condición de{' '}
            <strong>consumidor</strong> en el sentido del{' '}
            <Lit>RDLeg 1/2007</Lit>, será competente el órgano jurisdiccional
            correspondiente a su domicilio, conforme al Art. 90.2 del citado
            texto refundido.
          </p>
          <p className="text-xs text-gray-500">
            El régimen específico de legislación y jurisdicción aplicable a
            la <strong>relación contractual</strong> de compraventa entre
            HIPERA y el Cliente (pedidos, pagos, entrega, garantías, servicios
            de reparación) se encuentra desarrollado en el apartado §15 de los{' '}
            <a
              href="/?legal=terminos"
              className="text-red-600 underline hover:text-red-700"
            >
              Términos y Condiciones
            </a>
            , que prevalecerá sobre el presente Aviso Legal en lo relativo a
            dicha relación contractual.
          </p>
        </Subsection>

        <Subsection title="8.4. Resolución alternativa de litigios (ODR)">
          <p>
            Para las controversias derivadas de la <strong>contratación
            electrónica</strong> entre HIPERA y un Cliente consumidor, se está
            a lo dispuesto en el apartado §15.3 de los Términos y Condiciones,
            que regula la información sobre vías de resolución alternativa
            disponibles tras la derogación de la plataforma ODR de la Comisión
            Europea, conforme al <Lit>Reglamento (UE) 2024/3228</Lit>, vigente
            desde el 20 de julio de 2025. La información actualizada sobre las
            vías de resolución disponibles puede consultarse en{' '}
            <a
              href="https://consumer-redress.ec.europa.eu/dispute-resolution-bodies"
              target="_blank"
              rel="noopener noreferrer"
              className="text-red-600 underline hover:text-red-700"
            >
              consumer-redress.ec.europa.eu
            </a>
            .
          </p>
        </Subsection>

        <Subsection title="8.5. Coherencia con otros documentos legales">
          <p>
            En caso de discrepancia entre el presente Aviso Legal y los
            Términos y Condiciones en relación con la <strong>relación
            contractual de compraventa</strong> (pedidos, pagos, envío,
            garantías y reparación), prevalecerán los Términos y Condiciones.
            En relación con el <strong>tratamiento de datos personales</strong>,
            prevalecerá la Política de Privacidad. En relación con el{' '}
            <strong>uso de cookies</strong>, prevalecerá la Política de
            Cookies. El presente Aviso Legal regula, con carácter principal,
            todas las cuestiones no contractuales relativas al uso del Sitio
            Web como recurso digital.
          </p>
        </Subsection>
      </Section>

      <DocFooter
        docVersion={LEGAL_NOTICE_DOCUMENT_VERSION}
        consentVersion={LEGAL_NOTICE_VERSION}
        updatedAt={LEGAL_NOTICE_UPDATED_AT}
      />
    </div>
  );
}

function Intro() {
  return (
    <p className="text-sm text-gray-700 leading-relaxed">
      El presente <strong>Aviso Legal</strong> regula las condiciones de
      acceso y uso del sitio web {COMPANY.website}, titularidad de{' '}
      {COMPANY.name} (<strong>«HIPERA»</strong>), en cumplimiento del Art. 10
      de la <Lit>Ley 34/2002, de servicios de la sociedad de la información
      y de comercio electrónico</Lit> (LSSI-CE). Su contenido es complementario
      a los <strong>Términos y Condiciones</strong> y a las restantes políticas
      legales del sitio, sin reemplazarlos ni superponerse a ellos.
    </p>
  );
}
