// =====================================================================
// Política de Devoluciones — RDLeg 1/2007 (TRLGDCU) + Directiva 2011/83/UE
// =====================================================================
// Este documento es el manual operativo complementario al §8 de los
// Términos y Condiciones de HIPERA. T&C §8 establece la base contractual
// del derecho de desistimiento; esta Política desarrolla los pasos
// prácticos y aporta el modelo legal de formulario (Anexo B del RDLeg
// 1/2007) al que T&C §8.1 hace remisión expresa.
//
// Estructura:
//   §1  Objeto y alcance                       [Art. 97 RDLeg 1/2007]
//   §2  Plazo de desistimiento                 [Art. 104]
//   §3  Cómo ejercer el desistimiento          [Art. 106.1]
//   §4  Estado del producto                    [Art. 108.2]
//   §5  Plazo y método de reembolso            [Art. 107]
//   §6  Coste de la devolución                 [Art. 108.1]
//   §7  Excepciones legales                    [Art. 103]
//   §8  Productos defectuosos (garantía)       [Arts. 114-127]
//   §9  Revisión en el momento de la entrega   [Cross-ref T&C §7.3]
//   §10 Modelo de formulario (Anexo B)         [Anexo B RDLeg 1/2007]
//   §11 Modificaciones                          [Boilerplate común]
//
// Coherencia obligatoria con:
//   - T&C §7 (entrega), §8 (desistimiento), §9 (garantías legales),
//     §10.5 (garantía comercial de reparación 6 meses)
//   - Política de Privacidad §4 (datos tratados en gestión de
//     devoluciones), §5 (plazos de conservación)
//
// Servicios de reparación: regidos por T&C §10. NO aplica desistimiento
// una vez iniciada la prestación con consentimiento (Art. 103.m).
// =====================================================================

