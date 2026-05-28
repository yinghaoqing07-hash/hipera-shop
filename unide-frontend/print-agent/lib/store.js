// =====================================================================
// store.js — registro local de pedidos ya impresos (antiduplicado #2)
// =====================================================================
// El antiduplicado principal es printed_at en el servidor. Este registro
// local es la SEGUNDA barrera: cubre el caso en que la impresion tuvo
// exito pero el marcado en el servidor falló (p. ej. caída de red justo
// despues). Asi, aunque el pedido vuelva a aparecer en /pending, el
// agente sabe que YA lo imprimio y solo reintenta el marcado, sin sacar
// un ticket duplicado.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.resolve(__dirname, '..', 'printed.json');
const MAX_IDS = 1000; // conservamos los ultimos N para no crecer sin fin

export class PrintedStore {
  constructor() {
    this.ids = [];
    this.set = new Set();
    this._load();
  }

  _load() {
    try {
      if (fs.existsSync(FILE)) {
        const arr = JSON.parse(fs.readFileSync(FILE, 'utf8'));
        if (Array.isArray(arr)) {
          this.ids = arr.slice(-MAX_IDS);
          this.set = new Set(this.ids);
        }
      }
    } catch {
      // Archivo corrupto: empezamos limpio (el servidor sigue siendo la
      // fuente de verdad principal, asi que no es critico).
      this.ids = [];
      this.set = new Set();
    }
  }

  has(id) { return this.set.has(id); }

  add(id) {
    if (this.set.has(id)) return;
    this.set.add(id);
    this.ids.push(id);
    if (this.ids.length > MAX_IDS) {
      const removed = this.ids.splice(0, this.ids.length - MAX_IDS);
      for (const r of removed) this.set.delete(r);
    }
    this._save();
  }

  _save() {
    try {
      fs.writeFileSync(FILE, JSON.stringify(this.ids));
    } catch {
      // Si no se puede persistir, seguimos: el servidor evita duplicados.
    }
  }
}
