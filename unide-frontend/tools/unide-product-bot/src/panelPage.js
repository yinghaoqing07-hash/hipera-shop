// Página del panel: la versión minimalista que la dueña fue puliendo
// (reloj + chat a toda altura + entrada abajo + cajón izquierdo para los
// teclados interactivos + lector derecho para informes largos), recuperada
// tras el experimento de consola multivista, y con lo nuevo integrado:
// tarjeta de tareas programadas y ciclo de actualización robusto.
export function renderPanelPage(version) {
  return `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>JARVIS</title>
<style>
  :root {
    --motion-fast: 180ms;
    --motion-base: 260ms;
    --motion-slow: 360ms;
    --motion-ease: cubic-bezier(.22, 1, .36, 1);
  }
  * { box-sizing: border-box; }
  html, body { height: 100%; }
  body {
    margin: 0; background: #0d1117; color: #c9d4de;
    font-family: Consolas, "Cascadia Mono", "Courier New", "Microsoft YaHei", monospace;
    display: flex; flex-direction: column;
  }
  header {
    display: flex; justify-content: flex-end; align-items: center;
    padding: 14px 26px; font-size: 13px; letter-spacing: .08em; color: #76879a;
    animation: aparecerSuave var(--motion-slow) var(--motion-ease) both;
  }
  #estado { display: flex; gap: 18px; align-items: center; }
  #btnCajon {
    background: none; border: none; color: #8fa2b5;
    padding: 5px 2px; font-size: 12px; letter-spacing: .08em;
    cursor: pointer; font-family: inherit;
  }
  #btnCajon::before { content: '[ '; color: #46556a; }
  #btnCajon::after { content: ' ]'; color: #46556a; }
  #btnCajon:hover { color: #d5ecf8; }
  #punto { width: 8px; height: 8px; border-radius: 50%; background: #22c55e; display: inline-block; margin-right: 7px; vertical-align: 1px; animation: latido 2.4s ease-in-out infinite; }
  #punto.rojo { background: #ef4444; animation: none; }
  /* Paso de escritorio EN VIVO (lo escribe unideges-search.ps1 antes de
     cada paso): vacío = invisible, error en rojo. */
  #vivoEsc {
    margin-left: 16px; color: #a8c3d6;
    max-width: 38vw; overflow: hidden; text-overflow: ellipsis;
    white-space: nowrap; display: inline-block; vertical-align: bottom;
  }
  #vivoEsc:empty { display: none; }
  #vivoEsc::before {
    content: ''; display: inline-block; width: 6px; height: 6px;
    border-radius: 50%; background: #6f9cbd; margin-right: 8px;
    vertical-align: 1px; animation: latido 1.1s ease-in-out infinite;
  }
  #vivoEsc.err { color: #f87171; }
  #vivoEsc.err::before { background: #f87171; animation: none; }
  #vivoEsc.cambio { animation: destelloEstado 520ms var(--motion-ease); }
  @keyframes latido { 0%,100% { opacity: 1; } 50% { opacity: .35; } }
  main {
    flex: 1; display: flex; flex-direction: column; align-items: center;
    padding: 0 24px 24px; min-height: 0;
    animation: subirSuave var(--motion-slow) var(--motion-ease) 70ms both;
  }
  #zona {
    flex: 1; min-height: 0; width: 100%;
    display: grid; grid-template-columns: minmax(280px, 1fr) minmax(0, 980px) minmax(280px, 1fr);
    gap: 18px;
  }
  #centro { grid-column: 2; grid-row: 1; min-width: 0; min-height: 0; display: flex; flex-direction: column; align-items: center; }
  #saludo { font-size: 13px; letter-spacing: .08em; color: #5f7184; margin-bottom: 26px; }
  #linea {
    width: min(980px, 100%); display: flex; align-items: center; gap: 14px;
    border-bottom: 1px solid rgba(168,195,214,.25); padding: 6px 4px 12px;
    transition: border-color .25s; position: relative;
  }
  /* Sugerencias de comandos: al teclear "/" se despliega sobre la línea la
     lista completa de comandos (de GET /comandos) filtrada por lo escrito. */
  #sugerencias {
    display: none; position: absolute; left: 0; right: 0; bottom: calc(100% + 10px);
    max-height: 46vh; overflow-y: auto; z-index: 6;
    background: #10161f; border: 1px solid rgba(168,195,214,.28); border-radius: 2px;
    padding: 6px 0; font-size: 13.5px; line-height: 1.5;
  }
  #sugerencias.abierto { display: block; }
  #sugerencias .cat { padding: 8px 14px 3px; color: #5f7184; font-size: 11px; letter-spacing: .08em; }
  #sugerencias .cmd { padding: 5px 14px; cursor: pointer; color: #aebdcb; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  #sugerencias .cmd b { color: #cfe9f7; font-weight: 500; }
  #sugerencias .cmd:hover, #sugerencias .cmd.activo { background: rgba(255,255,255,.05); color: #e6eef4; }
  #linea:focus-within { border-color: rgba(168,195,214,.75); }
  #linea::before { content: "›"; color: #6f9cbd; font-size: 26px; line-height: 1; }
  #libre {
    flex: 1; background: none; border: none; outline: none; color: #e6eef4;
    font-size: 17px; font-weight: 400; letter-spacing: .02em; caret-color: #6f9cbd;
  }
  #libre::placeholder { color: #53657a; }
  /* Subir archivo: discreto al final de la línea de comandos. */
  #btnSubir {
    background: none; border: none; color: rgba(168,195,214,.4); cursor: pointer;
    font-size: 22px; line-height: 1; padding: 0 2px; font-family: inherit;
  }
  #btnSubir:hover { color: #cfe9f7; }
  .pill {
    background: none; border: none; color: #8fa2b5;
    padding: 7px 4px; font-size: 14.5px; cursor: pointer;
    font-family: inherit; transition: color .2s;
  }
  .pill::before { content: '[ '; color: #465564; }
  .pill::after { content: ' ]'; color: #465564; }
  .pill:hover { color: #e8f0f6; }
  .pill:active { transform: scale(.97); }
  #reloj { margin-top: 12px; font-size: 34px; font-weight: 400; letter-spacing: .06em; color: #eef5fa; line-height: 1; font-variant-numeric: tabular-nums; }
  #reloj span.seg { font-size: 14px; color: #6f9cbd; font-weight: 400; margin-left: 6px; }
  #fecha { margin: 6px 0 22px; font-size: 13px; letter-spacing: .1em; color: #76879a; }
  #tarjetas { display: grid; gap: 2px 18px; grid-template-columns: 1fr 1fr; }
  #tarjetas .tarjeta.ancha { grid-column: 1 / -1; }
  #tarjetas .tarjeta:nth-child(-n+2) { border-top: none; }
  /* 最近动态 al estilo del registro: líneas con hora, pegadas abajo,
     ocupando el hueco libre de la columna (petición del dueño). */
  #ladoDerecho {
    grid-column: 3; grid-row: 1; min-height: 0;
    display: flex; gap: 16px; padding: 0 6px;
  }
  #lector.abierto ~ #ladoDerecho { display: none; }
  #actividadLog {
    flex: 1; min-width: 0; min-height: 0;
    display: flex; flex-direction: column; padding: 6px 0 4px;
  }
  #actividadLog::after { content: ''; flex: none; height: 25px; }
  #tActividad {
    margin-top: auto; overflow: auto; min-height: 0;
    font-size: 13.5px; line-height: 1.75; color: #8fa2b5;
    white-space: pre-wrap; word-break: break-word; user-select: text;
    scrollbar-width: thin; scrollbar-color: rgba(168,195,214,.2) transparent;
  }
  #tActividad .hora { color: #566b80; margin-right: 8px; font-variant-numeric: tabular-nums; }
  #mantenimiento { margin-top: auto; padding-top: 14px; border-top: 1px solid rgba(200,211,220,.12); display: flex; gap: 8px; }
  /* Columna lateral FIJA (petición del dueño): las tarjetas de estado y el
     botón de actualizar viven aquí SIEMPRE, no dentro del 操作台. El cajón,
     al abrirse en la misma columna, la tapa temporalmente. */
  #lateral {
    grid-column: 1; grid-row: 1; min-height: 0; max-width: 520px;
    display: flex; flex-direction: column; overflow-y: auto;
    padding: 4px 6px; scrollbar-width: thin; scrollbar-color: rgba(168,195,214,.2) transparent;
    animation: aparecerSuave var(--motion-slow) var(--motion-ease) both;
  }
  #cajon.abierto ~ #lateral { display: none; }
  #cajonTeclado { display: none; }
  .tarjeta { border-top: 1px solid rgba(200,211,220,.1); padding: 12px 2px 6px; }
  /* 今日/促销 son clicables: lanzan su consulta de solo lectura en el chat. */
  .tarjeta.clicable { cursor: pointer; transition: background .18s; border-radius: 2px; }
  .tarjeta.clicable:hover { background: rgba(255,255,255,.04); }
  .tarjeta.clicable:hover .titulo { color: #a8c3d6; }
  .tarjeta.clicable:active { opacity: .75; }
  .tarjeta .titulo { font-size: 11px; letter-spacing: .08em; color: #5f7184; margin-bottom: 9px; }
  .tarjeta .dato { font-size: 15px; color: #aebdcb; line-height: 1.65; }
  .tarjeta .dato b { color: #cfe9f7; font-weight: 500; }
  .tarjeta .dato .hora { color: #5f7184; font-size: 12px; margin-right: 8px; font-variant-numeric: tabular-nums; }
  /* Tareas diarias: la hora es un input editable con el mismo aspecto que el texto. */
  .tarjeta .dato input.horaAuto { background: none; border: none; border-bottom: 1px dashed rgba(200,211,220,.25); color: #8fa5b8; font: inherit; font-size: 12px; padding: 0; width: 40px; cursor: pointer; font-variant-numeric: tabular-nums; }
  .tarjeta .dato input.horaAuto:hover, .tarjeta .dato input.horaAuto:focus { color: #cfe9f7; outline: none; border-bottom-color: rgba(200,211,220,.55); }
  .tarjeta .dato .filaDiaria { display: flex; align-items: baseline; gap: 7px; }
  .tarjeta .dato .filaDiaria.apagada { opacity: .45; }
  .tarjeta .dato .filaDiaria .etiqueta { flex: 1; min-width: 0; font-size: 13px; }
  .tarjeta .dato .filaDiaria .marca { color: #5f7184; font-size: 11px; margin-left: 4px; }
  #charla {
    /* flex 1: el chat se estira hasta la línea de comando, pegada abajo */
    flex: 1 1 0; min-height: 0; width: min(980px, 100%); overflow-y: auto;
    margin: 8px 0 20px; scrollbar-width: thin;
    scrollbar-color: rgba(168,195,214,.2) transparent;
    -webkit-mask-image: linear-gradient(to bottom, transparent, black 24px);
  }
  .msg { display: flex; margin: 13px 0; transform-origin: left center; }
  .msg.mia { justify-content: flex-end; transform-origin: right center; }
  .msg.entrando { animation: mensajeEntra var(--motion-base) var(--motion-ease) both; }
  .msg.mia.entrando { animation-name: mensajePropioEntra; }
  .msg.saliendo { animation: mensajeSale var(--motion-fast) ease-in both; pointer-events: none; }
  .burbuja {
    max-width: 84%;
    font-size: 15.5px; line-height: 1.75; white-space: pre-wrap; word-break: break-word;
    color: #b4c2cf;
  }
  .mia .burbuja { color: #cfe9f7; text-align: right; }
  /* Notas técnicas (AI 看图, 复盘…): pequeñas y apagadas para que la
     conversación de verdad respire; el texto completo se abre en el lector. */
  .msg.nota { margin: 6px 0; }
  .msg.nota .burbuja {
    font-size: 13px; line-height: 1.55; color: #6e8093;
    border-left: 2px solid rgba(168,195,214,.26); padding-left: 12px;
  }
  .msg.nota .chipLeer { font-size: 11px; padding: 2px 9px; }
  .burbuja.actualizada { animation: burbujaActualizada 460ms var(--motion-ease); }
  .textoMensaje.escribiendo::after {
    content: ''; display: inline-block; width: 1px; height: 1.05em;
    margin-left: 4px; vertical-align: -.12em; background: #6f9cbd;
    animation: cursorEscritura 620ms steps(1, end) infinite;
  }
  @keyframes cursorEscritura {
    0%, 46% { opacity: .95; }
    47%, 100% { opacity: 0; }
  }
  .burbuja.esperando { display: inline-flex; align-items: center; gap: 10px; color: #a8c3d6; }
  .esperandoTexto { font-size: 11px; letter-spacing: .08em; color: #7c91a6; }
  .esperandoPuntos { display: inline-flex; gap: 5px; }
  .esperandoPuntos i {
    width: 5px; height: 5px; border-radius: 50%; background: #6f9cbd;
    animation: puntoPensando 1.05s ease-in-out infinite;
  }
  .esperandoPuntos i:nth-child(2) { animation-delay: 120ms; }
  .esperandoPuntos i:nth-child(3) { animation-delay: 240ms; }
  .burbuja .meta { display: block; font-size: 10.5px; color: #53657a; letter-spacing: .04em; margin-top: 4px; }
  .chipTeclado, .chipLeer {
    display: inline-block; color: #7d94a9; padding: 2px 0; margin-right: 10px;
    font-size: 12.5px; cursor: pointer; letter-spacing: .04em; transition: color .18s;
  }
  .chipTeclado::before, .chipLeer::before { content: '[ '; color: #46556a; }
  .chipTeclado::after, .chipLeer::after { content: ' ]'; color: #46556a; }
  .chipTeclado:hover, .chipLeer:hover { color: #d5ecf8; }
  .chipTeclado:active, .chipLeer:active { opacity: .7; }
  /* --- cajón lateral: donde viven los teclados interactivos --- */
  /* Nada de paneles que se deslizan por encima: el cajón y el lector viven
     en las columnas laterales, que siempre están ahí vacías — el contenido
     aparece en el hueco y el chat no se mueve ni se tapa. */
  #cajon {
    grid-column: 1; grid-row: 1;
    min-height: 0; display: flex; flex-direction: column;
    opacity: 0; visibility: hidden; pointer-events: none;
    transform: translateX(-14px);
    transition: opacity var(--motion-base) var(--motion-ease), transform var(--motion-base) var(--motion-ease), visibility 0s linear var(--motion-base);
  }
  #cajon.abierto {
    opacity: 1; visibility: visible; pointer-events: auto; transform: translateX(0);
    transition-delay: 0s;
  }
  #cajon .contenidoNuevo { animation: contenidoLateral var(--motion-base) var(--motion-ease) both; }
  #cajon .cab {
    display: flex; justify-content: flex-end; align-items: center;
    padding: 0 6px 2px; font-size: 11px; color: #76879a;
  }
  #cajon .cab b { color: #a8c3d6; font-weight: 600; }
  #cajon .cab button {
    background: none; border: none; color: #76879a; font-size: 18px; cursor: pointer; padding: 2px 6px;
  }
  #cajon .cab button:hover { color: #cfe9f7; }
  #cajon .cuerpo { flex: 1; overflow-y: auto; padding: 4px 6px 24px; scrollbar-width: thin; scrollbar-color: rgba(168,195,214,.2) transparent; }
  #cajon .texto { font-size: 15px; color: #b9c8d6; line-height: 1.7; white-space: pre-wrap; margin-bottom: 16px; }
  #cajon img { max-width: 100%; border-radius: 2px; border: 1px solid rgba(200,211,220,.12); margin-bottom: 14px; display: block; }
  #cajon .filaB { display: flex; gap: 8px; margin-bottom: 8px; }
  #cajon .filaB button {
    flex: 1; min-width: 0; background: none; border: 1px solid rgba(200,211,220,.28); color: #c9dcea;
    border-radius: 2px; padding: 13px 10px; font-size: 15.5px; cursor: pointer; transition: all .15s;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  #cajon .filaB button:hover { background: rgba(111,156,189,.16); color: #e2f3fc; }
  #cajon .filaB button:active { transform: scale(.97); }
  #lector {
    grid-column: 3; grid-row: 1; z-index: 5; background: #0d1117;
    min-height: 0; display: flex; flex-direction: column;
    opacity: 0; visibility: hidden; pointer-events: none;
    transform: translateX(14px);
    transition: opacity var(--motion-base) var(--motion-ease), transform var(--motion-base) var(--motion-ease), visibility 0s linear var(--motion-base);
  }
  #lector.abierto {
    opacity: 1; visibility: visible; pointer-events: auto; transform: translateX(0);
    transition-delay: 0s;
  }
  #lector .contenidoNuevo { animation: contenidoLateral var(--motion-base) var(--motion-ease) both; }
  #lector .cab {
    display: flex; justify-content: space-between; align-items: center; gap: 12px;
    padding: 0 6px 2px; font-size: 11px; color: #76879a;
  }
  #lector .cab b { color: #a8c3d6; font-weight: 600; white-space: nowrap; }
  #lectorFoto { padding: 0 6px; }
  #lectorFoto img { max-width: 100%; border-radius: 2px; border: 1px solid rgba(200,211,220,.12); }
  #lector .cab span.titulo { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; text-align: left; letter-spacing: .1em; }
  #lector .cab button { background: none; border: none; color: #76879a; font-size: 18px; cursor: pointer; padding: 2px 6px; }
  #lector .cab button:hover { color: #cfe9f7; }
  #lector pre {
    flex: 1; overflow: auto; margin: 0; padding: 6px 6px 24px;
    font-family: Consolas, "Courier New", monospace; font-size: 13px; line-height: 1.6;
    color: #bdcad7; white-space: pre-wrap; word-break: break-word;
    scrollbar-width: thin; scrollbar-color: rgba(168,195,214,.2) transparent;
  }
  /* Registro en vivo (columna derecha): TODO lo que la automatización va
     haciendo, con hora, sin caja. Texto seleccionable para copiar; la
     flecha de abajo lo pliega. Invisible hasta que exista la primera
     línea; si el lector se abre en esa columna, el registro se aparta. */
  #registro {
    flex: 1.4; min-width: 0; min-height: 0;
    display: flex; flex-direction: column;
  }
  #registro:not(.con) { display: none; }
  #registroLineas {
    margin-top: auto; overflow: auto; padding: 6px 6px 4px; min-height: 0;
    font-family: Consolas, "Courier New", monospace; font-size: 13.5px; line-height: 1.75;
    color: #8fa2b5; white-space: pre-wrap; word-break: break-word;
    user-select: text; scrollbar-width: thin; scrollbar-color: rgba(168,195,214,.2) transparent;
    max-height: 100%; opacity: 1;
    transition: max-height var(--motion-slow) var(--motion-ease), opacity var(--motion-base) ease, padding var(--motion-base) ease;
  }
  /* Caja negra del escritorio: el paso a paso de la última operación de
     UnideGes, ENCIMA del registro y con su misma pinta de log (petición
     del dueño: nada de volcados técnicos en el chat). Sin contenido no
     ocupa nada; a los 15 min de la última operación desaparece sola. */
  #cajaNegraLineas {
    display: none; overflow: auto; padding: 6px 6px 4px; min-height: 0;
    max-height: 45%; flex: none;
    font-family: Consolas, "Courier New", monospace; font-size: 12.5px; line-height: 1.7;
    color: #8fa2b5; white-space: pre-wrap; word-break: break-word;
    user-select: text; scrollbar-width: thin; scrollbar-color: rgba(168,195,214,.2) transparent;
    border-bottom: 1px solid rgba(200,211,220,.12); margin-bottom: 4px;
  }
  #cajaNegraLineas.con { display: block; }
  #cajaNegraLineas .cab { color: #566b80; }
  #cajaNegraLineas .err { color: #f87171; }
  #registroLineas > div { transform-origin: right bottom; }
  #registroLineas > div.lineaNueva { animation: lineaRegistroEntra var(--motion-base) var(--motion-ease) both; }
  #registroLineas .err { color: #f87171; }
  #registroLineas .hora { color: #566b80; margin-right: 8px; }
  #registro.oculto #registroLineas { max-height: 0; opacity: 0; overflow: hidden; padding-top: 0; padding-bottom: 0; }
  #registroBtn {
    background: none; border: none; color: rgba(168,195,214,.4); cursor: pointer;
    font-size: 13px; padding: 2px 0 4px; align-self: center; letter-spacing: .08em;
  }
  #registroBtn:hover { color: #cfe9f7; }
  /* Plegado, la flecha se queda abajo (donde el dueño la espera). */
  #registro.oculto #registroBtn { margin-top: auto; }
  /* Captura que la IA está analizando: aparece con fundido sobre el
     registro de la derecha y se va sola al dejar de estar fresca. */
  #fotoVivo {
    grid-column: 3; grid-row: 1; justify-self: end; width: 58%; min-height: 0; z-index: 2;
    display: flex; flex-direction: column; align-items: stretch; justify-content: flex-start;
    gap: 10px; padding-top: 4px;
    opacity: 0; visibility: hidden; transform: translateY(-8px);
    transition: opacity var(--motion-slow) var(--motion-ease), transform var(--motion-slow) var(--motion-ease), visibility 0s linear var(--motion-slow);
    pointer-events: none;
  }
  #fotoVivo.visible { opacity: 1; visibility: visible; transform: translateY(0); transition-delay: 0s; }
  #fotoVivo img {
    width: 100%; max-height: 56vh; object-fit: contain; border-radius: 2px;
    border: 1px solid rgba(168,195,214,.28); box-shadow: 0 10px 42px rgba(0,0,0,.55);
    background: #0b1220;
  }
  #fotoVivo img { cursor: zoom-in; pointer-events: auto; }
  /* Mientras el modelo analiza, la imagen "late" con un halo — sustituye
     al texto explicativo. Al terminar el halo se apaga y la foto se queda
     un rato antes de fundirse. */
  #fotoVivo img.analizando { animation: brilloAnalisis 1.5s ease-in-out infinite; }
  @keyframes brilloAnalisis {
    0%, 100% { box-shadow: 0 0 0 1px rgba(111,156,189,.25), 0 10px 42px rgba(0,0,0,.55); }
    50% { box-shadow: 0 0 0 2px rgba(111,156,189,.6), 0 0 22px rgba(111,156,189,.35), 0 10px 42px rgba(0,0,0,.55); }
  }
  /* Lupa: cualquier imagen del panel ampliada a pantalla completa. */
  #lupa {
    position: fixed; inset: 0; z-index: 60; background: rgba(4,9,16,.9);
    display: flex; align-items: center; justify-content: center; cursor: zoom-out;
    opacity: 0; visibility: hidden;
    transition: opacity var(--motion-base) ease, visibility 0s linear var(--motion-base);
  }
  #lupa.visible { opacity: 1; visibility: visible; transition-delay: 0s; }
  #lupa img { max-width: 95vw; max-height: 95vh; border-radius: 2px; box-shadow: 0 24px 90px rgba(0,0,0,.75); }
  /* Mientras la foto está arriba, el registro cede SOLO lo que la foto
     ocupa de verdad: el resto de la columna es todo suyo. El alto exacto
     lo pone ajustarRegistroBajoFoto() en línea; este 60% es el arranque
     antes de la primera medición. */
  #registro.tapado #registroLineas { max-height: 60%; }
  /* Media pantalla (la dueña pone UnideGes y JARVIS lado a lado): con tres
     columnas no cabe nada. Dos columnas, el registro cede su sitio y el
     lector se muda a la izquierda. */
  @media (max-width: 1280px) {
    /* Columna lateral SOLO cuando hay algo abierto; si no, el chat centra. */
    #zona { grid-template-columns: 0 minmax(0, 1fr) 0; gap: 0; }
    #zona:has(#cajon.abierto), #zona:has(#lector.abierto) {
      grid-template-columns: minmax(280px, 420px) minmax(0, 1fr) 0; gap: 18px;
    }
    #ladoDerecho { display: none; }
    #fotoVivo { grid-column: 1; justify-self: stretch; width: auto; }
    #lector { grid-column: 1; }
    #reloj { font-size: 54px; }
    #vivoEsc { max-width: 26vw; }
  }
  #aviso {
    position: fixed; left: 50%; bottom: 34px; transform: translate(-50%, 8px);
    color: #a8c3d6; font-size: 13px; letter-spacing: .06em;
    opacity: 0; transition: opacity var(--motion-base) ease, transform var(--motion-base) var(--motion-ease); pointer-events: none;
  }
  #aviso.visible { opacity: .9; transform: translate(-50%, 0); }
  #ver { position: fixed; right: 16px; bottom: 10px; font-size: 10px; letter-spacing: .06em; color: rgba(168,195,214,.45); pointer-events: none; }
  @keyframes aparecerSuave {
    from { opacity: 0; }
    to { opacity: 1; }
  }
  @keyframes subirSuave {
    from { opacity: 0; transform: translateY(8px); }
    to { opacity: 1; transform: translateY(0); }
  }
  @keyframes mensajeEntra {
    from { opacity: 0; transform: translate(-10px, 5px) scale(.985); }
    to { opacity: 1; transform: translate(0, 0) scale(1); }
  }
  @keyframes mensajePropioEntra {
    from { opacity: 0; transform: translate(10px, 5px) scale(.985); }
    to { opacity: 1; transform: translate(0, 0) scale(1); }
  }
  @keyframes mensajeSale {
    to { opacity: 0; transform: translateY(-5px) scale(.98); }
  }
  @keyframes burbujaActualizada {
    0% { opacity: .58; transform: translateY(3px); }
    45% { color: #d8f2ff; }
    100% { opacity: 1; transform: translateY(0); }
  }
  @keyframes puntoPensando {
    0%, 70%, 100% { opacity: .25; transform: translateY(0); }
    35% { opacity: 1; transform: translateY(-3px); }
  }
  @keyframes contenidoLateral {
    from { opacity: 0; transform: translateY(5px); }
    to { opacity: 1; transform: translateY(0); }
  }
  @keyframes lineaRegistroEntra {
    from { opacity: 0; transform: translateY(5px); }
    to { opacity: 1; transform: translateY(0); }
  }
  @keyframes destelloEstado {
    0% { opacity: .35; filter: brightness(.8); }
    45% { opacity: 1; filter: brightness(1.45); }
    100% { opacity: 1; filter: brightness(1); }
  }
</style>
</head>
<body>
<header>
  <span id="estado"><button id="btnCajon" onclick="abrirCajonInicio()">操 作 台</button><span><span id="punto"></span><span id="txtEstado">连接中</span><span id="vivoEsc"></span></span></span>
</header>
<main>
  <div id="zona">
    <div id="cajon">
  <div class="cab"><button onclick="cerrarCajon()" title="关闭">✕</button></div>
  <div class="cuerpo">
    <div id="cajonInicio">
      <div class="titulo" style="color:#5f7184;font-size:12px;">没有进行中的操作面板</div>
    </div>
    <div id="cajonTeclado">
      <div class="texto" id="cajonTexto"></div>
      <div id="cajonFoto"></div>
      <div id="cajonBotones"></div>
    </div>
  </div>
    </div>
    <div id="lateral">
      <div id="tarjetas">
        <div class="tarjeta clicable" onclick="abrirDetalle('hoy')" title="点开看今天到货明细">
          <div class="titulo">今日</div>
          <div class="dato" id="tHoy">—</div>
        </div>
        <div class="tarjeta clicable" onclick="abrirDetalle('promos')" title="点开看全部促销商品">
          <div class="titulo">促销</div>
          <div class="dato" id="tPromo">—</div>
        </div>
        <div class="tarjeta ancha" id="tTareasCard" style="display:none">
          <div class="titulo">定时任务</div>
          <div class="dato" id="tTareas">—</div>
        </div>
      </div>
      <div id="mantenimiento">
        <button class="pill" onclick="admin('update')">更新 BOT</button>
      </div>
    </div>
    <div id="centro">
      <div id="reloj">--:--</div>
      <div id="fecha">&nbsp;</div>
      <div id="saludo"></div>
      <div id="charla"></div>
      <div id="linea">
        <div id="sugerencias"></div>
        <input id="libre" autofocus>
        <button id="btnSubir" title="上传文件（也可以直接拖进窗口）">＋</button>
        <input type="file" id="ficheroSubir" accept=".xlsx,.csv" style="display:none">
      </div>
    </div>
    <div id="lector">
      <div class="cab"><span class="titulo" id="lectorTitulo"></span><button onclick="cerrarLector()" title="关闭">✕</button></div>
      <div id="lectorFoto"></div>
      <pre id="lectorTexto"></pre>
    </div>
    <div id="ladoDerecho">
      <div id="actividadLog">
        <div id="tActividad"></div>
      </div>
      <div id="registro">
        <div id="cajaNegraLineas"></div>
        <div id="registroLineas"></div>
        <button id="registroBtn" onclick="plegarRegistro()" title="收起/展开">︿</button>
      </div>
    </div>
    <div id="fotoVivo">
      <img id="fotoVivoImg" alt="" title="点击放大">
    </div>
  </div>
</main>
<div id="lupa" onclick="cerrarLupa()"><img id="lupaImg" alt=""></div>
<div id="aviso"></div>
<div id="ver">${version}</div>
<script>
const libre = document.getElementById('libre');

// --- sugerencias de comandos al teclear "/" ----------------------------
// La lista sale de GET /comandos (la misma ayuda que /help), parseada una
// vez: líneas 【…】 = categoría, líneas que empiezan por "/" = comando con
// su explicación. Escribir filtra; clic / flechas+Enter / Tab completan.
let comandosLista = null;
let comandosPidiendo = false;
let sugActiva = -1;
const cajaSug = document.getElementById('sugerencias');
async function cargarComandos() {
  if (comandosLista || comandosPidiendo) return;
  comandosPidiendo = true;
  try {
    const texto = await (await fetch('/comandos')).text();
    const lista = [];
    texto.split('\\n').forEach((cruda) => {
      const linea = cruda.trim();
      const cat = linea.match(/^【(.+)】$/);
      if (cat) { lista.push({ cat: cat[1] }); return; }
      if (linea.charAt(0) === '/') lista.push({ cmd: linea.split(/[\\s—]/)[0], linea: linea });
    });
    comandosLista = lista;
    pintarSugerencias();
  } catch { comandosPidiendo = false; }
}
function cerrarSugerencias() { cajaSug.classList.remove('abierto'); sugActiva = -1; }
function pintarSugerencias() {
  const v = libre.value;
  if (v.charAt(0) !== '/') { cerrarSugerencias(); return; }
  if (!comandosLista) { cargarComandos(); return; }
  const buscar = v.slice(1).trim().toLowerCase();
  cajaSug.innerHTML = '';
  let visibles = 0;
  let catPendiente = null;
  // Si algo empieza por lo escrito, solo eso (Tab completa lo esperado);
  // si nada empieza así, búsqueda en el texto (p. ej. "/打印").
  const esPrefijo = (item) => item.cmd.slice(1).toLowerCase().indexOf(buscar) === 0;
  const hayPrefijo = Boolean(buscar) && comandosLista.some((i) => i.cmd && esPrefijo(i));
  comandosLista.forEach((item) => {
    if (item.cat) { catPendiente = item.cat; return; }
    if (buscar && !(hayPrefijo ? esPrefijo(item) : item.linea.toLowerCase().indexOf(buscar) >= 0)) return;
    if (catPendiente) {
      const c = document.createElement('div');
      c.className = 'cat';
      c.textContent = catPendiente;
      cajaSug.appendChild(c);
      catPendiente = null;
    }
    const fila = document.createElement('div');
    fila.className = 'cmd';
    fila.dataset.cmd = item.cmd;
    const b = document.createElement('b');
    b.textContent = item.cmd;
    fila.appendChild(b);
    fila.appendChild(document.createTextNode(item.linea.slice(item.cmd.length)));
    // mousedown y no click: así el input no pierde el foco antes de elegir.
    fila.onmousedown = (e) => { e.preventDefault(); elegirSugerencia(item.cmd); };
    cajaSug.appendChild(fila);
    visibles++;
  });
  sugActiva = -1;
  cajaSug.classList.toggle('abierto', visibles > 0);
  cajaSug.scrollTop = 0;
}
function elegirSugerencia(cmd) {
  libre.value = cmd + ' ';
  libre.focus();
  cerrarSugerencias();
}
libre.addEventListener('input', pintarSugerencias);
libre.addEventListener('focus', pintarSugerencias);
libre.addEventListener('blur', () => setTimeout(cerrarSugerencias, 150));
libre.addEventListener('keydown', (e) => {
  if (cajaSug.classList.contains('abierto')) {
    const filas = cajaSug.querySelectorAll('.cmd');
    if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && filas.length) {
      e.preventDefault();
      sugActiva = (sugActiva + (e.key === 'ArrowDown' ? 1 : -1) + filas.length) % filas.length;
      filas.forEach((f, i) => f.classList.toggle('activo', i === sugActiva));
      filas[sugActiva].scrollIntoView({ block: 'nearest' });
      return;
    }
    if (e.key === 'Tab' && filas.length) {
      e.preventDefault();
      elegirSugerencia(filas[sugActiva >= 0 ? sugActiva : 0].dataset.cmd);
      return;
    }
    if (e.key === 'Enter' && sugActiva >= 0 && filas[sugActiva]) {
      e.preventDefault();
      elegirSugerencia(filas[sugActiva].dataset.cmd);
      return;
    }
    if (e.key === 'Escape') { cerrarSugerencias(); return; }
  }
  if (e.key === 'Enter' && libre.value.trim()) { run(libre.value.trim()); libre.value = ''; cerrarSugerencias(); }
});

// --- chat sincronizado con Telegram: el bot guarda la transcripción y el
// panel la va pidiendo (solo lo nuevo, por seq). Lo tecleado aquí llega a
// Telegram como eco "🖥 …", y lo del móvil aparece aquí solo.
let chatSeq = 0;
let cargaInicial = true;
let pensandoFila = null;
let pensandoTimer = 0;

function relanzarAnimacion(el, clase) {
  if (!el) return;
  el.classList.remove(clase);
  void el.offsetWidth;
  el.classList.add(clase);
}
function animarContenido(el) {
  relanzarAnimacion(el, 'contenidoNuevo');
}
function mostrarPensando() {
  if (pensandoFila) return;
  const caja = document.getElementById('charla');
  const fila = document.createElement('div');
  fila.className = 'msg entrando';
  fila.dataset.transitorio = 'pensando';
  const b = document.createElement('div');
  b.className = 'burbuja esperando';
  const nombre = document.createElement('span');
  nombre.className = 'esperandoTexto';
  nombre.textContent = 'JARVIS';
  const puntos = document.createElement('span');
  puntos.className = 'esperandoPuntos';
  for (let i = 0; i < 3; i++) puntos.appendChild(document.createElement('i'));
  b.appendChild(nombre);
  b.appendChild(puntos);
  fila.appendChild(b);
  caja.appendChild(fila);
  pensandoFila = fila;
  caja.scrollTop = caja.scrollHeight;
  clearTimeout(pensandoTimer);
  pensandoTimer = setTimeout(() => ocultarPensando(), 120000);
}
function ocultarPensando(inmediato = false) {
  clearTimeout(pensandoTimer);
  if (!pensandoFila) return;
  const fila = pensandoFila;
  pensandoFila = null;
  if (inmediato) { fila.remove(); return; }
  fila.classList.remove('entrando');
  fila.classList.add('saliendo');
  setTimeout(() => fila.remove(), 190);
}

const filas = new Map(); // id → elemento .msg (para actualizar botones editados en sitio)
// El panel es sobrio: los emojis de los mensajes (pensados para Telegram)
// se filtran solo en la VISUALIZACION; en Telegram y en el registro siguen.
function sinEmoji(s) {
  return String(s || '').replace(/[\\u{1F000}-\\u{1FAFF}\\u{2600}-\\u{27BF}\\u{2B00}-\\u{2BFF}\\u{2300}-\\u{23FF}\\u{FE0F}\\u{200D}]/gu, '').replace(/  +/g, ' ').replace(/^ +/gm, '').trim();
}
// El CSV de promociones (pensado para Excel) es ilegible en crudo: el lector
// lo convierte en una lista agrupada por promoción, con precio de oferta,
// precio anterior y condiciones. Cualquier otro archivo se muestra tal cual.
function trocearCsv(texto) {
  const tabla = []; let fila = []; let campo = ''; let dentro = false;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (dentro) {
      if (c === '"') { if (texto[i + 1] === '"') { campo += '"'; i++; } else { dentro = false; } }
      else { campo += c; }
    } else if (c === '"') { dentro = true; }
    else if (c === ';') { fila.push(campo); campo = ''; }
    else if (c === '\\n') { fila.push(campo); tabla.push(fila); fila = []; campo = ''; }
    else if (c !== '\\r') { campo += c; }
  }
  if (campo !== '' || fila.length) { fila.push(campo); tabla.push(fila); }
  return tabla;
}
function csvLegible(texto) {
  const tabla = trocearCsv(texto);
  if (tabla.length < 2) return null;
  const cab = tabla[0].map((s) => s.trim().toLowerCase());
  const col = (n) => cab.indexOf(n);
  // CSV del diagnóstico de productos: lista legible, una línea por artículo
  // (nombre → estado; problemas solo si los hay).
  if (col('codigo_entrada') >= 0 && col('resultado') >= 0) {
    const iNomD = col('nombre_entrada'), iRes = col('resultado'), iProb = col('problemas'), iCodD = col('codigo_entrada'), iBloq = col('bloq_venta');
    const L = [];
    let bien = 0;
    for (const f of tabla.slice(1)) {
      if (!f || f.length < 3) continue;
      const nombre = (f[iNomD] || f[iCodD] || '').trim();
      const res = (f[iRes] || '').trim();
      const prob = (iProb >= 0 ? f[iProb] || '' : '').trim();
      const bloq = (iBloq >= 0 ? f[iBloq] || '' : '').trim();
      if (res === 'ok' && !prob) { bien++; continue; }
      L.push('· ' + nombre + '　→ ' + (res === 'error' ? '读取失败' : res) + (prob ? '：' + prob.split('|').map((x) => x.trim()).join('、') : '') + (bloq === 'true' ? '（停卖中）' : ''));
    }
    const cabecera = '共 ' + (tabla.length - 1) + ' 件，正常 ' + bien + ' 件' + (L.length ? '，有问题 ' + L.length + ' 件：' : '。');
    return [cabecera, ''].concat(L.length ? L : ['全部正常，没什么要处理的。']).join('\\n');
  }
  const iCod = col('codigo_promocion');
  const iNom = col('promocion'), iD = col('desde_promocion'), iH = col('hasta_promocion');
  const iArt = col('descripcion_articulo'), iPvp = col('pvp'), iOf = col('oferta'), iTx = col('texto_oferta');
  if (iCod < 0 || iArt < 0) return null;
  const grupos = new Map();
  for (const f of tabla.slice(1)) {
    if (f.length < 6) continue;
    const k = f[iCod] + '|' + (f[iNom] || '');
    if (!grupos.has(k)) grupos.set(k, { nombre: (f[iNom] || f[iCod] || '').trim(), desde: (f[iD] || '').trim(), hasta: (f[iH] || '').trim(), arts: [] });
    grupos.get(k).arts.push(f);
  }
  // Muchas campañas (NOVEDAD/STOCK semanal, sobre todo fruta) llevan el
  // MISMO precio en PVD y PVD Promoción: no hay rebaja, es el precio de la
  // semana. Señalarlo evita leerlo como si fuera un descuento.
  const aNum = (s) => parseFloat(String(s || '').replace(/[^0-9,.]/g, '').replace(',', '.'));
  const L = ['共 ' + grupos.size + ' 个促销活动', ''];
  for (const g of grupos.values()) {
    L.push('◆ ' + g.nombre + (g.desde ? '　（' + g.desde + ' → ' + g.hasta + '）' : ''));
    for (const f of g.arts) {
      let precio = (f[iOf] || '').trim();
      if (precio && precio.indexOf('€') < 0) precio = precio.replace(/(,\\d\\d)0$/, '$1') + ' €';
      const antes = (f[iPvp] || '').trim().replace(/(,\\d\\d)0(\\s*€)/, '$1$2');
      const sinRebaja = antes && Number.isFinite(aNum(precio)) && Math.abs(aNum(precio) - aNum(antes)) < 0.0005;
      L.push('　· ' + (f[iArt] || '').trim() + '　→ ' + precio + (sinRebaja ? '（本周价，无折扣）' : antes ? '（原价 ' + antes + '）' : ''));
      const tx = (f[iTx] || '').trim();
      if (tx && !sinRebaja) L.push('　　' + tx.toLowerCase());
    }
    L.push('');
  }
  return L.join('\\n');
}
function escribirTexto(el, texto) {
  // OJO: nada de prefers-reduced-motion aquí. El PC de la tienda tiene las
  // animaciones de Windows desactivadas y ese respeto tan educado dejaba el
  // panel completamente estático — el dueño QUIERE el movimiento.
  const contenido = String(texto || '');
  if (!contenido) { el.textContent = contenido; return; }
  el.textContent = '';
  el.classList.add('escribiendo');
  const duracion = Math.min(1050, Math.max(260, contenido.length * 13));
  const inicio = performance.now();
  const avanzar = (ahora) => {
    const progreso = Math.min(1, (ahora - inicio) / duracion);
    const visibles = Math.min(contenido.length, Math.max(1, Math.ceil(progreso * contenido.length)));
    el.textContent = contenido.slice(0, visibles);
    if (visibles < contenido.length) requestAnimationFrame(avanzar);
    else el.classList.remove('escribiendo');
  };
  requestAnimationFrame(avanzar);
}
async function abrirDocEnLector(m) {
  try {
    const r = await fetch('/file/' + m.id);
    if (!r.ok) { aviso('文件已不在（可能重启后被清理）'); return; }
    const crudo = await r.text();
    abrirLector(sinEmoji(m.text).slice(0, 40), csvLegible(crudo) || crudo);
  } catch { aviso('连不上 BOT'); }
}
function pintarBurbuja(m, { escribir = false } = {}) {
  const b = document.createElement('div');
  b.className = 'burbuja';
  const cuerpo = document.createElement('div');
  cuerpo.className = 'textoMensaje';
  // Los mensajes de teclado NUNCA enseñan su plantilla en el chat: frase de
  // la IA si llegó (resumen), y si no una fija — las instrucciones completas
  // viven junto a los botones, en la columna izquierda.
  const textoBruto = String(m.text || '');
  const esTeclado = m.buttons && m.buttons.length;
  const tecladoLargo = esTeclado && (textoBruto.length > 30 || textoBruto.split('\\n').length > 1);
  const completo = sinEmoji(m.resumen ? m.resumen : (tecladoLargo ? '操作面板已在左侧打开，按提示点就行。' : textoBruto));
  // Umbral alto a propósito: el chip 展开阅读 salía en casi todo y no
  // aportaba nada — solo recortamos lo REALMENTE largo. Las NOTAS técnicas
  // (AI 看图, 复盘) se pliegan mucho antes: una línea y al lector.
  const esNota = Boolean(m.nota);
  const esLargo = esNota
    ? (completo.length > 180 || completo.split('\\n').length > 3)
    : (completo.length > 700 || completo.split('\\n').length > 12);
  let textoVisible = completo;
  if (esLargo) {
    const lineas = completo.split('\\n').slice(0, esNota ? 1 : 8).join('\\n');
    const tope = esNota ? 90 : 700;
    textoVisible = (lineas.length > tope ? lineas.slice(0, tope) : lineas) + ' …';
  }
  if (escribir) escribirTexto(cuerpo, textoVisible);
  else cuerpo.textContent = textoVisible;
  b.appendChild(cuerpo);
  const chips = document.createElement('div');
  if (esLargo) {
    const chip = document.createElement('span');
    chip.className = 'chipLeer';
    chip.textContent = '展开阅读';
    chip.onclick = () => abrirLector(sinEmoji(m.text).split('\\n')[0].slice(0, 40), sinEmoji(m.text));
    chips.appendChild(chip);
  }
  if (m.doc) {
    // UN solo chip por documento (petición de la dueña): 打开 para lo que el
    // lector sabe enseñar; 下载 únicamente para lo que no (volcados .html
    // para mandar a Claude, zips...).
    const nombreDoc = String(m.docName || '');
    const esLegible = !nombreDoc || /\.(csv|txt|log|json)$/i.test(nombreDoc);
    const chip = document.createElement('span');
    chip.className = 'chipLeer';
    if (esLegible) {
      chip.textContent = '打开';
      chip.onclick = () => abrirDocEnLector(m);
    } else {
      chip.textContent = '下载';
      chip.onclick = () => {
        const a = document.createElement('a');
        a.href = '/file/' + m.id + '?dl=1&s=' + m.seq;
        a.download = nombreDoc || 'archivo';
        document.body.appendChild(a);
        a.click();
        a.remove();
      };
    }
    chips.appendChild(chip);
  }
  if (m.photo && !(m.buttons && m.buttons.length)) {
    // Las capturas no se incrustan en el chat: se abren en el lector. Las de
    // tarjetas con botones ya se ven en el cajón de operaciones.
    const chip = document.createElement('span');
    chip.className = 'chipLeer';
    chip.textContent = '查看截图';
    chip.onclick = () => abrirLector(sinEmoji(m.text).slice(0, 40), '', '/file/' + m.id + '?s=' + m.seq);
    chips.appendChild(chip);
  }
  if (m.buttons && m.buttons.length) {
    // Los teclados NO se pintan en la burbuja: viven en el cajón lateral.
    const chip = document.createElement('span');
    chip.className = 'chipTeclado';
    chip.textContent = '操作台';
    chip.onclick = () => abrirCajon(m.id);
    chips.appendChild(chip);
  }
  if (chips.children.length) b.appendChild(chips);
  const meta = document.createElement('span');
  meta.className = 'meta';
  const t = new Date(m.at);
  meta.textContent = (m.from === 'bot' ? 'JARVIS' : m.from === 'panel' ? '面板' : '你') + ' · ' + String(t.getHours()).padStart(2, '0') + ':' + String(t.getMinutes()).padStart(2, '0');
  b.appendChild(meta);
  return b;
}
// --- lector (cajón derecho para contenido largo) ---------------------------
function abrirLector(titulo, texto, fotoUrl) {
  document.getElementById('lectorTitulo').textContent = titulo || '';
  document.getElementById('lectorTexto').textContent = texto || '';
  const foto = document.getElementById('lectorFoto');
  foto.innerHTML = '';
  if (fotoUrl) {
    const img = document.createElement('img');
    img.src = fotoUrl;
    img.style.cursor = 'zoom-in';
    img.onclick = () => ampliar(fotoUrl);
    foto.appendChild(img);
  }
  document.getElementById('lector').classList.add('abierto');
  animarContenido(document.getElementById('lectorTexto'));
  animarContenido(foto);
}
function cerrarLector() { document.getElementById('lector').classList.remove('abierto'); }

// --- cajón lateral -------------------------------------------------------
const datos = new Map();      // id → último estado del mensaje (para re-render)
const cajonCerrados = new Set(); // teclados que el usuario cerró a mano
let cajonId = null;
function renderCajon(m) {
  document.getElementById('cajonInicio').style.display = 'none';
  document.getElementById('cajonTeclado').style.display = 'block';
  document.getElementById('cajonTexto').textContent = sinEmoji(m.text);
  const foto = document.getElementById('cajonFoto');
  foto.innerHTML = '';
  if (m.photo) {
    const img = document.createElement('img');
    img.src = '/file/' + m.id + '?s=' + m.seq;
    foto.appendChild(img);
  }
  const zona = document.getElementById('cajonBotones');
  zona.innerHTML = '';
  // Los teclados de lista (un boton por fila en Telegram) se reempaquetan a
  // DOS por fila; las filas que ya traen varios botones no se tocan.
  const filas = [];
  let sueltos = [];
  const volcar = () => {
    for (let i = 0; i < sueltos.length; i += 2) filas.push(sueltos.slice(i, i + 2));
    sueltos = [];
  };
  for (const fila of m.buttons || []) {
    if (fila.length === 1) sueltos.push(fila[0]);
    else { volcar(); filas.push(fila); }
  }
  volcar();
  for (const fila of filas) {
    const f = document.createElement('div');
    f.className = 'filaB';
    for (const bot of fila) {
      const btn = document.createElement('button');
      btn.textContent = sinEmoji(bot.t) || bot.t;
      btn.onclick = () => pulsar(bot.d);
      f.appendChild(btn);
    }
    zona.appendChild(f);
  }
  document.getElementById('cajon').classList.add('abierto');
  animarContenido(document.getElementById('cajonTeclado'));
}
function abrirCajon(id) {
  const m = datos.get(id);
  if (!m) return;
  cajonCerrados.delete(id);
  cajonId = id;
  renderCajon(m);
}
function cerrarCajon() {
  if (cajonId != null) cajonCerrados.add(cajonId);
  document.getElementById('cajon').classList.remove('abierto');
}
// Vista por defecto del cajón: los accesos rápidos y las tarjetas de estado
// (antes vivían en el centro de la página; el chat necesitaba el sitio).
function abrirCajonInicio() {
  cajonId = null;
  document.getElementById('cajonTeclado').style.display = 'none';
  document.getElementById('cajonInicio').style.display = 'block';
  document.getElementById('cajon').classList.add('abierto');
  animarContenido(document.getElementById('cajonInicio'));
}

// Mantenimiento desde el panel: actualizar el bot sin tocar ningun script.
// Para apagarlo basta cerrar la ventana (la X): el bot se apaga solo.
// Ciclo de la actualización, con feedback real de principio a fin:
//   1. se marca actualizando y el estado pasa a "正在更新…" (polling rápido)
//   2. el bot cae (fase de instalación) — el estado lo dice, no "离线"
//   3. vuelve: si /status trae otra versión, la página se recarga sola y
//      tras recargar enseña "更新完成"; si vuelve con la MISMA versión,
//      se avisa de que no ha cambiado nada.
let actualizando = 0;   // timestamp del clic, 0 = no estamos actualizando
let vioCaida = false;   // ya pasó por la fase "bot apagado"
let hechoVisto = 0;     // cuándo apareció "hecho:" sin que el bot reiniciara
let caidaDesde = 0;     // desde cuándo lleva el bot sin responder
async function admin(accion) {
  if (!confirm('现在后台更新 BOT？更新期间面板会断开一两分钟，完成后自己恢复。')) return;
  try {
    const r = await (await fetch('/admin', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ accion }) })).json();
    if (r.toast) aviso(r.toast);
    if (accion === 'update') { actualizando = Date.now(); vioCaida = false; hechoVisto = 0; caidaDesde = 0; refrescar(); }
  } catch { aviso('连不上 BOT'); }
}
// La X de la ventana apaga el bot: beacon de despedida al cerrarse la página.
// Una recarga también lo manda, pero la página vuelve al instante y el bot
// cancela el apagado (margen de 3 s en el servidor).
addEventListener('pagehide', () => {
  try { navigator.sendBeacon('/admin', new Blob([JSON.stringify({ accion: 'adios' })], { type: 'application/json' })); } catch { }
});
async function pulsar(data) {
  // Cancelar recoge el cajón al instante, sin esperar la vuelta del bot.
  if (String(data).indexOf('cancel:') === 0) cerrarCajon();
  mostrarPensando();
  try {
    const r = await (await fetch('/callback', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ data }) })).json();
    if (r.toast) aviso(r.toast);
    setTimeout(pollChat, 300);
  } catch { ocultarPensando(); aviso('连不上 BOT'); }
}
function ampliar(src) {
  if (!src) return;
  document.getElementById('lupaImg').src = src;
  document.getElementById('lupa').classList.add('visible');
}
function cerrarLupa() {
  document.getElementById('lupa').classList.remove('visible');
}
addEventListener('keydown', (e) => { if (e.key === 'Escape') cerrarLupa(); });
document.getElementById('fotoVivoImg').onclick = () => ampliar(document.getElementById('fotoVivoImg').src);
// El registro ocupa TODO lo que la foto en vivo deja libre: se mide el alto
// real de la imagen (varía con cada captura) y el resto de la columna es
// del registro — antes un tope fijo del 34% dejaba media columna vacía.
function ajustarRegistroBajoFoto() {
  const reg = document.getElementById('registro');
  const lineas = document.getElementById('registroLineas');
  const fv = document.getElementById('fotoVivo');
  if (!reg || !lineas) return;
  if (!reg.classList.contains('tapado') || !fv || !fv.classList.contains('visible')) {
    lineas.style.maxHeight = '';
    return;
  }
  const img = document.getElementById('fotoVivoImg');
  const alto = reg.clientHeight;
  if (!alto) return;
  const foto = (img && img.clientHeight ? img.clientHeight : Math.round(alto * 0.35)) + 22;
  lineas.style.maxHeight = Math.max(90, alto - foto) + 'px';
}
document.getElementById('fotoVivoImg').addEventListener('load', ajustarRegistroBajoFoto);
window.addEventListener('resize', ajustarRegistroBajoFoto);
function plegarRegistro() {
  const reg = document.getElementById('registro');
  const btn = document.getElementById('registroBtn');
  const oculto = reg.classList.toggle('oculto');
  btn.textContent = oculto ? '﹀' : '︿';
  try { localStorage.setItem('registroPlegado', oculto ? '1' : ''); } catch (e) { }
}
try {
  if (localStorage.getItem('registroPlegado')) {
    document.getElementById('registro').classList.add('oculto');
    document.getElementById('registroBtn').textContent = '﹀';
  }
} catch (e) { }
// Subida de archivos al bot (hoy: el export de /diagnostico_productos).
// Botón ＋ de la línea de comandos o arrastrar el archivo a la ventana.
document.getElementById('btnSubir').onclick = () => document.getElementById('ficheroSubir').click();
document.getElementById('ficheroSubir').addEventListener('change', (e) => {
  const f = e.target.files && e.target.files[0];
  if (f) subirArchivo(f);
  e.target.value = '';
});
addEventListener('dragover', (e) => e.preventDefault());
addEventListener('drop', (e) => {
  e.preventDefault();
  const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
  if (f) subirArchivo(f);
});
async function subirArchivo(f) {
  if (f.size > 30 * 1024 * 1024) { aviso('文件太大（上限 30MB）'); return; }
  mostrarPensando();
  try {
    const r = await (await fetch('/subir', { method: 'POST', headers: { 'x-nombre': encodeURIComponent(f.name) }, body: f })).json();
    aviso(r.toast || (r.ok ? '已上传' : '上传失败'));
    if (!r.ok) ocultarPensando();
    setTimeout(pollChat, 350);
  } catch { ocultarPensando(); aviso('连不上 BOT'); }
}
async function pollChat() {
  try {
    const r = await (await fetch('/chat?since=' + chatSeq)).json();
    // Paso de escritorio en vivo: viaja con este poll (2,5 s) porque el de
    // /status es demasiado lento (15 s) para ver pasos de 1-2 segundos.
    const vivo = document.getElementById('vivoEsc');
    if (vivo) {
      const dl = r.desktopLive;
      let t = '';
      if (dl && dl.line) {
        if (dl.line.indexOf('ERROR') >= 0) { if (dl.ageSec < 120) t = dl.line.slice(0, 110); }
        else if (dl.line.indexOf('listo') >= 0) { if (dl.ageSec < 8) t = dl.line.slice(0, 40); }
        else if (dl.ageSec < 60) t = dl.line.slice(0, 110);
      }
      if (vivo.textContent !== t) {
        vivo.textContent = t;
        if (t) relanzarAnimacion(vivo, 'cambio');
      }
      vivo.classList.toggle('err', t.indexOf('ERROR') >= 0);
    }
    const fv = document.getElementById('fotoVivo');
    if (fv) {
      const ls = r.liveShot;
      const mostrarFoto = Boolean(ls && ls.ageSec < 90);
      const imgVivo = document.getElementById('fotoVivoImg');
      if (mostrarFoto && fv.dataset.at !== String(ls.at)) {
        fv.dataset.at = String(ls.at);
        imgVivo.src = '/vivo-foto?t=' + ls.at;
      }
      fv.classList.toggle('visible', mostrarFoto);
      imgVivo.classList.toggle('analizando', Boolean(mostrarFoto && ls.busy));
      const regTap = document.getElementById('registro');
      if (regTap) regTap.classList.toggle('tapado', mostrarFoto);
      ajustarRegistroBajoFoto();
    }
    const reg = document.getElementById('registro');
    if (reg && Array.isArray(r.liveLog) && r.liveLog.length) {
      reg.classList.add('con');
      const cont = document.getElementById('registroLineas');
      const clave = r.liveLog.length + '|' + r.liveLog[r.liveLog.length - 1].t;
      if (cont && cont.dataset.clave !== clave) {
        cont.dataset.clave = clave;
        const pegado = cont.scrollHeight - cont.scrollTop - cont.clientHeight < 40;
        const clavesAnteriores = new Set(Array.from(cont.children).map((el) => el.dataset.claveLinea).filter(Boolean));
        const habiaLineas = cont.children.length > 0;
        cont.textContent = '';
        for (const e of r.liveLog) {
          const div = document.createElement('div');
          const claveLinea = String(e.t) + '|' + String(e.line);
          div.dataset.claveLinea = claveLinea;
          if (String(e.line).indexOf('ERROR') >= 0) div.classList.add('err');
          if (habiaLineas && !clavesAnteriores.has(claveLinea)) div.classList.add('lineaNueva');
          const hora = document.createElement('span');
          hora.className = 'hora';
          const d = new Date(e.t);
          hora.textContent = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0') + ':' + String(d.getSeconds()).padStart(2, '0');
          div.appendChild(hora);
          div.appendChild(document.createTextNode(String(e.line)));
          cont.appendChild(div);
        }
        if (pegado || !cont.dataset.visto) { cont.scrollTop = cont.scrollHeight; cont.dataset.visto = '1'; }
      }
    }
    // Caja negra del escritorio: encima del registro, misma pinta de log.
    // El bot manda las líneas (en vivo durante la operación y la verdad
    // final al terminar); null = nada reciente y la franja desaparece.
    const cajaCont = document.getElementById('cajaNegraLineas');
    if (cajaCont) {
      const lineasCaja = Array.isArray(r.cajaNegra) ? r.cajaNegra : [];
      const claveCaja = lineasCaja.length + '|' + (lineasCaja[lineasCaja.length - 1] || '');
      if (cajaCont.dataset.clave !== claveCaja) {
        cajaCont.dataset.clave = claveCaja;
        cajaCont.textContent = '';
        for (const l of lineasCaja) {
          const div = document.createElement('div');
          const texto = String(l);
          // Cabeceras y línea de cierre SIEMPRE en tono normal (petición
          // del dueño); rojo solo para pasos con ERROR/OJO de verdad.
          if (texto.charAt(0) === '·' || texto.charAt(0) === '=' || texto.indexOf('RESULT:') >= 0) div.classList.add('cab');
          else if (texto.indexOf('ERROR') >= 0 || texto.indexOf('OJO') >= 0) div.classList.add('err');
          div.appendChild(document.createTextNode(texto));
          cajaCont.appendChild(div);
        }
        cajaCont.scrollTop = cajaCont.scrollHeight;
      }
      cajaCont.classList.toggle('con', lineasCaja.length > 0);
      if (lineasCaja.length && reg) reg.classList.add('con');
    }
    if (r.messages && r.messages.length) {
      const caja = document.getElementById('charla');
      const pegado = caja.scrollHeight - caja.scrollTop - caja.clientHeight < 60;
      let nuevos = false;
      for (const m of r.messages) {
        chatSeq = Math.max(chatSeq, m.seq);
        if (m.from === 'bot') ocultarPensando();
        if (m.cierraCajon) cerrarCajon();
        // Informe recién terminado: se abre solo en el lector.
        if (m.autoAbrir && m.doc && !cargaInicial) abrirDocEnLector(m);
        if (m.buttons && m.buttons.length) {
          datos.set(m.id, m);
          if (!cajonCerrados.has(m.id) && (cajonId == null || m.seq >= (datos.get(cajonId)?.seq || 0) || m.id === cajonId)) {
            cajonId = m.id;
            renderCajon(m);
          } else if (m.id === cajonId) {
            renderCajon(m);
          }
        }
        const previa = filas.get(m.id);
        if (previa) {
          // Entrada editada (teclado del recuento, etc.): refrescar en sitio.
          const vieja = previa.querySelector('.burbuja');
          const nueva = pintarBurbuja(m);
          nueva.classList.add('actualizada');
          previa.replaceChild(nueva, vieja);
          continue;
        }
        const fila = document.createElement('div');
        fila.className = 'msg' + (m.from === 'bot' ? '' : ' mia') + (m.nota ? ' nota' : '') + (!cargaInicial ? ' entrando' : '');
        // Las notas técnicas no se teclean con efecto máquina: entran quietas.
        fila.appendChild(pintarBurbuja(m, { escribir: !cargaInicial && m.from === 'bot' && !m.nota }));
        caja.appendChild(fila);
        filas.set(m.id, fila);
        nuevos = true;
      }
      // Los puntos de "pensando" SIEMPRE al final: el eco del propio mensaje
      // del usuario llega por el poll DESPUÉS de crearse los puntos y los
      // dejaba por encima; appendChild los recoloca debajo.
      if (nuevos && pensandoFila && pensandoFila.parentNode === caja) caja.appendChild(pensandoFila);
      while (caja.children.length > 120) {
        const primero = caja.firstChild;
        for (const [id, el] of filas) if (el === primero) filas.delete(id);
        caja.removeChild(primero);
      }
      caja.classList.add('con');
      if (pegado && nuevos) caja.scrollTop = caja.scrollHeight;
    }
    cargaInicial = false;
  } catch { /* bot apagado: el punto rojo ya lo dice */ }
}
pollChat();
setInterval(pollChat, 2500);
// Tarjetas 今日/促销: el click abre el DETALLE completo en el lector
// (lista de llegada de hoy / todos los articulos en promocion), sin chat.
async function abrirDetalle(que) {
  try {
    const r = await fetch('/detalle?que=' + que);
    if (!r.ok) { aviso('拿不到数据'); return; }
    const d = await r.json();
    if (!d || !d.texto) { aviso('没有数据'); return; }
    abrirLector(d.titulo || '', d.csv ? (csvLegible(d.texto) || d.texto) : d.texto);
  } catch { aviso('连不上 BOT'); }
}
async function run(cmd) {
  if (/^(取消|算了|不要|不用了?|no|cancelar?)$/i.test(String(cmd).trim())) cerrarCajon();
  mostrarPensando();
  try {
    const r = await fetch('/run', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ cmd }) });
    aviso(r.ok ? '已收到' : '发送失败');
    if (!r.ok) ocultarPensando();
    setTimeout(pollChat, 350);
  } catch { ocultarPensando(); aviso('连不上 BOT'); }
}
function aviso(txt) {
  const el = document.getElementById('aviso');
  el.textContent = txt;
  el.classList.add('visible');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('visible'), 2400);
}
const VERSION_PAGINA = '${version}';
let bootVisto = null; // arranque del bot visto en el último /status
async function refrescar() {
  const punto = document.getElementById('punto');
  const txt = document.getElementById('txtEstado');
  try {
    const s = await (await fetch('/status')).json();
    // Versión del servidor distinta de la de esta página = el bot ya corre
    // código nuevo: recargar para estrenar la interfaz nueva. El aviso de
    // "hecho" se enseña tras la recarga (sessionStorage sobrevive a ella).
    if (s.version && VERSION_PAGINA && s.version !== VERSION_PAGINA) {
      try { sessionStorage.setItem('jarvisActualizado', s.version); } catch { }
      location.reload();
      return;
    }
    // El bot se ha REINICIADO (boot nuevo) pero la versión es la misma: la
    // actualización terminó sin traer nada nuevo. Marcador duro — funciona
    // aunque el corte fuera tan corto que ningún poll lo pillara.
    if (actualizando && bootVisto && s.boot && s.boot !== bootVisto) {
      actualizando = 0;
      aviso('更新跑完了，但版本没变 — 可能本来就是最新');
    } else if (actualizando && s.updateLine && s.updateLine.indexOf('ERROR') === 0) {
      // El updater dejó escrito el motivo del fallo: enseñarlo tal cual.
      actualizando = 0;
      aviso('更新失败 — ' + s.updateLine.slice(0, 90));
    } else if (actualizando && s.updateLine && s.updateLine.indexOf('hecho') === 0) {
      // "hecho" pero el bot sigue siendo el MISMO proceso (boot igual):
      // el reinicio no cuajó. Darle medio minuto y avisar con el remedio.
      if (!hechoVisto) hechoVisto = Date.now();
      else if (Date.now() - hechoVisto > 30000) {
        actualizando = 0;
        aviso('装完了但 bot 没重启成 — 跑一下 stop-bot.cmd 再开 panel.cmd');
      }
    } else if (actualizando && Date.now() - actualizando > 300000) {
      actualizando = 0;
      aviso('更新超时 — 看一眼 logs/update-estado.txt 或跑 start-bot.cmd');
    }
    if (s.boot) bootVisto = s.boot;
    caidaDesde = 0;
    punto.classList.remove('rojo');
    const partes = ['在线 ' + s.uptime];
    partes.push('促销 ' + (s.promoCsv || '无'));
    partes.push(s.autoRanToday ? '晨务 已办' : '晨务 —');
    const off = [];
    if (!s.webOrder) off.push('网页');
    if (!s.desktop) off.push('桌面');
    if (!s.llm) off.push('AI');
    if (off.length) partes.push(off.join('/') + ' 关');
    // Mientras se actualiza, la línea real del updater (de su log) es el
    // mejor indicador de por dónde va; si aún no hay, un genérico.
    if (actualizando) partes.unshift('正在更新：' + (s.updateLine || '启动更新器…'));
    txt.textContent = partes.join('　·　');
    pintarTarjetas(s);
  } catch {
    punto.classList.add('rojo');
    if (!caidaDesde) caidaDesde = Date.now();
    if (actualizando) {
      vioCaida = true;
      // La instalación normal tarda segundos; si el bot lleva minutos sin
      // volver, algo se torció — decir la verdad y el remedio.
      txt.textContent = Date.now() - caidaDesde > 180000
        ? '更新后 bot 一直没回来 — 去电脑上双击 panel.cmd 或 start-bot.cmd'
        : '正在更新（安装中，面板马上自己回来）…';
    } else {
      txt.textContent = '离线 — 黑窗口开着吗？';
    }
  }
}
function tic() {
  const d = new Date();
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  document.getElementById('reloj').innerHTML = hh + ':' + mm + '<span class="seg">' + ss + '</span>';
  const dias = ['周日','周一','周二','周三','周四','周五','周六'];
  document.getElementById('fecha').textContent = d.getFullYear() + ' / ' + String(d.getMonth() + 1).padStart(2, '0') + ' / ' + String(d.getDate()).padStart(2, '0') + '　' + dias[d.getDay()];
  const h = d.getHours();
  document.getElementById('saludo').textContent = h < 6 ? '深夜' : h < 12 ? '早上好' : h < 20 ? '下午好' : '晚上好';
}
tic();
setInterval(tic, 1000);
function pintarTarjetas(s) {
  document.getElementById('tHoy').innerHTML =
    '预计到货 <b>' + (s.arrivingToday ?? 0) + '</b> 单<br>晨务 ' + (s.autoRanToday ? '<b>已完成</b>' : '还没跑');
  if (s.promoStats) {
    document.getElementById('tPromo').innerHTML =
      '<b>' + s.promoStats.promos + '</b> 个活动 · <b>' + s.promoStats.items + '</b> 个商品<br>今明到期 <b>' + s.promoStats.endingSoon + '</b> 个' + (s.promoCsv ? '<br>数据：' + s.promoCsv : '');
  } else {
    document.getElementById('tPromo').textContent = '还没有促销数据，点「刷新促销」';
  }
  const tareas = Array.isArray(s.scheduledTasks) ? s.scheduledTasks : [];
  const diarias = Array.isArray(s.autoTareas) ? s.autoTareas : [];
  const tarjetaTareas = document.getElementById('tTareasCard');
  tarjetaTareas.style.display = (diarias.length || tareas.length) ? '' : 'none';
  const contTareas = document.getElementById('tTareas');
  // No repintar mientras se edita una hora: el repintado periódico se
  // comería el campo con el foco.
  if (!contTareas.contains(document.activeElement)) {
  contTareas.innerHTML = '';
  diarias.forEach((t) => contTareas.appendChild(filaDiaria(t)));
  tareas.slice(0, 6).forEach((t) => {
    const fila = document.createElement('div');
    const hora = document.createElement('span');
    hora.className = 'hora';
    const d = new Date(t.runAt);
    hora.textContent = String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0') + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
    const nombre = document.createElement('span');
    nombre.textContent = ' ' + (t.label || t.command || '定时任务') + ' ';
    const quitar = document.createElement('button');
    quitar.textContent = '×';
    quitar.title = '取消任务';
    quitar.style.cssText = 'background:none;border:1px solid rgba(200,211,220,.25);border-radius:6px;color:#8195a7;cursor:pointer;margin-left:6px;padding:0 7px;';
    quitar.onclick = async () => {
      try {
        const r = await (await fetch('/task/cancel', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: t.id }) })).json();
        aviso(r.toast || '已取消');
        refrescar();
      } catch { aviso('连不上 BOT'); }
    };
    fila.append(hora, nombre, quitar);
    contTareas.appendChild(fila);
  });
  }
  const act = (s.activity || []).slice(0, 14).map((a) => {
    const t = new Date(a.at);
    const hh = String(t.getHours()).padStart(2, '0') + ':' + String(t.getMinutes()).padStart(2, '0');
    return '<span class="hora">' + hh + '</span>' + escapar(a.text);
  }).reverse();
  const elAct = document.getElementById('tActividad');
  const htmlAct = act.join('<br>');
  if (elAct.innerHTML !== htmlAct) { elAct.innerHTML = htmlAct; elAct.scrollTop = elAct.scrollHeight; }
}
// Fila de una tarea diaria automática: hora editable (se guarda sola al
// cambiarla), etiqueta y botón 开/关. Los cambios van a POST /auto_tarea y
// se aplican en caliente en el bot.
function filaDiaria(t) {
  const fila = document.createElement('div');
  fila.className = 'filaDiaria' + (t.enabled ? '' : ' apagada');
  const hora = document.createElement('input');
  hora.type = 'text';
  hora.className = 'horaAuto';
  hora.value = t.time || '';
  hora.maxLength = 5;
  hora.title = '每天这个时间自动跑。点击可以改，改成像 07:30 这样，回车或点别处保存';
  hora.onchange = () => { const v = hora.value.trim(); if (v && v !== t.time) mandarAutoTarea(t.id, { time: v }); };
  const etiqueta = document.createElement('span');
  etiqueta.className = 'etiqueta';
  etiqueta.textContent = t.label || t.id;
  etiqueta.title = (t.desc || '') + '\\n每天 ' + (t.time || '?') + ' 自动执行';
  const marca = document.createElement('span');
  marca.className = 'marca';
  marca.textContent = !t.enabled ? '已停用' : (t.hoy ? '今天已跑' : '每天');
  const boton = document.createElement('button');
  boton.textContent = t.enabled ? '关' : '开';
  boton.title = t.enabled ? '停用这个每日任务' : '重新启用这个每日任务';
  boton.style.cssText = 'background:none;border:1px solid rgba(200,211,220,.25);border-radius:2px;color:#8195a7;cursor:pointer;margin-left:6px;padding:0 7px;';
  boton.onclick = () => mandarAutoTarea(t.id, { enabled: !t.enabled });
  fila.append(hora, etiqueta, marca, boton);
  return fila;
}
async function mandarAutoTarea(id, cambios) {
  try {
    const r = await (await fetch('/auto_tarea', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(Object.assign({ id: id }, cambios)) })).json();
    aviso(r.toast || (r.ok ? '已保存' : '没保存上'));
    // Soltar el foco para que el siguiente repintado pueda redibujar la tarjeta.
    try { document.activeElement.blur(); } catch { }
    refrescar();
  } catch { aviso('连不上 BOT'); }
}
function escapar(x) { const d = document.createElement('div'); d.textContent = x; return d.innerHTML; }
refrescar();
// Polling adaptativo: cada 15 s en reposo, cada 3 s mientras se actualiza
// (para pillar el momento en que el bot vuelve con la versión nueva).
(function cicloEstado() {
  setTimeout(async () => { await refrescar(); cicloEstado(); }, actualizando ? 3000 : 15000);
})();
// Aviso post-recarga: la actualización terminó y ESTA página ya es la nueva.
try {
  if (sessionStorage.getItem('jarvisActualizado')) {
    sessionStorage.removeItem('jarvisActualizado');
    aviso('更新完成，现在是 ' + (VERSION_PAGINA || '新版本'));
  }
} catch { }
</script>
</body>
</html>`;
}
