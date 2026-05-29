// =====================================================================
// Términos y Condiciones de Compra · HIPERA (QIANG GUO, S.L.)
// =====================================================================
// Documento legal vinculante para la compra de productos y la
// contratación de servicios de reparación a través de la web y la
// tienda física de HIPERA.
//
// Bases normativas principales:
//   - Real Decreto Legislativo 1/2007 (TR Ley General para la Defensa
//     de los Consumidores y Usuarios — TRLGDCU)
//   - Ley 34/2002 de Servicios de la Sociedad de la Información y de
//     Comercio Electrónico (LSSI-CE)
//   - Ley 7/1996 de Ordenación del Comercio Minorista
//   - Real Decreto 1906/1999 sobre contratación electrónica
//   - Directiva 2011/83/UE sobre derechos de los consumidores
//   - Reglamento (UE) 524/2013 sobre resolución de litigios en línea
//   - Reglamento (UE) 1215/2012 (Bruselas I bis) sobre competencia
//     judicial en consumo
//   - Reglamento (UE) 1169/2011 sobre información alimentaria
//   - Real Decreto 58/1988 sobre prestación de servicios de
//     asistencia técnica
//   - Código Civil
//   - Ley 7/2017 sobre resolución alternativa de litigios de consumo
// =====================================================================

