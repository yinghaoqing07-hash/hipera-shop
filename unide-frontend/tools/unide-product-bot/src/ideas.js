import path from 'node:path';
import { readJsonSafe, writeJsonAtomic } from './safeJson.js';

// Cuaderno de ideas del dueño (23/07): "quiero poder crear una función
// cuando se me ocurra algo y guardar el prompt del cambio". Cada idea es
// un texto libre con fecha; se acumulan y con /ideas_exportar salen como
// UN documento listo para reenviar a Claude, que es el flujo real de
// trabajo de esta tienda (idea → prompt guardado → se lo pasa a Claude →
// versión nueva). El bot NO ejecuta las ideas: solo las guarda.

const TOPE_IDEAS = 300;
const TOPE_TEXTO = 2000;

export class IdeaStore {
  constructor(config, logger) {
    this.file = path.resolve(config.logsDir || '.', 'ideas.json');
    this.logger = logger;
    const data = readJsonSafe(this.file, null) || { seq: 0, ideas: [] };
    this.seq = Number(data.seq) || 0;
    this.ideas = Array.isArray(data.ideas) ? data.ideas : [];
  }

  guardar() {
    try {
      writeJsonAtomic(this.file, { seq: this.seq, ideas: this.ideas });
    } catch (error) {
      this.logger?.warn('ideas no se pudieron guardar', { error: error.message });
    }
  }

  agregar(texto) {
    const limpio = String(texto || '').trim().slice(0, TOPE_TEXTO);
    if (!limpio) return null;
    this.seq += 1;
    const idea = { id: this.seq, texto: limpio, creado: new Date().toISOString(), estado: 'pendiente' };
    this.ideas.push(idea);
    if (this.ideas.length > TOPE_IDEAS) this.ideas = this.ideas.slice(-TOPE_IDEAS);
    this.guardar();
    return idea;
  }

  pendientes() {
    return this.ideas.filter((i) => i.estado === 'pendiente');
  }

  hechas() {
    return this.ideas.filter((i) => i.estado === 'hecha');
  }

  buscar(id) {
    return this.ideas.find((i) => i.id === Number(id)) || null;
  }

  marcarHecha(id) {
    const idea = this.buscar(id);
    if (!idea || idea.estado !== 'pendiente') return null;
    idea.estado = 'hecha';
    idea.hecha = new Date().toISOString();
    this.guardar();
    return idea;
  }

  borrar(id) {
    const idea = this.buscar(id);
    if (!idea) return null;
    this.ideas = this.ideas.filter((i) => i.id !== idea.id);
    this.guardar();
    return idea;
  }

  // Documento para reenviar a Claude: las pendientes numeradas, con fecha,
  // en texto plano. El encabezado ya viene redactado como petición.
  exportarTexto() {
    const pend = this.pendientes();
    if (!pend.length) return '';
    const lineas = [
      '老板攒的功能想法（从 Jarvis 想法本导出，按顺序做就行）：',
      ''
    ];
    for (let i = 0; i < pend.length; i += 1) {
      const fecha = String(pend[i].creado).slice(0, 10);
      lineas.push(`${i + 1}. [#${pend[i].id} · ${fecha}]`, pend[i].texto, '');
    }
    return lineas.join('\n');
  }
}

// '/idea 文字' → agregar; '/ideas' → listar; '/ideas_exportar' → exportar.
// null si no es un comando del cuaderno.
export function parseIdeaCommand(text) {
  const t = String(text || '').trim();
  let m;
  if ((m = t.match(/^\/ideas_exportar(?:@\w+)?\s*$/i))) return { accion: 'exportar' };
  if ((m = t.match(/^\/ideas(?:@\w+)?\s*$/i))) return { accion: 'listar' };
  if ((m = t.match(/^\/idea(?:@\w+)?(?:\s+([\s\S]+))?$/i))) return { accion: 'agregar', texto: (m[1] || '').trim() };
  return null;
}

// Frases naturales: 「记个想法：...」「我有个想法...」「存个点子...」.
// Devuelve el TEXTO de la idea ('' si la frase es solo el arranque) o null
// si la frase no habla de ideas. Se comprueba ANTES del enrutador LLM.
export function matchIdeaNatural(text) {
  const t = String(text || '').trim();
  let m;
  if ((m = t.match(/^(?:帮我)?(?:记|存|加)(?:个|一个|一下|条|一条)?(?:想法|点子|功能想法|新功能|需求)[：:，,、\s]*([\s\S]*)$/))) return m[1].trim();
  if ((m = t.match(/^我(?:有|想到)(?:了)?(?:个|一个)?(?:想法|点子|新功能|功能)[：:，,、\s]*([\s\S]*)$/))) return m[1].trim();
  return null;
}

export function formatIdeaList(store) {
  const pend = store.pendientes();
  const hechas = store.hechas().length;
  if (!pend.length) {
    return hechas
      ? `想法本是空的（已完成 ${hechas} 条）。想到什么就发「/idea 内容」或者直接说「记个想法：…」。`
      : '想法本还是空的。想到什么就发「/idea 内容」或者直接说「记个想法：…」。';
  }
  const lineas = [`💡 想法本 · ${pend.length} 条待做${hechas ? `（另有 ${hechas} 条已完成）` : ''}`, ''];
  for (const idea of pend) {
    const fecha = String(idea.creado).slice(5, 10).replace('-', '/');
    lineas.push(`#${idea.id} · ${fecha}`, idea.texto.length > 200 ? idea.texto.slice(0, 200) + '…' : idea.texto, '');
  }
  lineas.push('攒够了按「📤 导出发给 Claude」，一个文件全带走。');
  return lineas.join('\n');
}
