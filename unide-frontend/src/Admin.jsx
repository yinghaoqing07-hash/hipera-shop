import QRCode from 'qrcode';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import React, { useEffect, useMemo, useRef, useState } from "react";
import { supabase, clearSupabaseLocalSession } from './supabaseClient'; // 保留用于用户认证
import { apiClient } from './api/client'; // 新增：API客户端
import { 
  LayoutDashboard, Package, List, ShoppingBag, 
  Plus, Trash2, Edit2, X, DollarSign, AlertCircle, RefreshCw, Undo2, MessageCircle,
  ChevronRight, ChevronDown, FolderPlus, ImageIcon, LogOut, Upload, Wrench,
  CheckCircle, Clock, Gift, Printer, Menu, FileText, FileSpreadsheet, GripVertical,
  Bell, BellOff, Download, TrendingUp, Eye, EyeOff, MapPin, Phone, Mail, CreditCard, StickyNote,
  Truck, Store, Smartphone, CalendarCheck, ScanLine
} from "lucide-react";
import toast, { Toaster } from 'react-hot-toast';
import { useNewOrdersAlert } from './hooks/useNewOrdersAlert';
import IvaLookup from './components/IvaLookup';

const AVAILABLE_ICONS = ["Package", "Apple", "Coffee", "Utensils", "Baby", "Home", "Gift"];

// Motivos de reembolso más habituales (se pueden editar/ampliar en el modal).
const REFUND_REASONS = [
  "Producto agotado sin stock",
  "Producto en mal estado o caducado",
  "Error en el pedido",
  "No podemos entregar a tiempo",
  "A petición del cliente",
];

const COMPANY_DATA = {
  name: "QIANG GUO SL",
  address: "Paseo del Sol 1, 28880 Meco",
  nif: "B86126638",
  phone: "+34 918 782 602",
};

const TAX_RATE_OPTIONS = [
  { value: '', label: 'Pendiente' },
  { value: '4', label: '4% · Superreducido' },
  { value: '10', label: '10% · Reducido' },
  { value: '21', label: '21% · General' },
];