import {
  TERMS_DOCUMENT_VERSION,
  TERMS_UPDATED_AT,
  TERMS_VERSION,
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

export default function TerminosCondiciones() {
  return (
    <div className="space-y-6">
      <VersionBanner
        docVersion={TERMS_DOCUMENT_VERSION}
        consentVersion={TERMS_VERSION}
        updatedAt={TERMS_UPDATED_AT}
      />
      <Intro />

      <Section number="1" title="Información de la empresa">
        <p>
          En cumplimiento del Art. 10 de la <Lit>Ley 34/2002 (LSSI-CE)</Lit>, HIPERA facilita
          la siguiente información identificativa:
        </p>
        <ul className="list-disc list-inside space-y-1 ml-2">
          <li><strong>Denominación social:</strong> {COMPANY.name}</li>
          <li><strong>NIF:</strong> {COMPANY.nif}</li>
          <li><strong>Domicilio social y establecimiento:</strong> {COMPANY.address}</li>
          <li><strong>Inscripción:</strong> {COMPANY.registry}</li>
          <li><strong>Teléfono:</strong> {COMPANY.phone}</li>
          <li><strong>Correos electrónicos:</strong>
            <ul className="list-disc list-inside ml-5 mt-1 space-y-0.5">
              <li><Email addr={COMPANY.emailGeneral} /> — consultas generales</li>
              <li><Email addr={COMPANY.emailPrivacy} /> — protección de datos (Art. 13 RGPD)</li>
              <li><Email addr={COMPANY.emailComplaints} /> — reclamaciones formales (Ley 7/2017)</li>
            </ul>
          </li>
          <li><strong>Sitio web:</strong> {COMPANY.website}</li>
          <li><strong>Actividad:</strong> {COMPANY.activity}</li>
          <li><strong>Horario:</strong> {COMPANY.hours}</li>
        </ul>
      </Section>

      <Section number="2" title="Objeto y aceptación de las condiciones">
        <p>
          Las presentes condiciones generales regulan la compra de productos y la
          contratación de servicios de reparación ofrecidos por HIPERA a través de su
          tienda online y, en lo aplicable, en su establecimiento físico.
        </p>
        <p>
          La realización de un pedido implica la aceptación expresa de estas condiciones,
          marcadas mediante la casilla correspondiente en el proceso de registro y de
          compra. El uso continuado del sitio web implica la aceptación tácita de las
          mismas. Conforme al Art. 80 del <Lit>RDLeg 1/2007</Lit>, este documento se
          redacta de forma clara, comprensible y accesible.
        </p>
        <Subsection title="2.1 Capacidad para contratar">
          <p>
            Para realizar pedidos en HIPERA es necesario disponer de capacidad legal
            para contratar conforme al ordenamiento español. Los menores podrán
            contratar únicamente a través de sus representantes legales o con la
            autorización suficiente conforme al <Lit>Art. 1263 del Código Civil</Lit>.
            HIPERA se reserva el derecho de rechazar pedidos cuando existan dudas
            razonables sobre la capacidad para contratar del comprador, sin necesidad
            de justificación adicional.
          </p>
        </Subsection>
        <Subsection title="2.2 Verificación de edad para productos restringidos">
          <p>
            La venta de bebidas alcohólicas y otros productos sujetos a restricción
            por edad está limitada a personas mayores de la edad legal aplicable.
            HIPERA sólo comercializa productos sujetos a restricción de edad cuando
            está legalmente habilitada para ello y aplica los mecanismos de
            verificación exigidos por la normativa aplicable.
          </p>
          <p>
            HIPERA se reserva el derecho de solicitar verificación documental de la
            edad en el momento de la entrega y, en su caso, de rechazar la entrega
            cuando el destinatario no acredite la edad requerida, reembolsando el
            importe del producto restringido.
          </p>
        </Subsection>
        <Subsection title="2.3 Archivo y reproducción del contrato">
          <p>
            Conforme al Art. 27 de la <Lit>LSSI-CE</Lit>, estas condiciones pueden ser
            consultadas, descargadas e impresas por el usuario en cualquier momento desde
            el sitio web. HIPERA conserva copia electrónica del contrato durante los
            plazos legalmente exigibles.
          </p>
        </Subsection>
      </Section>

      <Section number="3" title="Información sobre los productos">
        <p>
          De acuerdo con el Art. 60 del <Lit>RDLeg 1/2007</Lit>, HIPERA proporciona
          información precontractual veraz, suficiente y accesible sobre cada producto en
          su ficha correspondiente: características esenciales, precio total con
          impuestos, gastos adicionales aplicables y disponibilidad.
        </p>
        <Subsection title="3.1 Fotografías y descripciones">
          <p>
            Las imágenes y descripciones tienen carácter ilustrativo. Pueden existir
            ligeras variaciones de envase, presentación o etiquetado que no afectan a las
            características esenciales del producto ni a su uso.
          </p>
        </Subsection>
        <Subsection title="3.2 Disponibilidad de stock">
          <p>
            La disponibilidad mostrada es la mejor estimación posible. Si después de
            confirmar un pedido un producto no estuviera disponible, HIPERA contactará al
            cliente para ofrecer una alternativa equivalente, cancelar parcialmente el
            pedido o reembolsar íntegramente el importe del producto afectado.
          </p>
        </Subsection>
        <Subsection title="3.3 Productos perecederos y alimentación">
          <p>
            Los productos alimentarios se entregan con un plazo razonable de consumo
            preferente o caducidad. La información de ingredientes, alérgenos, valores
            nutricionales y origen se ajusta al Reglamento (UE) 1169/2011 y figura en el
            etiquetado del producto y, en lo posible, en su ficha online.
          </p>
        </Subsection>
        <Subsection title="3.4 Errores manifiestos">
          <p>
            En caso de errores tipográficos, de precio u otros errores manifiestos en la
            información publicada, HIPERA podrá no formalizar la operación afectada y,
            si el pago ya se hubiera realizado, reembolsará íntegramente al cliente.
          </p>
        </Subsection>
      </Section>

      <Section number="4" title="Precios e IVA">
        <p>
          Todos los precios se expresan en euros (€) e incluyen el Impuesto sobre el Valor
          Añadido (IVA) español aplicable, salvo indicación expresa en contrario. Los tipos
          aplicados conforme a la Ley 37/1992 del IVA son:
        </p>
        <ul className="list-disc list-inside space-y-1 ml-2">
          <li><strong>4 % (superreducido):</strong> pan común, leche, queso, huevos, frutas, verduras, hortalizas, legumbres, tubérculos, cereales y aceite de oliva.</li>
          <li><strong>10 % (reducido):</strong> resto de productos alimentarios, otros aceites vegetales (girasol, soja, etc.) y determinados productos de higiene.</li>
          <li><strong>21 % (general):</strong> productos de bazar, accesorios, servicios de reparación y componentes electrónicos.</li>
        </ul>
        <p>
          Los gastos de envío y posibles recargos por método de pago se desglosan de forma
          separada antes de la confirmación del pedido y forman parte del importe final a
          abonar.
        </p>
        <p>
          HIPERA se reserva el derecho de modificar sus precios en cualquier momento. El
          precio aplicable al pedido es, en todo caso, el vigente en el momento de su
          confirmación, sin que las modificaciones posteriores afecten a pedidos ya
          formalizados.
        </p>
      </Section>

      <Section number="5" title="Proceso de pedido">
        <p>
          La realización de un pedido sigue los siguientes pasos:
        </p>
        <ol className="list-decimal list-inside space-y-1 ml-2">
          <li>Selección de productos y adición a la cesta.</li>
          <li>Introducción de datos de envío y selección del método de entrega.</li>
          <li>Selección del método de pago.</li>
          <li>Revisión final del pedido y aceptación expresa de las condiciones.</li>
          <li>Confirmación del pedido por parte de HIPERA mediante correo electrónico.</li>
        </ol>
        <Subsection title="5.1 Acuse de recibo">
          <p>
            Conforme al Art. 28 de la <Lit>LSSI-CE</Lit>, HIPERA enviará al cliente
            confirmación electrónica del pedido en un plazo máximo de 24 horas desde su
            realización. Esta confirmación incluye el detalle del pedido, los datos de
            envío, el importe total y un resumen de las condiciones aplicables.
          </p>
          <p className="text-xs text-gray-500">
            El correo de confirmación se remite desde la dirección{' '}
            <Email addr={COMPANY.emailOrders} /> a la cuenta de correo facilitada por
            el Cliente en el proceso de compra. Se recomienda añadir dicha dirección
            a la lista de remitentes seguros para evitar que las comunicaciones
            operativas del pedido sean clasificadas como correo no deseado.
          </p>
        </Subsection>
        <Subsection title="5.2 Perfeccionamiento del contrato y corrección de errores">
          <p>
            El contrato se entiende perfeccionado en el momento en que HIPERA envía la
            confirmación electrónica del pedido (acuse de recibo) al correo electrónico
            facilitado por el Cliente, conforme al Art. 27.1 de la <Lit>LSSI-CE</Lit> y al{' '}
            <Lit>Real Decreto 1906/1999</Lit>.
          </p>
          <p>
            Antes de dicha confirmación, el Cliente puede revisar y modificar libremente
            los productos de su cesta y los datos introducidos.
          </p>
          <p>
            Una vez confirmado el pedido por HIPERA, las modificaciones deberán solicitarse
            antes de que el pedido entre en preparación, dirigiéndose a{' '}
            <Email addr={COMPANY.emailGeneral} />.
          </p>
        </Subsection>
        <Subsection title="5.3 Idioma y archivo del contrato">
          <p>
            El idioma de formalización del contrato es el castellano. HIPERA conservará
            copia electrónica del contrato y la pondrá a disposición del cliente cuando lo
            solicite, durante los plazos legalmente exigibles.
          </p>
        </Subsection>
      </Section>

      <Section number="6" title="Métodos de pago">
        <p>
          HIPERA puede ofrecer los siguientes medios de pago, los cuales se actualizan
          periódicamente. Los medios de pago activos en cada momento se muestran en el
          proceso de compra:
        </p>
        <ul className="list-disc list-inside space-y-1 ml-2">
          <li><strong>Contra reembolso</strong> (pago en efectivo o con tarjeta en el momento de la entrega o de la recogida en tienda).</li>
          <li><strong>Pago en línea mediante tarjeta de crédito o débito (Visa, Mastercard), Bizum, Apple Pay y Google Pay</strong>, procesado a través de la pasarela de pagos <strong>Stripe Payments Europe, Ltd.</strong> (entidad de la Unión Europea con sede en Dublín, Irlanda, certificada PCI-DSS nivel 1). El pago se autoriza en el momento de la compra y el pedido se prepara una vez confirmado el cobro por la pasarela.</li>
          <li><strong>Bizum manual</strong> mediante el número operativo facilitado en el proceso de pago; el cliente envía la transferencia desde su aplicación bancaria y HIPERA verifica la recepción antes de preparar el pedido. Este medio es complementario al Bizum en línea procesado por Stripe.</li>
        </ul>
        <p>
          HIPERA no almacena ni tiene acceso al número completo de la tarjeta de pago. El
          procesamiento de los pagos en línea se delega íntegramente en la pasarela{' '}
          <strong>Stripe</strong>, proveedor debidamente certificado (PCI-DSS nivel 1,
          autenticación reforzada 3-D Secure conforme a la PSD2 / Directiva 2015/2366).
          El tratamiento de los datos de pago se describe en la{' '}
          <strong>Política de Privacidad</strong> (§6 y §7).
        </p>
        <p>
          HIPERA se reserva el derecho de cancelar pedidos cuando existan indicios
          razonables de fraude, suplantación de identidad o pago no autorizado, sin que
          ello genere responsabilidad alguna frente al usuario.
        </p>
        <p>
          Las facturas se emiten en formato electrónico (PDF), conforme a la Ley 37/1992
          del IVA, y se ponen a disposición del cliente en su cuenta y/o por correo.
        </p>
      </Section>

      <Section number="7" title="Envío y entrega">
        <p>
          Las zonas de cobertura, plazos estimados, tarifas y umbrales de envío gratuito
          se detallan en la{' '}
          <a
            href="/?legal=envios"
            className="text-red-600 underline hover:text-red-700 font-semibold"
          >
            Política de Envíos
          </a>
          , que forma parte integrante de las presentes condiciones.
        </p>
        <Subsection title="7.1 Plazo máximo de entrega">
          <p>
            Conforme al Art. 66 <em>bis</em> del <Lit>RDLeg 1/2007</Lit>, el plazo máximo
            de entrega es de 30 días naturales desde la confirmación del pedido, salvo
            pacto distinto. Si HIPERA no entrega en plazo, el cliente podrá conceder un
            plazo adicional razonable; transcurrido éste sin entrega, tendrá derecho a
            resolver el contrato con reembolso íntegro de las cantidades abonadas.
          </p>
        </Subsection>
        <Subsection title="7.2 Transmisión del riesgo">
          <p>
            Conforme al Art. 66 <em>ter</em> del <Lit>RDLeg 1/2007</Lit>, el riesgo de
            pérdida o deterioro de los productos se transmite al consumidor en el momento
            en que él, o un tercero designado por él (distinto del transportista), adquiere
            la posesión material del producto.
          </p>
          <p>
            <strong>Excepción:</strong> si el cliente encarga el transporte a un
            transportista distinto del ofrecido por HIPERA, el riesgo se transmite en el
            momento de la entrega del producto a dicho transportista, sin perjuicio de los
            derechos del cliente frente al propio transportista (Art. 66 <em>ter</em>.2).
          </p>
        </Subsection>
        <Subsection title="7.3 Incidencias en el transporte">
          <p>
            El cliente debe revisar el estado del paquete en el momento de la entrega y
            hacer constar cualquier daño visible en el albarán del transportista. Las
            incidencias relativas a daños no aparentes o a productos faltantes deben
            comunicarse a <Email addr={COMPANY.emailGeneral} /> en un plazo máximo de
            48 horas desde la recepción.
          </p>
          <p className="text-xs text-gray-500">
            Este plazo de 48 horas se establece a efectos de gestión logística y no
            limita los derechos legales del consumidor en materia de garantía de
            conformidad, reclamaciones u otras acciones reconocidas por la
            legislación aplicable.
          </p>
        </Subsection>
        <Subsection title="7.4 Recogida en tienda">
          <p>
            En la modalidad de recogida en tienda, el pedido queda a disposición del
            cliente en el establecimiento de Meco durante el horario comercial. Si
            transcurridos 7 días naturales el pedido no se ha recogido ni el cliente
            contesta a los avisos, HIPERA contactará nuevamente al cliente para acordar
            una solución o, en su defecto, cancelar el pedido reembolsando los productos
            no perecederos.
          </p>
        </Subsection>
      </Section>

      <Section number="8" title="Derecho de desistimiento y devoluciones">
        <p>
          Conforme a los Arts. 102 a 108 del <Lit>RDLeg 1/2007</Lit> y a la
          Directiva 2011/83/UE, el consumidor dispone de un plazo de <strong>14 días
          naturales</strong> desde la recepción del producto (o del último producto, si el
          pedido se entrega de forma fraccionada) para desistir del contrato sin necesidad
          de indicar motivo.
        </p>
        <Subsection title="8.1 Forma de ejercicio">
          <p>
            El cliente puede ejercer el desistimiento comunicándolo a{' '}
            <Email addr={COMPANY.emailGeneral} /> o por teléfono. De forma alternativa, está
            disponible el modelo de formulario tipo (Anexo B del{' '}
            <Lit>RDLeg 1/2007</Lit>) en la{' '}
            <a
              href="/?legal=devoluciones"
              className="text-red-600 underline hover:text-red-700"
            >
              Política de Devoluciones
            </a>
            .
          </p>
        </Subsection>
        <Subsection title="8.2 Estado del producto">
          <p>
            El producto debe encontrarse en un estado que permita su examen y prueba
            normales que el cliente habría efectuado en un establecimiento físico. El
            cliente sólo responde por la disminución de valor del producto resultante de
            una manipulación distinta de la necesaria para establecer su naturaleza,
            características y funcionamiento (Art. 108.2).
          </p>
        </Subsection>
        <Subsection title="8.3 Reembolso">
          <p>
            Una vez ejercido el desistimiento, HIPERA reembolsará el importe de los
            productos devueltos en un plazo máximo de 14 días naturales, utilizando
            el mismo medio de pago empleado por el cliente. Los{' '}
            <strong>gastos de envío estándar iniciales</strong> se reembolsarán
            íntegros cuando el desistimiento alcance la <strong>totalidad</strong>{' '}
            del pedido y dichos gastos hubieran sido efectivamente facturados; el
            régimen aplicable a las devoluciones <strong>parciales</strong> y la
            interacción con el umbral de envío gratuito se desarrolla en los §§5.4
            y 5.5 de la{' '}
            <a
              href="/?legal=devoluciones"
              className="text-red-600 underline hover:text-red-700"
            >
              Política de Devoluciones
            </a>
            . HIPERA podrá retener el reembolso hasta haber recibido el producto o
            la prueba de su devolución, lo que ocurra primero (Art. 107.2).
          </p>
        </Subsection>
        <Subsection title="8.4 Coste de devolución">
          <p>
            El coste directo de la devolución corresponde al cliente, salvo cuando el
            producto sea defectuoso, no corresponda al pedido o exista error imputable a
            HIPERA, en cuyo caso será asumido íntegramente por HIPERA.
          </p>
        </Subsection>
        <Subsection title="8.5 Excepciones legales al desistimiento">
          <p>
            Conforme al Art. 103 del <Lit>RDLeg 1/2007</Lit>, no asiste el derecho de
            desistimiento en los siguientes supuestos:
          </p>
          <ul className="list-disc list-inside space-y-1 ml-2">
            <li>Productos confeccionados conforme a especificaciones del consumidor o claramente personalizados.</li>
            <li>Productos perecederos o de rápida caducidad (alimentación fresca).</li>
            <li>Productos precintados que no sean aptos para devolución por razones de salud o higiene una vez abiertos tras la entrega.</li>
            <li>Grabaciones sonoras o de vídeo precintadas o programas informáticos precintados, una vez desprecintados por el consumidor.</li>
            <li>Prensa diaria, publicaciones periódicas o revistas, salvo suscripciones.</li>
            <li>Servicios de reparación ya iniciados con consentimiento expreso del cliente (véase sección 10).</li>
            <li>Servicios completamente ejecutados antes del fin del plazo de desistimiento, con consentimiento previo expreso del cliente.</li>
          </ul>
        </Subsection>
      </Section>

      <Section number="9" title="Garantías legales">
        <Subsection title="9.1 Garantía legal de conformidad">
          <p>
            Conforme a los Arts. 114 a 127 del <Lit>RDLeg 1/2007</Lit> (en la redacción
            dada por el Real Decreto-ley 7/2021), HIPERA responde frente al consumidor por
            cualquier falta de conformidad que se manifieste en un plazo de <strong>3 años
            </strong> desde la entrega para bienes nuevos y <strong>2 años</strong> para
            bienes de segunda mano.
          </p>
        </Subsection>
        <Subsection title="9.2 Presunción">
          <p>
            Salvo prueba en contrario, se presumirá que las faltas de conformidad
            manifestadas en los <strong>2 años</strong> siguientes a la entrega del bien
            existían en el momento de la misma, salvo cuando esta presunción sea
            incompatible con la naturaleza del bien o la índole de la falta (Art. 121.1).
          </p>
        </Subsection>
        <Subsection title="9.3 Derechos del consumidor">
          <p>
            En caso de falta de conformidad, el consumidor podrá optar entre exigir la
            puesta en conformidad del bien (reparación o sustitución), una rebaja
            proporcionada del precio o la resolución del contrato, conforme al régimen del
            Art. 118 y siguientes.
          </p>
        </Subsection>
        <Subsection title="9.4 Ejercicio de la garantía">
          <p>
            Para ejercer la garantía, el cliente debe contactar con HIPERA aportando
            justificante de compra (factura, ticket o número de pedido) y descripción del
            problema. HIPERA evaluará la incidencia y, en su caso, gestionará la
            reparación o sustitución directamente o con el servicio técnico autorizado.
          </p>
        </Subsection>
        <Subsection title="9.5 Garantía comercial adicional">
          <p>
            Cuando el fabricante ofrezca garantía comercial propia, sus condiciones serán
            las indicadas en su documentación, sin perjuicio en ningún caso de la garantía
            legal de conformidad descrita en este apartado.
          </p>
        </Subsection>
        <Subsection title="9.6 Productos perecederos y régimen sanitario">
          <p>
            Los productos perecederos están sujetos al régimen específico de garantía
            sanitaria conforme a la normativa de seguridad alimentaria, con derecho del
            consumidor a reclamación inmediata en caso de producto en mal estado,
            caducado o no conforme.
          </p>
        </Subsection>
      </Section>

      <Section number="10" title="Servicios de reparación de dispositivos móviles">
        <Subsection title="10.1 Naturaleza del servicio">
          <p>
            Los servicios de reparación de dispositivos móviles constituyen una prestación
            de servicio profesional sujeta a la <Lit>Ley 1/2007</Lit> y al{' '}
            <Lit>Real Decreto 58/1988</Lit> sobre prestación de servicios de asistencia
            técnica.
          </p>
        </Subsection>
        <Subsection title="10.2 Presupuesto previo">
          <p>
            Para los servicios estándar (sustitución de pantalla, batería y componentes
            comunes) el diagnóstico es <strong>gratuito</strong>. En supuestos de
            diagnóstico complejo o requerimiento de pruebas específicas, el coste de
            diagnóstico será comunicado y aceptado expresamente por el cliente antes de
            iniciar.
          </p>
          <p>
            La aceptación del presupuesto por parte del cliente es requisito imprescindible
            para iniciar la reparación.
          </p>
        </Subsection>
        <Subsection title="10.3 Excepción al derecho de desistimiento">
          <p>
            Una vez iniciada la reparación con el consentimiento expreso del cliente,
            <strong>no asiste el derecho de desistimiento</strong> de 14 días, conforme al
            Art. 103.m del <Lit>RDLeg 1/2007</Lit>.
          </p>
        </Subsection>
        <Subsection title="10.4 Reserva de citas y depósito">
          <p>
            La reserva de cita para reparación requiere el pago de un depósito cuyo
            importe se indica en el proceso de reserva en función del tipo de servicio y
            dispositivo.
          </p>
          <p>
            El depósito tiene la naturaleza de <strong>pago a cuenta</strong> según el{' '}
            <Lit>Art. 1454 del Código Civil</Lit>:
          </p>
          <ul className="list-disc list-inside space-y-1 ml-2">
            <li>Si el cliente decide proceder con la reparación, el depósito se aplica al precio final del servicio.</li>
            <li>Si HIPERA no puede realizar la reparación (falta de stock, complejidad imprevista), el depósito se reembolsa íntegramente.</li>
            <li>Si el cliente cancela con más de 24 horas de antelación, el depósito se reembolsa íntegramente.</li>
            <li>Si el cliente cancela con menos de 24 horas o no se presenta (<em>no-show</em>), el depósito no será reembolsado.</li>
          </ul>
        </Subsection>
        <Subsection title="10.5 Garantía de la reparación">
          <p>
            Las reparaciones realizadas por HIPERA gozan de una garantía comercial
            de <strong>seis (6) meses</strong> sobre el trabajo efectuado, que supera
            el plazo mínimo legal de tres (3) meses establecido en el{' '}
            <Lit>Real Decreto 58/1988</Lit> sobre prestación de servicios de
            asistencia técnica. Los componentes nuevos sustituidos disponen, además,
            de la garantía propia del fabricante.
          </p>
          <p>
            La garantía cubre los defectos atribuibles al trabajo realizado o a los
            componentes utilizados. No cubre daños posteriores ajenos a la
            reparación, uso indebido, golpes, exposición a líquidos u otras causas
            externas.
          </p>
        </Subsection>
        <Subsection title="10.6 Protección de datos del dispositivo del Cliente">
          <div className="ml-1 mt-3">
            <h4 className="font-semibold text-sm text-gray-900 mb-1">
              10.6.1. Responsabilidad del Cliente antes de la entrega
            </h4>
            <p>Se recomienda al Cliente, antes de entregar el dispositivo para reparación:</p>
            <ul className="list-disc list-inside space-y-1 ml-2 mt-1">
              <li>
                Realizar una copia de seguridad de sus datos personales (fotos,
                contactos, mensajes, etc.).
              </li>
              <li>
                Cerrar sesión en cuentas sensibles (banca, correo electrónico, redes
                sociales).
              </li>
              <li>Retirar la tarjeta SIM y la tarjeta de memoria (SD), si las hubiera.</li>
              <li>Eliminar contraseñas guardadas o información altamente sensible.</li>
              <li>
                Proporcionar, en su caso, un método temporal de desbloqueo únicamente
                cuando sea estrictamente necesario para la reparación.
              </li>
            </ul>
          </div>
          <div className="ml-1 mt-3">
            <h4 className="font-semibold text-sm text-gray-900 mb-1">
              10.6.2. Compromisos de HIPERA
            </h4>
            <p>HIPERA y su personal técnico se comprometen a:</p>
            <ul className="list-disc list-inside space-y-1 ml-2 mt-1">
              <li>
                Acceder al contenido del dispositivo únicamente cuando sea técnicamente
                imprescindible para diagnosticar o realizar la reparación.
              </li>
              <li>Limitar dicho acceso al alcance mínimo necesario.</li>
              <li>
                No copiar, descargar, transmitir, visualizar ni utilizar el contenido
                personal del Cliente para ningún fin ajeno a la reparación.
              </li>
              <li>
                Eliminar de forma segura cualquier dato técnico temporal generado
                durante el diagnóstico (logs, capturas, archivos de prueba) tras la
                finalización del servicio.
              </li>
              <li>
                Solicitar autorización expresa al Cliente cuando, excepcionalmente,
                sea necesario acceder a una aplicación o archivo concreto para
                resolver el problema reportado.
              </li>
            </ul>
          </div>
          <div className="ml-1 mt-3">
            <h4 className="font-semibold text-sm text-gray-900 mb-1">
              10.6.3. Confidencialidad
            </h4>
            <p>
              Todo el personal de HIPERA con acceso a dispositivos en reparación
              está sujeto a deber de confidencialidad, sin perjuicio de las
              obligaciones legales que pudieran imponer la comunicación a
              autoridades en supuestos tasados (Cuerpos y Fuerzas de Seguridad,
              requerimientos judiciales).
            </p>
          </div>
        </Subsection>
        <Subsection title="10.7 Equipos no recogidos">
          <p>
            El cliente dispone de un plazo de 30 días naturales desde la comunicación
            de la finalización de la reparación para recoger su equipo. HIPERA
            realizará al menos dos avisos por correo electrónico, WhatsApp o
            teléfono durante dicho plazo.
          </p>
          <p>
            Transcurridos los 30 días sin recogida ni respuesta, HIPERA continuará
            sus intentos de contacto. Si transcurridos <strong>6 meses</strong>{' '}
            desde la finalización de la reparación el equipo no ha sido recogido y
            el cliente no ha respondido a los avisos, HIPERA podrá:
          </p>
          <ul className="list-disc list-inside space-y-1 ml-2">
            <li>
              Aplicar gastos razonables de custodia conforme a tarifas comunicadas
              previamente al cliente.
            </li>
            <li>
              Ejercer los derechos legalmente reconocidos sobre bienes abandonados
              (<Lit>Código Civil Art. 1780 y ss.</Lit>).
            </li>
            <li>
              Acudir al procedimiento que corresponda conforme a la normativa
              aplicable, previa comunicación fehaciente al cliente cuando sea
              posible.
            </li>
          </ul>
          <p>
            En todo caso, HIPERA garantizará la eliminación segura de cualquier dato
            personal que pudiera permanecer en el dispositivo antes de su disposición.
          </p>
        </Subsection>
        <Subsection title="10.8 Limitaciones">
          <p>
            HIPERA se reserva el derecho a rechazar reparaciones de dispositivos con
            manipulaciones previas no profesionales, daños extensos por líquidos o
            cualquier circunstancia que represente un riesgo razonable para la seguridad
            del equipo o del personal. Si durante el diagnóstico se detectan defectos
            adicionales a los inicialmente comunicados, HIPERA contactará al cliente con
            un presupuesto ampliado para su aprobación expresa antes de continuar.
          </p>
        </Subsection>
      </Section>

      <Section number="11" title="Propiedad intelectual e industrial">
        <p>
          Son titularidad de HIPERA el nombre comercial, el logotipo, el diseño y
          contenido del sitio web, las fotografías propias, los textos editoriales y el
          código fuente, así como cualesquiera otros elementos creados o adquiridos por
          HIPERA, protegidos por el <Lit>RDLeg 1/1996</Lit> (Ley de Propiedad
          Intelectual) y la <Lit>Ley 17/2001</Lit> (Ley de Marcas).
        </p>
        <p>
          Las marcas, signos distintivos y demás derechos de propiedad industrial de los
          productos de terceros comercializados por HIPERA son titularidad de sus
          respectivos propietarios. Su utilización por parte de HIPERA se realiza al
          amparo de la doctrina del agotamiento del derecho de marca (Art. 36 de la{' '}
          <Lit>Ley 17/2001</Lit>) por tratarse de reventa legítima de productos
          adquiridos a través de canales autorizados.
        </p>
        <p>
          Queda prohibida la reproducción, distribución, comunicación pública,
          transformación o cualquier otra forma de explotación de los contenidos del
          sitio web sin autorización expresa de HIPERA o del titular correspondiente.
          HIPERA se reserva el ejercicio de las acciones civiles, administrativas y
          penales que en cada caso correspondan.
        </p>
        <p>
          Las opiniones, valoraciones y comentarios aportados por los usuarios se rigen
          por una licencia no exclusiva, gratuita y de ámbito mundial a favor de HIPERA
          para su exhibición en la web y sus comunicaciones comerciales.
        </p>
      </Section>

      <Section number="12" title="Responsabilidad y limitaciones">
        <p>
          HIPERA responde de la calidad, seguridad y conformidad de los productos y
          servicios que comercializa conforme a la legislación aplicable.
        </p>
        <Subsection title="12.1 Supuestos en los que HIPERA no responde">
          <p>
            HIPERA no responderá de daños imputables exclusivamente a terceros
            (transportistas o fabricantes) cuando la ley permita dicha exclusión,
            sin perjuicio de los derechos irrenunciables del consumidor frente a
            HIPERA como vendedor conforme al <Lit>RDLeg 1/2007</Lit>. Asimismo,
            HIPERA no responderá de:
          </p>
          <ul className="list-disc list-inside space-y-1 ml-2">
            <li>
              Daños o desperfectos derivados del uso indebido, manipulación o
              instalación incorrecta por parte del cliente.
            </li>
            <li>
              Interrupciones o errores técnicos del sitio web cuya causa no sea
              imputable a HIPERA.
            </li>
            <li>Contenidos de terceros enlazados desde el sitio web.</li>
          </ul>
        </Subsection>
        <Subsection title="12.2 Responsabilidad no excluible">
          <p>
            HIPERA <strong>no excluye ni limita</strong> su responsabilidad por dolo,
            negligencia grave, daños a la vida o salud de las personas, ni por cualquier
            otro supuesto en que la legislación de consumo prohíba la limitación,
            conforme al Art. 86 del <Lit>RDLeg 1/2007</Lit>. Cualquier cláusula que
            pretenda lo contrario se entenderá no puesta.
          </p>
        </Subsection>
        <Subsection title="12.3 Indemnización máxima">
          <p>
            Sin perjuicio de los supuestos no excluibles del apartado anterior, la
            responsabilidad contractual de HIPERA frente al cliente queda limitada
            al importe efectivamente pagado por el cliente por el producto o
            servicio que causó el daño.
          </p>
          <p className="text-xs text-gray-500">
            En relaciones con consumidores, esta limitación de responsabilidad sólo
            será aplicable en la medida permitida por la normativa imperativa de
            consumo, sin afectar a los derechos irrenunciables reconocidos por el{' '}
            <Lit>RDLeg 1/2007</Lit>.
          </p>
        </Subsection>
      </Section>

      <Section number="13" title="Fuerza mayor">
        <p>
          Conforme al Art. 1105 del <Lit>Código Civil</Lit>, ninguna de las partes será
          responsable del incumplimiento total o parcial de sus obligaciones cuando dicho
          incumplimiento se deba a sucesos imprevisibles o, aun siendo previsibles,
          inevitables, que escapen al control razonable de la parte afectada.
        </p>
        <Subsection title="13.1 Supuestos enunciativos">
          <p>
            Se consideran supuestos de fuerza mayor, sin carácter limitativo:
          </p>
          <ul className="list-disc list-inside space-y-1 ml-2">
            <li>Catástrofes naturales (terremotos, inundaciones, incendios, tormentas extremas).</li>
            <li>Conflictos armados, disturbios civiles o actos de terrorismo.</li>
            <li>Pandemias o epidemias declaradas por las autoridades sanitarias competentes.</li>
            <li>Huelgas generales o sectoriales que afecten al transporte, suministro o telecomunicaciones.</li>
            <li>Ataques de denegación de servicio (DDoS), <em>ransomware</em> u otros ciberataques que paralicen total o parcialmente la operación.</li>
            <li>Interrupciones masivas y prolongadas de proveedores de servicios cloud, pasarelas de pago u operadores logísticos.</li>
            <li>Decisiones administrativas o judiciales que impidan la operación normal o el cumplimiento de las obligaciones.</li>
            <li>Cortes prolongados de suministro eléctrico o de telecomunicaciones.</li>
          </ul>
        </Subsection>
        <Subsection title="13.2 Efectos">
          <p>
            Durante la vigencia del evento de fuerza mayor, las obligaciones afectadas
            quedarán suspendidas. HIPERA comunicará al cliente la incidencia tan pronto
            como sea razonablemente posible y procurará reanudar el cumplimiento en cuanto
            cesen las circunstancias.
          </p>
        </Subsection>
        <Subsection title="13.3 Resolución por persistencia">
          <p>
            Si el evento de fuerza mayor se prolonga durante más de 30 días naturales,
            cualquiera de las partes podrá resolver el contrato sin penalización,
            procediéndose al reembolso íntegro de las cantidades efectivamente abonadas
            por el cliente.
          </p>
        </Subsection>
      </Section>

      <Section number="14" title="Legislación aplicable y jurisdicción">
        <p>
          Las presentes condiciones se rigen por la legislación española.
        </p>
        <p>
          Para cualquier controversia que pudiera derivarse de la interpretación o
          aplicación de este contrato, las partes se someten a los Juzgados y Tribunales
          del <strong>domicilio del consumidor</strong> en España, conforme al
          Reglamento (UE) 1215/2012 (Bruselas I bis) y al Art. 90 del{' '}
          <Lit>RDLeg 1/2007</Lit>, que prohíben cláusulas de sumisión expresa a fueros
          distintos en contratos con consumidores.
        </p>
        <p>
          Para relaciones comerciales entre empresas (B2B), las partes se someten a los
          Juzgados y Tribunales de la ciudad de Madrid, con renuncia a cualquier otro
          fuero que pudiera corresponderles.
        </p>
        <p>
          Ninguna disposición de estas condiciones puede interpretarse como una
          limitación de los derechos imperativos que la legislación de consumo reconozca
          al cliente.
        </p>
      </Section>

      <Section number="15" title="Resolución extrajudicial de conflictos">
        <Subsection title="15.1 Reclamaciones internas">
          <p>
            El cliente puede dirigir sus reclamaciones a{' '}
            <Email addr={COMPANY.emailComplaints} />. Conforme a la{' '}
            <Lit>Ley 7/2017</Lit>, HIPERA dispone de un plazo máximo de 30 días naturales
            para responder de forma motivada. HIPERA dispone, además, de hojas oficiales
            de reclamación a disposición del cliente en su establecimiento físico.
          </p>
        </Subsection>
        <Subsection title="15.2 Vías administrativas">
          <p>El consumidor puede dirigir su reclamación, entre otros, a:</p>
          <ul className="list-disc list-inside space-y-1 ml-2">
            <li><strong>OMIC</strong> — Oficina Municipal o Comarcal de Información al Consumidor de la localidad de residencia del consumidor. En su defecto: <strong>Dirección General de Comercio, Consumo y Servicios</strong> de la Comunidad de Madrid.</li>
            <li><strong>AESAN</strong> — Agencia Española de Seguridad Alimentaria y Nutrición, para asuntos sanitarios o alimentarios.</li>
          </ul>
        </Subsection>
        <Subsection title="15.3 Resolución alternativa de litigios">
          <p>
            La antigua plataforma europea de resolución de litigios en línea (ODR),
            prevista en el <Lit>Reglamento (UE) 524/2013</Lit>, dejó de estar
            operativa el 20 de julio de 2025 por decisión de la Comisión Europea
            (<Lit>Reglamento (UE) 2024/3228</Lit>). El consumidor puede acudir a las
            vías de reclamación indicadas en los apartados 15.1 y 15.2 anteriores,
            incluida la OMIC, las autoridades de consumo competentes y, en su caso,
            los órganos de resolución alternativa de litigios disponibles en su
            jurisdicción conforme a la <Lit>Ley 7/2017</Lit>.
          </p>
          <p className="text-xs text-gray-500">
            Información actualizada sobre vías de resolución disponibles en{' '}
            <a
              href="https://consumer-redress.ec.europa.eu/dispute-resolution-bodies"
              target="_blank"
              rel="noopener noreferrer"
              className="text-red-600 underline hover:text-red-700"
            >
              consumer-redress.ec.europa.eu/dispute-resolution-bodies
            </a>
            .
          </p>
        </Subsection>
        <Subsection title="15.4 Sistema arbitral de consumo">
          <p>
            <strong>HIPERA no se encuentra actualmente adherida</strong> al Sistema
            Arbitral de Consumo (Junta Arbitral de Consumo de la Comunidad de Madrid).
            El consumidor conserva, en todo caso, el derecho a presentar sus reclamaciones
            a través de las vías administrativas y judiciales señaladas en los apartados
            anteriores.
          </p>
        </Subsection>
      </Section>

      <Section number="16" title="Disposiciones finales">
        <Subsection title="16.1 Modificación de las condiciones">
          <p>
            HIPERA podrá modificar las presentes condiciones por necesidades comerciales,
            tecnológicas o de adaptación normativa. Los cambios materiales se comunicarán
            con al menos 30 días naturales de antelación a los usuarios registrados y
            requerirán nueva aceptación expresa en el siguiente proceso de compra.
            Los cambios menores (correcciones tipográficas, aclaraciones, actualizaciones
            formales) se aplicarán sin necesidad de re-aceptación.
          </p>
        </Subsection>
        <Subsection title="16.2 Versionado">
          <p>
            El presente documento se identifica mediante una versión de documento
            ({TERMS_DOCUMENT_VERSION}) y una versión de consentimiento (v{TERMS_VERSION}).
            Los cambios mayores en la versión de documento (por ejemplo, paso de 1.x a
            2.0) implican un incremento de la versión de consentimiento y, en
            consecuencia, la necesidad de re-aceptación por parte de los usuarios.
          </p>
        </Subsection>
        <Subsection title="16.3 Independencia de cláusulas">
          <p>
            Si alguna disposición de estas condiciones fuera declarada nula, ilegal o
            inaplicable por una autoridad competente, dicha declaración no afectará a la
            validez del resto de disposiciones, que mantendrán su plena vigencia.
          </p>
        </Subsection>
        <Subsection title="16.4 Cesión">
          <p>
            El cliente no podrá ceder los derechos y obligaciones derivados del contrato
            sin el consentimiento previo y por escrito de HIPERA. HIPERA podrá ceder el
            contrato en supuestos de reestructuración empresarial (fusión, escisión,
            aportación de rama de actividad, etc.) notificándolo al cliente, sin que ello
            altere las condiciones aplicables.
          </p>
        </Subsection>
        <Subsection title="16.5 Idioma">
          <p>
            El idioma oficial del contrato es el castellano. Cualquier traducción a otros
            idiomas tiene carácter meramente informativo; en caso de discrepancia,
            prevalecerá la versión en castellano.
          </p>
        </Subsection>
        <Subsection title="16.6 Vigencia">
          <p>
            Estas condiciones entran en vigor el {TERMS_UPDATED_AT} y permanecen vigentes
            mientras no sean sustituidas por una versión posterior.
          </p>
        </Subsection>
      </Section>

      <DocFooter
        docVersion={TERMS_DOCUMENT_VERSION}
        consentVersion={TERMS_VERSION}
        updatedAt={TERMS_UPDATED_AT}
      />
    </div>
  );
}

// ---------------------------------------------------------------------
// Intro (texto introductorio específico de T&C — el resto de helpers
// se importan desde ./_components y los datos de empresa desde
// ../../config/company)
// ---------------------------------------------------------------------

function Intro() {
  return (
    <p className="text-sm text-gray-700 leading-relaxed">
      Estas Condiciones Generales de Contratación (en adelante, las
      <strong> «Condiciones»</strong>) regulan la relación contractual entre{' '}
      {COMPANY.name} (en adelante, <strong>«HIPERA»</strong>) y las personas físicas o
      jurídicas (en adelante, el <strong>«Cliente»</strong>) que adquieran productos o
      contraten servicios a través del sitio web {COMPANY.website} o en el
      establecimiento físico de HIPERA. La realización de un pedido implica la
      aceptación íntegra de estas Condiciones en su versión vigente.
    </p>
  );
}
