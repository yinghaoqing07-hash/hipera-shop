// =====================================================================
// Política de Envíos — RDLeg 1/2007 (TRLGDCU) + Directiva 2011/83/UE
// =====================================================================
// Este documento es el manual operativo complementario al §7 de los
// Términos y Condiciones de HIPERA. T&C §7 establece la base contractual
// del envío y la entrega; esta Política desarrolla las cuatro promesas
// expresas de T&C §7: zonas de cobertura, plazos estimados, tarifas y
// umbrales de envío gratuito.
//
// Estructura:
//   §1  Objeto y alcance                       [Art. 97 RDLeg 1/2007]
//   §2  Zonas de cobertura y modalidades       [Libertad comercial]
//   §3  Plazos de entrega                      [Art. 66 bis RDLeg 1/2007]
//   §4  Coste de envío y umbrales gratuitos    [Arts. 60.2.e + 97 + Ley 37/1992 IVA]
//   §5  Proceso de envío y seguimiento         [Libertad comercial]
//   §6  Transmisión del riesgo                 [Art. 66 ter RDLeg 1/2007]
//   §7  Incidencias en la entrega              [Cross-ref T&C §7.3]
//   §8  Modificaciones                          [Boilerplate común]
//
// Coherencia obligatoria con:
//   - T&C §7 (envío y entrega) — base contractual; §7.2 transmisión
//     del riesgo (mirror en §6 de esta Política), §7.3 incidencias 48h
//     (mirror en §7), §7.4 recogida en tienda (mirror en §2.1).
//   - Política de Devoluciones §6 (coste de la devolución cuando hay
//     defecto o error de HIPERA — HIPERA asume el envío de retorno).
//   - Política de Privacidad §6 (encargados del tratamiento). Mientras
//     el operador logístico esté redactado de forma genérica
//     ("transportista profesional contratado por HIPERA"), no es
//     necesario actualizar Privacy §6. Si en el futuro se firma un
//     contrato con un operador concreto (MRW, SEUR, Correos, Glovo,
//     etc.), se deberá actualizar Privacy §6 y bumpear PRIVACY_VERSION.
//
// ⚠️ PENDIENTE: La lista exacta de localidades de la zona local
// (Alcalá de Henares, Camarma de Esteruelas, Daganzo de Arriba,
// Azuqueca de Henares) y los plazos operativos estimados (24-72h
// envío a domicilio, 2-4h recogida en tienda) deben ser confirmados
// con los responsables comerciales del establecimiento antes del
// lanzamiento público del sitio. Los plazos comprometidos comercialmente
// son inferiores al máximo legal de 30 días naturales (Art. 66 bis
// RDLeg 1/2007); cualquier incumplimiento genera derecho de resolución
// con reembolso íntegro conforme a §3.4 de esta Política.
//
// Servicios de reparación: no aplican a esta Política — el cliente
// entrega y recoge el dispositivo presencialmente en el establecimiento
// (T&C §10).
// =====================================================================