import {
  RETURNS_DOCUMENT_VERSION,
  RETURNS_UPDATED_AT,
  RETURNS_VERSION,
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

export default function PoliticaDevoluciones() {
  return (
    <div className="space-y-6 text-gray-700">
      {/*
        Reglas de impresión específicas de esta Política. Al pulsar el
        botón «Imprimir» en §10, queremos imprimir SOLO el formulario
        del Anexo B (id="anexo-b-form"), no las once secciones completas.

        Iteración 1 (visibility: hidden + position: absolute):
          imprimía sólo el formulario en la página 1, pero la altura del
          documento permanecía intacta → 9 páginas en blanco al final.

        Iteración 2 (este bloque) — usa `display: none` para colapsar
        físicamente el resto del documento fuera del layout. El reto es
        que ocultar todos los descendientes de body también oculta los
        ANCESTROS del formulario (root div, wrappers, Section, ...). La
        solución es declarar visibles los ancestros con `:has()`:

          body :has(#anexo-b-form) → todos los antepasados del form
          #anexo-b-form * (display: revert) → toda la subárbol del form

        Soporte de :has(): Chrome 105+ (2022-08), Safari 15.4+ (2022-03),
        Firefox 121+ (2023-12). En 2026 es baseline.

        El <style> vive en el árbol de la Política, así que al navegar a
        otra página estas reglas se desmontan automáticamente.
      */}
      <style>{`
        @media print {
          @page { margin: 1.5cm; }

          /* 1. Punto de partida: ocultar todo el árbol del body. */
          body * { display: none !important; }

          /* 2. Reabrir los ancestros del formulario (root div, wrappers,
                Section, etc.) y limpiar su estilo decorativo para que
                no contaminen la página impresa con cajas grises,
                bordes redondeados, max-width, padding, etc. */
          body :has(#anexo-b-form) {
            display: block !important;
            background: transparent !important;
            padding: 0 !important;
            margin: 0 !important;
            border: none !important;
            box-shadow: none !important;
            max-width: none !important;
            width: auto !important;
          }

          /* 3. Reactivar la subárbol del formulario con su display
                natural (revert vuelve al UA default por elemento). */
          #anexo-b-form,
          #anexo-b-form * {
            display: revert !important;
          }

          /* 4. Aspecto final del contenedor del formulario impreso. */
          #anexo-b-form {
            display: block !important;
            padding: 1cm !important;
            margin: 0 !important;
            border: 2px solid #000 !important;
            border-radius: 8px !important;
            background: #fff !important;
            max-width: none !important;
            box-shadow: none !important;
          }

          /* 5. Ocultar específicamente el botón «Imprimir» dentro del
                formulario (display: revert lo habría restaurado). */
          #anexo-b-form button { display: none !important; }

          /* 6. Garantizar que body/html colapsan a la altura del
                contenido (sin páginas en blanco al final). */
          html, body {
            height: auto !important;
            overflow: visible !important;
            background: #fff !important;
            margin: 0 !important;
            padding: 0 !important;
          }
        }
      `}</style>

      <VersionBanner
        docVersion={RETURNS_DOCUMENT_VERSION}
        consentVersion={RETURNS_VERSION}
        updatedAt={RETURNS_UPDATED_AT}
      />

      <Intro />

      {/* ===================================================== */}
      <Section number="1" title="Objeto y alcance del documento">
        <p>
          La presente <strong>Política de Devoluciones</strong> desarrolla el
          procedimiento operativo para el ejercicio del derecho de desistimiento
          previsto en el <Lit>Real Decreto Legislativo 1/2007</Lit>, de 16 de noviembre,
          por el que se aprueba el texto refundido de la Ley General para la Defensa
          de los Consumidores y Usuarios (en adelante, <Lit>«RDLeg 1/2007»</Lit>) y en
          la <Lit>Directiva 2011/83/UE</Lit>, sobre los derechos de los consumidores.
        </p>
        <p>
          Esta Política es complementaria al apartado §8 de los <strong>Términos y
          Condiciones</strong> de HIPERA, que constituyen la base contractual de la
          relación con el Cliente. En caso de discrepancia entre ambos documentos
          prevalecerá lo dispuesto en los Términos y Condiciones.
        </p>

        <Subsection title="1.1. Productos y contratos cubiertos">
          <p>
            Esta Política se aplica a las compras de productos físicos realizadas a
            distancia a través del sitio web {COMPANY.website} cuando el comprador
            tenga la condición legal de <strong>consumidor o usuario</strong> conforme
            al Art. 3 del <Lit>RDLeg 1/2007</Lit>.
          </p>
          <p>
            Las compras realizadas presencialmente en el establecimiento físico de
            HIPERA se rigen por la normativa de comercio minorista (<Lit>Ley 7/1996</Lit>)
            y la política comercial específica de la tienda; el derecho de desistimiento
            de 14 días naturales <strong>no es exigible</strong> por ley en compras
            presenciales, sin perjuicio de la garantía legal de conformidad (véase §8).
          </p>
        </Subsection>

        <Subsection title="1.2. Servicios de reparación">
          <p>
            Los servicios de reparación contratados a través de HIPERA se rigen por el
            apartado §10 de los Términos y Condiciones y por el{' '}
            <Lit>Real Decreto 58/1988</Lit>. El derecho de desistimiento no resulta
            aplicable una vez iniciada la prestación del servicio con el consentimiento
            previo del Cliente (Art. 103.m) <Lit>RDLeg 1/2007</Lit>). HIPERA aplica una
            garantía comercial de 6 meses sobre la reparación efectuada, superior al
            mínimo legal de 3 meses establecido en el <Lit>RD 58/1988</Lit>.
          </p>
        </Subsection>
      </Section>

      {/* ===================================================== */}
      <Section number="2" title="Plazo de desistimiento">
        <Subsection title="2.1. Duración del plazo">
          <p>
            El Cliente dispone de un plazo de <strong>14 días naturales</strong> para
            desistir del contrato sin necesidad de justificar su decisión y sin
            penalización alguna (Art. 104 del <Lit>RDLeg 1/2007</Lit>).
          </p>
        </Subsection>

        <Subsection title="2.2. Cómputo del plazo">
          <p>El plazo de 14 días naturales se computa:</p>
          <ul className="list-disc list-inside space-y-1 ml-2">
            <li>
              <strong>Pedidos de un solo producto:</strong> desde la fecha de recepción
              del producto por el Cliente o por un tercero autorizado por él, distinto
              del transportista.
            </li>
            <li>
              <strong>Pedidos de varios productos entregados por separado:</strong>{' '}
              desde la fecha de recepción del <strong>último</strong> producto.
            </li>
            <li>
              <strong>Pedidos con entrega fraccionada</strong> (varias entregas
              previstas para un mismo producto): desde la fecha de recepción del último
              componente.
            </li>
          </ul>
          <p>
            Si el plazo finaliza en día inhábil, se considerará ejercido en plazo si la
            comunicación se realiza al día hábil inmediatamente siguiente.
          </p>
        </Subsection>

        <Subsection title="2.3. Prórroga por falta de información">
          <p>
            En el caso de que HIPERA no hubiera facilitado al Cliente la información
            sobre el derecho de desistimiento exigida por el Art. 97.1.i) del{' '}
            <Lit>RDLeg 1/2007</Lit>, el plazo se prorrogará en <strong>doce meses</strong>{' '}
            a contar desde la finalización del plazo inicial (Art. 105). HIPERA facilita
            esta información en la presente Política, en el resumen pre-contractual y en
            la confirmación del pedido.
          </p>
        </Subsection>
      </Section>

      {/* ===================================================== */}
      <Section number="3" title="Cómo ejercer el desistimiento">
        <p>
          El Cliente puede ejercer su derecho de desistimiento por cualquiera de los
          siguientes medios, todos ellos válidos a efectos del Art. 106.1 del{' '}
          <Lit>RDLeg 1/2007</Lit>:
        </p>

        <Subsection title="3.1. Por correo electrónico">
          <p>
            Enviando un mensaje a <Email addr={COMPANY.emailGeneral} /> con el asunto
            «<strong>Desistimiento</strong>». La indicación del asunto facilita la
            tramitación interna pero <strong>no es requisito de validez</strong>: el
            desistimiento surtirá efecto aunque se omita o se utilice otra fórmula.
          </p>
        </Subsection>

        <Subsection title="3.2. Por correo postal">
          <p>
            Remitiendo una comunicación firmada a la dirección postal de HIPERA:
            {' '}{COMPANY.name}, {COMPANY.address}.
          </p>
        </Subsection>

        <Subsection title="3.3. Mediante el formulario tipo (Anexo B)">
          <p>
            Cumplimentando el formulario legal facilitado en el apartado §10 de la
            presente Política (modelo Anexo B del <Lit>RDLeg 1/2007</Lit>). El
            formulario incluye una versión imprimible mediante el botón «Imprimir»
            disponible en dicho apartado.
          </p>
        </Subsection>

        <Subsection title="3.4. Contenido mínimo recomendado">
          <p>
            Para una tramitación ágil se recomienda que el Cliente indique:
          </p>
          <ul className="list-disc list-inside space-y-1 ml-2">
            <li>Número de pedido o referencia identificable.</li>
            <li>Producto(s) objeto del desistimiento.</li>
            <li>Fecha de recepción del producto.</li>
            <li>Nombre completo y datos de contacto del Cliente.</li>
            <li>Declaración inequívoca de desistir del contrato.</li>
          </ul>
          <p className="text-xs text-gray-500">
            La omisión de alguno de estos datos <strong>no invalida</strong> el
            desistimiento siempre que la comunicación permita identificar
            inequívocamente el contrato del que se desiste.
          </p>
        </Subsection>

        <Subsection title="3.5. Acuse de recibo">
          <p>
            HIPERA confirmará la recepción de la comunicación de desistimiento en un
            plazo orientativo de <strong>24 horas</strong> hábiles desde su recepción
            (lunes a sábado, excluidos festivos). La carga de la prueba del ejercicio
            del derecho de desistimiento dentro de plazo corresponde al Cliente (Art.
            106.4 del <Lit>RDLeg 1/2007</Lit>), por lo que se recomienda conservar el
            justificante de envío (acuse de email, certificado postal, etc.).
          </p>
        </Subsection>
      </Section>

      {/* ===================================================== */}
      <Section number="4" title="Estado en el que devolver el producto">
        <Subsection title="4.1. Criterio legal de uso aceptable">
          <p>
            El producto debe encontrarse en un estado que permita su{' '}
            <strong>examen y prueba normales que el Cliente habría efectuado en un
            establecimiento físico</strong>. El Cliente sólo responde por la disminución
            de valor del producto resultante de una manipulación distinta de la necesaria
            para establecer su naturaleza, características y funcionamiento (Art. 108.2
            del <Lit>RDLeg 1/2007</Lit>).
          </p>
          <p>
            <strong>HIPERA no exige que el producto esté «sin usar».</strong> El Cliente
            tiene derecho a examinar el producto, probarlo y comprobar que cumple con
            sus expectativas, del mismo modo que lo haría en una tienda física.
          </p>
        </Subsection>

        <Subsection title="4.2. Ejemplos prácticos">
          <p>A título orientativo:</p>
          <ul className="list-disc list-inside space-y-1 ml-2">
            <li>
              <strong>Aceptable:</strong> abrir el embalaje, examinar el producto,
              probarlo brevemente para comprobar su funcionamiento y decidir devolverlo.
            </li>
            <li>
              <strong>Aceptable:</strong> probar prendas de ropa o accesorios del mismo
              modo en que lo haría en un probador de una tienda física.
            </li>
            <li>
              <strong>No aceptable:</strong> utilizar el producto de forma intensiva
              durante varios días, ensuciarlo, dañarlo o someterlo a pruebas que excedan
              la mera verificación de su naturaleza y funcionamiento.
            </li>
            <li>
              <strong>No aceptable:</strong> devolver un producto con signos evidentes
              de uso prolongado o desgaste no justificado por una comprobación normal.
            </li>
          </ul>
          <p className="text-xs text-gray-500">
            Cuando el producto presente una disminución de valor imputable a una
            manipulación inadecuada, HIPERA podrá descontar dicha disminución del
            importe a reembolsar, justificándolo de forma motivada al Cliente.
          </p>
        </Subsection>

        <Subsection title="4.3. Embalaje, accesorios y documentación">
          <p>
            Se recomienda conservar el embalaje original siempre que sea posible, así
            como incluir todos los accesorios, manuales y documentación entregados con
            el producto. La <strong>ausencia del embalaje original no impide</strong>{' '}
            por sí sola el ejercicio del desistimiento, pero podrá considerarse a
            efectos de valorar la disminución de valor del producto cuando proceda.
          </p>
        </Subsection>
      </Section>

      {/* ===================================================== */}
      <Section number="5" title="Plazo y método de reembolso">
        <Subsection title="5.1. Plazo de reembolso">
          <p>
            HIPERA reembolsará el importe correspondiente en un plazo máximo de{' '}
            <strong>14 días naturales</strong> a contar desde la fecha en que reciba la
            comunicación de desistimiento del Cliente (Art. 107.1 del{' '}
            <Lit>RDLeg 1/2007</Lit>).
          </p>
        </Subsection>

        <Subsection title="5.2. Retención del reembolso">
          <p>
            HIPERA podrá retener el reembolso hasta haber recibido el producto, o hasta
            que el Cliente haya presentado prueba fehaciente de su devolución (p. ej.,
            justificante de envío con número de seguimiento), según qué condición se
            cumpla primero (Art. 107.2 del <Lit>RDLeg 1/2007</Lit>).
          </p>
        </Subsection>

        <Subsection title="5.3. Método de reembolso">
          <p>
            El reembolso se efectuará utilizando el <strong>mismo medio de pago</strong>{' '}
            empleado por el Cliente en la transacción original, salvo que el Cliente
            haya dispuesto expresamente otra cosa y siempre que dicho reembolso no le
            suponga ningún gasto adicional (Art. 107.1 del <Lit>RDLeg 1/2007</Lit>).
          </p>
        </Subsection>

        <Subsection title="5.4. Importe reembolsado y gastos de envío">
          <p>
            HIPERA reembolsará la totalidad de los pagos recibidos del Cliente,
            incluidos los gastos de envío <strong>estándar</strong> aplicados al pedido
            inicial. Conforme al Art. 107.3 del <Lit>RDLeg 1/2007</Lit>, en el supuesto
            de que el Cliente hubiera elegido expresamente una modalidad de entrega{' '}
            <strong>diferente y más cara</strong> que la entrega ordinaria ofrecida por
            HIPERA, el sobrecoste de dicha modalidad <strong>no será reembolsable</strong>.
          </p>
          <p className="text-xs text-gray-500">
            Ejemplo: si el envío estándar son 4,99 € y el Cliente eligió «envío urgente»
            por 9,99 €, HIPERA reembolsará el precio del producto más 4,99 € (importe
            del envío estándar). Los 5 € adicionales correspondientes al upgrade no
            son reembolsables.
          </p>
        </Subsection>
      </Section>

      {/* ===================================================== */}
      <Section number="6" title="Coste de la devolución">
        <Subsection title="6.1. Desistimiento libre del Cliente">
          <p>
            Cuando el Cliente ejerce libremente el derecho de desistimiento (sin que el
            producto sea defectuoso ni exista error imputable a HIPERA), el{' '}
            <strong>coste directo de devolver el producto corresponde al Cliente</strong>{' '}
            (Art. 108.1 del <Lit>RDLeg 1/2007</Lit>).
          </p>
        </Subsection>

        <Subsection title="6.2. Defecto, error o no conformidad imputables a HIPERA">
          <p>
            Cuando el motivo de la devolución sea cualquiera de los siguientes, HIPERA{' '}
            <strong>asume íntegramente</strong> el coste de la devolución (recogida y/o
            transporte):
          </p>
          <ul className="list-disc list-inside space-y-1 ml-2">
            <li>El producto recibido no se corresponde con el solicitado.</li>
            <li>El producto presenta defectos de fabricación o falta de conformidad.</li>
            <li>El producto ha sufrido daños imputables al transporte gestionado por HIPERA.</li>
            <li>Error de HIPERA en la composición, cantidad o etiquetado del envío.</li>
          </ul>
        </Subsection>

        <Subsection title="6.3. Modalidades de devolución">
          <p>El Cliente dispone de dos modalidades alternativas:</p>
          <ul className="list-disc list-inside space-y-1 ml-2">
            <li>
              <strong>Devolución en tienda física:</strong> el Cliente entrega el
              producto presencialmente en el establecimiento de {COMPANY.address}, sin
              coste de transporte. Modalidad recomendada cuando sea geográficamente
              viable.
            </li>
            <li>
              <strong>Devolución por transportista:</strong> el Cliente envía el
              producto al domicilio social de HIPERA por el operador de su elección. El
              coste corre a cargo del Cliente en los supuestos del §6.1 y a cargo de
              HIPERA en los supuestos del §6.2.
            </li>
          </ul>
          <p className="text-xs text-gray-500">
            En los supuestos del §6.2, el Cliente puede solicitar a HIPERA la gestión
            directa de la recogida sin coste, indicándolo en la comunicación de
            devolución.
          </p>
        </Subsection>
      </Section>

      {/* ===================================================== */}
      <Section number="7" title="Excepciones legales al derecho de desistimiento">
        <p>
          Conforme al Art. 103 del <Lit>RDLeg 1/2007</Lit>, el derecho de desistimiento{' '}
          <strong>no resulta aplicable</strong> a los siguientes contratos:
        </p>
        <ul className="list-disc list-inside space-y-2 ml-2">
          <li>
            <strong>Productos personalizados</strong> — productos confeccionados
            conforme a las especificaciones del consumidor o claramente personalizados.
            <span className="block text-xs text-gray-500 mt-1">
              Ejemplo: artículos con grabado, personalización por encargo o
              configuración específica solicitada por el Cliente.
            </span>
          </li>
          <li>
            <strong>Productos perecederos</strong> — productos que puedan deteriorarse
            o caducar con rapidez.
            <span className="block text-xs text-gray-500 mt-1">
              Ejemplo: alimentación fresca, productos refrigerados, panadería diaria,
              fruta y verdura.
            </span>
          </li>
          <li>
            <strong>Productos precintados de higiene o salud, una vez abiertos</strong>{' '}
            — productos precintados que no sean aptos para ser devueltos por razones
            de protección de la salud o de higiene, cuando hayan sido desprecintados
            tras la entrega.
            <span className="block text-xs text-gray-500 mt-1">
              Ejemplo: productos de cuidado personal, parafarmacia, cosmética íntima.
            </span>
          </li>
          <li>
            <strong>Grabaciones audio/vídeo o software precintados, una vez
            desprecintados</strong> — grabaciones sonoras o de vídeo precintadas o
            programas informáticos precintados que hayan sido desprecintados por el
            Cliente tras la entrega.
          </li>
          <li>
            <strong>Prensa diaria</strong> — entrega de prensa diaria, publicaciones
            periódicas o revistas, con la excepción de los contratos de suscripción
            para su entrega periódica.
          </li>
          <li>
            <strong>Servicios de reparación ya iniciados</strong> — contratos de
            prestación de servicios cuya ejecución haya comenzado con el consentimiento
            expreso del Cliente antes de la finalización del plazo de desistimiento
            (Art. 103.m).
            <span className="block text-xs text-gray-500 mt-1">
              Aplicable a los servicios de reparación de dispositivos móviles
              contratados con HIPERA (véase T&C §10).
            </span>
          </li>
          <li>
            <strong>Servicios completamente ejecutados</strong> — contratos de
            prestación de servicios completamente ejecutados antes de finalizar el
            plazo de desistimiento, cuando la ejecución haya comenzado con el
            consentimiento previo expreso del Cliente y con su reconocimiento de que,
            una vez completado el contrato por HIPERA, habrá perdido el derecho de
            desistimiento.
          </li>
        </ul>
        <p className="text-xs text-gray-500">
          La concurrencia de alguna de estas excepciones <strong>no priva al Cliente</strong>{' '}
          de la garantía legal de conformidad (véase §8) ni de los demás derechos
          irrenunciables reconocidos por la normativa de consumo.
        </p>
      </Section>

      {/* ===================================================== */}
      <Section number="8" title="Productos defectuosos o no conformes (garantía legal)">
        <Subsection title="8.1. Distinción clave: desistimiento ≠ garantía">
          <p>
            El derecho de desistimiento (apartados §2 a §7 de esta Política) y la
            garantía legal de conformidad son dos instituciones jurídicas{' '}
            <strong>independientes</strong>. El Cliente puede ejercitar la que mejor se
            adapte a su situación:
          </p>
          <div className="overflow-x-auto mt-2">
            <table className="w-full text-xs border border-gray-200 rounded-lg overflow-hidden">
              <thead className="bg-gray-100 text-gray-900">
                <tr>
                  <th className="text-left p-2 border-b border-gray-200 font-semibold">Criterio</th>
                  <th className="text-left p-2 border-b border-gray-200 font-semibold">Desistimiento</th>
                  <th className="text-left p-2 border-b border-gray-200 font-semibold">Garantía legal</th>
                </tr>
              </thead>
              <tbody className="text-gray-700">
                <tr>
                  <td className="p-2 border-b border-gray-100 font-medium">Motivo</td>
                  <td className="p-2 border-b border-gray-100">Libre, sin necesidad de justificar</td>
                  <td className="p-2 border-b border-gray-100">Producto defectuoso o no conforme</td>
                </tr>
                <tr>
                  <td className="p-2 border-b border-gray-100 font-medium">Plazo</td>
                  <td className="p-2 border-b border-gray-100">14 días naturales</td>
                  <td className="p-2 border-b border-gray-100">3 años (nuevo) / 2 años (segunda mano)</td>
                </tr>
                <tr>
                  <td className="p-2 border-b border-gray-100 font-medium">Coste devolución</td>
                  <td className="p-2 border-b border-gray-100">A cargo del Cliente</td>
                  <td className="p-2 border-b border-gray-100">A cargo de HIPERA</td>
                </tr>
                <tr>
                  <td className="p-2 font-medium">Remedio</td>
                  <td className="p-2">Reembolso íntegro</td>
                  <td className="p-2">Reparación / sustitución / rebaja / resolución</td>
                </tr>
              </tbody>
            </table>
          </div>
        </Subsection>

        <Subsection title="8.2. Garantía legal de conformidad">
          <p>
            Conforme a los Arts. 114 a 127 del <Lit>RDLeg 1/2007</Lit>, HIPERA responde
            ante el Cliente de cualquier falta de conformidad existente en el momento
            de la entrega del producto que se manifieste en los siguientes plazos:
          </p>
          <ul className="list-disc list-inside space-y-1 ml-2">
            <li>
              <strong>3 años</strong> desde la entrega para productos nuevos.
            </li>
            <li>
              <strong>2 años</strong> desde la entrega para productos de segunda mano.
            </li>
          </ul>
          <p>
            En estos supuestos, el Cliente podrá optar entre exigir la{' '}
            <strong>conformidad</strong> del producto mediante reparación o
            sustitución, o solicitar una <strong>reducción del precio</strong> o la{' '}
            <strong>resolución del contrato</strong>, en los términos y condiciones
            previstos en el Capítulo III del Título IV del Libro II del{' '}
            <Lit>RDLeg 1/2007</Lit>.
          </p>
          <p>
            El detalle completo de la garantía legal —incluidos los requisitos de
            notificación, los plazos de respuesta de HIPERA y la garantía comercial
            adicional aplicable a determinados productos y servicios— se encuentra en
            el apartado <strong>§9 de los Términos y Condiciones</strong>.
          </p>
        </Subsection>

        <Subsection title="8.3. Procedimiento ante un producto defectuoso">
          <p>Si el Cliente detecta una falta de conformidad debe:</p>
          <ol className="list-decimal list-inside space-y-1 ml-2">
            <li>
              Comunicarlo a HIPERA mediante correo electrónico a{' '}
              <Email addr={COMPANY.emailGeneral} /> (asunto: «<strong>Garantía</strong>»)
              o por teléfono al {COMPANY.phone}, aportando número de pedido, descripción
              del defecto y, si es posible, fotografías.
            </li>
            <li>
              Conservar el producto en el estado en que se encuentra hasta que HIPERA
              indique las instrucciones de devolución, reparación o sustitución.
            </li>
            <li>
              HIPERA acusará recibo y comunicará la solución propuesta (reparación,
              sustitución, rebaja o resolución, según el caso y la opción elegida por el
              Cliente).
            </li>
            <li>
              El coste de la devolución, transporte y, en su caso, la reparación o
              sustitución del producto corresponde íntegramente a HIPERA.
            </li>
          </ol>
        </Subsection>
      </Section>

      {/* ===================================================== */}
      <Section number="9" title="Revisión en el momento de la entrega">
        <Subsection title="9.1. Recomendación de inspección">
          <p>
            Se recomienda al Cliente revisar el estado del paquete y de su contenido en
            el momento de la entrega, especialmente cuando ésta se realiza a través de
            un transportista. Aunque <strong>no es una obligación legal</strong>, una
            inspección temprana facilita la gestión de eventuales incidencias logísticas.
          </p>
        </Subsection>

        <Subsection title="9.2. Incidencias visibles en la entrega">
          <p>
            Si el Cliente detecta daños visibles en el embalaje o en el producto en el
            momento de la entrega, se aconseja:
          </p>
          <ul className="list-disc list-inside space-y-1 ml-2">
            <li>
              Anotar la incidencia en el albarán de entrega del transportista{' '}
              <strong>antes de firmar la recepción</strong>.
            </li>
            <li>
              Comunicarlo a HIPERA en el plazo orientativo de <strong>48 horas</strong>{' '}
              a través de <Email addr={COMPANY.emailGeneral} /> con asunto «Incidencia
              entrega» o por teléfono al {COMPANY.phone}.
            </li>
          </ul>
        </Subsection>

        <Subsection title="9.3. Carácter no vinculante del plazo de 48 horas">
          <p>
            El plazo orientativo de 48 horas tiene <strong>carácter operativo</strong>{' '}
            (gestión interna con el operador logístico) y <strong>no limita ni
            sustituye</strong> los derechos legales del Cliente. En particular, no afecta a:
          </p>
          <ul className="list-disc list-inside space-y-1 ml-2">
            <li>
              El plazo de 14 días naturales para el ejercicio del derecho de
              desistimiento (apartados §2 a §6).
            </li>
            <li>
              El plazo de 3 años (o 2 años para productos de segunda mano) de la
              garantía legal de conformidad (§8).
            </li>
            <li>
              Cualquier otro derecho irrenunciable reconocido al Cliente por la
              normativa de consumo.
            </li>
          </ul>
        </Subsection>
      </Section>

      {/* ===================================================== */}
      <Section number="10" title="Modelo de formulario de desistimiento (Anexo B)">
        <p>
          A continuación se reproduce el modelo de formulario de desistimiento del{' '}
          <strong>Anexo B del <Lit>RDLeg 1/2007</Lit></strong>. Su uso es{' '}
          <strong>opcional</strong>: el Cliente puede ejercer el desistimiento por
          cualquiera de los medios descritos en el §3 sin necesidad de utilizar este
          formulario concreto.
        </p>
        <p className="text-xs text-gray-500">
          Para utilizar este formulario, imprima esta sección mediante el botón
          «Imprimir», cumpliméntelo a mano y envíelo a la dirección postal o de correo
          electrónico de HIPERA indicadas en el §3.
        </p>

        <div
          id="anexo-b-form"
          className="border-2 border-gray-300 rounded-xl p-5 bg-white print:border-black print:bg-white print:p-4 mt-3"
        >
          <div className="flex justify-between items-start mb-4">
            <h3 className="text-base print:text-lg font-bold text-gray-900">
              Formulario de desistimiento — Anexo B RDLeg 1/2007
            </h3>
            <button
              type="button"
              onClick={() => window.print()}
              className="text-xs bg-gray-900 text-white px-3 py-1.5 rounded-lg hover:bg-gray-700 transition-colors print:hidden"
            >
              Imprimir
            </button>
          </div>

          <p className="text-xs text-gray-500 mb-4 italic">
            (sólo debe cumplimentar y enviar el presente formulario si desea desistir
            del contrato)
          </p>

          <div className="space-y-4 text-sm text-gray-900">
            <div>
              <p className="font-medium mb-1">A la atención de:</p>
              <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 text-xs">
                <p>{COMPANY.name} («HIPERA»)</p>
                <p>NIF: {COMPANY.nif}</p>
                <p>{COMPANY.address}</p>
                <p>Correo electrónico: {COMPANY.emailGeneral}</p>
                <p>Teléfono: {COMPANY.phone}</p>
              </div>
            </div>

            <p className="leading-relaxed">
              Por la presente le comunico/comunicamos <em>(*)</em> que desisto de
              mi/desistimos de nuestro <em>(*)</em> contrato de venta del siguiente
              bien/prestación del siguiente servicio <em>(*)</em>:
            </p>
            <FormLine height="h-10" />
            <FormLine height="h-10" />

            <div>
              <p className="font-medium">Pedido el / recibido el <em>(*)</em>:</p>
              <FormLine height="h-8" />
            </div>

            <div>
              <p className="font-medium">
                Nombre del consumidor y usuario o de los consumidores y usuarios:
              </p>
              <FormLine height="h-8" />
            </div>

            <div>
              <p className="font-medium">
                Domicilio del consumidor y usuario o de los consumidores y usuarios:
              </p>
              <FormLine height="h-8" />
              <FormLine height="h-8" />
            </div>

            <div>
              <p className="font-medium">
                Firma del consumidor y usuario o de los consumidores y usuarios{' '}
                <span className="text-xs text-gray-500 font-normal">
                  (sólo si el presente formulario se presenta en papel)
                </span>
                :
              </p>
              <FormLine height="h-12" />
            </div>

            <div>
              <p className="font-medium">Fecha:</p>
              <FormLine height="h-8" />
            </div>

            <p className="text-xs text-gray-500 italic pt-3 border-t border-gray-200">
              <em>(*) Táchese lo que no proceda.</em>
            </p>
          </div>
        </div>
      </Section>

      {/* ===================================================== */}
      <Section number="11" title="Modificaciones de la Política de Devoluciones">
        <Subsection title="11.1. Causas de actualización">
          <p>
            HIPERA podrá actualizar la presente Política para incorporar cambios
            normativos, mejoras operativas o aclaraciones derivadas de la práctica.
            Cualquier modificación se publicará en el sitio web indicando la nueva
            fecha de vigencia.
          </p>
        </Subsection>

        <Subsection title="11.2. Comunicación de los cambios">
          <p>
            Los cambios <strong>materiales</strong> que afecten al fondo de los
            derechos del consumidor (p. ej.: modificación de plazos, nuevos supuestos
            de excepción, nuevos costes asociados a la devolución) se comunicarán
            mediante aviso visible en el sitio web durante un mínimo de 30 días
            naturales y, en su caso, mediante notificación a los usuarios registrados.
          </p>
          <p>
            Los cambios <strong>menores</strong> (correcciones tipográficas, ejemplos
            actualizados, mejoras de redacción sin afectar al fondo) se publicarán
            directamente indicando la nueva fecha de vigencia.
          </p>
        </Subsection>

        <Subsection title="11.3. Versionado">
          <p>
            La presente Política se identifica mediante una versión de documento
            ({RETURNS_DOCUMENT_VERSION}) y una versión de consentimiento
            (v{RETURNS_VERSION}). Los cambios mayores en la versión de documento (por
            ejemplo, paso de 1.x a 2.0) implican un incremento de la versión de
            consentimiento.
          </p>
        </Subsection>

        <Subsection title="11.4. Coherencia con otros documentos legales">
          <p>
            Esta Política se interpreta de forma coherente con los Términos y
            Condiciones (en particular §7 sobre entrega, §8 sobre desistimiento, §9
            sobre garantías legales y §10 sobre servicios de reparación) y con la
            Política de Privacidad. En caso de discrepancia con los Términos y
            Condiciones prevalecerán éstos en su versión vigente.
          </p>
        </Subsection>
      </Section>

      <DocFooter
        docVersion={RETURNS_DOCUMENT_VERSION}
        consentVersion={RETURNS_VERSION}
        updatedAt={RETURNS_UPDATED_AT}
      />
    </div>
  );
}

function Intro() {
  return (
    <p className="text-sm text-gray-700 leading-relaxed">
      La presente <strong>Política de Devoluciones</strong> describe el procedimiento
      operativo para que el <strong>«Cliente»</strong> ejercite su derecho de
      desistimiento y los derechos derivados de la garantía legal de conformidad en
      las compras realizadas a {COMPANY.name} (en adelante,{' '}
      <strong>«HIPERA»</strong>) a través de {COMPANY.website}. Constituye el manual
      operativo complementario al apartado §8 de los <strong>Términos y
      Condiciones</strong>, que conforman la base contractual de la relación con el
      Cliente.
    </p>
  );
}

/**
 * Línea inferior para que el usuario escriba a mano sobre el formulario
 * impreso del Anexo B. En pantalla se ve como un campo en blanco; al
 * imprimir, el borde se refuerza en negro para mejor legibilidad.
 */
function FormLine({ height = 'h-8' }) {
  return (
    <div
      className={`${height} border-b border-gray-400 print:border-black mt-1`}
    />
  );
}
