// =====================================================================
// Helpers y catálogos del panel de administración (sin JSX ni estado).
// Extraídos de Admin.jsx para poder testearlos y reutilizarlos.
// =====================================================================
export const AVAILABLE_ICONS = ["Package", "Apple", "Coffee", "Utensils", "Baby", "Home", "Gift"];

// Motivos de reembolso más habituales (se pueden editar/ampliar en el modal).
export const REFUND_REASONS = [
  "Producto agotado sin stock",
  "Producto en mal estado o caducado",
  "Error en el pedido",
  "No podemos entregar a tiempo",
  "A petición del cliente",
];

export const COMPANY_DATA = {
  name: "QIANG GUO SL",
  address: "Paseo del Sol 1, 28880 Meco",
  nif: "B86126638",
  phone: "+34 918 782 602",
};

export const TAX_RATE_OPTIONS = [
  { value: '', label: 'Pendiente' },
  { value: '4', label: '4% · Superreducido' },
  { value: '10', label: '10% · Reducido' },
  { value: '21', label: '21% · General' },
];

export const TAX_CATEGORY_OPTIONS = [
  { value: '', label: 'Sin clasificar' },
  { value: 'food_basic', label: 'Alimento básico · 4%' },
  { value: 'food_general', label: 'Alimento general · 10%' },
  { value: 'water', label: 'Agua · 10%' },
  { value: 'alcohol', label: 'Alcohol · 21%' },
  { value: 'sugary_drink', label: 'Bebida azucarada/edulcorada · 21%' },
  { value: 'hygiene', label: 'Higiene/cosmética · revisar' },
  { value: 'cleaning', label: 'Limpieza/hogar · 21%' },
  { value: 'electronics', label: 'Electrónica/accesorios · 21%' },
  { value: 'repair_service', label: 'Servicio reparación · 21%' },
  { value: 'other_21', label: 'Otros · 21%' },
  { value: 'ask_gestor', label: 'Consultar gestor' },
];

export const TAX_REVIEW_STATUS_OPTIONS = [
  { value: 'pending', label: 'Pendiente' },
  { value: 'needs_review', label: 'Revisar' },
  { value: 'ask_gestor', label: 'Preguntar gestor' },
  { value: 'reviewed', label: 'Confirmado' },
];

export const TAX_SUGGESTION_BATCH_LABELS = {
  '01_pos_exact_high': '01 POS exacto',
  '02_alcohol_21': '02 Alcohol 21%',
  '03_nonfood_clear_21': '03 No alimentación 21%',
  '04_nonfood_or_drinks_21_review': '04 Bebidas/droguería 21%',
  '05_pos_candidates_same_iva': '05 POS mismo IVA',
  '06_general_food_10_review': '06 Alimentación 10%',
  '07_basic_food_4_review': '07 Básicos 4%',
  '08_low_confidence_hint': '08 Baja confianza',
  '09_no_reliable_suggestion': '09 Sin sugerencia',
};

export const CSV_IMPORT_FIELDS = [
  'name', 'short_name', 'price', 'stock', 'image', 'category', 'sub_category_id', 'description',
  'tax_rate', 'tax_category', 'tax_review_status', 'tax_note',
  'image_needs_optimization', 'oferta', 'oferta_type', 'oferta_value', 'gift_product', 'visible',
];
export const CSV_HEADER_ALIASES = {
  name: ['name', 'nombre', 'nombre del producto', 'producto'],
  short_name: ['short_name', 'short name', 'nombre corto', 'nombre_corto', 'display_name', 'display name', 'titulo corto', 'título corto'],
  price: ['price', 'precio', 'precio €'],
  stock: ['stock', 'cantidad', 'cant'],
  image: ['image', 'imagen', 'img', 'url', 'foto'],
  category: ['category', 'categoria', 'categoría', 'categoria_id'],
  sub_category_id: ['sub_category_id', 'subcategory_id', 'subcategoria', 'sub_category', 'subcategoría'],
  description: ['description', 'descripcion', 'descripción', 'desc'],
  tax_rate: ['tax_rate', 'iva', 'iva_rate', 'tipo_iva', 'tipo iva', 'vat', 'vat_rate'],
  tax_category: ['tax_category', 'categoria_iva', 'categoría iva', 'iva_category', 'categoria fiscal'],
  tax_review_status: ['tax_review_status', 'estado_iva', 'iva_status', 'revision_iva', 'revisión iva'],
  tax_note: ['tax_note', 'nota_iva', 'iva_note', 'nota fiscal'],
  image_needs_optimization: ['image_needs_optimization', 'foto_revisar', 'foto optimizar', 'imagen_revisar', 'image_review'],
  oferta: ['oferta', 'offer', 'promo', 'en_oferta'],
  oferta_type: ['oferta_type', 'oferta type', 'tipo oferta', 'tipo_oferta'],
  oferta_value: ['oferta_value', 'oferta value', 'valor', 'valor_oferta'],
  gift_product: ['gift_product', 'gift product', 'regalo', 'gift', 'producto regalo'],
  visible: ['visible', 'mostrar', 'show', 'en_tienda', 'visible_en_tienda'],
};

export function normalizeTaxRate(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(String(value).replace(',', '.'));
  return [4, 10, 21].includes(n) ? n : null;
}