import {
  SHIPPING_DOCUMENT_VERSION,
  SHIPPING_UPDATED_AT,
  SHIPPING_VERSION,
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

export default function PoliticaEnvios() {
  return (
    <div className="space-y-6 text-gray-700">
      <VersionBanner
        docVersion={SHIPPING_DOCUMENT_VERSION}
        consentVersion={SHIPPING_VERSION}
        updatedAt={SHIPPING_UPDATED_AT}
      />

      <Intro />

      {/* ===================================================== */}
      <Section number="1" title="Objeto y alcance del documento">
        <p>
          La presente <strong>Política de Envíos</strong> desarrolla el procedimiento
          operativo para el envío y la entrega de los productos adquiridos a través
          del sitio web {COMPANY.website}, en cumplimiento de los Arts. 97 y 60.2.e
          del <Lit>Real Decreto Legislativo 1/2007</Lit>, de 16 de noviembre, por el
          que se aprueba el texto refundido de la Ley General para la Defensa de los
          Consumidores y Usuarios (en adelante, <Lit>«RDLeg 1/2007»</Lit>) y de la{' '}
          <Lit>Directiva 2011/83/UE</Lit>.
        </p>
        <p>
          Esta Política es complementaria al apartado §7 de los <strong>Términos y
          Condiciones</strong> de HIPERA, que constituyen la base contractual de la
          relación con el Cliente. En caso de discrepancia entre ambos documentos
          prevalecerá lo dispuesto en los Términos y Condiciones.
        </p>

        <Subsection title="1.1. Productos cubiertos">
          <p>
            Esta Política se aplica a los productos físicos comercializados por HIPERA
            (alimentación, bazar y demás artículos del catálogo) cuando son adquiridos
            a través del sitio web por personas físicas con la condición legal de{' '}
            <strong>consumidor o usuario</strong> conforme al Art. 3 del{' '}
            <Lit>RDLeg 1/2007</Lit>.
          </p>
        </Subsection>

        <Subsection title="1.2. Servicios de reparación">
          <p>
            Los servicios de reparación de dispositivos móviles y otros servicios
            técnicos prestados por HIPERA <strong>no están cubiertos</strong> por esta
            Política, sino que se rigen por el apartado §10 de los Términos y
            Condiciones y por el <Lit>Real Decreto 58/1988</Lit>. Por defecto, la
            entrega y recogida del dispositivo se realiza presencialmente en el
            establecimiento físico. Adicionalmente, dentro de la localidad de Meco,
            el Cliente puede contratar de forma opcional un servicio de{' '}
            <strong>recogida y entrega a domicilio</strong> del dispositivo, cuyas
            condiciones y tarifa se detallan en el apartado §10 de los Términos y
            Condiciones.
          </p>
        </Subsection>

        <Subsection title="1.3. Compras presenciales en tienda">
          <p>
            Las compras realizadas presencialmente en el establecimiento físico de
            HIPERA no son objeto de esta Política, salvo en lo relativo a la modalidad
            de <strong>recogida en tienda</strong> de pedidos efectuados previamente
            por el sitio web (§2.1).
          </p>
        </Subsection>
      </Section>

      {/* ===================================================== */}
      <Section number="2" title="Zonas de cobertura y modalidades de entrega">
        <p>
          HIPERA opera actualmente dos modalidades de entrega para los pedidos
          realizados a través del sitio web: <strong>recogida en tienda</strong> y{' '}
          <strong>envío a domicilio dentro de la zona local de Meco</strong>. Las
          zonas no cubiertas por esta Política se detallan en §2.4.
        </p>

        <Subsection title="2.1. Recogida en tienda (gratuita)">
          <p>
            El Cliente puede optar por recoger su pedido en el establecimiento físico
            de HIPERA, situado en {COMPANY.address}, durante el horario comercial
            ({COMPANY.hours}). Esta modalidad es <strong>siempre gratuita</strong>,
            sin importe mínimo de pedido.
          </p>
          <p>
            Para mayor agilidad, HIPERA notificará al Cliente por correo electrónico
            cuando el pedido esté listo para su recogida. El Cliente deberá presentar
            el número de pedido o un documento identificativo en el momento de la
            recogida.
          </p>
          <p className="text-xs text-gray-500">
            Modalidad recomendada para pedidos urgentes, productos frescos y envíos
            voluminosos.
          </p>
        </Subsection>

        <Subsection title="2.2. Envío a domicilio — zona local">
          <p>
            HIPERA realiza envíos a domicilio dentro de un radio aproximado de
            10&nbsp;km del establecimiento, que comprende el municipio de Meco y las
            siguientes poblaciones limítrofes:
          </p>
          <ul className="list-disc list-inside space-y-1 ml-2">
            <li>Meco (28880)</li>
            <li>Alcalá de Henares (28801–28809)</li>
            <li>Camarma de Esteruelas (28816)</li>
            <li>Daganzo de Arriba (28814)</li>
            <li>Azuqueca de Henares (19200)</li>
            <li>Poblaciones limítrofes próximas a estas localidades</li>
          </ul>
          <p className="text-xs text-gray-500">
            La lista anterior tiene carácter orientativo. HIPERA podrá ampliar o
            ajustar la zona de cobertura, comunicándolo en la versión vigente de
            esta Política. En caso de duda sobre la cobertura de un código postal
            concreto, el Cliente puede consultarlo por correo electrónico a{' '}
            <Email addr={COMPANY.emailGeneral} /> antes de realizar el pedido.
          </p>
        </Subsection>

        <Subsection title="2.3. Modalidad operativa del envío a domicilio">
          <p>
            El envío a domicilio se realiza mediante uno de los siguientes medios,
            según disponibilidad y características del pedido:
          </p>
          <ul className="list-disc list-inside space-y-1 ml-2">
            <li>
              <strong>Entrega propia de HIPERA</strong> — el personal del
              establecimiento realiza la entrega directamente en el domicilio del
              Cliente. Modalidad habitual para entregas dentro del casco urbano de
              Meco y, según disponibilidad, en las poblaciones limítrofes.
            </li>
            <li>
              <strong>Transportista profesional contratado por HIPERA</strong> — para
              determinadas entregas, HIPERA podrá contratar a un operador logístico
              profesional. En este caso, los datos del Cliente estrictamente
              necesarios para la entrega (nombre, dirección, teléfono) se comunicarán
              al operador exclusivamente con dicha finalidad, conforme a la Política
              de Privacidad de HIPERA.
            </li>
          </ul>
        </Subsection>

        <Subsection title="2.4. Zonas no cubiertas">
          <p>
            En la fecha de publicación de esta Política, HIPERA <strong>no realiza
            envíos</strong> a las siguientes zonas:
          </p>
          <ul className="list-disc list-inside space-y-1 ml-2">
            <li>Resto del territorio peninsular fuera de la zona local descrita en §2.2.</li>
            <li>Islas Baleares.</li>
            <li>Islas Canarias.</li>
            <li>Ceuta y Melilla.</li>
            <li>Cualquier destino fuera del territorio español.</li>
          </ul>
          <p className="text-xs text-gray-500">
            HIPERA podrá ampliar progresivamente su zona de cobertura. Las
            ampliaciones se reflejarán en una nueva versión de esta Política, con
            indicación de la fecha de vigencia.
          </p>
        </Subsection>
      </Section>

      {/* ===================================================== */}
      <Section number="3" title="Plazos de entrega">
        <Subsection title="3.1. Plazo legal máximo">
          <p>
            Conforme al Art. 66 <em>bis</em> del <Lit>RDLeg 1/2007</Lit>, salvo pacto
            en contrario, HIPERA entregará los productos al Cliente sin demora indebida
            y, en cualquier caso, en un plazo máximo de <strong>30 días naturales</strong>{' '}
            a contar desde la confirmación del pedido.
          </p>
        </Subsection>

        <Subsection title="3.2. Plazos operativos estimados">
          <p>
            Sin perjuicio del plazo legal máximo del §3.1, HIPERA aplica los siguientes
            plazos operativos estimados:
          </p>
          <div className="overflow-x-auto mt-2">
            <table className="w-full text-xs border border-gray-200 rounded-lg overflow-hidden">
              <thead className="bg-gray-100 text-gray-900">
                <tr>
                  <th className="text-left p-2 border-b border-gray-200 font-semibold">
                    Modalidad
                  </th>
                  <th className="text-left p-2 border-b border-gray-200 font-semibold">
                    Plazo estimado
                  </th>
                  <th className="text-left p-2 border-b border-gray-200 font-semibold">
                    Notas
                  </th>
                </tr>
              </thead>
              <tbody className="text-gray-700">
                <tr>
                  <td className="p-2 border-b border-gray-100 font-medium">
                    Recogida en tienda
                  </td>
                  <td className="p-2 border-b border-gray-100">
                    2–4 horas hábiles
                  </td>
                  <td className="p-2 border-b border-gray-100">
                    Preparación el mismo día para los pedidos confirmados antes de las{' '}
                    <strong>20:00</strong> dentro del horario comercial. Los pedidos
                    confirmados a partir de las <strong>20:00</strong> se preparan al
                    día hábil siguiente; los confirmados antes de la apertura se
                    preparan el mismo día en cuanto la tienda abre.
                  </td>
                </tr>
                <tr>
                  <td className="p-2 font-medium">Envío a domicilio (zona local)</td>
                  <td className="p-2">24–72 horas hábiles</td>
                  <td className="p-2">
                    Tiempo estimado desde la confirmación. Los días no hábiles
                    (domingos y festivos) no computan a estos efectos operativos.
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="text-xs text-gray-500">
            Los plazos estimados de la tabla anterior tienen carácter <strong>
            indicativo</strong> y dependen de factores externos como la disponibilidad
            de stock, la zona de entrega y eventuales incidencias logísticas. En
            cualquier caso, HIPERA se compromete a respetar el plazo legal máximo
            del §3.1.
          </p>
        </Subsection>

        <Subsection title="3.3. Cómputo del plazo">
          <p>
            El plazo de entrega comienza a contar a partir de la{' '}
            <strong>confirmación del pedido</strong> (momento en que HIPERA acepta el
            pedido y se considera perfeccionado el contrato, conforme a T&C §3). Los
            sábados, domingos y festivos no computan a efectos de los plazos
            operativos del §3.2, pero sí a efectos del plazo legal máximo del §3.1
            (que se computa en días naturales).
          </p>
        </Subsection>

        <Subsection title="3.4. Demoras y derechos del Cliente">
          <p>
            Si HIPERA no entregara los productos en el plazo legal máximo de 30 días
            naturales, el Cliente podrá emplazar a HIPERA a entregarlos en un{' '}
            <strong>plazo adicional razonable</strong>. Transcurrido dicho plazo
            adicional sin que la entrega se haya producido, el Cliente tendrá derecho
            a <strong>resolver el contrato</strong>, en cuyo caso HIPERA reembolsará
            sin demora indebida todas las cantidades abonadas (Art. 66 <em>bis</em>.3
            y .4 del <Lit>RDLeg 1/2007</Lit>).
          </p>
          <p>
            Cuando HIPERA prevea una demora respecto a los plazos operativos
            estimados del §3.2, lo comunicará al Cliente con la mayor antelación
            posible por correo electrónico o teléfono, proponiendo la solución más
            adecuada (esperar al nuevo plazo, cambiar el modo de entrega o cancelar
            el pedido).
          </p>
        </Subsection>
      </Section>

      {/* ===================================================== */}
      <Section number="4" title="Coste de envío y umbrales gratuitos">
        <Subsection title="4.1. Tarifa de envío a domicilio">
          <p>
            La tarifa de envío a domicilio dentro de la zona local descrita en §2.2
            es de <strong>4,99 €</strong> por pedido, IVA incluido. Esta tarifa es{' '}
            <strong>única y plana</strong> con independencia del peso, volumen o
            número de productos del pedido, salvo lo previsto en §4.5.
          </p>
        </Subsection>

        <Subsection title="4.2. Recogida en tienda — gratuita">
          <p>
            La modalidad de recogida en tienda descrita en §2.1 es{' '}
            <strong>siempre gratuita</strong>, sin coste alguno para el Cliente y sin
            importe mínimo de pedido.
          </p>
        </Subsection>

        <Subsection title="4.3. Umbral de envío gratuito a domicilio">
          <p>
            Cuando el importe del pedido (subtotal de productos con IVA incluido,
            antes de aplicar los gastos de envío) alcance o supere los{' '}
            <strong>40,00 €</strong>, HIPERA asumirá íntegramente el coste de envío
            a domicilio. Es decir, los <strong>pedidos iguales o superiores a 40 €
            se envían gratis</strong> dentro de la zona local descrita en §2.2.
          </p>
          <p className="text-xs text-gray-500">
            Ejemplo: si el Cliente realiza un pedido por importe de 38 € (en
            productos), pagará 4,99 € de envío (total 42,99 €). Si el pedido es de
            41 € (en productos), el envío es gratuito (total 41 €).
          </p>
        </Subsection>

        <Subsection title="4.4. IVA y desglose">
          <p>
            Todas las tarifas indicadas en esta Política se expresan{' '}
            <strong>con IVA incluido</strong> cuando resulte aplicable. El desglose
            fiscal detallado se reflejará en la factura oficial que se emita, cuando
            proceda, a través del canal de facturación habilitado por HIPERA.
          </p>
        </Subsection>

        <Subsection title="4.5. Productos voluminosos, frágiles o refrigerados">
          <p>
            Dentro de la zona local descrita en §2.2, la tarifa única del §4.1 cubre
            la entrega de productos voluminosos, frágiles o que requieran condiciones
            especiales (refrigerados, congelados) en condiciones razonables. HIPERA
            podrá reservarse el derecho de:
          </p>
          <ul className="list-disc list-inside space-y-1 ml-2">
            <li>
              Aplicar un recargo previamente comunicado y aceptado por el Cliente
              cuando un producto exija medios de transporte especiales no incluidos
              en la operativa habitual.
            </li>
            <li>
              Limitar a la recogida en tienda determinados productos cuya entrega a
              domicilio no sea viable por razones técnicas, sanitarias o de seguridad.
            </li>
          </ul>
          <p className="text-xs text-gray-500">
            Cualquier recargo o limitación se informará al Cliente <strong>antes</strong>{' '}
            de la confirmación del pedido, conforme al Art. 60.2.e del{' '}
            <Lit>RDLeg 1/2007</Lit>. El Cliente puede cancelar el pedido sin coste
            si no acepta el recargo.
          </p>
        </Subsection>
      </Section>

      {/* ===================================================== */}
      <Section number="5" title="Proceso de envío y seguimiento del pedido">
        <Subsection title="5.1. Confirmación del pedido">
          <p>
            Tras completar el proceso de compra, HIPERA enviará al Cliente un correo
            electrónico de <strong>confirmación del pedido</strong> con el resumen
            del contenido, el importe total, la modalidad de entrega seleccionada y
            el plazo operativo estimado. Esta confirmación marca el inicio del
            cómputo de plazos (§3.3).
          </p>
        </Subsection>

        <Subsection title="5.2. Preparación del pedido">
          <p>
            El equipo de HIPERA prepara el pedido en el establecimiento físico,
            verificando la disponibilidad de cada producto, su buen estado y, cuando
            proceda, sus condiciones de conservación (refrigeración, fragilidad). Si
            durante la preparación se detectara que algún producto no está disponible,
            HIPERA contactará con el Cliente para acordar la sustitución por un
            producto equivalente, el reembolso del importe correspondiente o la
            cancelación parcial del pedido.
          </p>
        </Subsection>

        <Subsection title="5.3. Expedición y aviso de salida">
          <p>
            Una vez preparado, el pedido se expide al Cliente conforme a la modalidad
            seleccionada (§2). HIPERA notificará al Cliente, por el medio acordado
            (correo electrónico o teléfono):
          </p>
          <ul className="list-disc list-inside space-y-1 ml-2">
            <li>
              <strong>Recogida en tienda:</strong> aviso de que el pedido está listo
              para ser recogido en el establecimiento.
            </li>
            <li>
              <strong>Envío a domicilio:</strong> aviso de salida del pedido con la
              ventana orientativa de entrega y, cuando proceda, los datos de contacto
              del operador logístico.
            </li>
          </ul>
        </Subsection>

        <Subsection title="5.4. Entrega y comprobante">
          <p>
            En el momento de la entrega, el Cliente o un tercero autorizado por él
            (distinto del transportista) recibirá los productos y firmará el albarán
            de entrega o equivalente. En la modalidad de entrega propia de HIPERA
            (§2.3), el comprobante podrá ser firmado en formato físico o electrónico
            (foto del albarán, recibo digital).
          </p>
          <p>
            En la recogida en tienda, la entrega se realiza contra presentación del
            número de pedido o de un documento identificativo del Cliente o de un
            tercero expresamente autorizado por él.
          </p>
        </Subsection>

        <Subsection title="5.5. Intentos de entrega">
          <p>
            Si en el momento de la entrega a domicilio no se encontrara al Cliente o
            persona autorizada en el domicilio indicado, se procederá de la siguiente
            forma:
          </p>
          <ul className="list-disc list-inside space-y-1 ml-2">
            <li>
              <strong>Primer intento fallido:</strong> el transportista o el personal
              de HIPERA dejará aviso (físico o electrónico) y se acordará con el
              Cliente una segunda fecha de entrega, en un plazo razonable y sin coste
              adicional.
            </li>
            <li>
              <strong>Segundo intento fallido:</strong> el pedido permanecerá en
              custodia del transportista o de HIPERA durante un máximo de 7 días
              naturales adicionales, a la espera de instrucciones del Cliente. HIPERA
              contactará con el Cliente proponiendo recogida en tienda, una tercera
              fecha de entrega o, en su defecto, la resolución del contrato con
              reembolso íntegro previa devolución del pedido al establecimiento.
            </li>
          </ul>
          <p className="text-xs text-gray-500">
            En productos perecederos, la imposibilidad de entrega en plazo razonable
            puede comportar el deterioro del producto. En estos casos HIPERA acordará
            con el Cliente la solución más adecuada (sustitución, reembolso parcial,
            cancelación).
          </p>
        </Subsection>

        <Subsection title="5.6. Recogida en tienda — procedimiento">
          <p>
            La recogida en tienda se realiza durante el horario comercial indicado
            por HIPERA. Conforme al apartado §7.4 de los Términos y Condiciones, si
            transcurridos <strong>7 días naturales</strong> desde el aviso de
            disponibilidad el Cliente no hubiera recogido el pedido ni contestado a
            los avisos, HIPERA contactará nuevamente con el Cliente para acordar una
            solución o, en su defecto, cancelar el pedido reembolsando los productos
            no perecederos.
          </p>
          <p>
            Cuando el pedido esté preparado, HIPERA enviará al Cliente un aviso de
            disponibilidad que incluye un <strong>código de recogida</strong>. Dicho
            código, junto con la indicación del nombre o teléfono asociados al
            pedido, sirve para <strong>acreditar la titularidad</strong> del mismo en
            el mostrador. HIPERA entregará el pedido a quien presente un código de
            recogida válido, pudiendo solicitar adicionalmente un documento
            identificativo cuando lo considere necesario (por ejemplo, en pedidos de
            importe elevado).
          </p>
          <p>
            El código de recogida es <strong>personal y confidencial</strong>. El
            Cliente es responsable de su custodia y de no divulgarlo a terceros. Al
            tratarse de la credencial acordada para la entrega, HIPERA no se hace
            responsable de la entrega del pedido a un tercero que presente un código
            de recogida válido cuando dicho código haya sido divulgado, extraviado o
            sustraído por causas ajenas a HIPERA. Si el Cliente sospecha que su código
            ha sido comprometido, debe comunicarlo a HIPERA lo antes posible y antes
            de la recogida para que se anule y se emita uno nuevo.
          </p>
        </Subsection>
      </Section>

      {/* ===================================================== */}
      <Section number="6" title="Transmisión del riesgo">
        <Subsection title="6.1. Regla general">
          <p>
            Conforme al Art. 66 <em>ter</em>.1 del <Lit>RDLeg 1/2007</Lit>, el riesgo
            de pérdida o deterioro de los productos se transmite al Cliente en el
            momento en que él, o un tercero designado por él (distinto del
            transportista), adquiere la <strong>posesión material</strong> del
            producto. Hasta ese momento, el riesgo corre por cuenta de HIPERA.
          </p>
        </Subsection>

        <Subsection title="6.2. Excepción — transportista elegido por el Cliente">
          <p>
            Si el Cliente encarga el transporte de los productos a un{' '}
            <strong>transportista distinto del ofrecido por HIPERA</strong>, el
            riesgo se transmite en el momento de la entrega de los productos a dicho
            transportista, sin perjuicio de los derechos que asistan al Cliente frente
            al propio transportista (Art. 66 <em>ter</em>.2 del{' '}
            <Lit>RDLeg 1/2007</Lit>).
          </p>
        </Subsection>

        <Subsection title="6.3. Relación con la garantía legal">
          <p>
            La transmisión del riesgo regulada en esta sección{' '}
            <strong>no afecta</strong> a la garantía legal de conformidad del
            producto (Arts. 114 a 127 del <Lit>RDLeg 1/2007</Lit>), cuyo régimen
            completo se describe en el apartado <strong>§9 de los Términos y
            Condiciones</strong> y se resume en el §8 de la Política de Devoluciones.
            Las faltas de conformidad ya existentes en el momento de la entrega son
            responsabilidad de HIPERA, con independencia del momento en que se
            manifiesten dentro de los plazos legales.
          </p>
        </Subsection>
      </Section>

      {/* ===================================================== */}
      <Section number="7" title="Incidencias en la entrega">
        <Subsection title="7.1. Recomendación de inspección">
          <p>
            Se recomienda al Cliente revisar el estado del paquete y de su contenido
            en el momento de la entrega, especialmente cuando ésta se realiza a
            través de un transportista. Aunque <strong>no es una obligación legal</strong>,
            una inspección temprana facilita la gestión de eventuales incidencias
            logísticas frente al operador.
          </p>
        </Subsection>

        <Subsection title="7.2. Daños visibles en el momento de la entrega">
          <p>
            Si el Cliente detecta daños visibles en el embalaje o en el producto en
            el momento de la entrega, se aconseja:
          </p>
          <ul className="list-disc list-inside space-y-1 ml-2">
            <li>
              Anotar la incidencia en el albarán de entrega del transportista{' '}
              <strong>antes de firmar la recepción</strong>.
            </li>
            <li>
              Conservar los embalajes y el producto en el estado en que se reciben,
              al menos hasta la resolución de la incidencia por parte de HIPERA.
            </li>
            <li>
              Comunicarlo a HIPERA cuanto antes mediante{' '}
              <Email addr={COMPANY.emailGeneral} /> con asunto «<strong>Incidencia
              entrega</strong>» o por teléfono al {COMPANY.phone}.
            </li>
          </ul>
        </Subsection>

        <Subsection title="7.3. Daños no aparentes o productos faltantes">
          <p>
            Cuando los daños no sean visibles en el momento de la entrega o existan
            productos faltantes en el envío, se aconseja comunicarlo a HIPERA en un
            plazo orientativo de <strong>48 horas</strong> desde la recepción, a
            través de los canales indicados en §7.2.
          </p>
        </Subsection>

        <Subsection title="7.4. Carácter no vinculante del plazo de 48 horas">
          <p>
            El plazo orientativo de 48 horas previsto en §7.3 tiene{' '}
            <strong>carácter operativo</strong> (gestión interna con el operador
            logístico) y <strong>no limita ni sustituye</strong> los derechos legales
            del Cliente. En particular, no afecta a:
          </p>
          <ul className="list-disc list-inside space-y-1 ml-2">
            <li>
              El plazo de 14 días naturales para el ejercicio del derecho de
              desistimiento (véase Política de Devoluciones §2).
            </li>
            <li>
              El plazo de 3 años (o 2 años para productos de segunda mano) de la
              garantía legal de conformidad (Arts. 114 a 127 del{' '}
              <Lit>RDLeg 1/2007</Lit>; véase T&C §9 y Política de Devoluciones §8).
            </li>
            <li>
              Cualquier otro derecho irrenunciable reconocido al Cliente por la
              normativa de consumo.
            </li>
          </ul>
        </Subsection>

        <Subsection title="7.5. Pérdida o extravío del envío">
          <p>
            Si transcurrido el plazo legal máximo de entrega (§3.1) el pedido no
            hubiera llegado al Cliente y existieran indicios razonables de pérdida o
            extravío durante el transporte, HIPERA iniciará las gestiones oportunas
            con el operador logístico y, en su caso, repondrá el pedido al Cliente
            o reembolsará íntegramente las cantidades abonadas a su elección. La
            pérdida o extravío del envío durante el transporte gestionado por HIPERA
            corre por cuenta de HIPERA conforme al §6.1.
          </p>
        </Subsection>
      </Section>

      {/* ===================================================== */}
      <Section number="8" title="Modificaciones de la Política de Envíos">
        <Subsection title="8.1. Causas de actualización">
          <p>
            HIPERA podrá actualizar la presente Política para incorporar cambios
            normativos, ampliaciones de la zona de cobertura, ajustes en las tarifas
            o en los plazos operativos, contratación de nuevos operadores logísticos
            o cualquier otra mejora derivada de la práctica comercial.
          </p>
        </Subsection>

        <Subsection title="8.2. Comunicación de los cambios">
          <p>
            Los cambios <strong>materiales</strong> que afecten al fondo de los
            derechos del Cliente (p. ej.: incremento de la tarifa, reducción del
            umbral de envío gratuito, modificación significativa de plazos, exclusión
            de zonas previamente cubiertas) se comunicarán mediante aviso visible en
            el sitio web durante un mínimo de 30 días naturales y, en su caso,
            mediante notificación a los usuarios registrados.
          </p>
          <p>
            Los cambios <strong>menores</strong> (correcciones tipográficas,
            ampliación de la lista de localidades cubiertas, ajustes redaccionales
            sin afectar al fondo) se publicarán directamente indicando la nueva
            fecha de vigencia.
          </p>
        </Subsection>

        <Subsection title="8.3. Versionado">
          <p>
            La presente Política se identifica mediante una versión de documento
            ({SHIPPING_DOCUMENT_VERSION}) y una versión de consentimiento
            (v{SHIPPING_VERSION}). Los cambios mayores en la versión de documento
            (por ejemplo, paso de 1.x a 2.0) implican un incremento de la versión
            de consentimiento.
          </p>
        </Subsection>

        <Subsection title="8.4. Coherencia con otros documentos legales">
          <p>
            Esta Política se interpreta de forma coherente con los Términos y
            Condiciones (en particular §6 sobre precios y pago, §7 sobre envío y
            entrega, §9 sobre garantías legales y §10 sobre servicios de
            reparación), con la Política de Devoluciones (especialmente §6 sobre
            coste de la devolución y §9 sobre revisión en la entrega) y con la
            Política de Privacidad. En caso de discrepancia con los Términos y
            Condiciones prevalecerán éstos en su versión vigente.
          </p>
        </Subsection>
      </Section>

      <DocFooter
        docVersion={SHIPPING_DOCUMENT_VERSION}
        consentVersion={SHIPPING_VERSION}
        updatedAt={SHIPPING_UPDATED_AT}
      />
    </div>
  );
}

function Intro() {
  return (
    <p className="text-sm text-gray-700 leading-relaxed">
      La presente <strong>Política de Envíos</strong> describe las zonas de
      cobertura, modalidades de entrega, plazos, tarifas y umbrales de envío
      gratuito aplicables a los pedidos realizados por el <strong>«Cliente»</strong>{' '}
      a {COMPANY.name} (en adelante, <strong>«HIPERA»</strong>) a través de{' '}
      {COMPANY.website}. Constituye el manual operativo complementario al
      apartado §7 de los <strong>Términos y Condiciones</strong>, que conforman
      la base contractual de la relación con el Cliente.
    </p>
  );
}