const TAX_CATEGORY_OPTIONS = [
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

const TAX_REVIEW_STATUS_OPTIONS = [
  { value: 'pending', label: 'Pendiente' },
  { value: 'needs_review', label: 'Revisar' },
  { value: 'ask_gestor', label: 'Preguntar gestor' },
  { value: 'reviewed', label: 'Confirmado' },
];

const TAX_SUGGESTION_BATCH_LABELS = {
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

const CSV_IMPORT_FIELDS = [
  'name', 'short_name', 'price', 'stock', 'image', 'category', 'sub_category_id', 'description',
  'tax_rate', 'tax_category', 'tax_review_status', 'tax_note',
  'image_needs_optimization', 'oferta', 'oferta_type', 'oferta_value', 'gift_product', 'visible',
];
const CSV_HEADER_ALIASES = {
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

function normalizeTaxRate(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(String(value).replace(',', '.'));
  return [4, 10, 21].includes(n) ? n : null;
}

function normalizeTaxStatus(value) {
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

function normalizeProductForState(product, fallbackImages = null) {
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

function taxStatusLabel(value) {
  return TAX_REVIEW_STATUS_OPTIONS.find((o) => o.value === value)?.label || 'Pendiente';
}

function taxRateLabel(product) {
  const rate = product?.taxRate ?? product?.tax_rate;
  return rate === null || rate === undefined || rate === '' ? 'IVA pendiente' : `IVA ${rate}%`;
}

function taxStatusClass(value) {
  // Paleta sobria: solo "revisado" lleva un acento (verde tenue); el resto
  // de estados se muestran en gris neutro para no recargar la vista.
  if (value === 'reviewed') return 'bg-green-50 text-green-700 border-green-200';
  return 'bg-gray-100 text-gray-600 border-gray-200';
}

function isProductReviewed(product) {
  const hasTaxRate = product?.taxRate !== '' && product?.taxRate !== null && product?.taxRate !== undefined
    || product?.tax_rate !== '' && product?.tax_rate !== null && product?.tax_rate !== undefined;
  return hasTaxRate && (product?.taxReviewStatus || product?.tax_review_status) === 'reviewed';
}

function productNeedsReview(product) {
  return !isProductReviewed(product);
}

function productHasImageReviewField(product) {
  return !!product?.hasImageReviewField || Object.prototype.hasOwnProperty.call(product || {}, 'image_needs_optimization');
}

function productDisplayName(product) {
  return (product?.shortName || product?.short_name || product?.name || '').trim();
}


function resolveTaxCategoryFromSuggestion(suggestion) {
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

function buildTaxSuggestionNote(suggestion) {
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

function parseCSV(text) {
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

function mapHeadersToFields(headers) {
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

export default function AdminApp() {
  const [activeTab, setActiveTab] = useState("dashboard");

  
  // Data
  const [products, setProducts] = useState([]);
  const [orders, setOrders] = useState([]);
  const [categories, setCategories] = useState([]);      
  const [subCategories, setSubCategories] = useState([]); 
  const [repairs, setRepairs] = useState([]); 
  const [bookings, setBookings] = useState([]); // citas de reparación
  const [bookingStatusFilter, setBookingStatusFilter] = useState('');
  const [loading, setLoading] = useState(false);

  // UI
  const [isEditing, setIsEditing] = useState(false);
  const [currentProduct, setCurrentProduct] = useState(null);
  const [newProduct, setNewProduct] = useState({
    name: "", shortName: "", price: 0, stock: 10, category: "", subCategoryId: "", image: "", images: [],
    description: "", oferta: false, oferta_type: "percent", oferta_value: 0, giftProduct: false,
    visible: true, taxRate: "", taxCategory: "", taxReviewStatus: "pending", taxNote: "", imageNeedsOptimization: false
  });
  const [uploading, setUploading] = useState(false);
  const [removingBg, setRemovingBg] = useState(false);
  const [generatingDesc, setGeneratingDesc] = useState(false);
  const [centeringProduct, setCenteringProduct] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedProductCategory, setSelectedProductCategory] = useState("");
  const [productReviewMode, setProductReviewMode] = useState(false);
  const [imageOptimizationOnly, setImageOptimizationOnly] = useState(false);
  const [taxBatchFilter, setTaxBatchFilter] = useState("");
  const [taxSuggestions, setTaxSuggestions] = useState([]);
  const [taxSuggestionsLoadError, setTaxSuggestionsLoadError] = useState(false);
  // Filtros de la pestaña Pedidos
  const [orderSearch, setOrderSearch] = useState("");
  const [orderStatusFilter, setOrderStatusFilter] = useState("");
  const [orderDateFrom, setOrderDateFrom] = useState("");
  const [orderDateTo, setOrderDateTo] = useState("");
  // Reembolso: pedido en proceso de reembolso (modal), motivo y estado.
  const [refundTarget, setRefundTarget] = useState(null); // objeto order o null
  const [refundReason, setRefundReason] = useState("");
  const [refundBusy, setRefundBusy] = useState(false);
  const [refundMode, setRefundMode] = useState("total"); // 'total' | 'partial'
  const [refundQtys, setRefundQtys] = useState({}); // { [itemIndex]: cantidad a devolver }
  // Tras reembolsar: aviso al cliente por WhatsApp con un toque.
  const [refundWaModal, setRefundWaModal] = useState(null); // { waLink, emailed, refundType } o null
  // Tras avisar "listo para recoger": aviso por WhatsApp + código de recogida.
  const [pickupWaModal, setPickupWaModal] = useState(null); // { waLink, emailed, code } o null
  const [notifyingId, setNotifyingId] = useState(null); // id del pedido cuyo aviso se está enviando
  // Cobro en tienda al entregar (pago en tienda / contra reembolso).
  const [collectTarget, setCollectTarget] = useState(null); // pedido a cobrar+entregar, o null
  const [collectBusy, setCollectBusy] = useState(false);
  // Detalle de pedido: pedido abierto en el panel lateral, o null.
  const [detailOrder, setDetailOrder] = useState(null);
  // Overlay de ayuda de atajos de teclado.
  const [helpOpen, setHelpOpen] = useState(false);
  const [expandedProductCats, setExpandedProductCats] = useState({});
  const [loadError, setLoadError] = useState(false);
  const fetchDataRetryCountRef = useRef(0);
  const RETRY_DELAYS = [5000, 15000, 35000]; // 3 reintentos: 5s, 15s, 35s (cold start ~60s)
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Importar CSV
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [importPreview, setImportPreview] = useState(null); // { headers, rows }
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState({ done: 0, total: 0, errors: [] });

  // Bulk AI: Quitar fondo / Centrar producto
  const [selectedProductIds, setSelectedProductIds] = useState(new Set());
  const [bulkProcessing, setBulkProcessing] = useState({ active: false, done: 0, total: 0, action: null, errors: [] });
  const [bulkResultModal, setBulkResultModal] = useState({ open: false, success: 0, failed: 0, failedIds: [], failedItems: [], successItems: [], action: null });

  // States for forms
  const [newCatName, setNewCatName] = useState("");
  const [newCatIcon, setNewCatIcon] = useState("Package");
  const [newSubName, setNewSubName] = useState("");
  const [selectedParentForSub, setSelectedParentForSub] = useState(null);
  const [newRepair, setNewRepair] = useState({ brand: "", model: "", description: "Incluye limpieza interna + Cristal y Funda (o Cargador) de REGALO." });


  useEffect(() => { fetchData(); }, []);

  useEffect(() => {
    let cancelled = false;
    fetch('/tax-suggestions/product-tax-suggestions.json')
      .then((res) => {
        if (!res.ok) throw new Error(`Tax suggestion file missing (${res.status})`);
        return res.json();
      })
      .then((data) => {
        if (cancelled) return;
        setTaxSuggestions(Array.isArray(data) ? data : []);
        setTaxSuggestionsLoadError(false);
      })
      .catch((error) => {
        if (cancelled) return;
        console.warn('Tax suggestions not loaded:', error);
        setTaxSuggestions([]);
        setTaxSuggestionsLoadError(true);
      });
    return () => { cancelled = true; };
  }, []);

  const taxSuggestionsById = useMemo(() => {
    const map = new Map();
    taxSuggestions.forEach((item) => {
      if (item?.online_id !== null && item?.online_id !== undefined) {
        map.set(String(item.online_id), item);
      }
    });
    return map;
  }, [taxSuggestions]);

  // =================================================================
  // Atajos de teclado globales del panel
  // =================================================================
  // Objetivo: agilizar el trabajo diario sin tocar acciones de riesgo
  // (Cobrar, Reembolsar, Eliminar, IA en lote, Importar CSV NO tienen
  // atajo de confirmación; sólo se permite cerrarlos con Escape).
  //   1-5            cambiar de sección
  //   /              enfocar el buscador de la sección
  //   n              crear (enfocar el formulario de alta)
  //   c              limpiar filtros/búsqueda
  //   r              recargar datos
  //   f / t / p      (en detalle de pedido) justificante / ticket / imprimir
  //   Ctrl/Cmd+Enter (en modal de producto) guardar
  //   ? / Escape     ayuda de atajos / cerrar lo que esté abierto
  useEffect(() => {
    const isTyping = (el) => {
      if (!el) return false;
      const tag = el.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
    };
    const focusEl = (id) => {
      const el = document.getElementById(id);
      if (el) { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); el.focus(); }
    };
    const anyModalOpen = !!(detailOrder || refundTarget || refundWaModal || pickupWaModal || collectTarget || isEditing || importModalOpen || bulkResultModal.open || helpOpen);

    const handler = (e) => {
      // Guardar producto con Ctrl/Cmd+Enter (acción segura, no destructiva).
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        if (isEditing && !uploading && !removingBg && !generatingDesc && !centeringProduct) {
          e.preventDefault();
          handleSaveProduct({ preventDefault() {} });
        }
        return;
      }
      // No secuestramos otros combos con modificador (atajos del navegador).
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      // Escape: cierra el overlay superior, o desenfoca el campo activo.
      if (e.key === 'Escape') {
        if (isTyping(document.activeElement)) { document.activeElement.blur(); return; }
        if (helpOpen) { setHelpOpen(false); return; }
        if (collectTarget) { if (!collectBusy) setCollectTarget(null); return; }
        if (pickupWaModal) { setPickupWaModal(null); return; }
        if (refundWaModal) { setRefundWaModal(null); return; }
        if (refundTarget) { setRefundTarget(null); return; }
        if (isEditing) { setIsEditing(false); return; }
        if (importModalOpen) { setImportModalOpen(false); return; }
        if (bulkResultModal.open) { setBulkResultModal(prev => ({ ...prev, open: false })); return; }
        if (detailOrder) { setDetailOrder(null); return; }
        if (sidebarOpen) { setSidebarOpen(false); return; }
        return;
      }

      // Mientras se escribe en un campo, no disparamos atajos de letra/número.
      if (isTyping(document.activeElement)) return;

      // Ayuda de atajos (Shift + / → '?').
      if (e.key === '?') { e.preventDefault(); setHelpOpen(o => !o); return; }

      // Atajos del detalle de pedido (sólo acciones seguras).
      if (detailOrder && !refundTarget && !refundWaModal && !pickupWaModal && !collectTarget) {
        const o = orders.find(x => x.id === detailOrder.id) || detailOrder;
        if (e.key === 'f') { e.preventDefault(); openOrderFactura(o); return; }
        if (e.key === 't') { e.preventDefault(); openOrderTicket(o); return; }
        if (e.key === 'p') { e.preventDefault(); printOrderTicket(o); return; }
        return; // dentro del detalle no corren los atajos globales de página
      }

      // Con cualquier otro modal abierto, no corren los atajos de página.
      if (anyModalOpen) return;

      // ---- Atajos globales (sin modal, sin foco en campo) ----
      switch (e.key) {
        case '1': setActiveTab('dashboard'); return;
        case '2': setActiveTab('products'); return;
        case '3': setActiveTab('categories'); return;
        case '4': setActiveTab('repairs'); return;
        case '5': setActiveTab('orders'); return;
        case '6': setActiveTab('iva'); return;
        case 'r': e.preventDefault(); fetchData(); toast.success('Datos actualizados'); return;
        default: break;
      }
      if (e.key === '/') {
        if (activeTab === 'products') { e.preventDefault(); focusEl('search-products'); return; }
        if (activeTab === 'orders') { e.preventDefault(); focusEl('search-orders'); return; }
        if (activeTab === 'iva') { e.preventDefault(); focusEl('search-iva'); return; }
      }
      if (e.key === 'n') {
        if (activeTab === 'products') { e.preventDefault(); focusEl('new-product-name'); return; }
        if (activeTab === 'categories') { e.preventDefault(); focusEl('category-name'); return; }
        if (activeTab === 'repairs') { e.preventDefault(); focusEl('repair-brand'); return; }
      }
      if (e.key === 'c') {
        if (activeTab === 'orders') { e.preventDefault(); setOrderSearch(''); setOrderStatusFilter(''); setOrderDateFrom(''); setOrderDateTo(''); return; }
        if (activeTab === 'products') { e.preventDefault(); setSearchTerm(''); setSelectedProductCategory(''); setTaxBatchFilter(''); setImageOptimizationOnly(false); return; }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [activeTab, detailOrder, refundTarget, refundWaModal, pickupWaModal, collectTarget, collectBusy, isEditing, importModalOpen, bulkResultModal.open, sidebarOpen, helpOpen, uploading, removingBg, generatingDesc, centeringProduct, orders]);

  // =================================================================
  // Alerta de pedidos nuevos (sonido + badge + notificación)
  // =================================================================
  // El hook gestiona polling cada 20 s contra /api/admin/orders/new,
  // sonido vía Web Audio API y notificación del SO opcional. La
  // primera carga inicializa `lastSeen` al "ahora" del cliente, así
  // que el histórico no se reporta como nuevo (sólo lo que entre a
  // partir de este momento).
  const {
    newCount,
    isMuted,
    toggleMute,
    playSound,
    markAllSeen,
    notifPermission,
    requestNotifPermission,
    lastNewOrderAt,
  } = useNewOrdersAlert({ pollIntervalMs: 20000, enabled: true });

  // Cuando entra un pedido nuevo refrescamos sólo la lista de orders
  // (no recargamos todo el panel) para que la pestaña "Pedidos"
  // muestre el nuevo registro completo aunque el dueño ya estuviera
  // viéndola. Es una fetch ligera y el backend ya está despierto por
  // el polling.
  useEffect(() => {
    if (newCount === 0) return;
    apiClient.getAdminOrders()
      .then((data) => { if (Array.isArray(data)) setOrders(data); })
      .catch(() => { /* el banner ya está visible, no hace falta toast */ });
  }, [newCount]);

  // Cambia el título de la pestaña para que el aviso sea visible
  // incluso cuando el admin está en otra pestaña/aplicación. Se
  // resetea al marcar como visto.
  useEffect(() => {
    const base = 'Admin · HIPERA';
    document.title = newCount > 0 ? `(${newCount}) ${base}` : base;
    return () => { document.title = base; };
  }, [newCount]);

  // Mantener backend despierto (Railway duerme sin tráfico): ping cada 2 min si la pestaña está visible
  useEffect(() => {
    if (!import.meta.env.PROD) return;
    const ping = () => {
      if (document.visibilityState !== 'visible') return;
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 10000);
      fetch('/api/health', { method: 'GET', signal: ctrl.signal })
        .catch(() => {})
        .finally(() => clearTimeout(t));
    };
    const t = setInterval(ping, 2 * 60 * 1000);
    ping();
    return () => clearInterval(t);
  }, []);

  const fetchData = async () => {
    setLoading(true);
    setLoadError(false);
    try {
      // 使用 Promise.allSettled 确保即使部分失败也不会影响其他数据
      const results = await Promise.allSettled([
        apiClient.getAdminProducts(),
        apiClient.getAdminOrders(),
        apiClient.getCategories(),
        apiClient.getSubCategories(),
        apiClient.getRepairServices(),
        apiClient.getAdminRepairBookings()
      ]);

      // 处理每个结果，只更新成功的数据
      const [pResult, oResult, cResult, sResult, rResult, bResult] = results;

      if (pResult.status === 'fulfilled' && pResult.value) {
        setProducts(pResult.value.map(p => {
          // 解析 images（如果是 JSON 字符串）
          let images = [];
          if (p.images) {
            try {
              images = typeof p.images === 'string' ? JSON.parse(p.images) : p.images;
            } catch (_e) {
              images = p.image ? [p.image] : [];
            }
          } else if (p.image) {
            images = [p.image];
          }
          
          return normalizeProductForState(p, images);
        }));
      } else if (pResult.status === 'rejected') {
        console.error("Products error:", pResult.reason);
      }

      if (oResult.status === 'fulfilled' && oResult.value) {
        setOrders(oResult.value);
      } else if (oResult.status === 'rejected') {
        console.error("Orders error:", oResult.reason);
      }

      if (cResult.status === 'fulfilled' && cResult.value) {
        setCategories(cResult.value);
      } else if (cResult.status === 'rejected') {
        console.error("Categories error:", cResult.reason);
      }

      if (sResult.status === 'fulfilled' && sResult.value) {
        setSubCategories(sResult.value);
      } else if (sResult.status === 'rejected') {
        console.error("SubCategories error:", sResult.reason);
        // 如果子类别加载失败，不清空现有数据
      }

      if (rResult.status === 'fulfilled' && rResult.value) {
        setRepairs(rResult.value);
      } else if (rResult.status === 'rejected') {
        console.error("Repairs error:", rResult.reason);
      }

      if (bResult.status === 'fulfilled' && Array.isArray(bResult.value)) {
        setBookings(bResult.value);
      } else if (bResult.status === 'rejected') {
        console.error("Bookings error:", bResult.reason);
      }

      const hasFailures = results.some(r => r.status === 'rejected');
      const allFailed = results.every(r => r.status === 'rejected');
      if (hasFailures) {
        setLoadError(true);
        const n = fetchDataRetryCountRef.current;
        if (allFailed && n < RETRY_DELAYS.length) {
          const delay = RETRY_DELAYS[n];
          fetchDataRetryCountRef.current = n + 1;
          toast.error(`Servidor inactivo. Reintentando en ${delay / 1000} s… (${n + 1}/${RETRY_DELAYS.length})`);
          setTimeout(() => fetchData(), delay);
        } else if (!allFailed) {
          toast.error("Algunos datos no se pudieron cargar. Verifique la conexión.");
        } else {
          toast.error("Error cargando datos. Compruebe conexión y pulse Reintentar.");
        }
      } else {
        fetchDataRetryCountRef.current = 0;
      }

    } catch (error) {
      setLoadError(true);
      console.error("Fetch data error:", error);
      const n = fetchDataRetryCountRef.current;
      if (n < RETRY_DELAYS.length) {
        const delay = RETRY_DELAYS[n];
        fetchDataRetryCountRef.current = n + 1;
        toast.error(`Servidor inactivo. Reintentando en ${delay / 1000} s… (${n + 1}/${RETRY_DELAYS.length})`);
        setTimeout(() => fetchData(), delay);
      } else {
        toast.error("Error cargando datos. Compruebe conexión y pulse Reintentar.");
      }
    } finally {
      setLoading(false);
    }
  };

  // Cierre de sesion robusto (2026-05-27 fix b): limpiamos primero los
  // tokens sb-* de localStorage en sincrono, despues lanzamos signOut()
  // en background y forzamos reload. Si solo lanzaramos signOut() y
  // location.href de inmediato, el SDK no habria llegado a borrar los
  // tokens (lo hace tras la respuesta del /logout), la pagina se
  // recargaria leyendo localStorage stale y el admin volveria a quedar
  // logueado dando la impresion de que el boton "no funciona".
  const handleLogout = () => {
    clearSupabaseLocalSession();
    supabase.auth.signOut().catch(() => {});
    window.location.href = '/login';
  };

  // --- Actions ---
  const handleDeleteProduct = async (id) => { 
    if(!window.confirm("¿Eliminar?")) return; 
    try {
      await apiClient.deleteProduct(id);
      toast.success("Producto eliminado");
      setProducts(prev => prev.filter(p => p.id !== id));
    } catch (error) {
      toast.error("Error al eliminar: " + error.message);
      fetchData();
    }
  };

  const handleReorderCategories = async (newOrderIds) => {
    try {
      setReordering(true);
      await apiClient.reorderCategories(newOrderIds);
      setCategories(prev => {
        const byId = Object.fromEntries(prev.map(c => [c.id, c]));
        return newOrderIds.map(id => byId[id]).filter(Boolean);
      });
      toast.success("Orden guardado");
    } catch (e) {
      toast.error("Error: " + (e?.message || "Error"));
    } finally { setReordering(false); }
  };

  const handleReorderSubCategories = async (parentId, newOrderIdsThisParent) => {
    try {
      setReordering(true);
      const subsThisParent = subCategories.filter(s => s.parent_id === parentId);
      const reorderedSubs = newOrderIdsThisParent.map(id => subsThisParent.find(x => x.id === id)).filter(Boolean);
      const ordered = [];
      let p1Used = false;
      for (const s of subCategories) {
        if (s.parent_id === parentId) {
          if (!p1Used) { ordered.push(...reorderedSubs); p1Used = true; }
        } else {
          ordered.push(s);
        }
      }
      await apiClient.reorderSubCategories(ordered.map(x => x.id));
      setSubCategories(ordered);
      toast.success("Orden guardado");
    } catch (e) {
      toast.error("Error: " + (e?.message || "Error"));
    } finally { setReordering(false); }
  };

  const handleReorderProducts = async (newOrderIdsFull) => {
    try {
      setReordering(true);
      await apiClient.reorderProducts(newOrderIdsFull);
      setProducts(prev => {
        const byId = Object.fromEntries(prev.map(p => [p.id, p]));
        return newOrderIdsFull.map(id => byId[id]).filter(Boolean);
      });
      toast.success("Orden guardado");
    } catch (e) {
      toast.error("Error: " + (e?.message || "Error"));
    } finally { setReordering(false); }
  };

  const buildProductReorder = (cid, subId, newOrderedIdsThisGroup) => {
    const subProducts = products.filter(p => {
      const pc = (p.category != null && p.category !== '') ? Number(p.category) : '__none__';
      const ps = (p.subCategoryId ?? p.sub_category_id) != null && (p.subCategoryId ?? p.sub_category_id) !== '' ? Number(p.subCategoryId ?? p.sub_category_id) : '__none__';
      return pc === cid && ps === subId;
    });
    const reordered = newOrderedIdsThisGroup.map(id => subProducts.find(x => x.id === id)).filter(Boolean);
    const result = [];
    let used = false;
    for (const p of products) {
      const pc = (p.category != null && p.category !== '') ? Number(p.category) : '__none__';
      const ps = (p.subCategoryId ?? p.sub_category_id) != null && (p.subCategoryId ?? p.sub_category_id) !== '' ? Number(p.subCategoryId ?? p.sub_category_id) : '__none__';
      if (pc === cid && ps === subId) {
        if (!used) { result.push(...reordered); used = true; }
      } else {
        result.push(p);
      }
    }
    return result.map(x => x.id);
  };

  const getProductCategoryKey = (product) => {
    const raw = product?.category;
    return raw !== null && raw !== undefined && raw !== '' ? Number(raw) : '__none__';
  };

  const getProductSubCategoryKey = (product) => {
    const raw = product?.subCategoryId ?? product?.sub_category_id;
    return raw !== null && raw !== undefined && raw !== '' ? Number(raw) : '__none__';
  };

  const getSelectedProductCategoryKey = () => {
    if (selectedProductCategory === '') return null;
    return selectedProductCategory === '_none' ? '__none__' : parseInt(selectedProductCategory, 10);
  };

  const getManualReviewOrderedProducts = (list) => {
    const categoryOrder = new Map(categories.map((c, idx) => [Number(c.id), c.sort_order ?? idx]));
    const subCategoryOrder = new Map(subCategories.map((s, idx) => [`${Number(s.parent_id)}:${Number(s.id)}`, s.sort_order ?? idx]));
    const productOrder = new Map(products.map((p, idx) => [String(p.id), idx]));
    const rankCategory = (key) => key === '__none__' ? Number.MAX_SAFE_INTEGER : (categoryOrder.get(Number(key)) ?? Number.MAX_SAFE_INTEGER - 1);
    const rankSubCategory = (catKey, subKey) => subKey === '__none__' ? Number.MAX_SAFE_INTEGER : (subCategoryOrder.get(`${Number(catKey)}:${Number(subKey)}`) ?? Number.MAX_SAFE_INTEGER - 1);

    return [...list].sort((a, b) => {
      const ac = getProductCategoryKey(a);
      const bc = getProductCategoryKey(b);
      const catDiff = rankCategory(ac) - rankCategory(bc);
      if (catDiff) return catDiff;

      const as = getProductSubCategoryKey(a);
      const bs = getProductSubCategoryKey(b);
      const subDiff = rankSubCategory(ac, as) - rankSubCategory(bc, bs);
      if (subDiff) return subDiff;

      return (productOrder.get(String(a.id)) ?? Number.MAX_SAFE_INTEGER) - (productOrder.get(String(b.id)) ?? Number.MAX_SAFE_INTEGER);
    });
  };

  const getNextProductInReviewCategory = (updatedProducts, current) => {
    const selectedCategoryKey = getSelectedProductCategoryKey();
    const scopeCategory = selectedCategoryKey !== null ? selectedCategoryKey : getProductCategoryKey(current);
    const productOrder = new Map(products.map((p, idx) => [String(p.id), idx]));
    const currentOrder = productOrder.get(String(current?.id)) ?? -1;
    const candidates = getManualReviewOrderedProducts(
      updatedProducts
        .filter(productNeedsReview)
        .filter(p => getProductCategoryKey(p) === scopeCategory)
        .filter(p => !taxBatchFilter || getTaxSuggestionForProduct(p)?.batch_id === taxBatchFilter)
        .filter(p => p.id !== current?.id)
    );

    return candidates.find(p => (productOrder.get(String(p.id)) ?? Number.MAX_SAFE_INTEGER) > currentOrder)
      || candidates[0]
      || null;
  };

  const [stockEdits, setStockEdits] = useState({});
  const [, setReordering] = useState(false);
  const [updatingStockId, setUpdatingStockId] = useState(null);
  const handleQuickStockUpdate = async (p) => {
    const newStock = parseInt(stockEdits[p.id] ?? p.stock, 10);
    if (Number.isNaN(newStock) || newStock < 0) {
      toast.error("Stock inválido");
      return;
    }
    setUpdatingStockId(p.id);
    try {
      const payload = { stock: newStock };
      if (newStock > 0) payload.visible = true;
      await apiClient.updateProduct(p.id, payload);
      setProducts(prev => prev.map(x => x.id === p.id ? { ...x, stock: newStock, visible: newStock > 0 ? true : x.visible } : x));
      setStockEdits(prev => { const n = {...prev}; delete n[p.id]; return n; });
      toast.success(newStock > 0 ? "Stock actualizado, producto re-publicado" : "Stock actualizado");
    } catch (e) {
      toast.error("Error: " + (e.message || "Error"));
    } finally {
      setUpdatingStockId(null);
    }
  };

  const getTaxSuggestionForProduct = (product) => {
    if (!product?.id) return null;
    return taxSuggestionsById.get(String(product.id)) || null;
  };

  const applyTaxSuggestionToCurrentProduct = (suggestion) => {
    if (!suggestion?.suggested_tax_rate) {
      toast.error("Esta sugerencia no tiene IVA fiable.");
      return;
    }
    setCurrentProduct((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        taxRate: String(suggestion.suggested_tax_rate),
        taxCategory: resolveTaxCategoryFromSuggestion(suggestion),
        taxReviewStatus: 'needs_review',
        taxNote: buildTaxSuggestionNote(suggestion),
      };
    });
    toast.success(`Sugerencia aplicada: IVA ${suggestion.suggested_tax_rate}%`);
  };
  
  const handleSaveProduct = async (e, options = {}) => {
    e.preventDefault();
    const images = currentProduct.images || (currentProduct.image ? [currentProduct.image] : []);
    const shouldSaveAndNext = !!options.saveAndNext;
    // markStatus: cuando se aparca un producto para revisar el IVA más tarde
    // (no se exige IVA y se guarda con ese estado, p.ej. 'needs_review').
    const markStatus = options.markStatus ? normalizeTaxStatus(options.markStatus) : null;
    const normalizedTaxRate = normalizeTaxRate(currentProduct.taxRate ?? currentProduct.tax_rate);
    // Solo exigimos IVA cuando se marca como REVISADO; si se aparca para
    // revisar (markStatus) no hace falta saber el IVA todavía.
    if (shouldSaveAndNext && !markStatus && normalizedTaxRate === null) {
      toast.error("Selecciona el IVA, o usa «Revisar IVA» si aún no lo sabes.");
      return;
    }
    if (currentProduct.imageNeedsOptimization && !productHasImageReviewField(currentProduct)) {
      toast.error("Primero ejecuta la migración image_needs_optimization en Supabase.");
      return;
    }
    const finalTaxStatus = markStatus
      ? markStatus
      : (shouldSaveAndNext ? 'reviewed' : normalizeTaxStatus(currentProduct.taxReviewStatus ?? currentProduct.tax_review_status));
    const dbPayload = { 
      name: currentProduct.name, 
      short_name: currentProduct.shortName ?? currentProduct.short_name ?? '',
      price: currentProduct.price, 
      stock: currentProduct.stock, 
      image: images[0] || currentProduct.image || '', // 主图（第一张）
      // 注意：images 字段不在数据库 schema 中，只保存主图 image
      category: currentProduct.category, 
      sub_category_id: currentProduct.subCategoryId, 
      // 👇 新增这 5 个字段
      description: currentProduct.description,
      oferta: currentProduct.oferta, 
      oferta_type: currentProduct.oferta_type || 'percent', 
      oferta_value: currentProduct.oferta_value || 0,
      gift_product: currentProduct.giftProduct || false,
      visible: currentProduct.visible !== false,
      tax_rate: normalizedTaxRate,
      tax_category: currentProduct.taxCategory ?? currentProduct.tax_category ?? '',
      tax_review_status: finalTaxStatus,
      tax_note: shouldSaveAndNext && !markStatus && !(currentProduct.taxNote ?? currentProduct.tax_note)
        ? 'manual pre-launch review'
        : (currentProduct.taxNote ?? currentProduct.tax_note ?? '')
    };
    if (productHasImageReviewField(currentProduct)) {
      dbPayload.image_needs_optimization = !!currentProduct.imageNeedsOptimization;
    }
    
    try {
      let savedProduct;
      if (currentProduct.id) {
        // 更新现有商品
        savedProduct = await apiClient.updateProduct(currentProduct.id, dbPayload);
        // 直接更新状态中的商品
        if (savedProduct && !shouldSaveAndNext) {
          setProducts(prev => prev.map(p => {
            if (p.id === currentProduct.id) {
              // 更新商品数据，保持 images 数组
              return normalizeProductForState(savedProduct, images);
            }
            return p;
          }));
          toast.success("Producto actualizado");
        } else {
          // 如果返回数据不完整，重新获取
          if (!shouldSaveAndNext) fetchData();
        }
      } else {
        // 创建新商品
        savedProduct = await apiClient.createProduct(dbPayload);
        // 直接添加到状态
        if (savedProduct && !shouldSaveAndNext) {
          setProducts(prev => [...prev, normalizeProductForState(savedProduct, images)]);
          toast.success("Producto creado");
        } else {
          // 如果返回数据不完整，重新获取
          if (!shouldSaveAndNext) fetchData();
        }
      }
      if (shouldSaveAndNext) {
        const normalized = savedProduct
          ? normalizeProductForState(savedProduct, images)
          : normalizeProductForState({ ...currentProduct, ...dbPayload }, images);
        const updated = currentProduct.id
          ? products.map(p => p.id === currentProduct.id ? normalized : p)
          : [...products, normalized];
        setProducts(updated);
        const next = productReviewMode
          ? getNextProductInReviewCategory(updated, currentProduct)
          : getManualReviewOrderedProducts(updated.filter(p => p.id !== currentProduct.id))[0];
        if (next) {
          setCurrentProduct(next);
          setIsEditing(true);
          toast.success(`Guardado. Siguiente: #${next.id}`);
        } else {
          setCurrentProduct(null);
          setIsEditing(false);
          toast.success(productReviewMode ? "Categoría revisada. No quedan productos pendientes aquí." : "Producto guardado.");
        }
      } else {
        setIsEditing(false); 
        setCurrentProduct(null);
      }
    } catch (error) {
      toast.error("Error al guardar: " + error.message);
      console.error("Error saving product:", error);
      // 保存失败时不清空表单，让用户可以重试
    }
  };

  const handleImageUpload = async (event) => {
    try {
      setUploading(true);
      const files = Array.from(event.target.files || []);
      if (files.length === 0) return;
      
      const uploadedUrls = [];
      for (const file of files) {
        const fileExt = file.name.split('.').pop();
        const fileName = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}.${fileExt}`;
        const { error } = await supabase.storage.from('products').upload(fileName, file);
        if (error) throw error;
        const { data } = supabase.storage.from('products').getPublicUrl(fileName);
        uploadedUrls.push(data.publicUrl);
      }
      
      const existingImages = currentProduct.images || (currentProduct.image ? [currentProduct.image] : []);
      const allImages = [...existingImages, ...uploadedUrls];
      
      setCurrentProduct({ 
        ...currentProduct, 
        images: allImages,
        image: allImages[0] // 主图（第一张）
      });
      
      if (files.length > 1) {
        toast.success(`${files.length} imágenes subidas`);
      }
    } catch(e) { 
      toast.error("Error al subir: " + (e.message || "Error desconocido")); 
    } finally { 
      setUploading(false);
      // 重置 input 以便可以再次选择相同文件
      event.target.value = '';
    }
  };
  
  const handleRemoveImage = (indexToRemove) => {
    const images = currentProduct.images || (currentProduct.image ? [currentProduct.image] : []);
    const newImages = images.filter((_, idx) => idx !== indexToRemove);
    setCurrentProduct({
      ...currentProduct,
      images: newImages,
      image: newImages[0] || ''
    });
  };

  const handleNewProductImageUpload = async (event) => {
    try {
      setUploading(true);
      const files = Array.from(event.target.files || []);
      if (files.length === 0) return;
      const uploadedUrls = [];
      for (const file of files) {
        const fileExt = file.name.split('.').pop();
        const fileName = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}.${fileExt}`;
        const { error } = await supabase.storage.from('products').upload(fileName, file);
        if (error) throw error;
        const { data } = supabase.storage.from('products').getPublicUrl(fileName);
        uploadedUrls.push(data.publicUrl);
      }
      const existing = newProduct.images?.length ? newProduct.images : (newProduct.image ? [newProduct.image] : []);
      const all = [...existing, ...uploadedUrls];
      setNewProduct(prev => ({ ...prev, images: all, image: all[0] || '' }));
      if (files.length > 1) toast.success(`${files.length} imágenes subidas`);
    } catch (e) {
      toast.error("Error al subir: " + (e.message || "Error desconocido"));
    } finally {
      setUploading(false);
      event.target.value = '';
    }
  };

  const handleNewProductRemoveImage = (indexToRemove) => {
    const images = newProduct.images?.length ? newProduct.images : (newProduct.image ? [newProduct.image] : []);
    const next = images.filter((_, i) => i !== indexToRemove);
    setNewProduct(prev => ({ ...prev, images: next, image: next[0] || '' }));
  };

  const handleNewProductRemoveBg = async () => {
    const images = newProduct.images?.length ? newProduct.images : (newProduct.image ? [newProduct.image] : []);
    if (images.length === 0) return;
    try {
      setRemovingBg(true);
      const { image_url } = await apiClient.removeBg(images[0]);
      const newImages = [image_url, ...images.slice(1)];
      setNewProduct(prev => ({ ...prev, images: newImages, image: image_url }));
      toast.success("Fondo eliminado");
    } catch (e) {
      const errMsg = typeof e?.message === 'string' ? e.message : (e?.message?.message || (typeof e?.message === 'object' ? 'Error de servicio' : String(e?.message || e || 'Error')));
      toast.error("Quitar fondo: " + errMsg);
    } finally { setRemovingBg(false); }
  };

  const handleNewProductGenerateDescription = async () => {
    const images = newProduct.images?.length ? newProduct.images : (newProduct.image ? [newProduct.image] : []);
    if (images.length === 0) return;
    try {
      setGeneratingDesc(true);
      const result = await apiClient.generateDescription(images);
      const updated = { ...newProduct, description: result.description || "" };
      if (result.productInfo?.productName) updated.name = result.productInfo.productName;
      if (result.productInfo?.quantity) {
        const qtyMatch = result.productInfo.quantity.match(/(\d+)/);
        if (qtyMatch && (newProduct.stock == null || newProduct.stock === 10)) updated.stock = parseInt(qtyMatch[1], 10);
      }
      setNewProduct(updated);
      const infoParts = [];
      if (result.productInfo?.productName) infoParts.push(`Nombre: ${result.productInfo.productName}`);
      if (result.productInfo?.weight) infoParts.push(`Peso: ${result.productInfo.weight}`);
      if (result.productInfo?.quantity) infoParts.push(`Cantidad: ${result.productInfo.quantity}`);
      if (infoParts.length > 0) toast.success(`Información extraída (${images.length} imagen${images.length > 1 ? 'es' : ''}): ${infoParts.join(', ')}`);
      else toast.success(`Información extraída de ${images.length} imagen${images.length > 1 ? 'es' : ''}`);
    } catch (e) {
      toast.error("Extraer información: " + (e.message || "Error"));
    } finally { setGeneratingDesc(false); }
  };

  const handleNewProductCenterProduct = async () => {
    const images = newProduct.images?.length ? newProduct.images : (newProduct.image ? [newProduct.image] : []);
    if (images.length === 0) return;
    try {
      setCenteringProduct(true);
      const { image_url } = await apiClient.centerProduct(images[0]);
      const newImages = [image_url, ...images.slice(1)];
      setNewProduct(prev => ({ ...prev, images: newImages, image: image_url }));
      toast.success("Producto centrado");
    } catch (e) {
      toast.error("Centrar producto: " + (e.message || "Error"));
    } finally { setCenteringProduct(false); }
  };

  const toggleProductSelect = (id) => {
    setSelectedProductIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const selectAllProducts = (ids) => {
    setSelectedProductIds(prev => { const next = new Set(prev); ids.forEach(id => next.add(id)); return next; });
  };
  const clearProductSelection = () => setSelectedProductIds(new Set());

  const delay = (ms) => new Promise(res => setTimeout(res, ms));

  const runBulkAction = async (action, idsOverride = null) => {
    const ids = idsOverride || Array.from(selectedProductIds);
    const items = ids.map(id => products.find(p => p.id === id)).filter(Boolean);
    const withImage = items.filter(p => p.image || (p.images && p.images[0]));
    if (withImage.length === 0) {
      toast.error("Los productos seleccionados no tienen imagen");
      return;
    }
    setBulkProcessing({ active: true, done: 0, total: withImage.length, action, errors: [] });
    const errors = [];
    const DELAY_MS = 5000; // 5s entre peticiones para evitar rate limit
    const MAX_RETRIES = 2;

    for (let i = 0; i < withImage.length; i++) {
      if (i > 0) await delay(DELAY_MS);
      const p = withImage[i];
      const imgUrl = p.images?.[0] || p.image;
      if (!imgUrl) continue;
      let lastErr;
      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
          let newUrl;
          if (action === 'both') {
            const r1 = await apiClient.removeBg(imgUrl);
            const url1 = r1?.image_url;
            if (!url1) throw new Error('removeBg sin resultado');
            const r2 = await apiClient.centerProduct(url1);
            newUrl = r2?.image_url;
          } else if (action === 'removeBg') {
            const r = await apiClient.removeBg(imgUrl);
            newUrl = r?.image_url;
          } else {
            const r = await apiClient.centerProduct(imgUrl);
            newUrl = r?.image_url;
          }
          if (newUrl) {
            const imgs = p.images || (p.image ? [p.image] : []);
            const newImages = [newUrl, ...imgs.slice(1)];
            await apiClient.updateProduct(p.id, {
              name: p.name, short_name: p.shortName ?? p.short_name ?? '', price: p.price, stock: p.stock, category: p.category,
              sub_category_id: p.subCategoryId ?? p.sub_category_id, description: p.description || '',
              oferta: p.oferta, oferta_type: p.oferta_type || 'percent', oferta_value: p.oferta_value || 0,
              gift_product: p.giftProduct || false, visible: p.visible !== false,
              tax_rate: normalizeTaxRate(p.taxRate ?? p.tax_rate),
              tax_category: p.taxCategory ?? p.tax_category ?? '',
              tax_review_status: normalizeTaxStatus(p.taxReviewStatus ?? p.tax_review_status),
              tax_note: p.taxNote ?? p.tax_note ?? '',
              image: newImages[0]
            });
            setProducts(prev => prev.map(x => x.id === p.id ? { ...x, image: newImages[0], images: newImages } : x));
          }
          break; // éxito
        } catch (e) {
          lastErr = e;
          if (attempt < MAX_RETRIES) await delay(3000); // 3s antes de reintentar
        }
      }
      if (lastErr) errors.push({ id: p.id, name: p.name, msg: lastErr?.message || 'Error' });
      setBulkProcessing(prev => ({ ...prev, done: i + 1, errors }));
    }
    setBulkProcessing(prev => ({ ...prev, active: false }));
    const successCount = withImage.length - errors.length;
    const failedIds = errors.map(e => e.id);
    const successItems = withImage.filter(p => !errors.some(e => e.id === p.id)).map(p => ({ id: p.id, name: p.name }));
    const failedItems = errors.map(e => ({ id: e.id, name: e.name, msg: e.msg }));
    setBulkResultModal({ open: true, success: successCount, failed: errors.length, failedIds, failedItems, successItems, action });
    if (failedIds.length === 0) clearProductSelection();
  };

  const handleBulkRetryFailed = () => {
    const { failedIds, action } = bulkResultModal;
    setBulkResultModal(prev => ({ ...prev, open: false }));
    setSelectedProductIds(new Set(failedIds));
    runBulkAction(action, failedIds);
  };

  const handleCreateProduct = async (e) => {
    e.preventDefault();
    const imgs = newProduct.images?.length ? newProduct.images : (newProduct.image ? [newProduct.image] : []);
    const payload = {
      name: newProduct.name,
      short_name: newProduct.shortName || '',
      price: newProduct.price,
      stock: newProduct.stock,
      image: imgs[0] || '',
      category: newProduct.category,
      sub_category_id: newProduct.subCategoryId || null,
      description: newProduct.description || '',
      oferta: newProduct.oferta || false,
      oferta_type: newProduct.oferta_type || 'percent',
      oferta_value: newProduct.oferta_value || 0,
      gift_product: newProduct.giftProduct || false,
      visible: newProduct.visible !== false,
      tax_rate: normalizeTaxRate(newProduct.taxRate),
      tax_category: newProduct.taxCategory || '',
      tax_review_status: normalizeTaxStatus(newProduct.taxReviewStatus),
      tax_note: newProduct.taxNote || ''
    };
    if (newProduct.imageNeedsOptimization) {
      payload.image_needs_optimization = true;
    }
    try {
      const saved = await apiClient.createProduct(payload);
      toast.success("Producto creado");
      if (saved) {
        setProducts(prev => [...prev, normalizeProductForState(saved, imgs)]);
      } else fetchData();
      setNewProduct({ name: "", shortName: "", price: 0, stock: 10, category: "", subCategoryId: "", image: "", images: [], description: "", oferta: false, oferta_type: "percent", oferta_value: 0, giftProduct: false, visible: true, taxRate: "", taxCategory: "", taxReviewStatus: "pending", taxNote: "", imageNeedsOptimization: false });
    } catch (err) {
      toast.error("Error al crear: " + (err.message || "Error"));
    }
  };

  const downloadImportTemplate = () => {
    const headers = CSV_IMPORT_FIELDS;
    const example = ['Ejemplo Producto Nombre Completo 500g', 'Ejemplo Producto 500g', '2.50', '10', '', '1', '', 'Descripción opcional', '10', 'food_general', 'pending', 'IVA pendiente de confirmar', 'false', 'false', 'percent', '0', 'false', 'true'];
    const lines = [headers.join(','), example.map((v) => (v.includes(',') ? `"${v}"` : v)).join(',')];
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'plantilla_productos.csv';
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const handleImportFileSelect = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const rows = parseCSV(reader.result || '');
        if (rows.length < 2) {
          toast.error('El CSV debe tener cabecera y al menos una fila de datos.');
          return;
        }
        const headers = rows[0];
        const dataRows = rows.slice(1).filter((r) => r.some((c) => String(c).trim() !== ''));
        setImportPreview({ headers, rows: dataRows });
      } catch (err) {
        toast.error('Error al leer CSV: ' + (err.message || ''));
      }
    };
    reader.readAsText(file, 'UTF-8');
    e.target.value = '';
  };

  const runImport = async () => {
    if (!importPreview?.rows?.length) return;
    const { headers, rows } = importPreview;
    const colMap = mapHeadersToFields(headers);
    const nameIdx = headers.findIndex((h, i) => colMap[i] === 'name');
    const priceIdx = headers.findIndex((h, i) => colMap[i] === 'price');
    if (nameIdx === -1 || priceIdx === -1) {
      toast.error('El CSV debe incluir columnas "name"/"nombre" y "price"/"precio".');
      return;
    }
    const resolveCategory = (val) => {
      const v = String(val || '').trim();
      if (!v) return null;
      const n = parseFloat(v);
      if (!Number.isNaN(n) && String(Math.floor(n)) === String(n)) return Math.floor(n);
      const c = categories.find((x) => (x.name || '').toLowerCase() === v.toLowerCase());
      return c ? c.id : null;
    };
    const bool = (v) => {
      const s = String(v || '').toLowerCase().trim();
      return ['1', 'true', 'si', 'sí', 'yes', 's'].includes(s);
    };
    setImporting(true);
    setImportProgress({ done: 0, total: rows.length, errors: [] });
    const errors = [];
    let imported = 0;
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const get = (field) => {
        const idx = headers.findIndex((_, j) => colMap[j] === field);
        return idx >= 0 && row[idx] !== undefined ? String(row[idx] || '').trim() : '';
      };
      const name = get('name');
      const priceVal = get('price');
      if (!name || !priceVal) {
        errors.push({ row: i + 2, msg: 'Falta nombre o precio' });
        setImportProgress({ done: i + 1, total: rows.length, errors });
        continue;
      }
      const price = parseFloat(priceVal.replace(',', '.'));
      if (Number.isNaN(price) || price < 0) {
        errors.push({ row: i + 2, msg: 'Precio inválido' });
        setImportProgress({ done: i + 1, total: rows.length, errors });
        continue;
      }
      const rawTaxRate = get('tax_rate');
      const taxRate = normalizeTaxRate(rawTaxRate);
      if (rawTaxRate && taxRate === null) {
        errors.push({ row: i + 2, msg: 'IVA inválido: usa 4, 10 o 21' });
        setImportProgress({ done: i + 1, total: rows.length, errors });
        continue;
      }
      const payload = {
        name,
        short_name: get('short_name') || '',
        price,
        stock: parseInt(get('stock'), 10) || 10,
        image: get('image') || '',
        category: resolveCategory(get('category')),
        sub_category_id: (() => { const v = get('sub_category_id'); const n = parseInt(v, 10); return (v && !Number.isNaN(n)) ? n : null; })(),
        description: get('description') || '',
        tax_rate: taxRate,
        tax_category: get('tax_category') || '',
        tax_review_status: normalizeTaxStatus(get('tax_review_status')),
        tax_note: get('tax_note') || '',
        image_needs_optimization: bool(get('image_needs_optimization')),
        oferta: bool(get('oferta')),
        oferta_type: (get('oferta_type') || 'percent').toLowerCase().replace(/[^a-z]/g, '') === 'second' ? 'second' : (get('oferta_type') || '').toLowerCase().replace(/[^a-z]/g, '') === 'gift' ? 'gift' : 'percent',
        oferta_value: parseFloat((get('oferta_value') || '0').replace(',', '.')) || 0,
        gift_product: bool(get('gift_product')),
        visible: get('visible') === '' || get('visible') === undefined ? true : bool(get('visible')),
      };
      try {
        await apiClient.createProduct(payload);
        imported++;
      } catch (e) {
        errors.push({ row: i + 2, msg: e.message || 'Error API' });
      }
      setImportProgress({ done: i + 1, total: rows.length, errors });
    }
    setImporting(false);
    if (imported > 0) {
      toast.success(`Importados ${imported} producto${imported !== 1 ? 's' : ''}.`);
      fetchData();
    }
    if (errors.length > 0) toast.error(`${errors.length} fila${errors.length !== 1 ? 's' : ''} con error. Ver modal.`);
  };

  const handleRemoveBg = async () => {
    const images = currentProduct?.images || (currentProduct?.image ? [currentProduct.image] : []);
    if (images.length === 0) return;
    
    try {
      setRemovingBg(true);
      // 只对第一张图（主图）去背
      const { image_url } = await apiClient.removeBg(images[0]);
      const newImages = [image_url, ...images.slice(1)];
      setCurrentProduct({ 
        ...currentProduct, 
        images: newImages,
        image: image_url 
      });
      toast.success("Fondo eliminado");
    } catch (e) {
      const errMsg = typeof e?.message === 'string' ? e.message : (e?.message?.message || (typeof e?.message === 'object' ? 'Error de servicio' : String(e?.message || e || 'Error')));
      toast.error("Quitar fondo: " + errMsg);
    } finally { setRemovingBg(false); }
  };

  const handleGenerateDescription = async () => {
    const images = currentProduct?.images || (currentProduct?.image ? [currentProduct.image] : []);
    if (images.length === 0) return;
    
    try {
      setGeneratingDesc(true);
      // 发送所有图片到后端
      const result = await apiClient.generateDescription(images);
      
      const updatedProduct = { ...currentProduct, description: result.description || "" };
      
      if (result.productInfo?.productName) {
        updatedProduct.name = result.productInfo.productName;
      }
      if (result.productInfo?.quantity) {
        const qtyMatch = result.productInfo.quantity.match(/(\d+)/);
        if (qtyMatch && (!currentProduct.stock || currentProduct.stock === 10)) {
          updatedProduct.stock = parseInt(qtyMatch[1]);
        }
      }
      
      setCurrentProduct(updatedProduct);
      
      const infoParts = [];
      if (result.productInfo?.productName) infoParts.push(`Nombre: ${result.productInfo.productName}`);
      if (result.productInfo?.weight) infoParts.push(`Peso: ${result.productInfo.weight}`);
      if (result.productInfo?.quantity) infoParts.push(`Cantidad: ${result.productInfo.quantity}`);
      if (infoParts.length > 0) {
        toast.success(`Información extraída (${images.length} imagen${images.length > 1 ? 'es' : ''}): ${infoParts.join(', ')}`);
      } else {
        toast.success(`Información extraída de ${images.length} imagen${images.length > 1 ? 'es' : ''}`);
      }
    } catch (e) {
      toast.error("Extraer información: " + (e.message || "Error"));
    } finally { setGeneratingDesc(false); }
  };

  const handleCenterProduct = async () => {
    const images = currentProduct?.images || (currentProduct?.image ? [currentProduct.image] : []);
    if (images.length === 0) return;
    
    try {
      setCenteringProduct(true);
      // 对第一张图（主图）进行居中处理
      const { image_url } = await apiClient.centerProduct(images[0]);
      const newImages = [image_url, ...images.slice(1)];
      setCurrentProduct({ 
        ...currentProduct, 
        images: newImages,
        image: image_url 
      });
      toast.success("Producto centrado");
    } catch (e) {
      toast.error("Centrar producto: " + (e.message || "Error"));
    } finally { setCenteringProduct(false); }
  };

  const handleAddCategory = async () => { 
    if (!newCatName) return; 
    try {
      const newCat = await apiClient.createCategory({ name: newCatName, icon: newCatIcon });
      toast.success("Categoría creada");
      setNewCatName(""); 
      setNewCatIcon("Package");
      // 直接添加到状态，避免重新获取所有数据
      if (newCat) {
        setCategories(prev => [...prev, newCat]);
      } else {
        fetchData();
      }
    } catch (error) {
      toast.error("Error: " + error.message);
      console.error("Error creating category:", error);
    }
  };
  
  const handleAddSubCategory = async (pid) => { 
    if (!newSubName) return; 
    try {
      const newSub = await apiClient.createSubCategory({ parent_id: pid, name: newSubName });
      toast.success("Subcategoría creada");
      setNewSubName(""); 
      setSelectedParentForSub(null); 
      // 直接添加到状态，避免重新获取所有数据
      if (newSub) {
        setSubCategories(prev => [...prev, newSub]);
      } else {
        // 如果返回的数据不完整，才重新获取
        fetchData();
      }
    } catch (error) {
      toast.error("Error: " + error.message);
      console.error("Error creating subcategory:", error);
    }
  };
  
  const handleDeleteCategory = async (id, isSub) => { 
    if(!window.confirm("¿Borrar?")) return; 
    try {
      if (isSub) {
        await apiClient.deleteSubCategory(id);
        // 直接从状态中移除，避免重新获取所有数据
        setSubCategories(prev => prev.filter(s => s.id !== id));
      } else {
        await apiClient.deleteCategory(id);
        // 直接从状态中移除，避免重新获取所有数据
        setCategories(prev => prev.filter(c => c.id !== id));
        // 同时移除该类别下的所有子类别
        setSubCategories(prev => prev.filter(s => s.parent_id !== id));
      }
      toast.success("Eliminado");
    } catch (error) {
      toast.error("Error: " + error.message);
      console.error("Error deleting category:", error);
      // 如果删除失败，重新获取数据以确保同步
      fetchData();
    }
  };
  
  const handleDeleteRepair = async (id) => { 
    if(!window.confirm("¿Borrar?")) return; 
    try {
      await apiClient.deleteRepairService(id);
      toast.success("Servicio eliminado");
      // 直接从状态中移除，避免重新获取所有数据
      setRepairs(prev => prev.filter(r => r.id !== id));
    } catch (error) {
      toast.error("Error: " + error.message);
      console.error("Error deleting repair:", error);
      // 如果删除失败，重新获取数据以确保同步
      fetchData();
    }
  };

  const updateOrderStatus = async (oid, st) => { 
    try {
      await apiClient.updateOrderStatus(oid, st);
      toast.success("Estado actualizado");
      fetchData();
    } catch (error) {
      toast.error("Error: " + error.message);
    }
  };

  // ¿Pedido de pago en tienda / contra reembolso aún sin cobrar?
  // Detectamos por método de pago (no por estado), para que el botón
  // "Cobrar y entregar" siga disponible aunque el pedido haya pasado a
  // "Listo para recoger". Al cobrarlo, payment_method pasa a
  // "Efectivo/Tarjeta (en tienda)" y el regex deja de coincidir.
  const isUnpaidCounter = (o) =>
    /contra\s*reembolso/i.test(o?.payment_method || '') && !['Entregado', 'Cancelado'].includes(o?.status);

  // Marca un pedido de pago en tienda como cobrado + entregado,
  // registrando el método real (efectivo / tarjeta TPV) para contabilidad.
  const confirmCollect = async (method) => {
    if (!collectTarget) return;
    setCollectBusy(true);
    try {
      const targetId = collectTarget.id;
      const amount = `€${Number(collectTarget.total || 0).toFixed(2)}`;
      await apiClient.updateOrderStatus(targetId, 'Entregado', method);
      toast.success(`Cobrado ${amount} · ${method}`, { icon: '💰', duration: 3500 });
      // Actualización en sitio (sin recargar toda la página).
      setOrders(prev => prev.map(o => o.id === targetId
        ? { ...o, status: 'Entregado', payment_method: method }
        : o));
      setCollectTarget(null);
    } catch (error) {
      toast.error('Error: ' + error.message);
    } finally {
      setCollectBusy(false);
    }
  };

  // Cobra (captura) la retención de tarjeta de un pedido "Autorizado".
  const captureOrder = async (oid) => {
    if (!window.confirm('¿Cobrar ahora el importe retenido de este pedido? El cliente verá el cargo definitivo en su tarjeta.')) return;
    try {
      const ord = orders.find(o => o.id === oid);
      const amount = ord?.total != null ? `€${Number(ord.total).toFixed(2)}` : '';
      const res = await apiClient.captureOrder(oid);
      toast.success(
        res?.alreadyCaptured ? 'Este pedido ya estaba cobrado' : `Cobrado ${amount}`.trim(),
        res?.alreadyCaptured ? undefined : { icon: '💰', duration: 3500 }
      );
      // Actualización EN SITIO (sin recargar toda la página): el cobro deja
      // el pedido en "Procesando". Fusionamos el pedido devuelto por el
      // backend si viene, y forzamos el estado final.
      setOrders(prev => prev.map(o => o.id === oid
        ? { ...o, ...(res?.order || {}), status: 'Procesando' }
        : o));
    } catch (error) {
      toast.error('Error al cobrar: ' + error.message);
    }
  };

  // Código de recogida determinista de 6 dígitos a partir del id del
  // pedido. DEBE coincidir byte a byte con pickupCode() en
  // backend/services/email.js para que el número que ve el personal en el
  // panel sea el mismo que recibe el cliente en su aviso.
  const pickupCode = (id) => {
    const s = String(id || '');
    let h = 0;
    for (let i = 0; i < s.length; i++) {
      h = (h * 31 + s.charCodeAt(i)) >>> 0;
    }
    return String(h % 1000000).padStart(6, '0');
  };

  // True si el pedido es de recogida en tienda (valor canónico
  // 'store_pickup'; /recog/ cubre datos antiguos sin delivery_method).
  const isPickupOrder = (o) => o?.delivery_method === 'store_pickup' || /recog/i.test(o?.address || '');

  // Avisa al cliente de que su pedido de recogida está listo: marca
  // "Listo para recoger", envía email con el código de recogida y ofrece
  // avisar por WhatsApp con un toque.
  const notifyOrderReady = async (oid) => {
    setNotifyingId(oid);
    try {
      const res = await apiClient.notifyOrderReady(oid);
      toast.success(res?.emailed ? 'Cliente avisado por email · pedido listo' : 'Pedido marcado como listo');
      setPickupWaModal({ waLink: res?.waLink || null, emailed: !!res?.emailed, code: res?.code || null });
      fetchData();
    } catch (error) {
      toast.error('Error al avisar: ' + error.message);
    } finally {
      setNotifyingId(null);
    }
  };

  // Confirma el reembolso del pedido del modal: llama al backend, que
  // reembolsa/libera en Stripe, repone stock, marca Cancelado y envía
  // email al cliente. Luego ofrecemos avisar por WhatsApp con un toque.
  const confirmRefund = async () => {
    if (!refundTarget) return;
    // En modo parcial: construir la lista de artículos devueltos.
    let opts;
    if (refundMode === 'partial') {
      const items = Object.entries(refundQtys)
        .map(([index, quantity]) => ({ index: Number(index), quantity: Number(quantity) }))
        .filter(it => it.quantity > 0);
      if (items.length === 0) {
        toast.error('Selecciona al menos un artículo a devolver');
        return;
      }
      opts = { partial: true, items };
    }
    setRefundBusy(true);
    try {
      const res = await apiClient.refundOrder(refundTarget.id, refundReason.trim(), opts);
      const msgByType = {
        refunded: 'Reembolso emitido al cliente',
        partial: `Reembolso parcial emitido (€${Number(res?.amount || 0).toFixed(2)})`,
        released: 'Retención liberada (no se cobró nada)',
        cancelled: 'Pedido cancelado',
      };
      toast.success(msgByType[res?.refundType] || 'Pedido reembolsado');
      setRefundTarget(null);
      setRefundReason("");
      setRefundQtys({});
      setRefundMode('total');
      setRefundWaModal({ waLink: res?.waLink || null, emailed: !!res?.emailed, refundType: res?.refundType });
      fetchData();
    } catch (error) {
      toast.error('Error al reembolsar: ' + error.message);
    } finally {
      setRefundBusy(false);
    }
  };

  // Exporta la lista de pedidos (ya filtrada) a un CSV compatible con
  // Excel. Usa ';' como separador (Excel ES) y BOM UTF-8 para que los
  // acentos y el € se vean bien. Cada campo se escapa entre comillas.
  const exportOrdersCsv = (list) => {
    if (!list || list.length === 0) {
      toast.error("No hay pedidos para exportar");
      return;
    }
    const esc = (v) => {
      const s = (v === null || v === undefined) ? '' : String(v);
      return `"${s.replace(/"/g, '""')}"`;
    };
    const headers = [
      'Nº pedido', 'Fecha', 'Teléfono', 'Email', 'Dirección',
      'Entrega', 'Estado', 'Pago', 'Cupón', 'Descuento (EUR)', 'Total (EUR)', 'Artículos', 'Nota',
    ];
    const rows = list.map(o => {
      const fecha = o.created_at
        ? new Date(o.created_at).toLocaleString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
        : '';
      const entrega = o.delivery_method === 'store_pickup' ? 'Recogida' : 'Envío';
      const articulos = Array.isArray(o.items)
        ? o.items.map(it => `${it.quantity || 1}x ${it.name || ''}${it.id != null ? ` (#${it.id})` : ''}`).join(' | ')
        : '';
      return [
        o.id || '', fecha, o.phone || '', o.customer_email || '', o.address || '',
        entrega, o.status || '', o.payment_method || '',
        o.coupon_code || '', (Number(o.discount) || 0).toFixed(2),
        (Number(o.total) || 0).toFixed(2), articulos, o.note || '',
      ].map(esc).join(';');
    });
    const csv = '\uFEFF' + [headers.map(esc).join(';'), ...rows].join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `pedidos_hipera_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success(`${list.length} pedido(s) exportado(s)`);
  };

  const buildTicketPdfBlob = async (order) => {
    const isService = order.items?.some(i => i.isService) ?? false;
    const orderQueryUrl = `${window.location.origin.replace(/\/admin.*$/, '')}/?order=${order.id}`;
    const qrCodeUrl = await QRCode.toDataURL(orderQueryUrl, { errorCorrectionLevel: 'H', width: 300, margin: 2 });
    const doc = new jsPDF({ orientation: 'p', unit: 'mm', format: [80, 260] });
    let y = 10;
    const centerX = 40;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(18);
    doc.text(COMPANY_DATA.name, centerX, y, { align: 'center' });
    y += 6;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.text('Mercado & Servicios', centerX, y, { align: 'center' });
    y += 5;
    doc.text(COMPANY_DATA.address, centerX, y, { align: 'center' });
    y += 5;
    doc.text(`NIF: ${COMPANY_DATA.nif}`, centerX, y, { align: 'center' });
    y += 5;
    doc.text(new Date(order.created_at).toLocaleString('es-ES'), centerX, y, { align: 'center' });
    y += 8;
    doc.setFontSize(9);
    doc.text('--------------------------------', centerX, y, { align: 'center' });
    y += 5;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.text(isService ? 'RESGUARDO REPARACION' : 'JUSTIFICANTE DE PEDIDO', centerX, y, { align: 'center' });
    y += 5;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.text(`Ref: ${order.id.slice(0, 8)}`, centerX, y, { align: 'center' });
    y += 5;
    doc.text('--------------------------------', centerX, y, { align: 'center' });
    y += 6;
    doc.setFontSize(10);
    const regular = order.items?.filter(i => !(i.isGift || i.price === 0)) ?? [];
    const gifts = order.items?.filter(i => i.isGift || i.price === 0) ?? [];
    regular.forEach((item) => {
      const idTag = item.id != null ? `#${item.id} ` : '';
      doc.text((idTag + (item.name || '')).substring(0, 28), 5, y);
      y += 5;
      doc.text(`${item.quantity} x ${(item.price || 0).toFixed(2)}`.padEnd(20) + `€${((item.price || 0) * (item.quantity || 0)).toFixed(2)}`, 5, y);
      y += 6;
    });
    if (gifts.length > 0) {
      y += 3;
      doc.text('--------------------------------', centerX, y, { align: 'center' });
      y += 5;
      doc.setFont('helvetica', 'bold');
      doc.text('REGALO(S) — GRATIS', centerX, y, { align: 'center' });
      y += 6;
      doc.setFont('helvetica', 'normal');
      gifts.forEach((item) => {
        const idTag = item.id != null ? `#${item.id} ` : '';
        doc.text(`${(idTag + (item.name || '')).substring(0, 22)} [REGALO]`, 5, y);
        y += 5;
        doc.text(`${item.quantity} x 0.00`.padEnd(20) + 'GRATIS', 5, y);
        y += 6;
      });
    }
    y += 3;
    doc.text('--------------------------------', centerX, y, { align: 'center' });
    y += 6;
    // Desglose: subtotal - descuento + envio = total. El envio se deriva
    // (no se guarda como linea aparte) para que las cuentas cuadren.
    const ticketDiscount = Number(order.discount) || 0;
    const ticketItemsGross = regular.reduce((s, it) => s + ((it.price || 0) * (it.quantity || 0)), 0);
    const ticketShipping = Math.max(0, Math.round(((order.total || 0) - (ticketItemsGross - ticketDiscount)) * 100) / 100);
    if (ticketDiscount > 0 || ticketShipping > 0) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(10);
      doc.text('Subtotal:'.padEnd(18) + `EUR ${ticketItemsGross.toFixed(2)}`, 5, y);
      y += 5;
      if (ticketDiscount > 0) {
        doc.text(`Dto (${order.coupon_code || 'CUPON'}):`.padEnd(16) + `-EUR ${ticketDiscount.toFixed(2)}`, 5, y);
        y += 5;
      }
      if (ticketShipping > 0) {
        doc.text('Envio:'.padEnd(18) + `EUR ${ticketShipping.toFixed(2)}`, 5, y);
        y += 5;
      }
      y += 1;
    }
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.text(`TOTAL:     EUR ${(order.total || 0).toFixed(2)}`, 5, y);
    y += 7;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.text('Precios con impuestos incluidos si corresponde.', 5, y);
    y += 6;
    doc.text('No valido como factura fiscal.', 5, y);
    y += 6;
    doc.setFontSize(10);
    doc.text(`Pago: ${(order.payment_method || 'Efectivo/Bizum').toUpperCase()}`, 5, y);
    y += 10;
    if (isService) {
      doc.setFontSize(9);
      doc.text('GARANTIA DE REPARACION: 6 MESES', centerX, y, { align: 'center' });
      y += 5;
      doc.text('Imprescindible presentar este ticket', centerX, y, { align: 'center' });
      y += 6;
    }
    doc.addImage(qrCodeUrl, 'PNG', 20, y, 40, 40);
    y += 45;
    doc.setFontSize(10);
    doc.text('¡Gracias por su visita!', centerX, y, { align: 'center' });
    return doc.output('blob');
  };

  const openOrderFactura = async (order) => {
    try {
      const isService = order.items?.some(i => i.isService) ?? false;
      const orderQueryUrl = `${window.location.origin.replace(/\/admin.*$/, '')}/?order=${order.id}`;
      const qrCodeUrl = await QRCode.toDataURL(orderQueryUrl, { errorCorrectionLevel: 'H', width: 300, margin: 2 });
      const doc = new jsPDF();
      doc.setFillColor(220, 38, 38);
      doc.rect(0, 0, 210, 40, 'F');
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(24);
      doc.setFont('helvetica', 'bold');
      doc.text(COMPANY_DATA.name, 14, 20);
      doc.setFontSize(10);
      doc.setFont('helvetica', 'normal');
      doc.text('Mercado & Reparaciones', 14, 26);
      doc.setFontSize(10);
      doc.text(COMPANY_DATA.address, 196, 15, { align: 'right' });
      doc.text(`NIF: ${COMPANY_DATA.nif}`, 196, 20, { align: 'right' });
      doc.text(`Tel: ${COMPANY_DATA.phone}`, 196, 25, { align: 'right' });
      doc.setTextColor(0, 0, 0);
      doc.setFontSize(11);
      doc.text('CLIENTE:', 14, 55);
      doc.setFont('helvetica', 'normal');
      doc.text(order.address || 'Cliente General', 14, 62);
      doc.text(order.phone || '', 14, 67);
      doc.setFont('helvetica', 'bold');
      doc.text('JUSTIFICANTE DE PEDIDO', 140, 55);
      doc.setFont('helvetica', 'normal');
      doc.text(`Pedido: ${order.id.slice(0, 8).toUpperCase()}`, 140, 62);
      doc.text(`Fecha: ${new Date(order.created_at).toLocaleDateString('es-ES')}`, 140, 67);
      doc.text(`Forma de Pago: ${(order.payment_method || 'CONTADO').toUpperCase()}`, 140, 72);
      doc.setFontSize(8);
      doc.setTextColor(120);
      doc.text('Documento no válido como factura fiscal.', 140, 77);
      doc.text('Si necesita factura oficial, solicítela con sus datos fiscales.', 140, 81);
      doc.setTextColor(0, 0, 0);
      const regularItems = (order.items || []).filter(i => !(i.isGift || i.price === 0));
      const giftItems = (order.items || []).filter(i => i.isGift || i.price === 0);
      let startY = 80;
      if (regularItems.length > 0) {
        const tableRows = regularItems.map(item => [
          item.name || '',
          item.quantity,
          `€${(item.price || 0).toFixed(2)}`,
          `€${((item.price || 0) * (item.quantity || 0)).toFixed(2)}`
        ]);
        autoTable(doc, {
          startY,
          head: [['Descripción', 'Cant.', 'Precio', 'TOTAL']],
          body: tableRows,
          theme: 'grid',
          headStyles: { fillColor: [31, 41, 55] },
          styles: { fontSize: 9 },
        });
        startY = doc.lastAutoTable.finalY + 8;
      }
      if (giftItems.length > 0) {
        doc.setFontSize(10);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(180, 80, 120);
        doc.text('Regalo(s) — GRATIS', 14, startY);
        startY += 6;
        doc.setTextColor(0, 0, 0);
        doc.setFont('helvetica', 'normal');
        const giftRows = giftItems.map(item => [
          `${(item.name || '')} [REGALO]`,
          item.quantity,
          '0.00',
          '€0.00'
        ]);
        autoTable(doc, {
          startY,
          head: [['Descripción', 'Cant.', 'Precio', 'TOTAL']],
          body: giftRows,
          theme: 'grid',
          headStyles: { fillColor: [180, 80, 120] },
          styles: { fontSize: 9 },
        });
        startY = doc.lastAutoTable.finalY + 8;
      }
      let finalY = startY + 2;
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(10);
      const couponDiscount = Number(order.discount) || 0;
      const itemsGross = regularItems.reduce((s, it) => s + ((it.price || 0) * (it.quantity || 0)), 0);
      // Envío derivado: total = subtotal(items) - descuento + envío.
      const shipping = Math.max(0, Math.round(((order.total || 0) - (itemsGross - couponDiscount)) * 100) / 100);
      if (couponDiscount > 0 || shipping > 0) {
        doc.text('Subtotal:', 160, finalY, { align: 'right' });
        doc.text(`€${itemsGross.toFixed(2)}`, 190, finalY, { align: 'right' });
        finalY += 5;
        if (couponDiscount > 0) {
          doc.setTextColor(22, 130, 60);
          doc.text(`Descuento (${order.coupon_code || 'CUPÓN'}):`, 160, finalY, { align: 'right' });
          doc.text(`-€${couponDiscount.toFixed(2)}`, 190, finalY, { align: 'right' });
          doc.setTextColor(0, 0, 0);
          finalY += 5;
        }
        if (shipping > 0) {
          doc.text('Envío:', 160, finalY, { align: 'right' });
          doc.text(`€${shipping.toFixed(2)}`, 190, finalY, { align: 'right' });
          finalY += 5;
        }
      }
      doc.setTextColor(120);
      doc.text('Precios con impuestos incluidos cuando corresponda.', 190, finalY, { align: 'right' });
      finalY += 9;
      doc.setTextColor(0, 0, 0);
      doc.setFontSize(14);
      doc.setFont('helvetica', 'bold');
      doc.text('TOTAL A PAGAR:', 160, finalY, { align: 'right' });
      doc.text(`€${(order.total || 0).toFixed(2)}`, 190, finalY, { align: 'right' });
      if (isService) {
        const boxY = finalY + 11;
        doc.setDrawColor(200);
        doc.setFillColor(248, 248, 248);
        doc.rect(14, boxY, 182, 50, 'FD');
        doc.setFontSize(10);
        doc.setTextColor(220, 38, 38);
        doc.text('GARANTÍA Y CONDICIONES', 18, boxY + 8);
        doc.setFontSize(8);
        doc.setTextColor(80);
        ['1. Validez: 180 días de garantía sobre la reparación efectuada.',
         '2. Exclusiones: No cubre daños por humedad, golpes posteriores o manipulación externa.',
         '3. Recogida: Dispone de 3 meses para recoger su dispositivo. Pasado este tiempo, será enviado a reciclaje.',
         '4. Datos: La empresa no se hace responsable de la pérdida de software o datos.'].forEach((line, i) =>
          doc.text(line, 18, boxY + 16 + (i * 5)));
      }
      doc.addImage(qrCodeUrl, 'PNG', 14, 250, 25, 25);
      doc.setFontSize(8);
      doc.setTextColor(150);
      doc.text('Escanea para ver tu pedido online', 42, 260);
      doc.text('Gracias por su visita.', 42, 265);
      const blob = doc.output('blob');
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank');
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      toast.success('Justificante abierto');
    } catch (e) {
      toast.error('Error al abrir justificante: ' + (e.message || 'Error'));
    }
  };

  const openOrderTicket = async (order) => {
    try {
      const blob = await buildTicketPdfBlob(order);
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank');
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      toast.success('Ticket abierto');
    } catch (e) {
      toast.error('Error al abrir ticket: ' + (e.message || 'Error'));
    }
  };

  const printOrderTicket = async (order) => {
    try {
      const blob = await buildTicketPdfBlob(order);
      const url = URL.createObjectURL(blob);
      const w = window.open(url, '_blank');
      if (w) {
        setTimeout(() => { try { w.print(); } catch (_) { /* ignore */ } }, 800);
        setTimeout(() => URL.revokeObjectURL(url), 30000);
        toast.success('Imprimir ticket');
      } else {
        const iframe = document.createElement('iframe');
        iframe.style.cssText = 'position:fixed;width:0;height:0;border:none;';
        document.body.appendChild(iframe);
        iframe.src = url;
        iframe.onload = () => {
          setTimeout(() => {
            try { iframe.contentWindow?.print(); } catch (_) { window.open(url, '_blank'); }
          }, 600);
          setTimeout(() => { URL.revokeObjectURL(url); try { document.body.removeChild(iframe); } catch (_) { /* ignore */ } }, 30000);
        };
        toast.success('Imprimir ticket');
      }
    } catch (e) {
      toast.error('Error al imprimir: ' + (e.message || 'Error'));
    }
  };

  // --- Renders ---
  const todayOrders = orders.filter(o => {
    if (!o.created_at) return false;
    const d = new Date(o.created_at);
    const t = new Date();
    return d.getFullYear() === t.getFullYear() && d.getMonth() === t.getMonth() && d.getDate() === t.getDate();
  });

  // --- Métricas del dashboard ---
  const LOW_STOCK_THRESHOLD = 5;
  // Para "ingresos" no contamos pedidos cancelados ni los que aún
  // esperan pago (no son ventas reales todavía).
  // "Autorizado" se excluye de ingresos: el importe sólo está RETENIDO en la
  // tarjeta, aún no cobrado. Cuenta como ingreso al capturarlo (→ "Procesando").
  const REVENUE_EXCLUDED = ['Cancelado', 'Esperando pago', 'Autorizado'];
  const validRevenueOrders = orders.filter(o => !REVENUE_EXCLUDED.includes(o.status));
  const revenueTotal = validRevenueOrders.reduce((a, b) => a + (Number(b.total) || 0), 0);
  const revenueToday = todayOrders
    .filter(o => !REVENUE_EXCLUDED.includes(o.status))
    .reduce((a, b) => a + (Number(b.total) || 0), 0);
  // "Pendientes": pedidos ya confirmados que faltan por preparar/entregar.
  const pendingCount = orders.filter(o => o.status === 'Procesando').length;
  const lowStockProducts = products
    .filter(p => (p.stock ?? 0) > 0 && (p.stock ?? 0) <= LOW_STOCK_THRESHOLD)
    .sort((a, b) => (a.stock ?? 0) - (b.stock ?? 0));
  // Productos más vendidos (suma de unidades en pedidos válidos, sin regalos).
  const topProducts = (() => {
    const map = new Map();
    for (const o of validRevenueOrders) {
      if (!Array.isArray(o.items)) continue;
      for (const it of o.items) {
        if (it?.isGift || it?.price === 0) continue;
        const key = it.id != null ? `id:${it.id}` : `name:${it.name}`;
        const prev = map.get(key) || { id: it.id, name: it.name, qty: 0, revenue: 0 };
        prev.qty += Number(it.quantity) || 0;
        prev.revenue += (Number(it.price) || 0) * (Number(it.quantity) || 0);
        map.set(key, prev);
      }
    }
    return Array.from(map.values()).sort((a, b) => b.qty - a.qty).slice(0, 5);
  })();

  const renderDashboard = () => (
    <div className="space-y-6 animate-fade-in">
        <h2 className="text-2xl font-bold text-gray-800">Panel General</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-white p-5 rounded-xl shadow-sm border border-gray-100">
            <p className="text-gray-500 text-xs uppercase font-bold">Ingresos hoy</p>
            <h3 className="text-2xl font-bold text-gray-900">€{revenueToday.toFixed(2)}</h3>
          </div>
          <div className="bg-white p-5 rounded-xl shadow-sm border border-gray-100">
            <p className="text-gray-500 text-xs uppercase font-bold">Pedidos hoy</p>
            <h3 className="text-2xl font-bold text-gray-800">{todayOrders.length}</h3>
          </div>
          <button
            type="button"
            onClick={() => { setActiveTab('orders'); setOrderStatusFilter('Procesando'); setOrderSearch(''); setOrderDateFrom(''); setOrderDateTo(''); setSidebarOpen(false); }}
            className={`text-left p-5 rounded-xl shadow-sm border transition-colors ${pendingCount > 0 ? 'bg-gray-50 border-gray-200 hover:bg-gray-100' : 'bg-white border-gray-100'}`}
            title="Ver pedidos pendientes de preparar"
          >
            <p className="text-gray-500 text-xs uppercase font-bold">Pendientes</p>
            <h3 className="text-2xl font-bold text-gray-900">{pendingCount}</h3>
          </button>
          <div className="bg-white p-5 rounded-xl shadow-sm border border-gray-100">
            <p className="text-gray-500 text-xs uppercase font-bold">Ingresos total</p>
            <h3 className="text-2xl font-bold text-gray-800">€{revenueTotal.toFixed(2)}</h3>
            <p className="text-[11px] text-gray-400 mt-0.5">{orders.length} pedidos · {products.length} productos</p>
          </div>
        </div>
        {topProducts.length > 0 && (
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
            <h3 className="p-4 font-bold text-gray-800 border-b border-gray-100 flex items-center gap-2">
              <TrendingUp size={18} className="text-gray-400"/> Productos más vendidos
            </h3>
            <div className="divide-y">
              {topProducts.map((p, i) => {
                const img = products.find(x => x.id === p.id)?.image;
                return (
                  <div key={p.id ?? p.name ?? i} className="p-3 px-4 flex items-center gap-3 hover:bg-gray-50">
                    <span className="text-sm font-bold text-gray-400 w-5 flex-shrink-0">{i + 1}</span>
                    {img && <img src={img} alt="" loading="lazy" className="w-9 h-9 rounded object-cover border border-gray-200 flex-shrink-0 bg-gray-50"/>}
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-gray-800 truncate" title={p.name}>{productDisplayName(p)}{p.id != null && <span className="text-gray-400 font-mono text-xs ml-1">#{p.id}</span>}</div>
                      <div className="text-xs text-gray-500">€{p.revenue.toFixed(2)} en ventas</div>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <div className="font-bold text-gray-800">{p.qty}</div>
                      <div className="text-[11px] text-gray-400 uppercase">uds.</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
        {lowStockProducts.length > 0 && (
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
            <h3 className="p-4 font-bold text-gray-700 border-b border-gray-100 bg-gray-50 flex items-center gap-2">
              <AlertCircle size={18} className="text-gray-400"/> Stock bajo (≤ {LOW_STOCK_THRESHOLD} uds.) — {lowStockProducts.length}
            </h3>
            <div className="divide-y max-h-72 overflow-y-auto">
              {lowStockProducts.map(p => (
                <div key={p.id} className="p-4 flex flex-wrap items-center gap-3 hover:bg-gray-50">
                  <img src={p.image || "https://via.placeholder.com/40"} alt="" className="w-10 h-10 rounded object-cover bg-gray-100 flex-shrink-0"/>
                  <div className="flex-1 min-w-0">
                    <div className="font-bold text-gray-800 truncate" title={p.name}>{productDisplayName(p)}<span className="text-gray-400 font-mono text-xs ml-1">#{p.id}</span></div>
                    <div className="text-xs text-gray-500">€{p.price?.toFixed(2)} · quedan <span className="font-bold text-gray-900">{p.stock}</span></div>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min="0"
                      value={stockEdits[p.id] ?? p.stock ?? 0}
                      onChange={e => setStockEdits(prev => ({ ...prev, [p.id]: e.target.value }))}
                      className="w-16 px-2 py-1.5 border rounded text-sm"
                    />
                    <button
                      type="button"
                      onClick={() => handleQuickStockUpdate(p)}
                      disabled={updatingStockId === p.id}
                      className="px-3 py-1.5 rounded-lg bg-gray-900 text-white text-sm font-medium hover:bg-gray-800 disabled:opacity-50"
                    >
                      {updatingStockId === p.id ? "..." : "Actualizar"}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        {(() => {
          const soldOut = products.filter(p => (p.stock ?? 0) === 0);
          return soldOut.length > 0 ? (
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
              <h3 className="p-4 font-bold text-gray-800 border-b border-gray-100">Productos agotados (stock=0)</h3>
              <div className="divide-y max-h-72 overflow-y-auto">
                {soldOut.map(p => (
                  <div key={p.id} className="p-4 flex flex-wrap items-center gap-3 hover:bg-gray-50">
                    <img src={p.image || "https://via.placeholder.com/40"} alt="" className="w-10 h-10 rounded object-cover bg-gray-100 flex-shrink-0"/>
                    <div className="flex-1 min-w-0">
                      <div className="font-bold text-gray-800 truncate" title={p.name}>{productDisplayName(p)}</div>
                      <div className="text-xs text-gray-500">€{p.price?.toFixed(2)}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        min="0"
                        value={stockEdits[p.id] ?? p.stock ?? 0}
                        onChange={e => setStockEdits(prev => ({ ...prev, [p.id]: e.target.value }))}
                        className="w-16 px-2 py-1.5 border rounded text-sm"
                      />
                      <button
                        type="button"
                        onClick={() => handleQuickStockUpdate(p)}
                        disabled={updatingStockId === p.id}
                        className="px-3 py-1.5 rounded-lg bg-gray-900 text-white text-sm font-medium hover:bg-gray-800 disabled:opacity-50"
                      >
                        {updatingStockId === p.id ? "..." : "Actualizar"}
                      </button>
                      <button type="button" onClick={() => handleDeleteProduct(p.id)} className="p-1.5 rounded-lg text-red-600 hover:bg-red-50" title="Eliminar">
                        <Trash2 size={18}/>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null;
        })()}
        {todayOrders.length > 0 && (
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
            <h3 className="p-4 font-bold text-gray-800 border-b border-gray-100">Pedidos de hoy</h3>
            <div className="divide-y max-h-64 overflow-y-auto">
              {todayOrders.map(o => {
                const dateStr = o.created_at ? new Date(o.created_at).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }) : '';
                return (
                  <div key={o.id} className="p-4 flex flex-wrap items-center justify-between gap-2 hover:bg-gray-50">
                    <div className="min-w-0">
                      <span className="font-mono text-xs font-bold text-gray-500">#{o.id.slice(0,8)}</span>
                      <span className="text-gray-400 text-xs ml-2">{dateStr}</span>
                      <div className="font-bold text-gray-800 truncate">{o.phone}</div>
                      <div className="text-xs text-gray-500 truncate">{o.address}</div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className="font-bold text-gray-800">€{o.total?.toFixed(2)}</span>
                      <button type="button" onClick={() => openOrderFactura(o)} className="p-1.5 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-600" title="Ver justificante">
                        <FileText size={16}/>
                      </button>
                      <button type="button" onClick={() => openOrderTicket(o)} className="p-1.5 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-600" title="Ver ticket">
                        <FileText size={16}/>
                      </button>
                      <button type="button" onClick={() => printOrderTicket(o)} className="p-1.5 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-600" title="Imprimir ticket">
                        <Printer size={16}/>
                      </button>
                      <button type="button" onClick={() => { setActiveTab('orders'); }} className="text-xs text-gray-700 font-bold">Ver</button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
    </div>
  );

  const renderProducts = () => {
    const searchLower = searchTerm.toLowerCase().trim();
    const reviewStats = {
      total: products.length,
      pending: products.filter(productNeedsReview).length,
      reviewed: products.filter(isProductReviewed).length,
      noTax: products.filter(p => !p.taxRate && !p.tax_rate).length,
      lowStock: products.filter(p => Number(p.stock || 0) <= LOW_STOCK_THRESHOLD).length,
      noImage: products.filter(p => !p.image && !(p.images || [])[0]).length,
      imageNeedsOptimization: products.filter(p => p.imageNeedsOptimization || p.image_needs_optimization).length,
    };
    const taxBatchOptions = Object.entries(TAX_SUGGESTION_BATCH_LABELS).map(([id, label]) => ({
      id,
      label,
      count: taxSuggestions.filter((item) => item.batch_id === id).length,
    })).filter((item) => item.count > 0);
    // El nº tras quitar un '#' inicial permite buscar por id (ej. "#42"
    // o "42") además de por nombre, para casar con el #id que aparece en
    // pedidos y tickets.
    const searchId = searchLower.replace(/^#/, '');
    const isIdQuery = /^\d+$/.test(searchId);
    let filtered = products.filter(p => {
      if (!searchLower) return true;
      // id: coincidencia EXACTA (buscar 19 no debe traer 190, 198...).
      if (isIdQuery && String(p.id) === searchId) return true;
      if ((p.name || '').toLowerCase().includes(searchLower)) return true;
      if ((p.shortName || p.short_name || '').toLowerCase().includes(searchLower)) return true;
      return false;
    });
    if (productReviewMode) {
      filtered = getManualReviewOrderedProducts(filtered.filter(productNeedsReview));
    }
    if (taxBatchFilter) {
      filtered = filtered.filter(p => getTaxSuggestionForProduct(p)?.batch_id === taxBatchFilter);
    }
    if (imageOptimizationOnly) {
      filtered = filtered.filter(p => p.imageNeedsOptimization || p.image_needs_optimization);
    }
    const isSearching = !!searchLower;
    const catFilter = selectedProductCategory === '' ? null : (selectedProductCategory === '_none' ? '__none__' : parseInt(selectedProductCategory, 10));

    // Estructura: byCategoryAndSub[cid][subId] = [productos]
    const byCategoryAndSub = {};
    filtered.forEach(p => {
      const raw = p.category;
      const cid = (raw != null && raw !== '') ? Number(raw) : '__none__';
      if (catFilter !== null && cid !== catFilter) return;
      const subRaw = p.subCategoryId ?? p.sub_category_id;
      const subId = (subRaw != null && subRaw !== '') ? Number(subRaw) : '__none__';
      if (!byCategoryAndSub[cid]) byCategoryAndSub[cid] = {};
      if (!byCategoryAndSub[cid][subId]) byCategoryAndSub[cid][subId] = [];
      byCategoryAndSub[cid][subId].push(p);
    });

    const catOrder = catFilter !== null ? [catFilter] : [...categories.map(c => c.id), '__none__'];

    const productDnD = (p, targetP, list, cid, subId) => {
      if (p.id === targetP.id) return;
      const ids = list.map(x => x.id);
      const fromIdx = ids.indexOf(p.id);
      const toIdx = ids.indexOf(targetP.id);
      if (fromIdx < 0 || toIdx < 0) return;
      ids.splice(fromIdx, 1);
      ids.splice(ids.indexOf(targetP.id), 0, p.id);
      handleReorderProducts(buildProductReorder(cid, subId, ids));
    };

    const openProductForReview = (product) => {
      if (!product) {
        toast("No quedan productos pendientes");
        return;
      }
      setCurrentProduct(product);
      setIsEditing(true);
    };

    const openNextReviewProduct = () => {
      const selectedCategoryKey = getSelectedProductCategoryKey();
      const candidates = getManualReviewOrderedProducts(
        filtered
          .filter(productNeedsReview)
          .filter(p => selectedCategoryKey === null || getProductCategoryKey(p) === selectedCategoryKey)
      );
      openProductForReview(candidates[0]);
    };

    const renderProductRow = (p, cid, subId, list) => (
      <tr key={p.id} draggable onDragStart={e => { e.dataTransfer.setData('application/json', JSON.stringify({ type: 'product', id: p.id })); e.dataTransfer.effectAllowed = 'move'; }} onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }} onDrop={e => { e.preventDefault(); try { const d = JSON.parse(e.dataTransfer.getData('application/json')); if (d.type === 'product') { const target = list.find(x => x.id === p.id); if (target) productDnD(list.find(x => x.id === d.id), target, list, cid, subId); } } catch (_) { /* ignore */ } }}>
        <td className="p-2 w-10">
          {(p.image || p.images?.[0]) && (
            <input type="checkbox" checked={selectedProductIds.has(p.id)} onChange={() => toggleProductSelect(p.id)} className="rounded" onClick={e => e.stopPropagation()}/>
          )}
          <GripVertical size={14} className="text-gray-400 cursor-grab inline-block" style={{ verticalAlign: 'middle' }}/>
        </td>
        <td className="p-4 flex items-center gap-3">
          <img src={p.image || "https://via.placeholder.com/40"} alt="" className="w-10 h-10 rounded object-cover bg-gray-100"/>
          <div>
            <div className="font-bold" title={p.name}>{productDisplayName(p)} <span className="text-gray-400 font-mono text-xs font-normal">#{p.id}</span></div>
            {(p.shortName || p.short_name) && <div className="text-xs text-gray-500 truncate" title={p.name}>{p.name}</div>}
            <div className="flex flex-wrap gap-1 mt-1">
              {p.oferta && <span className="bg-gray-100 text-gray-700 border border-gray-200 rounded px-1.5 py-0.5 text-[10px] font-bold">OFERTA</span>}
              {(p.imageNeedsOptimization || p.image_needs_optimization) && <span className="bg-gray-100 text-gray-600 border border-gray-200 rounded px-1.5 py-0.5 text-[10px] font-bold">FOTO</span>}
              {(() => {
                const suggestion = getTaxSuggestionForProduct(p);
                return suggestion ? <span className="bg-gray-100 text-gray-600 border border-gray-200 rounded px-1.5 py-0.5 text-[10px] font-bold">{TAX_SUGGESTION_BATCH_LABELS[suggestion.batch_id] || 'IVA sugerido'}</span> : null;
              })()}
            </div>
          </div>
        </td>
        <td className="p-4">€{p.price}</td>
        <td className="p-4">{p.stock}</td>
        <td className="p-4">
          <div className="flex flex-col gap-1">
            <span className="text-xs font-bold text-gray-800">{taxRateLabel(p)}</span>
            <span className={`w-fit px-2 py-0.5 rounded-full border text-[11px] font-semibold ${taxStatusClass(p.taxReviewStatus || p.tax_review_status)}`}>{taxStatusLabel(p.taxReviewStatus || p.tax_review_status)}</span>
          </div>
        </td>
        <td className="p-4 text-right"><button type="button" onClick={() => openProductForReview(p)} className="text-gray-500 hover:text-gray-800 mr-2"><Edit2 size={18}/></button><button type="button" onClick={() => handleDeleteProduct(p.id)} className="text-gray-400 hover:text-red-600"><Trash2 size={18}/></button></td>
      </tr>
    );

    const renderProductCard = (p, cid, subId, list) => (
      <div key={p.id} className="bg-white rounded-xl shadow-sm border p-4 flex gap-3" draggable onDragStart={e => { e.dataTransfer.setData('application/json', JSON.stringify({ type: 'product', id: p.id })); e.dataTransfer.effectAllowed = 'move'; }} onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }} onDrop={e => { e.preventDefault(); try { const d = JSON.parse(e.dataTransfer.getData('application/json')); if (d.type === 'product') { const target = list.find(x => x.id === p.id); if (target) productDnD(list.find(x => x.id === d.id), target, list, cid, subId); } } catch (_) { /* ignore */ } }}>
        <div className="flex-shrink-0 pt-1 flex flex-col gap-1">
          {(p.image || p.images?.[0]) && (
            <input type="checkbox" checked={selectedProductIds.has(p.id)} onChange={() => toggleProductSelect(p.id)} className="rounded" onClick={e => e.stopPropagation()}/>
          )}
          <GripVertical size={14} className="text-gray-400 cursor-grab"/>
        </div>
        <div className="flex-1 min-w-0">
        <div className="flex items-start gap-3 mb-3">
          <img src={p.image || "https://via.placeholder.com/40"} alt="" className="w-12 h-12 rounded object-cover bg-gray-100 flex-shrink-0"/>
          <div className="flex-1 min-w-0">
            <div className="font-bold text-gray-800 truncate" title={p.name}>{productDisplayName(p)} <span className="text-gray-400 font-mono text-xs font-normal">#{p.id}</span></div>
            {(p.shortName || p.short_name) && <div className="text-xs text-gray-500 truncate" title={p.name}>{p.name}</div>}
            <div className="flex flex-wrap gap-1 mt-1">
              {p.oferta && <span className="bg-gray-100 text-gray-700 border border-gray-200 rounded px-1.5 py-0.5 text-[10px] font-bold">OFERTA</span>}
              {(p.imageNeedsOptimization || p.image_needs_optimization) && <span className="bg-gray-100 text-gray-600 border border-gray-200 rounded px-1.5 py-0.5 text-[10px] font-bold">FOTO</span>}
              {(() => {
                const suggestion = getTaxSuggestionForProduct(p);
                return suggestion ? <span className="bg-gray-100 text-gray-600 border border-gray-200 rounded px-1.5 py-0.5 text-[10px] font-bold">{TAX_SUGGESTION_BATCH_LABELS[suggestion.batch_id] || 'IVA sugerido'}</span> : null;
              })()}
            </div>
            <div className="flex items-center gap-4 mt-2 text-sm">
              <span className="font-bold text-gray-800">€{p.price}</span>
              <span className="text-gray-500">Stock: {p.stock}</span>
            </div>
            <div className="flex items-center gap-2 mt-2">
              <span className="text-xs font-bold text-gray-800">{taxRateLabel(p)}</span>
              <span className={`px-2 py-0.5 rounded-full border text-[11px] font-semibold ${taxStatusClass(p.taxReviewStatus || p.tax_review_status)}`}>{taxStatusLabel(p.taxReviewStatus || p.tax_review_status)}</span>
            </div>
          </div>
        </div>
        <div className="flex gap-2 justify-end">
          <button type="button" onClick={() => openProductForReview(p)} className="text-gray-600 px-3 py-1.5 rounded-lg hover:bg-gray-100 flex items-center gap-1"><Edit2 size={16}/><span className="text-xs">Editar</span></button>
          <button type="button" onClick={() => handleDeleteProduct(p.id)} className="text-red-600 px-3 py-1.5 rounded-lg hover:bg-red-50 flex items-center gap-1"><Trash2 size={16}/><span className="text-xs">Eliminar</span></button>
        </div>
        </div>
      </div>
    );

    const exportProductsCsv = () => {
      const exportRows = filtered.filter(p => {
        if (catFilter === null) return true;
        const cid = (p.category != null && p.category !== '') ? Number(p.category) : '__none__';
        return cid === catFilter;
      });
      const headers = ['id', ...CSV_IMPORT_FIELDS];
      const esc = (v) => {
        const s = String(v ?? '');
        return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      };
      const rows = exportRows.map(p => [
        p.id,
        p.name,
        p.shortName ?? p.short_name ?? '',
        p.price,
        p.stock,
        p.image || '',
        p.category ?? '',
        p.subCategoryId ?? p.sub_category_id ?? '',
        p.description || '',
        p.taxRate ?? p.tax_rate ?? '',
        p.taxCategory ?? p.tax_category ?? '',
        p.taxReviewStatus ?? p.tax_review_status ?? 'pending',
        p.taxNote ?? p.tax_note ?? '',
        p.imageNeedsOptimization ?? p.image_needs_optimization ?? false,
        p.oferta || false,
        p.oferta_type || 'percent',
        p.oferta_value || 0,
        p.giftProduct || p.gift_product || false,
        p.visible !== false,
      ]);
      const csv = '\uFEFF' + [headers.map(esc).join(';'), ...rows.map(r => r.map(esc).join(';'))].join('\r\n');
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `productos_iva_hipera_${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(a.href);
    };

    return (
      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row gap-3 bg-white p-4 rounded-xl shadow-sm items-stretch sm:items-center">
          <input id="search-products" name="search-products" placeholder="Buscar por nombre o #id (ej. 42)..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} className="flex-1 pl-4 pr-4 py-2 border rounded-lg text-sm outline-none focus:ring-2 ring-gray-200"/>
          <select value={selectedProductCategory} onChange={e => setSelectedProductCategory(e.target.value)} className="sm:w-48 pl-4 pr-4 py-2 border rounded-lg text-sm outline-none focus:ring-2 ring-gray-200 bg-white">
            <option value="">Todas las categorías</option>
            {categories.map(c => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
            <option value="_none">Sin categoría</option>
          </select>
          <select value={taxBatchFilter} onChange={e => setTaxBatchFilter(e.target.value)} className="sm:w-56 pl-4 pr-4 py-2 border rounded-lg text-sm outline-none focus:ring-2 ring-gray-200 bg-white">
            <option value="">Todos los lotes IVA</option>
            {taxBatchOptions.map((batch) => (
              <option key={batch.id} value={batch.id}>{batch.label} · {batch.count}</option>
            ))}
          </select>
          <button type="button" onClick={() => setProductReviewMode(v => !v)} className={`px-4 py-2 rounded-lg font-medium text-sm inline-flex items-center justify-center gap-2 ${productReviewMode ? 'bg-gray-900 text-white hover:bg-gray-800' : 'border border-gray-300 text-gray-700 hover:bg-gray-50'}`}>
            <CheckCircle size={18}/>
            {productReviewMode ? 'Modo revisión ON' : 'Modo revisión'}
          </button>
          {productReviewMode && (
            <button type="button" onClick={openNextReviewProduct} className="px-4 py-2 rounded-lg bg-gray-900 text-white font-medium text-sm inline-flex items-center justify-center gap-2 hover:bg-gray-800">
              <ChevronRight size={18}/>
              Abrir siguiente
            </button>
          )}
          <button type="button" onClick={() => setImageOptimizationOnly(v => !v)} className={`px-4 py-2 rounded-lg font-medium text-sm inline-flex items-center justify-center gap-2 ${imageOptimizationOnly ? 'bg-gray-900 text-white hover:bg-gray-800' : 'border border-gray-300 text-gray-700 hover:bg-gray-50'}`}>
            <ImageIcon size={18}/>
            Fotos marcadas
          </button>
          <button type="button" onClick={() => { setImportModalOpen(true); setImportPreview(null); setImportProgress({ done: 0, total: 0, errors: [] }); }} className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 font-medium text-sm inline-flex items-center justify-center gap-2 hover:bg-gray-50">
            <FileSpreadsheet size={18}/>
            Importar CSV
          </button>
          <button type="button" onClick={exportProductsCsv} className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 font-medium text-sm inline-flex items-center justify-center gap-2 hover:bg-gray-50">
            <Download size={18}/>
            Exportar IVA
          </button>
        </div>

        {taxSuggestionsLoadError && (
          <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-700">
            No se han podido cargar las sugerencias IVA locales. Revisa <span className="font-mono">/tax-suggestions/product-tax-suggestions.json</span>.
          </div>
        )}

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-2">
          <div className="bg-white rounded-xl border p-3"><div className="text-[11px] text-gray-500 font-bold uppercase">Productos</div><div className="text-xl font-extrabold text-gray-900">{reviewStats.total}</div></div>
          <div className="bg-white rounded-xl border p-3"><div className="text-[11px] text-gray-500 font-bold uppercase">Pendientes</div><div className="text-xl font-extrabold text-gray-900">{reviewStats.pending}</div></div>
          <div className="bg-white rounded-xl border p-3"><div className="text-[11px] text-gray-500 font-bold uppercase">Revisados</div><div className="text-xl font-extrabold text-gray-900">{reviewStats.reviewed}</div></div>
          <div className="bg-white rounded-xl border p-3"><div className="text-[11px] text-gray-500 font-bold uppercase">Sin IVA</div><div className="text-xl font-extrabold text-gray-900">{reviewStats.noTax}</div></div>
          <div className="bg-white rounded-xl border p-3"><div className="text-[11px] text-gray-500 font-bold uppercase">Stock bajo</div><div className="text-xl font-extrabold text-gray-900">{reviewStats.lowStock}</div></div>
          <div className="bg-white rounded-xl border p-3"><div className="text-[11px] text-gray-500 font-bold uppercase">Sin imagen</div><div className="text-xl font-extrabold text-gray-900">{reviewStats.noImage}</div></div>
          <div className="bg-white rounded-xl border p-3"><div className="text-[11px] text-gray-500 font-bold uppercase">Foto revisar</div><div className="text-xl font-extrabold text-gray-900">{reviewStats.imageNeedsOptimization}</div></div>
        </div>

        <p className="text-xs text-gray-500">{productReviewMode ? 'Modo revisión: se muestran productos pendientes por orden de categoría/subcategoría. Si filtras una categoría, Abrir siguiente y Guardar y siguiente continúan dentro de esa categoría.' : 'Arrastra productos (⋮⋮) para cambiar orden en la tienda'}</p>
        {/* Inline: Añadir producto (form above categories) */}
        <form onSubmit={handleCreateProduct} className="bg-white rounded-xl shadow-sm border p-4 sm:p-6 space-y-4">
          <h3 className="font-bold text-gray-800 text-lg">Añadir producto nuevo</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div><label className="text-xs font-bold text-gray-500 mb-1 block">Nombre completo</label><textarea id="new-product-name" name="new-product-name" required rows={2} value={newProduct.name} onChange={e => setNewProduct(p => ({ ...p, name: e.target.value }))} placeholder="Nombre completo del producto" className="w-full border p-2 rounded-lg text-sm resize-y min-h-[2.5rem]"/></div>
            <div><label className="text-xs font-bold text-gray-500 mb-1 block">Nombre corto</label><input value={newProduct.shortName || ''} onChange={e => setNewProduct(p => ({ ...p, shortName: e.target.value }))} placeholder="Ej: Frankfurt ElPozo Original" className="w-full border p-2 rounded-lg text-sm"/></div>
            <div><label className="text-xs font-bold text-gray-500 mb-1 block">Precio €</label><input required type="number" step="0.01" value={newProduct.price || ''} onChange={e => setNewProduct(p => ({ ...p, price: parseFloat(e.target.value) || 0 }))} className="w-full border p-2 rounded-lg text-sm"/></div>
            <div><label className="text-xs font-bold text-gray-500 mb-1 block">Stock</label><input required type="number" value={newProduct.stock ?? ''} onChange={e => setNewProduct(p => ({ ...p, stock: parseInt(e.target.value, 10) || 0 }))} className="w-full border p-2 rounded-lg text-sm"/></div>
            <div className="sm:col-span-2 lg:col-span-1 flex flex-col justify-end"><label className="text-xs font-bold text-gray-500 mb-1 block">Categoría</label><select required value={newProduct.category || ''} onChange={e => { const v = e.target.value; setNewProduct(p => ({ ...p, category: v ? parseInt(v, 10) : '', subCategoryId: '' })); }} className="w-full border p-2 rounded-lg text-sm bg-white"><option value="">—</option>{categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div><label className="text-xs font-bold text-gray-500 mb-1 block">Subcategoría</label><select value={newProduct.subCategoryId || ''} onChange={e => setNewProduct(p => ({ ...p, subCategoryId: e.target.value ? parseInt(e.target.value, 10) : '' }))} disabled={!newProduct.category} className="w-full border p-2 rounded-lg text-sm bg-white"><option value="">—</option>{subCategories.filter(s => s.parent_id === (Number(newProduct.category) || null)).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
            <div><label className="text-xs font-bold text-gray-500 mb-1 block">Descripción</label><textarea rows={5} value={newProduct.description || ''} onChange={e => setNewProduct(p => ({ ...p, description: e.target.value }))} placeholder="Opcional. AI puede rellenar con «Extraer información»." className="w-full border p-2 rounded-lg text-sm resize-y min-h-[5rem]"/></div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 rounded-xl border border-gray-200 bg-gray-50 p-4">
            <div>
              <label className="text-xs font-bold text-gray-600 mb-1 block">IVA</label>
              <select value={newProduct.taxRate ?? ''} onChange={e => setNewProduct(p => ({ ...p, taxRate: e.target.value }))} className="w-full border border-gray-300 p-2 rounded-lg text-sm bg-white">
                {TAX_RATE_OPTIONS.map(o => <option key={o.value || 'pending'} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-bold text-gray-600 mb-1 block">Categoría fiscal</label>
              <select value={newProduct.taxCategory || ''} onChange={e => setNewProduct(p => ({ ...p, taxCategory: e.target.value }))} className="w-full border border-gray-300 p-2 rounded-lg text-sm bg-white">
                {TAX_CATEGORY_OPTIONS.map(o => <option key={o.value || 'none'} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-bold text-gray-600 mb-1 block">Revisión IVA</label>
              <select value={newProduct.taxReviewStatus || 'pending'} onChange={e => setNewProduct(p => ({ ...p, taxReviewStatus: e.target.value }))} className="w-full border border-gray-300 p-2 rounded-lg text-sm bg-white">
                {TAX_REVIEW_STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-bold text-gray-600 mb-1 block">Nota fiscal</label>
              <input value={newProduct.taxNote || ''} onChange={e => setNewProduct(p => ({ ...p, taxNote: e.target.value }))} placeholder="Ej: revisar con factura proveedor" className="w-full border border-gray-300 p-2 rounded-lg text-sm bg-white"/>
            </div>
          </div>
          <div className="flex flex-wrap gap-4 items-center">
            <label className="flex items-center gap-2 cursor-pointer"><input type="checkbox" checked={newProduct.oferta || false} onChange={e => setNewProduct(p => ({ ...p, oferta: e.target.checked }))} className="rounded"/> <span className="text-sm font-medium">Oferta</span></label>
            {newProduct.oferta && (<><select value={newProduct.oferta_type || 'percent'} onChange={e => setNewProduct(p => ({ ...p, oferta_type: e.target.value }))} className="border p-1.5 rounded text-sm"><option value="percent">%</option><option value="second">2ª -50%</option><option value="gift">2x1</option></select><input type="number" placeholder="Valor" value={newProduct.oferta_value ?? ''} onChange={e => setNewProduct(p => ({ ...p, oferta_value: parseFloat(e.target.value) || 0 }))} className="w-20 border p-1.5 rounded text-sm"/></>)}
            <label className="flex items-center gap-2 cursor-pointer"><input type="checkbox" checked={newProduct.giftProduct || false} onChange={e => setNewProduct(p => ({ ...p, giftProduct: e.target.checked }))} className="rounded"/> <span className="text-sm font-medium">Regalo (€65+)</span></label>
            <label className="flex items-center gap-2 cursor-pointer"><input type="checkbox" checked={newProduct.visible !== false} onChange={e => setNewProduct(p => ({ ...p, visible: e.target.checked }))} className="rounded"/> <span className="text-sm font-medium">Mostrar en tienda</span></label>
          </div>
          <div>
            <label className="text-xs font-bold text-gray-500 mb-1 block">Imagen</label>
            <div className="flex flex-wrap gap-3 items-center">
              <label className="border-2 border-dashed border-gray-300 rounded-lg px-4 py-2 text-sm text-gray-500 hover:bg-gray-50 cursor-pointer">{uploading ? 'Subiendo…' : 'Subir imagen'}<input type="file" accept="image/*" multiple onChange={handleNewProductImageUpload} className="hidden"/></label>
              {(newProduct.images?.length > 0 || newProduct.image) && (
                <div className="flex flex-wrap gap-2">
                  {(newProduct.images || (newProduct.image ? [newProduct.image] : [])).map((img, idx) => (
                    <div key={idx} className="relative group">
                      <img src={img} alt="" className="w-12 h-12 object-cover rounded border bg-gray-50"/>
                      <button type="button" onClick={() => handleNewProductRemoveImage(idx)} className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 text-white rounded-full flex items-center justify-center text-xs">×</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
            {(newProduct.images?.length > 0 || newProduct.image) && (
              <div className="mt-2 flex gap-2 flex-wrap">
                <button type="button" onClick={handleNewProductRemoveBg} disabled={removingBg || centeringProduct} className="px-3 py-1.5 text-sm font-medium rounded-lg bg-gray-200 hover:bg-gray-300 disabled:opacity-50">
                  {removingBg ? "..." : "Quitar fondo (AI)"}
                </button>
                <button type="button" onClick={handleNewProductCenterProduct} disabled={centeringProduct || removingBg} className="px-3 py-1.5 text-sm font-medium rounded-lg bg-gray-100 text-gray-700 hover:bg-gray-200 disabled:opacity-50">
                  {centeringProduct ? "..." : "Centrar producto (AI)"}
                </button>
                <button type="button" onClick={handleNewProductGenerateDescription} disabled={generatingDesc || centeringProduct} className="px-3 py-1.5 text-sm font-medium rounded-lg bg-gray-100 text-gray-700 hover:bg-gray-200 disabled:opacity-50">
                  {generatingDesc ? "..." : `Extraer información (AI)${(newProduct.images?.length || (newProduct.image ? 1 : 0)) > 1 ? ` (${newProduct.images?.length || 1} imágenes)` : ""}`}
                </button>
              </div>
            )}
          </div>
          <button type="submit" disabled={uploading || removingBg || generatingDesc || centeringProduct} className="bg-gray-900 text-white px-6 py-2 rounded-lg font-bold hover:bg-gray-800 disabled:opacity-50">Guardar producto</button>
        </form>

        <>
          {isSearching ? (
            filtered.length === 0 ? (
              <div className="bg-white rounded-xl shadow-sm border p-8 text-center text-gray-500">
                No se encontró ningún producto para «{searchTerm}».
              </div>
            ) : (
              <>
                {/* Resultados de búsqueda: lista plana (sin árbol de categorías) */}
                <div className="hidden md:block bg-white rounded-xl shadow-sm border overflow-hidden">
                  <div className="px-4 py-2 text-xs font-bold text-gray-500 bg-gray-50 border-b">{filtered.length} resultado(s)</div>
                  <table className="w-full text-left text-sm">
                    <thead className="bg-gray-50 text-gray-500 font-bold"><tr><th className="p-2 w-10"></th><th className="p-4">Producto</th><th className="p-4">Precio</th><th className="p-4">Stock</th><th className="p-4">IVA</th><th className="p-4 text-right">Acción</th></tr></thead>
                    <tbody className="divide-y">{filtered.map(p => renderProductRow(p, (p.category != null && p.category !== '' ? Number(p.category) : '__none__'), (p.subCategoryId ?? p.sub_category_id ?? '__none__'), filtered))}</tbody>
                  </table>
                </div>
                <div className="md:hidden space-y-3">
                  <div className="text-xs font-bold text-gray-500">{filtered.length} resultado(s)</div>
                  {filtered.map(p => renderProductCard(p, (p.category != null && p.category !== '' ? Number(p.category) : '__none__'), (p.subCategoryId ?? p.sub_category_id ?? '__none__'), filtered))}
                </div>
              </>
            )
          ) : (
          <>
          {/* Desktop: Categoría → Subcategorías → Productos */}
            <div className="hidden md:block space-y-2">
              {catOrder.map(cid => {
                const catKey = `cat-${cid}`;
                const catExpanded = !!expandedProductCats[catKey];
                const catName = cid === '__none__' ? 'Sin categoría' : (categories.find(c => c.id === cid)?.name || 'Otros');
                const subs = cid === '__none__' ? [{ id: '__none__', name: 'Productos' }] : subCategories.filter(s => s.parent_id === cid);
                const subOrder = cid === '__none__' ? ['__none__'] : [...subs.map(s => s.id), '__none__'];
                const totalProducts = Object.values(byCategoryAndSub[cid] || {}).flat().length;
                return (
                  <div key={cid} className="bg-white rounded-xl shadow-sm border overflow-hidden">
                    <button
                      type="button"
                      onClick={() => setExpandedProductCats(prev => ({ ...prev, [catKey]: !prev[catKey] }))}
                      className="w-full bg-gray-50 px-4 py-3 font-bold text-gray-800 flex items-center justify-between hover:bg-gray-100 transition-colors text-left"
                    >
                      <span className="flex items-center gap-2">
                        {catExpanded ? <ChevronDown size={18} className="text-gray-500"/> : <ChevronRight size={18} className="text-gray-500"/>}
                        {catName}
                      </span>
                      <span className="text-sm font-normal text-gray-500">{subs.length} subcategoría{subs.length !== 1 ? 's' : ''} · {totalProducts} producto{totalProducts !== 1 ? 's' : ''}</span>
                    </button>
                    {catExpanded && (
                      <div className="border-t bg-gray-50/50">
                        {cid === '__none__' ? (
                          (() => {
                            const list = (byCategoryAndSub[cid] || {})['__none__'] || [];
                            return list.length === 0 ? <div className="px-4 py-8 text-center text-gray-500 text-sm">No hay productos sin categoría.</div> : (
                              <table className="w-full text-left text-sm"><thead className="bg-gray-100/80 text-gray-500 font-bold"><tr><th className="p-2 w-10"></th><th className="p-4">Producto</th><th className="p-4">Precio</th><th className="p-4">Stock</th><th className="p-4">IVA</th><th className="p-4 text-right">Acción</th></tr></thead><tbody className="divide-y bg-white">{list.map(p => renderProductRow(p, cid, '__none__', list))}</tbody></table>
                            );
                          })()
                        ) : (
                          subOrder.map(subId => {
                            const subKey = `cat-${cid}-sub-${subId}`;
                            const subExpanded = !!expandedProductCats[subKey];
                            const subName = subId === '__none__' ? 'Sin subcategoría' : (subs.find(s => s.id === subId)?.name || 'Otros');
                            const list = (byCategoryAndSub[cid] || {})[subId] || [];
                            return (
                              <div key={subId} className="border-b border-gray-100 last:border-b-0">
                                <button type="button" onClick={() => setExpandedProductCats(prev => ({ ...prev, [subKey]: !prev[subKey] }))} className="w-full px-6 py-2.5 flex items-center justify-between text-left hover:bg-gray-100/80 transition-colors">
                                  <span className="flex items-center gap-2 text-sm font-medium text-gray-700"><span className="text-gray-400">{subExpanded ? <ChevronDown size={16}/> : <ChevronRight size={16}/>}</span>{subName}</span>
                                  <span className="text-xs text-gray-500">{list.length} producto{list.length !== 1 ? 's' : ''}</span>
                                </button>
                                {subExpanded && (list.length === 0 ? <div className="px-8 py-6 text-center text-gray-500 text-sm">No hay productos en esta subcategoría.</div> : <table className="w-full text-left text-sm"><thead className="bg-gray-100/80 text-gray-500 font-bold"><tr><th className="p-2 w-10"></th><th className="p-4 pl-8">Producto</th><th className="p-4">Precio</th><th className="p-4">Stock</th><th className="p-4">IVA</th><th className="p-4 text-right">Acción</th></tr></thead><tbody className="divide-y bg-white">{list.map(p => renderProductRow(p, cid, subId, list))}</tbody></table>)}
                              </div>
                            );
                          })
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Mobile: Categoría → Subcategorías → Productos */}
            <div className="md:hidden space-y-2">
              {catOrder.map(cid => {
                const catKey = `cat-${cid}`;
                const catExpanded = !!expandedProductCats[catKey];
                const catName = cid === '__none__' ? 'Sin categoría' : (categories.find(c => c.id === cid)?.name || 'Otros');
                const subs = cid === '__none__' ? [{ id: '__none__', name: 'Productos' }] : subCategories.filter(s => s.parent_id === cid);
                const subOrder = cid === '__none__' ? ['__none__'] : [...subs.map(s => s.id), '__none__'];
                const totalProducts = Object.values(byCategoryAndSub[cid] || {}).flat().length;
                return (
                  <div key={cid} className="bg-white rounded-xl shadow-sm border overflow-hidden">
                    <button type="button" onClick={() => setExpandedProductCats(prev => ({ ...prev, [catKey]: !prev[catKey] }))} className="w-full px-4 py-3 flex items-center justify-between font-bold text-gray-800 hover:bg-gray-50 transition-colors text-left">
                      <span className="flex items-center gap-2">{catExpanded ? <ChevronDown size={18} className="text-gray-500"/> : <ChevronRight size={18} className="text-gray-500"/>}{catName}</span>
                      <span className="text-xs font-normal text-gray-500">{subs.length} sub · {totalProducts} prod.</span>
                    </button>
                    {catExpanded && (
                      <div className="border-t">
                        {cid === '__none__' ? (
                          (() => { const list = (byCategoryAndSub[cid] || {})['__none__'] || []; return list.length === 0 ? <div className="px-4 py-6 text-center text-gray-500 text-sm">No hay productos.</div> : <div className="px-4 py-3 space-y-3">{list.map(p => renderProductCard(p, cid, '__none__', list))}</div>; })()
                        ) : (
                          subOrder.map(subId => {
                            const subKey = `cat-${cid}-sub-${subId}`;
                            const subExpanded = !!expandedProductCats[subKey];
                            const subName = subId === '__none__' ? 'Sin subcategoría' : (subs.find(s => s.id === subId)?.name || 'Otros');
                            const list = (byCategoryAndSub[cid] || {})[subId] || [];
                            return (
                              <div key={subId} className="border-b border-gray-100">
                                <button type="button" onClick={() => setExpandedProductCats(prev => ({ ...prev, [subKey]: !prev[subKey] }))} className="w-full px-5 py-2.5 flex items-center justify-between text-left bg-gray-50/50 hover:bg-gray-100">
                                  <span className="flex items-center gap-2 text-sm font-medium text-gray-700"><span className="text-gray-400">{subExpanded ? <ChevronDown size={16}/> : <ChevronRight size={16}/>}</span>{subName}</span>
                                  <span className="text-xs text-gray-500">{list.length}</span>
                                </button>
                                {subExpanded && (list.length === 0 ? <div className="px-6 py-4 text-center text-gray-500 text-sm">No hay productos.</div> : <div className="px-4 py-3 space-y-3">{list.map(p => renderProductCard(p, cid, subId, list))}</div>)}
                              </div>
                            );
                          })
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </>
          )}
        </>
      </div>
    );
  };

  const renderCategoryManager = () => {
    const sortedCats = [...categories].sort((a, b) => (a.sort_order ?? a.id) - (b.sort_order ?? b.id));
    const onCatDragStart = (e, c) => { e.dataTransfer.setData('application/json', JSON.stringify({ type: 'category', id: c.id })); e.dataTransfer.effectAllowed = 'move'; };
    const onCatDragOver = (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; };
    const onCatDrop = (e, targetCat) => {
      e.preventDefault();
      try {
        const d = JSON.parse(e.dataTransfer.getData('application/json'));
        if (d.type !== 'category' || d.id === targetCat.id) return;
        const ids = sortedCats.map(x => x.id);
        const fromIdx = ids.indexOf(d.id);
        const toIdx = ids.indexOf(targetCat.id);
        if (fromIdx < 0 || toIdx < 0) return;
        ids.splice(fromIdx, 1);
        ids.splice(ids.indexOf(targetCat.id), 0, d.id);
        handleReorderCategories(ids);
      } catch (_) { /* ignore */ }
    };

    return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row gap-3 mb-6 bg-white p-4 rounded-xl border border-gray-100 shadow-sm">
        <div className="flex-1"><label className="text-xs font-bold text-gray-500 block mb-1">Nombre</label><input id="category-name" name="category-name" value={newCatName} onChange={e => setNewCatName(e.target.value)} className="border p-2 rounded-lg w-full"/></div>
        <div className="sm:w-40"><label className="text-xs font-bold text-gray-500 block mb-1">Icono</label><select id="category-icon" name="category-icon" value={newCatIcon} onChange={e => setNewCatIcon(e.target.value)} className="border p-2 rounded-lg w-full">{AVAILABLE_ICONS.map(i=><option key={i} value={i}>{i}</option>)}</select></div>
        <button onClick={handleAddCategory} className="bg-gray-900 text-white px-4 py-2.5 rounded-lg font-bold whitespace-nowrap sm:self-end">Crear</button>
      </div>
      <p className="text-xs text-gray-500 mb-2">Arrastra para cambiar el orden (se aplica en la tienda)</p>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {sortedCats.map(c => {
          const subs = subCategories.filter(s => s.parent_id === c.id).sort((a, b) => (a.sort_order ?? a.id) - (b.sort_order ?? b.id));
          return (
          <div key={c.id} className="bg-white border rounded-xl overflow-hidden shadow-sm" draggable onDragStart={e => onCatDragStart(e, c)} onDragOver={onCatDragOver} onDrop={e => onCatDrop(e, c)}>
            <div className="bg-gray-50 p-3 flex justify-between items-center font-bold text-gray-800 border-b">
              <span className="flex items-center gap-1"><GripVertical size={16} className="text-gray-400 cursor-grab"/>{c.icon} {c.name}</span>
              <button onClick={() => handleDeleteCategory(c.id)} className="text-gray-400 hover:text-red-600"><Trash2 size={16}/></button>
            </div>
            <div className="p-3">
               <ul className="space-y-2 mb-2">
                 {subs.map(s => (
                   <li key={s.id} className="flex justify-between items-center text-sm text-gray-600 group" draggable onDragStart={e => { e.stopPropagation(); e.dataTransfer.setData('application/json', JSON.stringify({ type: 'sub', parentId: c.id, id: s.id })); e.dataTransfer.effectAllowed = 'move'; }} onDragOver={e => { e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = 'move'; }} onDrop={e => {
                     e.preventDefault(); e.stopPropagation();
                     try {
                       const d = JSON.parse(e.dataTransfer.getData('application/json'));
                       if (d.type !== 'sub' || d.parentId !== c.id || d.id === s.id) return;
                       const ids = subs.map(x => x.id);
                       const fromIdx = ids.indexOf(d.id);
                       const toIdx = ids.indexOf(s.id);
                       if (fromIdx < 0 || toIdx < 0) return;
                       ids.splice(fromIdx, 1);
                       ids.splice(ids.indexOf(s.id), 0, d.id);
                       handleReorderSubCategories(c.id, ids);
                     } catch (_) { /* ignore */ }
                   }}>
                     <span className="flex items-center gap-1"><GripVertical size={12} className="text-gray-300 opacity-0 group-hover:opacity-100 cursor-grab"/>- {s.name}</span>
                     <button onClick={() => handleDeleteCategory(s.id, true)} className="text-gray-300 hover:text-red-600"><Trash2 size={14}/></button>
                   </li>
                 ))}
               </ul>
               {selectedParentForSub === c.id ? (
                 <div className="flex gap-1"><input id="sub-category-name" name="sub-category-name" autoFocus placeholder="Sub..." value={newSubName} onChange={e => setNewSubName(e.target.value)} className="border p-1 text-sm rounded w-full"/><button onClick={() => handleAddSubCategory(c.id)} className="bg-gray-900 text-white px-2 rounded text-xs">OK</button></div>
               ) : <button onClick={() => setSelectedParentForSub(c.id)} className="w-full py-1 text-xs text-gray-600 border border-dashed border-gray-300 rounded">+ Añadir Sub</button>}
            </div>
          </div>
          );
        })}
      </div>
    </div>
  );
  };

const renderRepairs = () => (
    <div className="space-y-6">
      {/* 新增维修表单 */}
      <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-100 flex flex-col gap-3">
        <h3 className="font-bold text-gray-800 text-sm">Añadir Modelo (solo marca, modelo, descripción)</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-2">
           <div><label className="text-xs font-bold text-gray-500 block mb-1">Marca</label><input id="repair-brand" name="repair-brand" placeholder="ej: Apple" value={newRepair.brand || ""} onChange={e => setNewRepair({...newRepair, brand: e.target.value})} className="border p-2 rounded-lg text-sm w-full"/></div>
           <div><label className="text-xs font-bold text-gray-500 block mb-1">Modelo</label><input id="repair-model" name="repair-model" placeholder="ej: iPhone 13" value={newRepair.model || ""} onChange={e => setNewRepair({...newRepair, model: e.target.value})} className="border p-2 rounded-lg text-sm w-full"/></div>
        </div>
        <div className="mb-2">
           <label className="text-xs font-bold text-gray-500 block mb-1">Descripción</label>
           <input id="repair-description" name="repair-description" placeholder="Descripción" value={newRepair.description || ""} onChange={e => setNewRepair({...newRepair, description: e.target.value})} className="w-full border p-2 rounded-lg text-sm" />
           <p className="text-xs text-gray-500 mt-1">Por defecto: Incluye limpieza interna + Cristal y Funda (o Cargador) de REGALO.</p>
        </div>
        <button onClick={async () => {
    if (!newRepair.brand?.trim()) { toast.error("Falta la Marca"); return; }
    if (!newRepair.model?.trim()) { toast.error("Falta el Modelo"); return; }

    const toastId = toast.loading("Guardando...");
    try {
        const newRepairService = await apiClient.createRepairService({
            brand: newRepair.brand.trim(),
            model: newRepair.model.trim(),
            description: (newRepair.description || "Incluye limpieza interna + Cristal y Funda (o Cargador) de REGALO.").trim()
        });
        toast.success("Modelo añadido", { id: toastId });
        setNewRepair({ brand: "", model: "", description: "Incluye limpieza interna + Cristal y Funda (o Cargador) de REGALO." });
        if (newRepairService) setRepairs(prev => [...prev, newRepairService]);
        else fetchData();
    } catch (err) {
        console.error(err);
        toast.error("Error: " + (err.message || "Error"), { id: toastId });
    }
}} className="bg-gray-900 text-white px-4 py-2 rounded-lg font-bold text-sm">
    Añadir
</button>
      </div>

      {/* 列表显示：Marca · Modelo · Descripción */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {repairs.map(r => (
          <div key={r.id} className="bg-white p-4 rounded-xl shadow-sm border border-gray-100">
             <div className="flex justify-between items-start mb-2">
                <div className="flex-1">
                   <div className="flex gap-2 mb-1">
                      <span className="bg-gray-100 text-gray-600 text-[10px] px-2 py-0.5 rounded font-bold uppercase">{r.brand}</span>
                      <span className="bg-gray-100 text-gray-600 text-[10px] px-2 py-0.5 rounded font-bold uppercase">{r.model}</span>
                   </div>
                   <p className="text-xs text-gray-600 mb-2 line-clamp-2">{r.description || "—"}</p>
                </div>
                <button onClick={() => handleDeleteRepair(r.id)} className="text-gray-300 hover:text-red-600 p-2 flex-shrink-0"><Trash2 size={18}/></button>
             </div>
             <button 
               onClick={async () => {
                 const newDesc = prompt("Editar descripción:", r.description || "");
                 if (newDesc !== null) {
                   try {
                     await apiClient.updateRepairService(r.id, { description: newDesc });
                     toast.success("Descripción actualizada");
                     fetchData();
                   } catch (error) {
                     toast.error("Error: " + error.message);
                   }
                 }
               }}
               className="w-full mt-2 text-xs bg-gray-100 hover:bg-gray-200 text-gray-700 px-3 py-1.5 rounded-lg font-medium transition-colors"
             >
               <Edit2 size={12} className="inline mr-1"/> Editar Descripción
             </button>
          </div>
        ))}
      </div>
    </div>
  );

  // Color del <select> de estado según el estado actual.
  // Paleta sobria: "Entregado" lleva un acento verde tenue (estado final OK)
  // y el resto de estados se muestran en gris neutro.
  const orderStatusSelectClass = (status) =>
    status === 'Entregado' ? 'bg-green-50 text-green-700'
    : 'bg-gray-100 text-gray-700';

  // Badge de método de pago: gris neutro para todos.
  const orderPaymentBadgeClass = (_method) => 'bg-gray-100 text-gray-600';

  // Estados seleccionables manualmente desde el panel.
  const ORDER_STATUS_OPTIONS = ['Autorizado', 'Procesando', 'Listo para recoger', 'Pendiente de Pago', 'Enviado', 'Entregado', 'Cancelado'];

  // <select> de estado reutilizable (tabla, tarjeta y detalle). Si el estado
  // real del pedido NO está en la lista (p.ej. 'Esperando pago' mientras
  // Stripe aún no confirma el pago), lo añadimos como opción para que el
  // <select> muestre la verdad en vez de caer por defecto en la primera
  // opción (lo que hacía parecer "Autorizado" un pedido que no lo era).
  const renderStatusSelect = (o, sizeClass = 'px-2 py-1 text-xs') => {
    const known = ORDER_STATUS_OPTIONS.includes(o.status);
    return (
      <select
        value={o.status || ''}
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => updateOrderStatus(o.id, e.target.value)}
        className={`border rounded font-bold cursor-pointer ${sizeClass} ${orderStatusSelectClass(o.status)}`}
      >
        {!known && <option value={o.status || ''} disabled>{o.status || '—'} (en curso)</option>}
        {ORDER_STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
      </select>
    );
  };

  // Botonera de acciones de un pedido (Cobrar / Reembolsar / Justificante /
  // Ticket / Imprimir). Reutilizada en el detalle del pedido.
  // ¿Se puede avisar de que el pedido de recogida está listo? Solo
  // recogida en tienda y en un estado en el que ya está pagado/preparándose
  // (no autorizado pendiente de cobro, no cancelado/entregado).
  const canNotifyReady = (o) =>
    isPickupOrder(o) && !['Cancelado', 'Autorizado', 'Esperando pago', 'Entregado'].includes(o.status);

  const renderOrderActions = (o, btn = 'px-3 py-1.5 text-xs') => (
    <>
      {o.status === 'Autorizado' && (
        <button type="button" onClick={() => captureOrder(o.id)} className={`btn-cobrar inline-flex items-center gap-1 rounded-lg text-white font-bold ${btn}`} title="Cobrar la retención de tarjeta">
          <DollarSign size={14}/> Cobrar
        </button>
      )}
      {canNotifyReady(o) && (
        <button type="button" onClick={() => notifyOrderReady(o.id)} disabled={notifyingId === o.id} className={`inline-flex items-center gap-1 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold disabled:opacity-50 ${btn}`} title="Avisar al cliente de que su pedido está listo para recoger">
          <Bell size={14}/> {notifyingId === o.id ? 'Avisando…' : o.status === 'Listo para recoger' ? 'Reenviar aviso' : 'Avisar: listo'}
        </button>
      )}
      {isUnpaidCounter(o) && (
        <button type="button" onClick={() => setCollectTarget(o)} className={`btn-cobrar inline-flex items-center gap-1 rounded-lg text-white font-bold ${btn}`} title="Registrar cobro en tienda y marcar entregado">
          <DollarSign size={14}/> Cobrar y entregar
        </button>
      )}
      {o.stripe_payment_intent && o.status !== 'Cancelado' && (
        <button type="button" onClick={() => { setRefundTarget(o); setRefundReason(''); setRefundMode('total'); setRefundQtys({}); }} className={`inline-flex items-center gap-1 rounded-lg border border-red-200 text-red-600 hover:bg-red-50 font-bold ${btn}`} title="Reembolsar y avisar al cliente">
          <Undo2 size={14}/> Reembolsar
        </button>
      )}
      <button type="button" onClick={() => openOrderFactura(o)} className={`inline-flex items-center gap-1 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold ${btn}`} title="Ver justificante">
        <FileText size={14}/> Justificante
      </button>
      <button type="button" onClick={() => openOrderTicket(o)} className={`inline-flex items-center gap-1 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold ${btn}`} title="Ver ticket">
        <FileText size={14}/> Ticket
      </button>
      <button type="button" onClick={() => printOrderTicket(o)} className={`inline-flex items-center gap-1 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold ${btn}`} title="Imprimir ticket">
        <Printer size={14}/> Imprimir
      </button>
    </>
  );

  // Antigüedad de la retención de tarjeta (autorización Stripe). Las
  // autorizaciones caducan a los ~7 días: si no se cobra antes, se pierde.
  const STRIPE_AUTH_VALID_DAYS = 7;
  const authHoldInfo = (o) => {
    const createdMs = o.created_at ? new Date(o.created_at).getTime() : Date.now();
    const days = Math.floor((Date.now() - createdMs) / 86400000);
    const daysLeft = STRIPE_AUTH_VALID_DAYS - days;
    return { days, daysLeft, urgent: daysLeft <= 2, expired: daysLeft <= 0 };
  };
  // ---- Citas de reparación ----
  const BOOKING_STATUSES = ['Nueva', 'Contactado', 'Agendada', 'Completada', 'Cancelada'];
  const REPAIR_TYPE_LABELS = { pantalla: 'Pantalla', bateria: 'Batería', otro: 'Otro / a consultar' };
  const updateBookingStatus = async (id, status) => {
    const prev = bookings;
    setBookings(bs => bs.map(b => b.id === id ? { ...b, status } : b));
    try {
      await apiClient.updateRepairBookingStatus(id, status);
      toast.success('Cita actualizada');
    } catch (e) {
      setBookings(prev);
      toast.error('No se pudo actualizar: ' + (e?.message || ''));
    }
  };

  const renderBookings = () => {
    const filtered = bookingStatusFilter ? bookings.filter(b => b.status === bookingStatusFilter) : bookings;
    const newCount = bookings.filter(b => b.status === 'Nueva').length;
    return (
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-2xl font-black text-gray-900">Citas de reparación</h2>
            <p className="text-sm text-gray-500 mt-0.5">
              {newCount > 0 ? `${newCount} nueva${newCount > 1 ? 's' : ''} sin atender` : 'Sin citas nuevas pendientes'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={bookingStatusFilter}
              onChange={(e) => setBookingStatusFilter(e.target.value)}
              className="p-2 text-sm bg-white border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-gray-200"
            >
              <option value="">Todos los estados</option>
              {BOOKING_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <button onClick={() => fetchData()} className="p-2 text-sm bg-gray-900 text-white rounded-lg font-bold hover:bg-gray-800">Actualizar</button>
          </div>
        </div>

        {filtered.length === 0 ? (
          <div className="text-center py-16 bg-white rounded-2xl border border-gray-200">
            <Wrench size={32} className="mx-auto mb-3 text-gray-300"/>
            <p className="text-gray-500">No hay citas {bookingStatusFilter ? `en estado "${bookingStatusFilter}"` : 'todavía'}.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map(b => {
              const device = [b.brand, b.model].filter(Boolean).join(' ') || 'Sin especificar';
              const phone = String(b.phone || '').replace(/[\s.\-()]/g, '').replace(/^\+?(0034|34)/, '');
              const isNew = b.status === 'Nueva';
              const created = b.created_at ? new Date(b.created_at).toLocaleString('es-ES', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';
              return (
                <div key={b.id} className={`rounded-2xl border p-4 ${isNew ? 'bg-gray-50 border-l-4 border-l-gray-900 border-gray-200' : 'bg-white border-gray-200'}`}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-black text-gray-900">{device}</span>
                        <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">{REPAIR_TYPE_LABELS[b.repair_type] || 'A consultar'}</span>
                        {b.handover === 'domicilio' && (
                          <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-gray-900 text-white inline-flex items-center gap-1"><Truck size={11}/> Domicilio</span>
                        )}
                      </div>
                      <p className="text-sm text-gray-700 mt-1"><span className="font-bold">{b.customer_name}</span> · {b.phone}</p>
                      {b.email ? <p className="text-xs text-gray-500 mt-0.5">{b.email}</p> : null}
                      {b.handover === 'domicilio' && b.address ? (
                        <p className="text-xs text-gray-700 mt-0.5 font-bold">Recoger en: {b.address} <span className="font-normal text-gray-500">(5€ · gratis con pedido 25€+)</span></p>
                      ) : null}
                      <p className="text-xs text-gray-500 mt-0.5">Recibida {created}</p>
                      {b.note ? <p className="text-sm text-gray-600 mt-2 bg-gray-100 rounded-lg px-3 py-2">{b.note}</p> : null}
                    </div>
                    <div className="flex flex-col items-end gap-2">
                      <select
                        value={BOOKING_STATUSES.includes(b.status) ? b.status : ''}
                        onChange={(e) => updateBookingStatus(b.id, e.target.value)}
                        className="p-2 text-sm bg-white border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-gray-200 font-bold text-gray-800"
                      >
                        {!BOOKING_STATUSES.includes(b.status) && <option value="" disabled>{b.status || '—'}</option>}
                        {BOOKING_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
                      <div className="flex gap-2 flex-wrap justify-end">
                        {b.email && (
                          <a href={`mailto:${b.email}?subject=${encodeURIComponent(`Tu reparación en HIPERA: ${device}`)}`} className="inline-flex items-center gap-1 text-xs font-bold px-3 py-2 rounded-lg bg-gray-900 hover:bg-gray-800 text-white">
                            <Mail size={14}/> Email
                          </a>
                        )}
                        <a href={`https://wa.me/34${phone}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-bold px-3 py-2 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-700">
                          <Smartphone size={14}/> WhatsApp
                        </a>
                        <a href={`tel:+34${phone}`} className="inline-flex items-center gap-1 text-xs font-bold px-3 py-2 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-700">
                          <Phone size={14}/> Llamar
                        </a>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  const renderOrders = () => {
     const searchLower = orderSearch.toLowerCase().trim();
     const fromTs = orderDateFrom ? new Date(orderDateFrom + 'T00:00:00').getTime() : null;
     const toTs = orderDateTo ? new Date(orderDateTo + 'T23:59:59').getTime() : null;
     const filteredOrders = orders.filter(o => {
       if (orderStatusFilter && o.status !== orderStatusFilter) return false;
       if (searchLower) {
         const haystack = `${o.id || ''} ${o.phone || ''} ${o.customer_email || ''} ${o.address || ''}`.toLowerCase();
         if (!haystack.includes(searchLower)) return false;
       }
       if (fromTs || toTs) {
         const t = o.created_at ? new Date(o.created_at).getTime() : 0;
         if (fromTs && t < fromTs) return false;
         if (toTs && t > toTs) return false;
       }
       return true;
     });
     const filtersActive = !!(searchLower || orderStatusFilter || orderDateFrom || orderDateTo);
     const authorizedOrders = orders.filter(o => o.status === 'Autorizado');
     const urgentAuth = authorizedOrders.filter(o => authHoldInfo(o).urgent).length;
     return (
     <div className="space-y-4">
        <h2 className="text-xl md:text-2xl font-bold text-gray-800">
          Pedidos ({filtersActive ? `${filteredOrders.length} de ${orders.length}` : orders.length})
        </h2>
        {/* Aviso de pedidos autorizados pendientes de cobro. La retención de
            tarjeta caduca a los ~7 días: si no se cobra antes, se pierde. */}
        {authorizedOrders.length > 0 && (
         <div className={`flex flex-wrap items-center gap-3 rounded-xl border p-3 ${urgentAuth > 0 ? 'bg-red-50 border-red-200' : 'bg-gray-50 border-gray-200'}`}>
           <AlertCircle size={20} className={`flex-shrink-0 ${urgentAuth > 0 ? 'text-red-600' : 'text-gray-500'}`} />
           <div className={`flex-1 min-w-[200px] text-sm ${urgentAuth > 0 ? 'text-red-800' : 'text-gray-700'}`}>
             <strong>{authorizedOrders.length}</strong> {authorizedOrders.length === 1 ? 'pedido autorizado pendiente de cobro' : 'pedidos autorizados pendientes de cobro'}.
             {urgentAuth > 0 && <> <strong>{urgentAuth}</strong> a punto de caducar (≤2 días).</>}
             <span className="block text-xs opacity-80 mt-0.5">La retención de tarjeta caduca a los ~7 días; cóbralos o reembólsalos antes.</span>
           </div>
           <button
             type="button"
             onClick={() => setOrderStatusFilter(orderStatusFilter === 'Autorizado' ? '' : 'Autorizado')}
             className={`px-3 py-1.5 rounded-lg text-xs font-bold text-white ${urgentAuth > 0 ? 'bg-red-600 hover:bg-red-700' : 'bg-gray-800 hover:bg-gray-900'}`}
           >
              {orderStatusFilter === 'Autorizado' ? 'Quitar filtro' : 'Ver solo autorizados'}
            </button>
          </div>
        )}
        {/* Barra de filtros */}
        <div className="bg-white rounded-xl shadow-sm border p-3 flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[180px]">
            <label className="text-xs font-bold text-gray-500 mb-1 block">Buscar (teléfono / nº pedido / email)</label>
            <input
              id="search-orders"
              name="search-orders"
              type="text"
              value={orderSearch}
              onChange={e => setOrderSearch(e.target.value)}
              placeholder="Ej. 600123456, a1b2c3, cliente@..."
              className="w-full border p-2 rounded-lg text-sm"
            />
          </div>
          <div>
            <label className="text-xs font-bold text-gray-500 mb-1 block">Estado</label>
            <select value={orderStatusFilter} onChange={e => setOrderStatusFilter(e.target.value)} className="border p-2 rounded-lg text-sm bg-white">
              <option value="">Todos</option>
              <option>Esperando pago</option>
              <option>Autorizado</option>
              <option>Procesando</option>
              <option>Listo para recoger</option>
              <option>Pendiente de Pago</option>
              <option>Enviado</option>
              <option>Entregado</option>
              <option>Cancelado</option>
            </select>
          </div>
          <div>
            <label className="text-xs font-bold text-gray-500 mb-1 block">Desde</label>
            <input type="date" value={orderDateFrom} onChange={e => setOrderDateFrom(e.target.value)} className="border p-2 rounded-lg text-sm" />
          </div>
          <div>
            <label className="text-xs font-bold text-gray-500 mb-1 block">Hasta</label>
            <input type="date" value={orderDateTo} onChange={e => setOrderDateTo(e.target.value)} className="border p-2 rounded-lg text-sm" />
          </div>
          {filtersActive && (
            <button
              type="button"
              onClick={() => { setOrderSearch(''); setOrderStatusFilter(''); setOrderDateFrom(''); setOrderDateTo(''); }}
              className="px-3 py-2 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm font-medium"
            >
              Limpiar
            </button>
          )}
          <button
            type="button"
            onClick={() => exportOrdersCsv(filteredOrders)}
            disabled={filteredOrders.length === 0}
            className="px-3 py-2 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 text-sm font-bold disabled:opacity-50 flex items-center gap-1.5"
            title="Exportar la lista filtrada a CSV (Excel)"
          >
            <Download size={16}/> CSV ({filteredOrders.length})
          </button>
        </div>
        <p className="text-xs text-gray-400 px-1">Haz clic en un pedido para ver el detalle, items y acciones.</p>
        {/* Desktop table (compacta) */}
        <div className="hidden md:block bg-white rounded-xl shadow-sm border overflow-hidden">
          <table className="w-full text-left text-sm">
             <thead className="bg-gray-50 font-bold text-gray-500">
               <tr>
                 <th className="px-4 py-3">Pedido</th>
                 <th className="px-4 py-3">Fecha</th>
                 <th className="px-4 py-3">Total</th>
                 <th className="px-4 py-3">Estado</th>
                 <th className="px-4 py-3 w-28 text-right">Detalle</th>
               </tr>
             </thead>
             <tbody>
               {filteredOrders.map(o => {
                 const orderDate = o.created_at ? new Date(o.created_at) : null;
                 const dateStr = orderDate ? orderDate.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';
                 const isPickup = isPickupOrder(o);
                 const isAuth = o.status === 'Autorizado';
                 const hold = isAuth ? authHoldInfo(o) : null;
                 // Pendiente = aún no terminado (no entregado ni cancelado):
                 // necesita acción (cobrar, preparar, entregar…) → marco gris.
                 const isPending = !['Entregado', 'Cancelado'].includes(o.status);
                 return (
                 <tr key={o.id} onClick={() => setDetailOrder(o)} className={`border-b cursor-pointer transition-colors ${isAuth && hold.urgent ? 'bg-red-50/70 hover:bg-red-100/70 border-l-4 border-l-red-400' : isPending ? 'bg-gray-50 hover:bg-gray-100 border-l-4 border-l-gray-300' : 'hover:bg-gray-50'}`}>
                   <td className="px-4 py-3 align-middle">
                      <div className="font-mono text-[11px] font-bold text-gray-400">#{o.id.slice(0,8)}</div>
                     <div className="font-bold text-gray-800 text-sm">{o.phone || '—'}</div>
                     <div className="mt-0.5 flex items-center gap-1 text-[11px] max-w-[220px]">
                       {isPickup ? (
                         <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-gray-100 text-gray-700 font-bold whitespace-nowrap"><Store size={11}/> Recogida</span>
                       ) : (
                         <>
                           <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-gray-100 text-gray-700 font-bold whitespace-nowrap"><Truck size={11}/> Envío</span>
                           <span className="text-gray-500 truncate">{o.address || ''}</span>
                         </>
                       )}
                     </div>
                     {isAuth && (
                       <span className={`inline-flex items-center gap-1 mt-1 px-1.5 py-0.5 rounded text-[10px] font-bold ${hold.urgent ? 'bg-red-200 text-red-800' : 'bg-gray-200 text-gray-700'}`}>
                         <DollarSign size={10}/> {hold.expired ? 'Retención caducada' : `Cobrar · quedan ${hold.daysLeft}d`}
                       </span>
                     )}
                  </td>
                  <td className="px-4 py-3 align-middle text-xs text-gray-600 whitespace-nowrap">{dateStr}</td>
                   <td className="px-4 py-3 align-middle font-bold whitespace-nowrap">
                      €{o.total?.toFixed(2)}
                     {o.coupon_code && (
                       <div className="mt-0.5 text-[10px] font-bold text-gray-600">
                         <span className="bg-gray-100 border border-gray-200 px-1.5 py-0.5 rounded">−€{(Number(o.discount) || 0).toFixed(2)}</span>
                       </div>
                     )}
                   </td>
                   <td className="px-4 py-3 align-middle">
                      <div className="flex items-center gap-2 flex-wrap">
                        {renderStatusSelect(o)}
                        {o.status === 'Autorizado' && (
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); captureOrder(o.id); }}
                            className="btn-cobrar inline-flex items-center gap-1 px-2 py-1 rounded-lg text-white text-xs font-bold whitespace-nowrap"
                            title="Cobrar la retención de tarjeta"
                          >
                            <DollarSign size={13}/> Cobrar
                          </button>
                        )}
                        {isUnpaidCounter(o) && (
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); setCollectTarget(o); }}
                            className="btn-cobrar inline-flex items-center gap-1 px-2 py-1 rounded-lg text-white text-xs font-bold whitespace-nowrap"
                            title="Registrar cobro en tienda y marcar entregado"
                          >
                            <DollarSign size={13}/> Cobrar y entregar
                          </button>
                        )}
                      </div>
                   </td>
                   <td className="px-4 py-3 align-middle text-right">
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); setDetailOrder(o); }}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-bold whitespace-nowrap"
                        title="Ver detalle del pedido"
                        aria-label={`Ver detalle del pedido ${String(o.id || '').slice(0, 8)}`}
                      >
                        Ver detalle <ChevronRight size={14}/>
                      </button>
                   </td>
                 </tr>
               )})}
             </tbody>
          </table>
          {filteredOrders.length === 0 && (
            <div className="p-8 text-center text-gray-400 text-sm">No hay pedidos que coincidan con los filtros.</div>
          )}
        </div>
        {/* Mobile cards (compactas) */}
        <div className="md:hidden space-y-3">
          {filteredOrders.map(o => {
            const orderDate = o.created_at ? new Date(o.created_at) : null;
            const dateStr = orderDate ? orderDate.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';
            const isPickup = isPickupOrder(o);
            const isAuth = o.status === 'Autorizado';
            const hold = isAuth ? authHoldInfo(o) : null;
            // Pendiente = aún no terminado (no entregado ni cancelado).
            const isPending = !['Entregado', 'Cancelado'].includes(o.status);
            return (
              <button type="button" key={o.id} onClick={() => setDetailOrder(o)} className={`w-full text-left rounded-xl shadow-sm border p-3 active:bg-gray-50 ${isAuth && hold.urgent ? 'bg-red-50 border-l-4 border-l-red-400' : isPending ? 'bg-gray-50 border-l-4 border-l-gray-300' : 'bg-white'}`}>
                <div className="flex justify-between items-start gap-2">
                  <div className="min-w-0">
                    <div className="font-mono text-[11px] font-bold text-gray-400">#{o.id.slice(0,8)}</div>
                    <div className="font-bold text-gray-800 truncate">{o.phone || '—'}</div>
                    <div className="mt-0.5 flex items-center gap-x-2 gap-y-1 flex-wrap text-[11px]">
                      {isPickup ? (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-gray-100 text-gray-700 font-bold whitespace-nowrap"><Store size={11}/> Recogida</span>
                      ) : (
                        <>
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-gray-100 text-gray-700 font-bold whitespace-nowrap"><Truck size={11}/> Envío</span>
                          <span className="text-gray-500 truncate max-w-[140px]">{o.address || ''}</span>
                        </>
                      )}
                      <span className="inline-flex items-center gap-1 text-gray-500 whitespace-nowrap"><Clock size={11}/> {dateStr}</span>
                    </div>
                    {isAuth && (
                      <span className={`inline-flex items-center gap-1 mt-1 px-1.5 py-0.5 rounded text-[10px] font-bold ${hold.urgent ? 'bg-red-200 text-red-800' : 'bg-gray-200 text-gray-700'}`}>
                        <DollarSign size={10}/> {hold.expired ? 'Retención caducada' : `Cobrar · quedan ${hold.daysLeft}d`}
                      </span>
                    )}
                  </div>
                  <div className="text-right flex-shrink-0 flex flex-col items-end gap-1.5">
                    {o.status === 'Autorizado' ? (
                      <span
                        role="button"
                        tabIndex={0}
                        onClick={(e) => { e.stopPropagation(); captureOrder(o.id); }}
                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); captureOrder(o.id); } }}
                        className="btn-cobrar inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-white text-sm font-extrabold"
                      >
                        <DollarSign size={14}/> Cobrar €{o.total?.toFixed(2)}
                      </span>
                    ) : (
                      <>
                        <div className="font-bold text-gray-800">€{o.total?.toFixed(2)}</div>
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${orderStatusSelectClass(o.status)}`}>{o.status}</span>
                      </>
                    )}
                    <span className="inline-flex items-center gap-0.5 text-[11px] font-bold text-gray-500">Ver detalle <ChevronRight size={13}/></span>
                  </div>
                </div>
              </button>
            );
          })}
          {filteredOrders.length === 0 && (
            <div className="p-8 text-center text-gray-400 text-sm bg-white rounded-xl border">No hay pedidos que coincidan con los filtros.</div>
          )}
        </div>
     </div>
     );
  };

  // Panel de detalle de un pedido (al hacer clic en una fila/tarjeta).
  // Muestra contacto, entrega, items completos, totales y todas las
  // acciones. Lee la versión viva del pedido desde `orders` para reflejar
  // cambios de estado/reembolso sin cerrar el panel.
  const renderOrderDetailModal = () => {
    if (!detailOrder) return null;
    const o = orders.find(x => x.id === detailOrder.id) || detailOrder;
    const paymentMethod = o.payment_method || 'No especificado';
    const orderDate = o.created_at ? new Date(o.created_at) : null;
    const dateStr = orderDate ? orderDate.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
    const isPickup = isPickupOrder(o);
    const items = Array.isArray(o.items) ? o.items : [];
    const itemsTotal = items.reduce((s, it) => s + (Number(it.price) || 0) * (Number(it.quantity) || 0), 0);
    return (
      <div className="fixed inset-0 z-[60] flex justify-end bg-black/40" onClick={() => setDetailOrder(null)}>
        <div className="w-full max-w-md h-full bg-white shadow-2xl flex flex-col animate-slide-in-right" onClick={(e) => e.stopPropagation()}>
          {/* Cabecera */}
          <div className="flex items-center justify-between px-4 py-2.5 border-b">
            <div>
              <div className="font-mono text-[11px] font-bold text-gray-400">#{o.id.slice(0,8)}</div>
              <div className="text-base font-bold text-gray-800">Pedido</div>
            </div>
            <div className="flex items-center gap-2">
              {renderStatusSelect(o, 'px-2 py-1 text-xs')}
              <button type="button" onClick={() => setDetailOrder(null)} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500"><X size={18}/></button>
            </div>
          </div>
          {/* Cuerpo */}
          <div className="flex-1 overflow-y-auto p-3 space-y-2.5 text-sm">
            {o.status === 'Autorizado' && (() => {
              const hold = authHoldInfo(o);
              return (
                <div className={`flex items-start gap-2 rounded-lg p-2.5 border ${hold.urgent ? 'bg-red-50 border-red-200 text-red-800' : 'bg-gray-50 border-gray-200 text-gray-700'}`}>
                  <DollarSign size={15} className="mt-0.5 flex-shrink-0" />
                  <div>
                    <div className="font-bold text-[13px]">Pago autorizado, pendiente de cobro</div>
                    <div className="text-[11px] opacity-90 mt-0.5">
                      {hold.expired
                        ? 'La retención puede haber caducado. Verifica en Stripe antes de cobrar.'
                        : `Quedan ~${hold.daysLeft} día(s) antes de que caduque la retención. Pulsa “Cobrar” para capturar el importe o “Reembolsar” para liberarla.`}
                    </div>
                  </div>
                </div>
              );
            })()}
            <div className="grid grid-cols-2 gap-2">
              <div className="bg-gray-50 rounded-lg p-2.5">
                <div className="flex items-center gap-1.5 text-[10px] font-bold text-gray-400 uppercase"><Clock size={11}/> Fecha</div>
                <div className="mt-0.5 text-[13px] text-gray-800">{dateStr}</div>
              </div>
              <div className="bg-gray-50 rounded-lg p-2.5">
                <div className="flex items-center gap-1.5 text-[10px] font-bold text-gray-400 uppercase"><CreditCard size={11}/> Pago</div>
                <div className="mt-0.5"><span className={`px-2 py-0.5 rounded text-xs font-bold ${orderPaymentBadgeClass(paymentMethod)}`}>{paymentMethod}</span></div>
              </div>
            </div>
            <div className="bg-gray-50 rounded-lg p-2.5 space-y-1">
              <div className="flex items-center gap-1.5 text-[10px] font-bold text-gray-400 uppercase">{isPickup ? <><Store size={11}/> Recogida en tienda</> : <><Truck size={11}/> Envío a domicilio</>}</div>
              {o.phone && <div className="flex items-center gap-1.5 text-[13px] text-gray-800"><Phone size={12} className="text-gray-400"/> {o.phone}</div>}
              {o.customer_email && <div className="flex items-center gap-1.5 text-[13px] text-gray-800 break-all"><Mail size={12} className="text-gray-400"/> {o.customer_email}</div>}
              {o.address && <div className="flex items-start gap-1.5 text-[13px] text-gray-600"><MapPin size={12} className="text-gray-400 mt-0.5 flex-shrink-0"/> {o.address}</div>}
              {o.note && <div className="flex items-start gap-1.5 text-[12px] text-gray-700 bg-gray-100 border border-gray-200 rounded p-2"><StickyNote size={12} className="mt-0.5 flex-shrink-0 text-gray-400"/> {o.note}</div>}
            </div>
            {isPickup && (
              <div className="rounded-lg p-2.5 bg-gray-50 border border-gray-200">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 text-[10px] font-bold text-gray-500 uppercase"><Bell size={11}/> Código de recogida</div>
                  <div className="font-mono text-xl font-extrabold text-gray-900 tracking-widest">{o.pickup_code || pickupCode(o.id)}</div>
                </div>
                <div className="flex items-start gap-1.5 mt-2 text-[11px] text-gray-700 bg-gray-100 rounded p-2 font-semibold">
                  <AlertCircle size={13} className="mt-0.5 flex-shrink-0"/>
                  <span>Pide también el <strong>teléfono o nombre</strong> y compáralo con el pedido{o.phone ? ` (tel. ${o.phone})` : ''}.</span>
                </div>
                {o.status === 'Listo para recoger' && <div className="text-[11px] text-gray-500 mt-1 font-semibold">✓ Cliente ya avisado de que está listo.</div>}
              </div>
            )}
            <div>
              <div className="text-[10px] font-bold text-gray-400 uppercase mb-1">Artículos</div>
              <div>
                {items.map((item, idx) => {
                  const isGift = item.isGift || item.price === 0;
                  const thumb = products.find(p => p.id === item.id)?.image || item.image;
                  return (
                    <div key={idx} className={`flex justify-between items-center gap-2 py-1 ${isGift ? 'bg-gray-100 border border-gray-200 px-2 rounded' : 'border-b border-dashed border-gray-100'}`}>
                      <span className="flex items-center gap-2 min-w-0">
                        {thumb && <img src={thumb} alt="" loading="lazy" className="w-8 h-8 rounded object-cover border border-gray-200 flex-shrink-0 bg-gray-50" />}
                        {isGift && <Gift size={12} className="text-gray-500 flex-shrink-0"/>}
                        <span className={`min-w-0 text-[13px] ${isGift ? 'font-bold text-gray-700' : 'text-gray-700'}`}>
                          <span className="font-bold">{item.quantity}x</span> {item.name}
                        </span>
                      </span>
                      {isGift
                        ? <span className="text-[10px] bg-gray-300 text-gray-800 px-1.5 py-0.5 rounded font-bold flex-shrink-0">GRATIS</span>
                        : <span className="text-[13px] text-gray-600 flex-shrink-0 font-medium">€{((Number(item.price)||0) * (Number(item.quantity)||0)).toFixed(2)}</span>}
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="border-t pt-2 space-y-0.5">
              <div className="flex justify-between text-[13px] text-gray-600"><span>Subtotal artículos</span><span>€{itemsTotal.toFixed(2)}</span></div>
              {o.coupon_code && (
                <div className="flex justify-between text-[13px] text-gray-600 font-medium"><span>Cupón {o.coupon_code}</span><span>−€{(Number(o.discount) || 0).toFixed(2)}</span></div>
              )}
              <div className="flex justify-between text-base font-bold text-gray-800 pt-0.5"><span>Total</span><span>€{o.total?.toFixed(2)}</span></div>
            </div>
          </div>
          {/* Pie: acciones */}
          <div className="border-t p-3 flex flex-wrap gap-2 bg-gray-50">
            {renderOrderActions(o, 'px-3 py-2 text-xs')}
          </div>
        </div>
      </div>
    );
  };

  // Modal de reembolso: total (todo el pedido) o parcial (por artículos
  // devueltos), motivo (presets + texto libre) y confirmación.
  const renderRefundModal = () => {
    if (!refundTarget) return null;
    const o = refundTarget;
    const sid = String(o.id || '').slice(0, 8).toUpperCase();
    const isHoldOnly = o.status === 'Autorizado'; // sólo retenido, aún no cobrado
    const items = Array.isArray(o.items) ? o.items : [];
    // El reembolso parcial sólo aplica a pedidos ya cobrados (no a una
    // simple retención) y que tengan artículos.
    const canPartial = !isHoldOnly && items.length > 0;
    const isPartial = refundMode === 'partial' && canPartial;

    const setQty = (idx, q) => {
      const ordered = Math.floor(Number(items[idx]?.quantity) || 0);
      const next = Math.max(0, Math.min(ordered, q));
      setRefundQtys(prev => ({ ...prev, [idx]: next }));
    };
    const partialAmount = items.reduce((sum, it, idx) => {
      const q = Number(refundQtys[idx]) || 0;
      return sum + (Number(it?.price) || 0) * q;
    }, 0);

    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-3 sm:p-4 backdrop-blur-sm">
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[92vh] overflow-hidden flex flex-col">
          <div className="flex justify-between items-center p-4 sm:p-5 border-b">
            <h3 className="text-lg font-bold text-gray-800 flex items-center gap-2"><Undo2 size={20} className="text-rose-600"/> Reembolsar pedido</h3>
            <button type="button" onClick={() => { if (!refundBusy) setRefundTarget(null); }} className="p-2 hover:bg-gray-100 rounded-full" disabled={refundBusy}>
              <X className="text-gray-500" size={20}/>
            </button>
          </div>
          <div className="p-4 sm:p-5 overflow-y-auto space-y-4">
            <div className="bg-gray-50 rounded-xl p-3 text-sm">
              <div className="flex justify-between"><span className="text-gray-500">Pedido</span><span className="font-bold text-gray-800">#{sid}</span></div>
              <div className="flex justify-between mt-1"><span className="text-gray-500">Importe del pedido</span><span className="font-bold text-gray-800">€{Number(o.total || 0).toFixed(2)}</span></div>
              {o.customer_email && <div className="flex justify-between mt-1"><span className="text-gray-500">Email</span><span className="font-medium text-gray-700 truncate ml-2">{o.customer_email}</span></div>}
            </div>

            {/* Selector total / parcial (parcial sólo si está cobrado) */}
            {canPartial && (
              <div className="grid grid-cols-2 gap-2">
                <button type="button" onClick={() => setRefundMode('total')} className={`px-3 py-2 rounded-lg text-sm font-bold border transition-colors ${!isPartial ? 'bg-rose-600 border-rose-600 text-white' : 'bg-white border-gray-200 text-gray-600 hover:border-rose-300'}`}>Reembolso total</button>
                <button type="button" onClick={() => setRefundMode('partial')} className={`px-3 py-2 rounded-lg text-sm font-bold border transition-colors ${isPartial ? 'bg-rose-600 border-rose-600 text-white' : 'bg-white border-gray-200 text-gray-600 hover:border-rose-300'}`}>Parcial (por artículos)</button>
              </div>
            )}

            {isPartial ? (
              <div>
                <label className="block text-xs font-bold text-gray-600 uppercase tracking-wide mb-2">Artículos a devolver</label>
                <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                  {items.map((it, idx) => {
                    const ordered = Math.floor(Number(it?.quantity) || 0);
                    const sel = Number(refundQtys[idx]) || 0;
                    return (
                      <div key={idx} className={`flex items-center gap-2 rounded-lg border p-2 ${sel > 0 ? 'border-rose-300 bg-rose-50' : 'border-gray-200'}`}>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium text-gray-800 truncate">{it?.name || 'Producto'}</div>
                          <div className="text-xs text-gray-500">€{Number(it?.price || 0).toFixed(2)} · pedidos: {ordered}</div>
                        </div>
                        <div className="flex items-center gap-1.5 flex-shrink-0">
                          <button type="button" onClick={() => setQty(idx, sel - 1)} disabled={sel <= 0} className="w-7 h-7 rounded-md border border-gray-300 text-gray-600 font-bold disabled:opacity-40">−</button>
                          <span className="w-6 text-center text-sm font-bold text-gray-800">{sel}</span>
                          <button type="button" onClick={() => setQty(idx, sel + 1)} disabled={sel >= ordered} className="w-7 h-7 rounded-md border border-gray-300 text-gray-600 font-bold disabled:opacity-40">+</button>
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div className="flex justify-between items-center mt-3 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">
                  <span className="text-sm font-bold text-rose-800">A reembolsar</span>
                  <span className="text-lg font-extrabold text-rose-700">€{partialAmount.toFixed(2)}</span>
                </div>
                <p className="text-[11px] text-gray-400 mt-1">Se devolverá ese importe y sólo se repondrá el stock de los artículos seleccionados. El pedido sigue activo.</p>
              </div>
            ) : (
              <div className={`rounded-xl p-3 text-xs leading-relaxed ${isHoldOnly ? 'bg-gray-50 text-gray-700 border border-gray-200' : 'bg-rose-50 text-rose-800 border border-rose-200'}`}>
                {isHoldOnly
                  ? 'Este pedido sólo está AUTORIZADO (retención sin cobrar). Al confirmar se liberará la retención: el cliente nunca llega a pagar.'
                  : 'Se emitirá un reembolso TOTAL en Stripe al método de pago del cliente. El pedido pasará a Cancelado y se repondrá todo el stock.'}
              </div>
            )}

            <div>
              <label className="block text-xs font-bold text-gray-600 uppercase tracking-wide mb-2">Motivo (se enviará al cliente)</label>
              <div className="flex flex-wrap gap-2 mb-2">
                {REFUND_REASONS.map(r => (
                  <button key={r} type="button" onClick={() => setRefundReason(r)} className={`px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors ${refundReason === r ? 'bg-rose-600 border-rose-600 text-white' : 'bg-white border-gray-200 text-gray-600 hover:border-rose-300'}`}>
                    {r}
                  </button>
                ))}
              </div>
              <textarea value={refundReason} onChange={(e) => setRefundReason(e.target.value)} rows={3} maxLength={500} placeholder="Escribe o ajusta el motivo que verá el cliente…" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm resize-none focus:ring-2 focus:ring-rose-200 focus:border-rose-400 outline-none"/>
              <p className="text-[11px] text-gray-400 mt-1">El cliente recibirá un email con este motivo y las instrucciones de devolución del dinero.</p>
            </div>
          </div>
          <div className="p-4 sm:p-5 border-t flex gap-2 justify-end">
            <button type="button" onClick={() => setRefundTarget(null)} disabled={refundBusy} className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 text-sm font-medium hover:bg-gray-50 disabled:opacity-50">Cancelar</button>
            <button type="button" onClick={confirmRefund} disabled={refundBusy || (isPartial && partialAmount <= 0)} className="px-4 py-2 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-sm font-bold inline-flex items-center gap-2 disabled:opacity-50">
              {refundBusy ? <RefreshCw size={16} className="animate-spin"/> : <Undo2 size={16}/>}
              {refundBusy ? 'Procesando…' : isPartial ? `Reembolsar €${partialAmount.toFixed(2)}` : (isHoldOnly ? 'Liberar y avisar' : 'Reembolsar y avisar')}
            </button>
          </div>
        </div>
      </div>
    );
  };

  // Modal post-reembolso: avisar al cliente por WhatsApp con un toque.
  const renderRefundWaModal = () => {
    if (!refundWaModal) return null;
    const { waLink, emailed } = refundWaModal;
    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-3 sm:p-4 backdrop-blur-sm">
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden">
          <div className="p-5 text-center">
            <div className="w-12 h-12 rounded-full bg-green-100 text-green-600 flex items-center justify-center mx-auto mb-3"><CheckCircle size={26}/></div>
            <h3 className="text-lg font-bold text-gray-800 mb-1">Reembolso realizado</h3>
            <p className="text-sm text-gray-500 mb-4">
              {emailed ? 'Hemos enviado un email al cliente con el motivo y las instrucciones.' : 'Este pedido no tenía email. Avisa al cliente por WhatsApp.'}
            </p>
            {waLink ? (
              <a href={waLink} target="_blank" rel="noopener noreferrer" onClick={() => setRefundWaModal(null)} className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-green-600 hover:bg-green-700 text-white text-sm font-bold mb-2">
                <MessageCircle size={18}/> Avisar por WhatsApp
              </a>
            ) : (
              <p className="text-xs text-gray-400 bg-gray-50 rounded-lg p-3 mb-2">No hay un teléfono válido para abrir WhatsApp en este pedido.</p>
            )}
            <button type="button" onClick={() => setRefundWaModal(null)} className="w-full px-4 py-2 rounded-xl border border-gray-200 text-gray-600 text-sm font-medium hover:bg-gray-50">Cerrar</button>
          </div>
        </div>
      </div>
    );
  };

  // Modal post-aviso "listo para recoger": muestra el código de recogida y
  // ofrece avisar al cliente por WhatsApp con un toque.
  const renderPickupWaModal = () => {
    if (!pickupWaModal) return null;
    const { waLink, emailed, code } = pickupWaModal;
    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-3 sm:p-4 backdrop-blur-sm">
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden">
          <div className="p-5 text-center">
            <div className="w-12 h-12 rounded-full bg-gray-100 text-gray-600 flex items-center justify-center mx-auto mb-3"><CheckCircle size={26}/></div>
            <h3 className="text-lg font-bold text-gray-800 mb-1">Pedido marcado como listo</h3>
            <p className="text-sm text-gray-500 mb-3">
              {emailed ? 'Hemos enviado un email al cliente con el código de recogida.' : 'Este pedido no tenía email. Avisa al cliente por WhatsApp.'}
            </p>
            {code && (
              <div className="rounded-xl bg-gray-50 border border-gray-200 p-3 mb-4">
                <div className="text-[11px] font-bold text-gray-500 uppercase tracking-wide">Código de recogida</div>
                <div className="font-mono text-2xl font-extrabold text-gray-900 tracking-widest mt-0.5">{code}</div>
              </div>
            )}
            {waLink ? (
              <a href={waLink} target="_blank" rel="noopener noreferrer" onClick={() => setPickupWaModal(null)} className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-green-600 hover:bg-green-700 text-white text-sm font-bold mb-2">
                <MessageCircle size={18}/> Avisar por WhatsApp
              </a>
            ) : (
              <p className="text-xs text-gray-400 bg-gray-50 rounded-lg p-3 mb-2">No hay un teléfono válido para abrir WhatsApp en este pedido.</p>
            )}
            <button type="button" onClick={() => setPickupWaModal(null)} className="w-full px-4 py-2 rounded-xl border border-gray-200 text-gray-600 text-sm font-medium hover:bg-gray-50">Cerrar</button>
          </div>
        </div>
      </div>
    );
  };

  // Modal de cobro en tienda: registra cómo se cobró (efectivo / tarjeta)
  // y marca el pedido como Entregado. Para pedidos de pago en tienda /
  // contra reembolso (aún sin cobrar).
  const renderCollectModal = () => {
    if (!collectTarget) return null;
    const o = collectTarget;
    const sid = String(o.id || '').slice(0, 8).toUpperCase();
    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-3 sm:p-4 backdrop-blur-sm">
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden">
          <div className="flex justify-between items-center p-4 border-b">
            <h3 className="text-lg font-bold text-gray-800 flex items-center gap-2"><DollarSign size={20} className="text-green-600"/> Cobrar y entregar</h3>
            <button type="button" onClick={() => { if (!collectBusy) setCollectTarget(null); }} className="p-2 hover:bg-gray-100 rounded-full" disabled={collectBusy}><X className="text-gray-500" size={20}/></button>
          </div>
          <div className="p-5">
            <div className="bg-gray-50 rounded-xl p-3 text-sm mb-4">
              <div className="flex justify-between"><span className="text-gray-500">Pedido</span><span className="font-bold text-gray-800">#{sid}</span></div>
              <div className="flex justify-between mt-1"><span className="text-gray-500">A cobrar</span><span className="font-extrabold text-green-700 text-lg">€{Number(o.total || 0).toFixed(2)}</span></div>
            </div>
            <p className="text-sm text-gray-500 mb-3">¿Cómo ha pagado el cliente? Se registrará y el pedido pasará a <strong>Entregado</strong>.</p>
            <div className="grid grid-cols-2 gap-3">
              <button type="button" disabled={collectBusy} onClick={() => confirmCollect('Efectivo (en tienda)')} className="btn-cobrar flex flex-col items-center gap-1 px-4 py-4 rounded-xl text-white font-bold disabled:opacity-50">
                <span className="text-2xl">💵</span> Efectivo
              </button>
              <button type="button" disabled={collectBusy} onClick={() => confirmCollect('Tarjeta TPV (en tienda)')} className="flex flex-col items-center gap-1 px-4 py-4 rounded-xl bg-gray-800 hover:bg-gray-900 text-white font-bold disabled:opacity-50">
                <CreditCard size={24}/> Tarjeta (TPV)
              </button>
            </div>
            <p className="text-[11px] text-gray-400 mt-3 text-center">La tarjeta se cobra en el datáfono físico de la tienda; el sitio web no interviene.</p>
            <button type="button" onClick={() => { if (!collectBusy) setCollectTarget(null); }} disabled={collectBusy} className="w-full mt-3 px-4 py-2 rounded-xl border border-gray-200 text-gray-600 text-sm font-medium hover:bg-gray-50 disabled:opacity-50">Cancelar</button>
          </div>
        </div>
      </div>
    );
  };

  // Overlay con la lista de atajos de teclado. Las acciones de riesgo
  // (Cobrar, Reembolsar, Eliminar, IA en lote, Importar CSV) NO tienen
  // atajo a propósito y se indica abajo.
  const renderShortcutsHelp = () => {
    const Kbd = ({ children }) => (
      <kbd className="inline-flex items-center justify-center min-w-[22px] px-1.5 py-0.5 rounded border border-gray-300 bg-gray-50 text-gray-700 text-[11px] font-mono font-bold shadow-sm">{children}</kbd>
    );
    const Group = ({ title, rows }) => (
      <div>
        <p className="text-xs font-bold text-gray-400 uppercase tracking-wide mb-2">{title}</p>
        <div className="space-y-1.5">
          {rows.map(([keys, desc]) => (
            <div key={desc} className="flex items-center justify-between gap-3 text-sm">
              <span className="text-gray-700">{desc}</span>
              <span className="flex items-center gap-1 flex-shrink-0">{keys}</span>
            </div>
          ))}
        </div>
      </div>
    );
    return (
      <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4" onClick={() => setHelpOpen(false)}>
        <div className="w-full max-w-lg max-h-[85vh] overflow-y-auto bg-white rounded-2xl shadow-2xl" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center justify-between px-5 py-4 border-b sticky top-0 bg-white">
            <h3 className="text-lg font-bold text-gray-800">Atajos de teclado</h3>
            <button type="button" onClick={() => setHelpOpen(false)} className="p-2 rounded-lg hover:bg-gray-100 text-gray-500"><X size={18}/></button>
          </div>
          <div className="p-5 grid grid-cols-1 sm:grid-cols-2 gap-5">
            <Group title="Navegación" rows={[
              [<><Kbd>1</Kbd><Kbd>2</Kbd><Kbd>3</Kbd><Kbd>4</Kbd><Kbd>5</Kbd><Kbd>6</Kbd></>, 'Dashboard / Productos / Categorías / Reparaciones / Pedidos / Consulta IVA'],
            ]}/>
            <Group title="En cada sección" rows={[
              [<Kbd>/</Kbd>, 'Enfocar el buscador'],
              [<Kbd>n</Kbd>, 'Crear / enfocar el alta'],
              [<Kbd>c</Kbd>, 'Limpiar filtros / búsqueda'],
              [<Kbd>r</Kbd>, 'Recargar datos'],
            ]}/>
            <Group title="Detalle de pedido" rows={[
              [<Kbd>f</Kbd>, 'Abrir justificante'],
              [<Kbd>t</Kbd>, 'Abrir ticket'],
              [<Kbd>p</Kbd>, 'Imprimir ticket'],
            ]}/>
            <Group title="Modal de producto" rows={[
              [<><Kbd>Ctrl</Kbd><span className="text-gray-400 text-xs">/</span><Kbd>⌘</Kbd><Kbd>↵</Kbd></>, 'Guardar producto'],
            ]}/>
            <Group title="General" rows={[
              [<Kbd>?</Kbd>, 'Mostrar / ocultar esta ayuda'],
              [<Kbd>Esc</Kbd>, 'Cerrar ventana o quitar el foco'],
            ]}/>
          </div>
          <div className="px-5 pb-5">
            <div className="text-xs text-gray-500 bg-gray-50 border border-gray-200 rounded-lg p-3">
              Por seguridad, <strong>Cobrar, Reembolsar, Eliminar, IA en lote e Importar CSV</strong> no tienen atajo: hay que pulsarlos a mano.
            </div>
          </div>
        </div>
      </div>
    );
  };

  const renderImportModal = () => (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-2 sm:p-4 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
        <div className="flex justify-between items-center p-4 sm:p-6 border-b">
          <h3 className="text-xl font-bold text-gray-800">Importar productos (CSV)</h3>
          <button type="button" onClick={() => { if (!importing) { setImportModalOpen(false); setImportPreview(null); setImportProgress({ done: 0, total: 0, errors: [] }); } }} className="p-2 hover:bg-gray-100 rounded-full" disabled={importing}>
            <X className="text-gray-500" size={20}/>
          </button>
        </div>
        <div className="p-4 sm:p-6 overflow-y-auto space-y-4">
          <div className="flex flex-wrap gap-3 items-center">
            <button type="button" onClick={downloadImportTemplate} className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 text-sm font-medium hover:bg-gray-50 flex items-center gap-2">
              <FileSpreadsheet size={16}/>
              Descargar plantilla
            </button>
            <label className="px-4 py-2 rounded-lg bg-gray-900 text-white text-sm font-medium hover:bg-gray-800 cursor-pointer flex items-center gap-2">
              <Upload size={16}/>
              Elegir CSV
              <input type="file" accept=".csv,text/csv" className="hidden" onChange={handleImportFileSelect}/>
            </label>
          </div>
          <p className="text-xs text-gray-500">Cabeceras admitidas: name/nombre, short_name/nombre corto, price/precio, stock, image, category, sub_category_id, description, tax_rate/iva, tax_category, tax_review_status, tax_note, image_needs_optimization, oferta, oferta_type, oferta_value, gift_product, visible. category puede ser ID o nombre.</p>
          {importPreview && (
            <>
              <div className="font-bold text-gray-800">Vista previa · {importPreview.rows.length} fila{importPreview.rows.length !== 1 ? 's' : ''}</div>
              <div className="border rounded-xl overflow-x-auto max-h-48 overflow-y-auto">
                <table className="w-full text-left text-sm">
                  <thead className="bg-gray-100 sticky top-0">
                    <tr>{importPreview.headers.map((h, i) => <th key={i} className="p-2 whitespace-nowrap">{h}</th>)}</tr>
                  </thead>
                  <tbody className="divide-y">
                    {importPreview.rows.slice(0, 15).map((row, i) => (
                      <tr key={i}>{row.map((cell, j) => <td key={j} className="p-2 max-w-[120px] truncate" title={String(cell)}>{cell}</td>)}</tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {importPreview.rows.length > 15 && <div className="text-xs text-gray-500">... y {importPreview.rows.length - 15} más.</div>}
              {importProgress.total > 0 && (
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span>{importing ? `Importando ${importProgress.done}/${importProgress.total}...` : `Listo: ${importProgress.done} procesadas.`}</span>
                  </div>
                  {importProgress.errors.length > 0 && (
                    <div className="bg-red-50 border border-red-100 rounded-lg p-3 max-h-32 overflow-y-auto">
                      <div className="text-xs font-bold text-red-800 mb-1">Errores:</div>
                      {importProgress.errors.map((e, i) => <div key={i} className="text-xs text-red-700">Fila {e.row}: {e.msg}</div>)}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
        <div className="p-4 sm:p-6 border-t bg-gray-50 flex justify-end gap-2">
          <button type="button" onClick={() => { setImportModalOpen(false); setImportPreview(null); setImportProgress({ done: 0, total: 0, errors: [] }); }} className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 font-medium hover:bg-gray-50" disabled={importing}>
            Cerrar
          </button>
          <button type="button" onClick={runImport} disabled={!importPreview?.rows?.length || importing} className="px-6 py-2 rounded-lg bg-gray-900 text-white font-bold hover:bg-gray-800 disabled:opacity-50">
            {importing ? 'Importando…' : 'Importar'}
          </button>
        </div>
      </div>
    </div>
  );

  const renderBulkResultModal = () => (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-hidden flex flex-col">
        <div className="p-6 border-b">
          <h3 className="text-xl font-bold text-gray-800 mb-2">Resultado</h3>
          <p className="text-green-600 font-medium">✓ {bulkResultModal.success} completados</p>
          <p className="text-red-600 font-medium">✗ {bulkResultModal.failed} fallaron</p>
        </div>
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {(bulkResultModal.successItems || []).length > 0 && (
            <div>
              <p className="text-xs font-bold text-gray-500 mb-2 uppercase">Completados ({(bulkResultModal.successItems || []).length})</p>
              <ul className="text-sm text-gray-700 space-y-1 max-h-32 overflow-y-auto">
                {(bulkResultModal.successItems || []).map(item => (
                  <li key={item.id} className="truncate">✓ {item.name}</li>
                ))}
              </ul>
            </div>
          )}
          {(bulkResultModal.failedItems || []).length > 0 && (
            <div>
              <p className="text-xs font-bold text-gray-500 mb-2 uppercase">Fallidos ({(bulkResultModal.failedItems || []).length})</p>
              <ul className="text-sm text-gray-700 space-y-2 max-h-40 overflow-y-auto">
                {(bulkResultModal.failedItems || []).map(item => (
                  <li key={item.id} className="border-l-2 border-red-300 pl-2">
                    <span className="font-medium text-red-700">✗ {item.name}</span>
                    <p className="text-xs text-red-600 mt-0.5">{item.msg}</p>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
        <div className="p-6 border-t flex gap-3">
          {bulkResultModal.failed > 0 && (
            <button type="button" onClick={handleBulkRetryFailed} className="px-4 py-2 rounded-lg bg-gray-900 text-white font-medium hover:bg-gray-800">
              Reintentar fallidos ({bulkResultModal.failed})
            </button>
          )}
          <button type="button" onClick={() => { setBulkResultModal(prev => ({ ...prev, open: false })); clearProductSelection(); }} className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 font-medium hover:bg-gray-50">
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );

  // ... Product Modal ... (保持原样，为了简洁我这里没改动)
  const renderProductModal = () => {
    const filteredSubs = subCategories.filter(s => s.parent_id === parseInt(currentProduct.category));
    const productImages = currentProduct?.images?.length
      ? currentProduct.images
      : (currentProduct?.image ? [currentProduct.image] : []);
    const primaryProductImage = productImages[0];
    const isReviewModal = productReviewMode && !!currentProduct?.id;
    const currentTaxSuggestion = getTaxSuggestionForProduct(currentProduct);
    if (isReviewModal) {
      const isVisible = currentProduct.visible !== false;
      const needsFoto = !!(currentProduct.imageNeedsOptimization || currentProduct.image_needs_optimization);
      const pendingCount = products.filter(productNeedsReview).length;
      const busy = uploading || removingBg || generatingDesc || centeringProduct;
      return (
        <div className="fixed inset-0 bg-white z-50 flex flex-col animate-fade-in">
          <div className="h-11 flex items-center justify-between px-3 border-b border-gray-200 bg-white flex-shrink-0">
            <div className="flex items-center gap-2 min-w-0">
              <h3 className="text-sm font-bold text-gray-900 truncate">Revisión <span className="text-gray-400 font-mono text-xs">#{currentProduct.id}</span></h3>
              <span className={`flex-shrink-0 px-2 py-0.5 rounded-full border text-[10px] font-semibold ${taxStatusClass(currentProduct.taxReviewStatus || currentProduct.tax_review_status)}`}>{taxStatusLabel(currentProduct.taxReviewStatus || currentProduct.tax_review_status)}</span>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <span className="text-[11px] font-bold text-gray-600 bg-gray-100 border border-gray-200 rounded-full px-2 py-0.5">{pendingCount} pend.</span>
              <button onClick={() => setIsEditing(false)} className="p-1.5 hover:bg-gray-100 rounded-full"><X className="text-gray-500" size={20}/></button>
            </div>
          </div>

          <form onSubmit={handleSaveProduct} className="flex-1 min-h-0 flex flex-col">
            <div className="flex-1 min-h-0 flex flex-col sm:grid sm:grid-cols-[minmax(0,1fr)_minmax(300px,360px)] lg:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)] gap-2 sm:gap-3 p-2 sm:p-3 overflow-hidden">
              {/* Imagen: ocupa todo el espacio libre en móvil (los campos van
                  debajo con altura natural) para verla lo más grande posible. */}
              <div className="relative rounded-2xl border border-gray-200 bg-gray-50 overflow-hidden flex flex-col min-h-0 flex-1 sm:flex-none sm:h-auto">
                <div className="flex-1 min-h-0 flex items-center justify-center bg-[linear-gradient(45deg,#f8fafc_25%,transparent_25%),linear-gradient(-45deg,#f8fafc_25%,transparent_25%),linear-gradient(45deg,transparent_75%,#f8fafc_75%),linear-gradient(-45deg,transparent_75%,#f8fafc_75%)] bg-[length:24px_24px] bg-[position:0_0,0_12px,12px_-12px,-12px_0]">
                  {primaryProductImage ? (
                    <img src={primaryProductImage} alt={currentProduct.name || 'Producto'} className="max-h-full max-w-full object-contain p-2"/>
                  ) : (
                    <div className="text-center text-gray-400">
                      <ImageIcon size={44} className="mx-auto mb-2 opacity-60"/>
                      <div className="text-sm font-medium">Sin imagen principal</div>
                    </div>
                  )}
                </div>
                {needsFoto && <span className="absolute top-2 right-2 text-gray-600 bg-white/90 border border-gray-300 rounded px-2 py-0.5 text-[10px] font-bold">FOTO</span>}
              </div>

              {/* Campos: altura natural en móvil (la imagen se queda con el
                  resto del alto); en escritorio ocupan su columna. */}
              <div className="flex-shrink-0 sm:flex-1 sm:min-h-0 sm:overflow-y-auto flex flex-col gap-2">
                <textarea id="product-name" name="product-name" required rows={2} value={currentProduct.name} onChange={e => setCurrentProduct({...currentProduct, name: e.target.value})} className="w-full border p-2 rounded-lg text-sm font-semibold resize-none min-h-[3rem]" placeholder="Nombre completo del producto"/>
                <input value={currentProduct.shortName ?? currentProduct.short_name ?? ''} onChange={e => setCurrentProduct({...currentProduct, shortName: e.target.value})} className="w-full border p-2 rounded-lg text-sm" placeholder="Nombre corto para la tienda (opcional)"/>

                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <label className="text-[11px] font-bold text-gray-500 mb-0.5 block">Precio €</label>
                    <input id="product-price" name="product-price" required type="number" step="0.01" inputMode="decimal" value={currentProduct.price} onChange={e => setCurrentProduct({...currentProduct, price: parseFloat(e.target.value)})} className="w-full border p-2 rounded-lg text-sm"/>
                  </div>
                  <div>
                    <label className="text-[11px] font-bold text-gray-500 mb-0.5 block">Stock</label>
                    <input id="product-stock" name="product-stock" required type="number" inputMode="numeric" value={currentProduct.stock} onChange={e => setCurrentProduct({...currentProduct, stock: parseInt(e.target.value)})} className="w-full border p-2 rounded-lg text-sm"/>
                  </div>
                  <div>
                    <label className="text-[11px] font-bold text-gray-500 mb-0.5 block">IVA</label>
                    <select id="product-tax-rate" name="product-tax-rate" value={currentProduct.taxRate ?? currentProduct.tax_rate ?? ''} onChange={e => setCurrentProduct({...currentProduct, taxRate: e.target.value})} className="w-full border border-gray-300 p-2 rounded-lg text-sm bg-white">
                      {TAX_RATE_OPTIONS.map(o => <option key={o.value || 'pending'} value={o.value}>{o.label}</option>)}
                    </select>
                  </div>
                </div>

                {/* Sugerencia IVA compacta (una línea) */}
                {currentTaxSuggestion ? (
                  <div className="flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-1.5">
                    <span className="text-sm font-extrabold text-gray-900 flex-shrink-0">Sug. IVA {currentTaxSuggestion.suggested_tax_rate || '?'}%</span>
                    <span className="px-1.5 py-0.5 rounded-full border border-gray-200 bg-white text-gray-500 text-[10px] font-semibold flex-shrink-0">{currentTaxSuggestion.tax_confidence || 's/conf'}</span>
                    <span className="text-[11px] text-gray-500 truncate flex-1 min-w-0">{currentTaxSuggestion.matched_description || currentTaxSuggestion.tax_source || ''}</span>
                    <button type="button" onClick={() => applyTaxSuggestionToCurrentProduct(currentTaxSuggestion)} disabled={!currentTaxSuggestion.suggested_tax_rate} className="px-2.5 py-1 rounded-lg bg-gray-900 text-white text-xs font-bold hover:bg-gray-800 disabled:opacity-50 flex-shrink-0">Usar</button>
                  </div>
                ) : (
                  <div className="rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-1.5 text-[11px] text-gray-500">Sin sugerencia IVA local. Busca en POS o consulta gestor.</div>
                )}

                {/* Visible + Foto: dos toggles en una fila */}
                <div className="grid grid-cols-2 gap-2">
                  <button type="button" onClick={() => setCurrentProduct({...currentProduct, visible: !isVisible})} className={`flex items-center justify-center gap-2 p-2.5 rounded-xl border text-sm font-bold transition-colors ${isVisible ? 'border-gray-800 bg-gray-900 text-white' : 'border-gray-200 bg-white text-gray-400'}`}>
                    {isVisible ? <Eye size={16}/> : <EyeOff size={16}/>} {isVisible ? 'Visible' : 'Oculto'}
                  </button>
                  <button type="button" onClick={() => setCurrentProduct({...currentProduct, imageNeedsOptimization: !needsFoto})} className={`flex items-center justify-center gap-2 p-2.5 rounded-xl border text-sm font-bold transition-colors ${needsFoto ? 'border-gray-800 bg-gray-900 text-white' : 'border-gray-200 bg-white text-gray-400'}`}>
                    <ImageIcon size={16}/> {needsFoto ? 'Foto marcada' : 'Foto OK'}
                  </button>
                </div>
              </div>
            </div>

            <div className="border-t border-gray-200 bg-white p-2 sm:p-2.5 flex-shrink-0 space-y-1.5" style={{ paddingBottom: 'max(0.5rem, env(safe-area-inset-bottom))' }}>
              <div className="grid grid-cols-2 gap-2 sm:max-w-xl sm:ml-auto">
                <button type="button" onClick={(e) => handleSaveProduct(e, { saveAndNext: true, markStatus: 'needs_review' })} disabled={busy} className="w-full bg-white border border-gray-300 text-gray-700 py-3 rounded-xl font-bold hover:bg-gray-50 transition-colors disabled:opacity-50" title="No sé el IVA: marcar para revisar y pasar al siguiente">
                  Revisar IVA →
                </button>
                <button type="button" onClick={(e) => handleSaveProduct(e, { saveAndNext: true })} disabled={busy} className="w-full bg-gray-900 text-white py-3 rounded-xl font-bold hover:bg-gray-800 transition-colors disabled:opacity-50" title="Marcar como revisado (requiere IVA) y pasar al siguiente">
                  Revisado →
                </button>
              </div>
              <button type="submit" disabled={busy} className="w-full text-xs font-semibold text-gray-500 hover:text-gray-700 py-1 disabled:opacity-50">Guardar sin avanzar</button>
            </div>
          </form>
        </div>
      );
    }
    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-2 sm:p-4 backdrop-blur-sm animate-fade-in">
        <div className={`bg-white rounded-2xl shadow-2xl w-full ${isReviewModal ? 'max-w-6xl p-2.5 sm:p-3' : 'max-w-2xl p-4 sm:p-6'} max-h-[95vh] sm:max-h-[90vh] overflow-y-auto`}>
          <div className={`flex justify-between items-center ${isReviewModal ? 'mb-2' : 'mb-6'}`}>
            <h3 className={`${isReviewModal ? 'text-base' : 'text-xl'} font-bold text-gray-800`}>{currentProduct.id ? 'Editar' : 'Nuevo'} Producto</h3>
            <button onClick={() => setIsEditing(false)} className={`${isReviewModal ? 'p-1.5' : 'p-2'} hover:bg-gray-100 rounded-full`}><X className="text-gray-500" size={20}/></button>
          </div>
          <form onSubmit={handleSaveProduct} className={isReviewModal ? 'space-y-0' : 'space-y-4'}>
            {isReviewModal ? (
              <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_minmax(260px,340px)] lg:grid-cols-[minmax(0,1.15fr)_minmax(300px,0.85fr)] gap-2.5 lg:gap-3">
                <div className="rounded-2xl border border-gray-200 bg-gray-50 overflow-hidden min-h-0">
                  <div className="flex items-center justify-between gap-3 px-2.5 py-1.5 border-b border-gray-200 bg-white">
                    <div className="min-w-0">
                      <div className="text-xs font-bold text-gray-500 uppercase">Imagen principal</div>
                      <div className="text-sm font-semibold text-gray-800 truncate">{currentProduct.name || 'Producto sin nombre'}</div>
                    </div>
                    <span className="text-xs font-mono text-gray-400 flex-shrink-0">#{currentProduct.id}</span>
                  </div>
                  <div className="h-48 sm:h-[340px] lg:h-[360px] flex items-center justify-center bg-[linear-gradient(45deg,#f8fafc_25%,transparent_25%),linear-gradient(-45deg,#f8fafc_25%,transparent_25%),linear-gradient(45deg,transparent_75%,#f8fafc_75%),linear-gradient(-45deg,transparent_75%,#f8fafc_75%)] bg-[length:24px_24px] bg-[position:0_0,0_12px,12px_-12px,-12px_0]">
                    {primaryProductImage ? (
                      <img src={primaryProductImage} alt={currentProduct.name || 'Producto'} className="max-h-full max-w-full object-contain p-2"/>
                    ) : (
                      <div className="text-center text-gray-400">
                        <ImageIcon size={44} className="mx-auto mb-2 opacity-60"/>
                        <div className="text-sm font-medium">Sin imagen principal</div>
                      </div>
                    )}
                  </div>
                </div>

                <div className="space-y-2">
                  <div>
                    <label className="text-xs font-bold text-gray-500 mb-1 block">Nombre</label>
                    <textarea id="product-name" name="product-name" required rows={2} value={currentProduct.name} onChange={e => setCurrentProduct({...currentProduct, name: e.target.value})} className="w-full border p-1.5 rounded-lg text-sm resize-none min-h-[3.75rem]" placeholder="Nombre completo del producto"/>
                    <input value={currentProduct.shortName ?? currentProduct.short_name ?? ''} onChange={e => setCurrentProduct({...currentProduct, shortName: e.target.value})} className="w-full border p-1.5 rounded-lg text-sm mt-2" placeholder="Nombre corto para la tienda"/>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div><label className="text-xs font-bold text-gray-500 mb-1 block">Precio</label><input id="product-price" name="product-price" required type="number" step="0.01" value={currentProduct.price} onChange={e => setCurrentProduct({...currentProduct, price: parseFloat(e.target.value)})} className="w-full border p-1.5 rounded-lg"/></div>
                    <div><label className="text-xs font-bold text-gray-500 mb-1 block">Stock</label><input id="product-stock" name="product-stock" required type="number" value={currentProduct.stock} onChange={e => setCurrentProduct({...currentProduct, stock: parseInt(e.target.value)})} className="w-full border p-1.5 rounded-lg"/></div>
                  </div>

                  <div>
                    <label className="text-xs font-bold text-gray-600 mb-1 block">IVA</label>
                    <select id="product-tax-rate" name="product-tax-rate" value={currentProduct.taxRate ?? currentProduct.tax_rate ?? ''} onChange={e => setCurrentProduct({...currentProduct, taxRate: e.target.value})} className="w-full border border-gray-300 p-1.5 rounded-lg text-sm bg-white">
                      {TAX_RATE_OPTIONS.map(o => <option key={o.value || 'pending'} value={o.value}>{o.label}</option>)}
                    </select>
                  </div>

                  <label className="flex items-center gap-2.5 p-2.5 rounded-xl border border-gray-200 bg-gray-50 cursor-pointer">
                    <input type="checkbox" id="product-visible" checked={currentProduct.visible !== false} onChange={e => setCurrentProduct({...currentProduct, visible: e.target.checked})} className="w-4 h-4 rounded"/>
                    <span className="font-bold text-sm text-gray-800">Mostrar en tienda</span>
                  </label>

                  <label className={`flex items-center gap-2.5 p-2.5 rounded-xl border cursor-pointer ${currentProduct.imageNeedsOptimization ? 'border-gray-400 bg-gray-100' : 'border-gray-200 bg-white'}`}>
                    <input type="checkbox" checked={!!currentProduct.imageNeedsOptimization} onChange={e => setCurrentProduct({...currentProduct, imageNeedsOptimization: e.target.checked})} className="w-4 h-4 rounded"/>
                    <span>
                      <span className="block font-bold text-sm text-gray-800">Foto pendiente de optimizar</span>
                      <span className="block text-xs text-gray-500">Para arreglarla luego.</span>
                    </span>
                  </label>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-0.5">
                    <button type="submit" disabled={uploading || removingBg || generatingDesc || centeringProduct} className="w-full bg-gray-900 text-white py-2.5 rounded-xl font-bold hover:bg-gray-800 transition-colors">Guardar</button>
                    <button type="button" onClick={(e) => handleSaveProduct(e, { saveAndNext: true })} disabled={uploading || removingBg || generatingDesc || centeringProduct} className="w-full bg-gray-900 text-white py-2.5 rounded-xl font-bold hover:bg-gray-800 transition-colors">
                      Guardar y siguiente
                    </button>
                  </div>
                </div>
              </div>
            ) : (
            <>
            <div className="rounded-2xl border border-gray-200 bg-gray-50 overflow-hidden">
              <div className="flex items-center justify-between gap-3 px-3 py-2 border-b border-gray-200 bg-white">
                <div className="min-w-0">
                  <div className="text-xs font-bold text-gray-500 uppercase">Imagen principal</div>
                  <div className="text-sm font-semibold text-gray-800 truncate">{currentProduct.name || 'Producto sin nombre'}</div>
                </div>
                {currentProduct.id && <span className="text-xs font-mono text-gray-400 flex-shrink-0">#{currentProduct.id}</span>}
              </div>
              <div className="h-72 sm:h-96 flex items-center justify-center bg-[linear-gradient(45deg,#f8fafc_25%,transparent_25%),linear-gradient(-45deg,#f8fafc_25%,transparent_25%),linear-gradient(45deg,transparent_75%,#f8fafc_75%),linear-gradient(-45deg,transparent_75%,#f8fafc_75%)] bg-[length:24px_24px] bg-[position:0_0,0_12px,12px_-12px,-12px_0]">
                {primaryProductImage ? (
                  <img src={primaryProductImage} alt={currentProduct.name || 'Producto'} className="max-h-full max-w-full object-contain p-3"/>
                ) : (
                  <div className="text-center text-gray-400">
                    <ImageIcon size={44} className="mx-auto mb-2 opacity-60"/>
                    <div className="text-sm font-medium">Sin imagen principal</div>
                  </div>
                )}
              </div>
            </div>
            
            {/* 基本信息 */}
            <div>
              <label className="text-xs font-bold text-gray-500 mb-1 block">Nombre completo</label>
              <textarea id="product-name" name="product-name" required rows={2} value={currentProduct.name} onChange={e => setCurrentProduct({...currentProduct, name: e.target.value})} className="w-full border p-2 rounded-lg text-sm resize-y min-h-[2.5rem]" placeholder="Nombre completo del producto"/>
            </div>
            <div>
              <label className="text-xs font-bold text-gray-500 mb-1 block">Nombre corto</label>
              <input value={currentProduct.shortName ?? currentProduct.short_name ?? ''} onChange={e => setCurrentProduct({...currentProduct, shortName: e.target.value})} className="w-full border p-2 rounded-lg text-sm" placeholder="Ej: Frankfurt ElPozo Original"/>
            </div>
            
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div><label className="text-xs font-bold text-gray-500 mb-1 block">Precio</label><input id="product-price" name="product-price" required type="number" step="0.01" value={currentProduct.price} onChange={e => setCurrentProduct({...currentProduct, price: parseFloat(e.target.value)})} className="w-full border p-2 rounded-lg"/></div>
              <div><label className="text-xs font-bold text-gray-500 mb-1 block">Stock</label><input id="product-stock" name="product-stock" required type="number" value={currentProduct.stock} onChange={e => setCurrentProduct({...currentProduct, stock: parseInt(e.target.value)})} className="w-full border p-2 rounded-lg"/></div>
            </div>

            {!productReviewMode && (
              <div>
                 <label className="text-xs font-bold text-gray-500 mb-1 block">Descripción</label>
                 <textarea 
                   id="product-description"
                   name="product-description"
                   rows={6}
                   value={currentProduct.description || ""} 
                   onChange={e => setCurrentProduct({...currentProduct, description: e.target.value})} 
                   className="w-full border p-2 rounded-lg text-sm resize-y min-h-[6rem]"
                   placeholder="Escribe detalles del producto. AI puede rellenar con «Extraer información»."
                 />
              </div>
            )}

            <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h4 className="font-bold text-sm text-gray-800">IVA y revisión fiscal</h4>
                  <p className="text-[11px] text-gray-500">Fase 2: clasificar antes de emitir facturas oficiales.</p>
                </div>
                <span className={`px-2 py-1 rounded-full border text-[11px] font-semibold ${taxStatusClass(currentProduct.taxReviewStatus || currentProduct.tax_review_status)}`}>{taxStatusLabel(currentProduct.taxReviewStatus || currentProduct.tax_review_status)}</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-bold text-gray-600 mb-1 block">IVA</label>
                  <select id="product-tax-rate" name="product-tax-rate" value={currentProduct.taxRate ?? currentProduct.tax_rate ?? ''} onChange={e => setCurrentProduct({...currentProduct, taxRate: e.target.value})} className="w-full border border-gray-300 p-2 rounded-lg text-sm bg-white">
                    {TAX_RATE_OPTIONS.map(o => <option key={o.value || 'pending'} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-bold text-gray-600 mb-1 block">Categoría fiscal</label>
                  <select id="product-tax-category" name="product-tax-category" value={currentProduct.taxCategory ?? currentProduct.tax_category ?? ''} onChange={e => setCurrentProduct({...currentProduct, taxCategory: e.target.value})} className="w-full border border-gray-300 p-2 rounded-lg text-sm bg-white">
                    {TAX_CATEGORY_OPTIONS.map(o => <option key={o.value || 'none'} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-bold text-gray-600 mb-1 block">Estado</label>
                  <select id="product-tax-review-status" name="product-tax-review-status" value={currentProduct.taxReviewStatus ?? currentProduct.tax_review_status ?? 'pending'} onChange={e => setCurrentProduct({...currentProduct, taxReviewStatus: e.target.value})} className="w-full border border-gray-300 p-2 rounded-lg text-sm bg-white">
                    {TAX_REVIEW_STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-bold text-gray-600 mb-1 block">Nota fiscal</label>
                  <input id="product-tax-note" name="product-tax-note" value={currentProduct.taxNote ?? currentProduct.tax_note ?? ''} onChange={e => setCurrentProduct({...currentProduct, taxNote: e.target.value})} placeholder="Motivo, duda o referencia proveedor" className="w-full border border-gray-300 p-2 rounded-lg text-sm bg-white"/>
                </div>
              </div>
            </div>

            {/* 👇 Mostrar en tienda */}
            <div className="flex items-center gap-2 p-4 rounded-xl border border-gray-200 bg-gray-50">
                <input type="checkbox" id="product-visible" checked={currentProduct.visible !== false} onChange={e => setCurrentProduct({...currentProduct, visible: e.target.checked})} className="w-4 h-4 rounded"/>
                <label htmlFor="product-visible" className="font-bold text-sm text-gray-800">Mostrar en tienda (visible para clientes)</label>
            </div>

            {!productReviewMode && (
              <>
                <div className="bg-gray-50 p-4 rounded-xl border border-gray-200">
                    <div className="flex items-center gap-2">
                       <input 
                         type="checkbox" 
                         id="isGiftProduct" 
                         checked={currentProduct.giftProduct || false} 
                         onChange={e => setCurrentProduct({...currentProduct, giftProduct: e.target.checked})} 
                         className="w-4 h-4 rounded"
                       />
                       <label htmlFor="isGiftProduct" className="font-bold text-sm text-gray-800">Producto de Regalo (订单满€65可选)</label>
                    </div>
                </div>

                <div className="bg-gray-50 p-4 rounded-xl border border-gray-200">
                    <div className="flex items-center gap-2 mb-3">
                       <input 
                         type="checkbox" 
                         id="isOferta" 
                         checked={currentProduct.oferta || false} 
                         onChange={e => setCurrentProduct({...currentProduct, oferta: e.target.checked})} 
                         className="w-4 h-4 rounded"
                       />
                       <label htmlFor="isOferta" className="font-bold text-sm text-gray-800">¿Activar Oferta?</label>
                    </div>
                    
                    {currentProduct.oferta && (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 animate-fade-in">
                         <div>
                           <label className="text-xs font-bold text-gray-500 mb-1 block">Tipo</label>
                           <select id="oferta-type" name="oferta-type" value={currentProduct.oferta_type || "percent"} onChange={e => setCurrentProduct({...currentProduct, oferta_type: e.target.value})} className="w-full p-2 border rounded-lg text-sm bg-white">
                             <option value="percent">Descuento %</option>
                             <option value="second">2ª unidad -50%</option>
                             <option value="gift">2x1 (Regalo)</option>
                           </select>
                         </div>
                         <div>
                           <label className="text-xs font-bold text-gray-500 mb-1 block">Valor</label>
                           <input 
                             id="oferta-value"
                             name="oferta-value"
                             type="number" 
                             placeholder={currentProduct.oferta_type === "percent" ? "% (ej: 20)" : "Valor"} 
                             value={currentProduct.oferta_value || 0} 
                             onChange={e => setCurrentProduct({...currentProduct, oferta_value: parseFloat(e.target.value)})} 
                             className="w-full p-2 border rounded-lg text-sm"
                           />
                         </div>
                      </div>
                    )}
                </div>
              </>
            )}

            {/* 图片上传 - 支持多图 */}
            <div>
              <label className="text-xs font-bold text-gray-500 mb-1 block">Imágenes (puedes subir varias)</label>
              <div className="border-2 border-dashed border-gray-300 rounded-xl p-4 text-center hover:bg-gray-50 cursor-pointer relative">
                  {uploading ? (
                    <div className="text-gray-500">Subiendo...</div>
                  ) : (
                    <div className="text-gray-400 text-sm">Click para subir (puedes seleccionar múltiples imágenes)</div>
                  )}
                  <input id="product-image" name="product-image" type="file" accept="image/*" multiple onChange={handleImageUpload} className="absolute inset-0 opacity-0"/>
              </div>
              
              {/* 显示已上传的图片 */}
              {(currentProduct?.images?.length > 0 || currentProduct?.image) && (
                <div className="mt-3 grid grid-cols-3 gap-2">
                  {(currentProduct.images || (currentProduct.image ? [currentProduct.image] : [])).map((img, idx) => (
                    <div key={idx} className="relative group">
                      <img src={img} alt={`Producto ${idx + 1}`} className="w-full h-20 object-contain rounded-lg border border-gray-200 bg-gray-50"/>
                      {idx === 0 && (
                        <span className="absolute top-1 left-1 bg-gray-900 text-white text-xs px-1.5 py-0.5 rounded font-bold">Principal</span>
                      )}
                      <button
                        type="button"
                        onClick={() => handleRemoveImage(idx)}
                        className="absolute top-1 right-1 bg-red-500 text-white rounded-full w-5 h-5 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity text-xs"
                        title="Eliminar"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              )}
              
              {(currentProduct?.images?.length > 0 || currentProduct?.image) && (
                <div className="mt-2 flex gap-2 flex-wrap">
                  <button type="button" onClick={handleRemoveBg} disabled={removingBg || centeringProduct} className="px-3 py-1.5 text-sm font-medium rounded-lg bg-gray-200 hover:bg-gray-300 disabled:opacity-50">
                    {removingBg ? "..." : "Quitar fondo (AI)"}
                  </button>
                  <button type="button" onClick={handleCenterProduct} disabled={centeringProduct || removingBg} className="px-3 py-1.5 text-sm font-medium rounded-lg bg-gray-100 text-gray-700 hover:bg-gray-200 disabled:opacity-50">
                    {centeringProduct ? "..." : "Centrar producto (AI)"}
                  </button>
                  {!productReviewMode && (
                    <button type="button" onClick={handleGenerateDescription} disabled={generatingDesc || centeringProduct} className="px-3 py-1.5 text-sm font-medium rounded-lg bg-gray-100 text-gray-700 hover:bg-gray-200 disabled:opacity-50">
                      {generatingDesc ? "..." : `Extraer información (AI) ${currentProduct?.images?.length > 1 ? `(${currentProduct.images.length} imágenes)` : ''}`}
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* 分类选择 */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <select id="product-category" name="product-category" required value={currentProduct.category} onChange={e => setCurrentProduct({...currentProduct, category: parseInt(e.target.value)})} className="w-full border p-2 rounded-lg"><option value="">Categoría</option>{categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
                <select id="product-subcategory" name="product-subcategory" value={currentProduct.subCategoryId || ""} onChange={e => setCurrentProduct({...currentProduct, subCategoryId: parseInt(e.target.value)})} className="w-full border p-2 rounded-lg" disabled={!currentProduct.category}><option value="">Subcategoría</option>{filteredSubs.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <button type="submit" disabled={uploading || removingBg || generatingDesc || centeringProduct} className="w-full bg-gray-900 text-white py-3 rounded-xl font-bold hover:bg-gray-800 transition-colors">Guardar Producto</button>
              {productReviewMode && currentProduct.id && (
                <button type="button" onClick={(e) => handleSaveProduct(e, { saveAndNext: true })} disabled={uploading || removingBg || generatingDesc || centeringProduct} className="w-full bg-gray-900 text-white py-3 rounded-xl font-bold hover:bg-gray-800 transition-colors">
                  Guardar y siguiente
                </button>
              )}
            </div>
            </>
            )}
          </form>
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-gray-100 flex font-sans text-gray-800">
      <Toaster position="top-right" />
      {/* Mobile menu overlay */}
      {sidebarOpen && (
        <div 
          className="fixed inset-0 bg-black/50 z-30 md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}
      <aside className={`fixed md:static inset-y-0 left-0 ${sidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'} w-64 bg-gray-900 text-white flex-shrink-0 flex flex-col py-6 space-y-2 shadow-xl z-40 transition-transform duration-300`}>
        <div className="px-6 mb-8 font-bold text-xl flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-red-600 rounded-lg flex items-center justify-center font-extrabold">H</div>
            <span>HIPERA</span>
          </div>
          <button 
            onClick={() => setSidebarOpen(false)}
            className="md:hidden text-gray-400 hover:text-white"
          >
            <X size={20} />
          </button>
        </div>
        <nav className="flex-1 space-y-1 px-2">
            <button onClick={() => { setActiveTab("dashboard"); setSidebarOpen(false); }} className={`w-full p-3 px-4 flex items-center gap-3 rounded-xl ${activeTab==='dashboard'?'bg-red-600':'hover:bg-gray-800'}`}><LayoutDashboard size={20}/><span>Dashboard</span></button>
            <button onClick={() => { setActiveTab("products"); setSidebarOpen(false); }} className={`w-full p-3 px-4 flex items-center gap-3 rounded-xl ${activeTab==='products'?'bg-red-600':'hover:bg-gray-800'}`}><Package size={20}/><span>Productos</span></button>
            <button onClick={() => { setActiveTab("categories"); setSidebarOpen(false); }} className={`w-full p-3 px-4 flex items-center gap-3 rounded-xl ${activeTab==='categories'?'bg-red-600':'hover:bg-gray-800'}`}><List size={20}/><span>Categorías</span></button>
            <button onClick={() => { setActiveTab("repairs"); setSidebarOpen(false); }} className={`w-full p-3 px-4 flex items-center gap-3 rounded-xl ${activeTab==='repairs'?'bg-red-600':'hover:bg-gray-800'}`}><Wrench size={20}/><span>Reparaciones</span></button>
            <button onClick={() => { setActiveTab("citas"); setSidebarOpen(false); }} className={`w-full p-3 px-4 flex items-center gap-3 rounded-xl ${activeTab==='citas'?'bg-red-600':'hover:bg-gray-800'}`}>
              <CalendarCheck size={20}/><span className="flex-1 text-left">Citas</span>
              {bookings.filter(b => b.status === 'Nueva').length > 0 && (
                <span className="text-[11px] font-black bg-white text-red-600 rounded-full px-2 py-0.5">{bookings.filter(b => b.status === 'Nueva').length}</span>
              )}
            </button>
            <button onClick={() => { setActiveTab("orders"); setSidebarOpen(false); }} className={`w-full p-3 px-4 flex items-center gap-3 rounded-xl ${activeTab==='orders'?'bg-red-600':'hover:bg-gray-800'}`}><ShoppingBag size={20}/><span>Pedidos</span></button>
            <button onClick={() => { setActiveTab("iva"); setSidebarOpen(false); }} className={`w-full p-3 px-4 flex items-center gap-3 rounded-xl ${activeTab==='iva'?'bg-red-600':'hover:bg-gray-800'}`}><ScanLine size={20}/><span>Consulta IVA</span></button>
        </nav>
        <div className="px-4 pt-4 border-t border-gray-800 space-y-2">
          {/* Controles de alerta sonora de pedidos nuevos.
              Persistente en localStorage: si el dueño silencia un
              día, sigue silenciado al volver. */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={toggleMute}
              title={isMuted ? 'Activar sonido' : 'Silenciar sonido'}
              className={`p-2 rounded-lg transition-colors ${isMuted ? 'bg-gray-800 text-gray-500 hover:text-gray-300' : 'bg-gray-800 text-yellow-400 hover:bg-gray-700'}`}
              aria-label={isMuted ? 'Activar sonido' : 'Silenciar sonido'}
            >
              {isMuted ? <BellOff size={18}/> : <Bell size={18}/>}
            </button>
            <button
              type="button"
              onClick={playSound}
              className="flex-1 px-2 py-2 text-xs text-gray-300 hover:text-white bg-gray-800 hover:bg-gray-700 rounded-lg transition-colors"
              title="Reproduce el sonido de prueba (sirve también para desbloquear el audio del navegador la primera vez)."
            >
              Probar sonido
            </button>
          </div>
          {/* Permiso de notificaciones del sistema operativo: sólo
              mostramos el botón si está en 'default' (aún no se ha
              decidido). Si ya fue 'denied' o 'granted' no insistimos. */}
          {notifPermission === 'default' && (
            <button
              type="button"
              onClick={requestNotifPermission}
              className="w-full p-2 text-xs bg-yellow-600 hover:bg-yellow-700 text-white rounded-lg font-medium"
            >
              Activar avisos del navegador
            </button>
          )}
          <button onClick={() => setHelpOpen(true)} className="w-full p-3 flex items-center gap-3 text-gray-400 hover:text-white rounded-xl"><span className="w-5 text-center font-mono font-bold">?</span><span>Atajos de teclado</span></button>
          <button onClick={handleLogout} className="w-full p-3 flex items-center gap-3 text-gray-400 hover:text-white rounded-xl"><LogOut size={20}/><span>Salir</span></button>
        </div>
      </aside>
      <main className={`flex-1 min-w-0 overflow-x-hidden overflow-y-auto h-screen pt-14 pl-4 pr-4 pb-4 md:pt-8 md:pl-8 md:pr-8 md:pb-8 ${activeTab === 'products' && (selectedProductIds.size > 0 || bulkProcessing.active) ? 'pb-24' : ''}`}>
        {/* Mobile menu button - reserve space so content is not hidden */}
        <button 
          type="button"
          onClick={() => setSidebarOpen(true)}
          aria-label="Abrir menú"
          className="md:hidden fixed top-4 left-4 z-30 bg-gray-900 text-white p-2.5 rounded-lg shadow-lg"
        >
          <Menu size={22} />
        </button>

        {/* Banner persistente de pedidos nuevos. Se muestra encima
            del contenido independientemente de la pestaña activa,
            así el dueño siempre lo ve aunque esté en Productos /
            Categorías / etc. */}
        {newCount > 0 && (
          <div
            role="status"
            aria-live="polite"
            className="mb-4 p-3 md:p-4 bg-red-600 text-white rounded-xl shadow-lg flex flex-wrap items-center justify-between gap-3"
          >
            <div className="flex items-center gap-3">
              <span className="relative flex h-3 w-3 flex-shrink-0">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-yellow-300 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-3 w-3 bg-yellow-400"></span>
              </span>
              <div>
                <p className="font-bold text-sm md:text-base">
                  {newCount === 1 ? '1 pedido nuevo sin atender' : `${newCount} pedidos nuevos sin atender`}
                </p>
                {lastNewOrderAt && (
                  <p className="text-xs text-red-100">
                    Último a las {lastNewOrderAt.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                  </p>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => { setActiveTab('orders'); setSidebarOpen(false); markAllSeen(); }}
                className="px-4 py-2 bg-white text-red-600 rounded-lg text-sm font-bold hover:bg-red-50 active:scale-95 transition-all"
              >
                Ver pedidos
              </button>
              <button
                type="button"
                onClick={markAllSeen}
                className="px-3 py-2 border border-white/40 text-white rounded-lg text-sm font-medium hover:bg-red-700 active:scale-95 transition-all"
                title="Marcar como vistos sin abrir la pestaña de pedidos"
              >
                Marcar visto
              </button>
            </div>
          </div>
        )}

        {loading ? (
          <div className="flex min-h-[60vh] items-center justify-center"><RefreshCw className="animate-spin text-gray-400" size={32}/></div>
        ) : (
          <>
            {loadError && (
              <div className="mb-4 p-4 bg-amber-50 border border-amber-200 rounded-xl flex flex-wrap items-center justify-between gap-2">
                <span className="text-amber-800 text-sm font-medium">No se pudieron cargar todos los datos.</span>
                <button type="button" onClick={() => { fetchDataRetryCountRef.current = 0; fetchData(); }} className="px-4 py-2 bg-amber-600 text-white rounded-lg text-sm font-bold hover:bg-amber-700">
                  Reintentar
                </button>
              </div>
            )}
            {activeTab === 'dashboard' && renderDashboard()} 
            {activeTab === 'products' && renderProducts()}
            {activeTab === 'categories' && renderCategoryManager()}
            {activeTab === 'repairs' && renderRepairs()}
            {activeTab === 'citas' && renderBookings()}
            {activeTab === 'orders' && renderOrders()}
            {activeTab === 'iva' && <IvaLookup />}
          </>
        )}
      </main>
      {isEditing && renderProductModal()}
      {importModalOpen && renderImportModal()}
      {bulkResultModal.open && renderBulkResultModal()}
      {detailOrder && renderOrderDetailModal()}
      {refundTarget && renderRefundModal()}
      {refundWaModal && renderRefundWaModal()}
      {pickupWaModal && renderPickupWaModal()}
      {collectTarget && renderCollectModal()}
      {helpOpen && renderShortcutsHelp()}

      {/* Bulk AI: barra fija abajo cuando hay selección en Productos */}
      {activeTab === 'products' && (selectedProductIds.size > 0 || bulkProcessing.active) && (
        <div className="fixed bottom-0 left-0 right-0 md:left-64 bg-white border-t border-gray-200 shadow-lg z-20 p-4 flex flex-wrap items-center justify-center gap-3">
          {bulkProcessing.active ? (
            <span className="text-sm font-medium text-gray-700">
              {bulkProcessing.action === 'both' ? 'Quitar fondo + Centrar' : bulkProcessing.action === 'removeBg' ? 'Quitar fondo' : 'Centrar producto'}: {bulkProcessing.done}/{bulkProcessing.total} (~5s entre cada uno)
            </span>
          ) : (
            <>
              <span className="text-sm font-medium text-gray-700">{selectedProductIds.size} seleccionados</span>
              <button type="button" onClick={() => runBulkAction('both')} className="px-4 py-2 rounded-lg bg-gray-900 hover:bg-gray-800 text-white text-sm font-medium">
                Quitar fondo + Centrar (AI)
              </button>
              <button type="button" onClick={() => runBulkAction('removeBg')} className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 text-sm font-medium">
                Solo Quitar fondo
              </button>
              <button type="button" onClick={() => runBulkAction('center')} className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 text-sm font-medium">
                Solo Centrar
              </button>
              <button type="button" onClick={clearProductSelection} className="px-4 py-2 rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50 text-sm">
                Cancelar
              </button>
              <button type="button" onClick={() => selectAllProducts(products.filter(p => {
                const q = searchTerm.toLowerCase().trim();
                return !q || (p.name || '').toLowerCase().includes(q) || (p.shortName || p.short_name || '').toLowerCase().includes(q);
              }).filter(p => p.image || p.images?.[0]).map(p => p.id))} className="text-xs text-gray-500 hover:underline">
                Seleccionar todos (con imagen)
              </button>
            </>
          )}
        </div>
      )}

    </div>
  );
}