export function normalizeTaxStatus(value) {
  const raw = String(value || '').trim().toLowerCase();
  const aliases = {
    pendiente: 'pending',
    pending: 'pending',
    revisar: 'needs_review',
    needs_review: 'needs_review',
    revision: 'needs_review',
    revisión: 'needs_review',
    gestor: 'ask_gestor',
    ask_gestor: 'ask_gestor',
    consultar_gestor: 'ask_gestor',
    confirmado: 'reviewed',
    confirmada: 'reviewed',
    reviewed: 'reviewed',
    revisado: 'reviewed',
    revisada: 'reviewed',
  };
  const v = aliases[raw] || String(value || '').trim();
  return TAX_REVIEW_STATUS_OPTIONS.some((o) => o.value === v) ? v : 'pending';
}

export function normalizeProductForState(product, fallbackImages = null) {
  const images = fallbackImages || product.images || (product.image ? [product.image] : []);
  const hasImageReviewField = Object.prototype.hasOwnProperty.call(product || {}, 'image_needs_optimization');
  return {
    ...product,
    ofertaType: product.oferta_type,
    ofertaValue: product.oferta_value,
    subCategoryId: product.sub_category_id,
    images,
    image: images[0] || product.image || '',
    giftProduct: product.gift_product || false,
    shortName: product.short_name || product.shortName || '',
    taxRate: product.tax_rate ?? '',
    taxCategory: product.tax_category || '',
    taxReviewStatus: product.tax_review_status || 'pending',
    taxNote: product.tax_note || '',
    imageNeedsOptimization: Boolean(product.image_needs_optimization),
    hasImageReviewField,
  };
}

export function taxStatusLabel(value) {
  return TAX_REVIEW_STATUS_OPTIONS.find((o) => o.value === value)?.label || 'Pendiente';
}

export function taxRateLabel(product) {
  const rate = product?.taxRate ?? product?.tax_rate;
  return rate === null || rate === undefined || rate === '' ? 'IVA pendiente' : `IVA ${rate}%`;
}

export function taxStatusClass(value) {
  // Paleta sobria: solo "revisado" lleva un acento (verde tenue); el resto
  // de estados se muestran en gris neutro para no recargar la vista.
  if (value === 'reviewed') return 'bg-green-50 text-green-700 border-green-200';
  return 'bg-gray-100 text-gray-600 border-gray-200';
}

export function isProductReviewed(product) {
  const hasTaxRate = product?.taxRate !== '' && product?.taxRate !== null && product?.taxRate !== undefined
    || product?.tax_rate !== '' && product?.tax_rate !== null && product?.tax_rate !== undefined;
  return hasTaxRate && (product?.taxReviewStatus || product?.tax_review_status) === 'reviewed';
}

export function productNeedsReview(product) {
  return !isProductReviewed(product);
}

export function productHasImageReviewField(product) {
  return !!product?.hasImageReviewField || Object.prototype.hasOwnProperty.call(product || {}, 'image_needs_optimization');
}

export function productDisplayName(product) {
  return (product?.shortName || product?.short_name || product?.name || '').trim();
}

export function adminTabFromPath(pathname) {
  if (pathname === '/admin/caja/monedas') return 'coins';
  return 'dashboard';
}


export function resolveTaxCategoryFromSuggestion(suggestion) {
  const raw = suggestion?.suggested_tax_category || '';
  if (TAX_CATEGORY_OPTIONS.some((o) => o.value === raw)) return raw;
  const batchId = suggestion?.batch_id || '';
  const rate = String(suggestion?.suggested_tax_rate || '');
  if (batchId.includes('alcohol')) return 'alcohol';
  if (batchId.includes('drinks') || raw === 'sugary_drink') return 'sugary_drink';
  if (raw === 'cleaning') return 'cleaning';
  if (raw === 'hygiene') return 'hygiene';
  if (rate === '4') return 'food_basic';
  if (rate === '10') return 'food_general';
  if (rate === '21') return 'other_21';
  return '';
}

export function buildTaxSuggestionNote(suggestion) {
  if (!suggestion) return '';
  const parts = [
    `IVA sugerido ${suggestion.suggested_tax_rate || '?'}%`,
    suggestion.tax_confidence ? `confianza ${suggestion.tax_confidence}` : '',
    suggestion.batch_id || '',
    suggestion.tax_source || '',
    suggestion.matched_code ? `POS ${suggestion.matched_code}` : '',
  ].filter(Boolean);
  return parts.join(' · ');
}

export function parseCSV(text) {
  const raw = (text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
  const lines = raw.split('\n').filter((l) => l.length > 0);
  const first = lines[0] || '';
  const delimiter = (first.match(/;/g) || []).length > (first.match(/,/g) || []).length ? ';' : ',';
  const rows = [];
  for (const line of lines) {
    const out = [];
    let cur = '';
    let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') {
        if (inQ && line[i + 1] === '"') { cur += '"'; i++; continue; }
        inQ = !inQ;
        continue;
      }
      if (!inQ && c === delimiter) { out.push(cur.trim()); cur = ''; continue; }
      cur += c;
    }
    out.push(cur.trim());
    rows.push(out);
  }
  return rows;
}

export function mapHeadersToFields(headers) {
  const map = {};
  const lower = (s) => (s || '').toLowerCase().trim().replace(/\s+/g, '_');
  headers.forEach((h, i) => {
    const l = lower(h);
    for (const [field, aliases] of Object.entries(CSV_HEADER_ALIASES)) {
      if (aliases.some((a) => lower(a) === l || a === h)) { map[i] = field; break; }
    }
    if (map[i] == null && (l === 'name' || l === 'nombre' || l === 'nombre_del_producto')) map[i] = 'name';
    if (map[i] == null && (l === 'price' || l === 'precio')) map[i] = 'price';
    if (map[i] == null && (l === 'stock' || l === 'cantidad')) map[i] = 'stock';
  });
  return map;
}
