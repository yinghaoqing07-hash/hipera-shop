import QRCode from 'qrcode';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import React, { useEffect, useRef, useState } from "react";
import { supabase } from './supabaseClient'; // 保留用于用户认证
import { apiClient } from './api/client'; // 新增：API客户端
import { useNavigate } from "react-router-dom"; 
import { 
  LayoutDashboard, Package, List, ShoppingBag, 
  Plus, Trash2, Edit2, X, DollarSign, AlertCircle, RefreshCw,
  ChevronRight, ChevronDown, FolderPlus, ImageIcon, LogOut, Upload, Wrench,
  CheckCircle, Clock, Gift, Printer, Menu, FileText, FileSpreadsheet
} from "lucide-react";
import toast, { Toaster } from 'react-hot-toast';

const AVAILABLE_ICONS = ["Package", "Apple", "Coffee", "Utensils", "Baby", "Home", "Gift"];

const COMPANY_DATA = {
  name: "QIANG GUO SL",
  address: "Paseo del Sol 1, 28880 Meco",
  nif: "B86126638",
  phone: "+34 918 782 602",
};

const CSV_IMPORT_FIELDS = ['name', 'price', 'stock', 'image', 'category', 'sub_category_id', 'description', 'oferta', 'oferta_type', 'oferta_value', 'gift_product', 'visible'];
const CSV_HEADER_ALIASES = {
  name: ['name', 'nombre', 'nombre del producto', 'producto'],
  price: ['price', 'precio', 'precio €'],
  stock: ['stock', 'cantidad', 'cant'],
  image: ['image', 'imagen', 'img', 'url', 'foto'],
  category: ['category', 'categoria', 'categoría', 'categoria_id'],
  sub_category_id: ['sub_category_id', 'subcategory_id', 'subcategoria', 'sub_category', 'subcategoría'],
  description: ['description', 'descripcion', 'descripción', 'desc'],
  oferta: ['oferta', 'offer', 'promo', 'en_oferta'],
  oferta_type: ['oferta_type', 'oferta type', 'tipo oferta', 'tipo_oferta'],
  oferta_value: ['oferta_value', 'oferta value', 'valor', 'valor_oferta'],
  gift_product: ['gift_product', 'gift product', 'regalo', 'gift', 'producto regalo'],
  visible: ['visible', 'mostrar', 'show', 'en_tienda', 'visible_en_tienda'],
};

function parseCSV(text) {
  const raw = (text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
  const lines = raw.split('\n').filter((l) => l.length > 0);
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
      if (!inQ && c === ',') { out.push(cur.trim()); cur = ''; continue; }
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
  const navigate = useNavigate();
  
  // Data
  const [products, setProducts] = useState([]);
  const [orders, setOrders] = useState([]);
  const [categories, setCategories] = useState([]);      
  const [subCategories, setSubCategories] = useState([]); 
  const [repairs, setRepairs] = useState([]); 
  const [loading, setLoading] = useState(false);

  // UI
  const [isEditing, setIsEditing] = useState(false);
  const [currentProduct, setCurrentProduct] = useState(null);
  const [newProduct, setNewProduct] = useState({
    name: "", price: 0, stock: 10, category: "", subCategoryId: "", image: "", images: [],
    description: "", oferta: false, oferta_type: "percent", oferta_value: 0, giftProduct: false,
    visible: true
  });
  const [uploading, setUploading] = useState(false);
  const [removingBg, setRemovingBg] = useState(false);
  const [generatingDesc, setGeneratingDesc] = useState(false);
  const [centeringProduct, setCenteringProduct] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedProductCategory, setSelectedProductCategory] = useState("");
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

  // States for forms
  const [newCatName, setNewCatName] = useState("");
  const [newCatIcon, setNewCatIcon] = useState("Package");
  const [newSubName, setNewSubName] = useState("");
  const [selectedParentForSub, setSelectedParentForSub] = useState(null);
  const [newRepair, setNewRepair] = useState({ brand: "", model: "", description: "Incluye limpieza interna + Cristal y Funda (o Cargador) de REGALO." });

  // 修改：增加了 description, oferta, oferta_type, oferta_value
  const [formData, setFormData] = useState({
    name: "", price: "", category: "", image: "", stock: "", 
    description: "", oferta: false, oferta_type: "percent", oferta_value: 0
  });

  useEffect(() => { fetchData(); }, []);

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
        apiClient.getRepairServices()
      ]);

      // 处理每个结果，只更新成功的数据
      const [pResult, oResult, cResult, sResult, rResult] = results;

      if (pResult.status === 'fulfilled' && pResult.value) {
        setProducts(pResult.value.map(p => {
          // 解析 images（如果是 JSON 字符串）
          let images = [];
          if (p.images) {
            try {
              images = typeof p.images === 'string' ? JSON.parse(p.images) : p.images;
            } catch (e) {
              images = p.image ? [p.image] : [];
            }
          } else if (p.image) {
            images = [p.image];
          }
          
          return {
            ...p, 
            ofertaType: p.oferta_type, 
            ofertaValue: p.oferta_value, 
            subCategoryId: p.sub_category_id,
            images: images,
            image: images[0] || p.image || '',
            giftProduct: p.gift_product || false
          };
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

  const handleLogout = async () => { await supabase.auth.signOut(); navigate("/login"); };

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

  const [stockEdits, setStockEdits] = useState({});
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
      const updated = await apiClient.updateProduct(p.id, payload);
      setProducts(prev => prev.map(x => x.id === p.id ? { ...x, stock: newStock, visible: newStock > 0 ? true : x.visible } : x));
      setStockEdits(prev => { const n = {...prev}; delete n[p.id]; return n; });
      toast.success(newStock > 0 ? "Stock actualizado, producto re-publicado" : "Stock actualizado");
    } catch (e) {
      toast.error("Error: " + (e.message || "Error"));
    } finally {
      setUpdatingStockId(null);
    }
  };
  
  const handleSaveProduct = async (e) => {
    e.preventDefault();
    const images = currentProduct.images || (currentProduct.image ? [currentProduct.image] : []);
    const dbPayload = { 
      name: currentProduct.name, 
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
      visible: currentProduct.visible !== false
    };
    
    try {
      let savedProduct;
      if (currentProduct.id) {
        // 更新现有商品
        savedProduct = await apiClient.updateProduct(currentProduct.id, dbPayload);
        toast.success("Producto actualizado");
        // 直接更新状态中的商品
        if (savedProduct) {
          setProducts(prev => prev.map(p => {
            if (p.id === currentProduct.id) {
              // 更新商品数据，保持 images 数组
              return {
                ...savedProduct,
                ofertaType: savedProduct.oferta_type,
                ofertaValue: savedProduct.oferta_value,
                subCategoryId: savedProduct.sub_category_id,
                images: images, // 保持前端的多图数组
                image: images[0] || savedProduct.image || '',
                giftProduct: savedProduct.gift_product || false
              };
            }
            return p;
          }));
        } else {
          // 如果返回数据不完整，重新获取
          fetchData();
        }
      } else {
        // 创建新商品
        savedProduct = await apiClient.createProduct(dbPayload);
        toast.success("Producto creado");
        // 直接添加到状态
        if (savedProduct) {
          const newProduct = {
            ...savedProduct,
            ofertaType: savedProduct.oferta_type,
            ofertaValue: savedProduct.oferta_value,
            subCategoryId: savedProduct.sub_category_id,
            images: images, // 保持前端的多图数组
            image: images[0] || savedProduct.image || '',
            giftProduct: savedProduct.gift_product || false
          };
          setProducts(prev => [...prev, newProduct]);
        } else {
          // 如果返回数据不完整，重新获取
          fetchData();
        }
      }
      setIsEditing(false); 
      setCurrentProduct(null);
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

  const runBulkAction = async (action) => {
    const ids = Array.from(selectedProductIds);
    const items = ids.map(id => products.find(p => p.id === id)).filter(Boolean);
    const withImage = items.filter(p => p.image || (p.images && p.images[0]));
    if (withImage.length === 0) {
      toast.error("Los productos seleccionados no tienen imagen");
      return;
    }
    setBulkProcessing({ active: true, done: 0, total: withImage.length, action, errors: [] });
    const errors = [];
    for (let i = 0; i < withImage.length; i++) {
      const p = withImage[i];
      const imgUrl = p.images?.[0] || p.image;
      if (!imgUrl) continue;
      try {
        let newUrl;
        if (action === 'removeBg') {
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
            name: p.name, price: p.price, stock: p.stock, category: p.category,
            sub_category_id: p.subCategoryId ?? p.sub_category_id, description: p.description || '',
            oferta: p.oferta, oferta_type: p.oferta_type || 'percent', oferta_value: p.oferta_value || 0,
            gift_product: p.giftProduct || false, visible: p.visible !== false,
            image: newImages[0]
          });
          setProducts(prev => prev.map(x => x.id === p.id ? { ...x, image: newImages[0], images: newImages } : x));
        }
      } catch (e) {
        errors.push({ id: p.id, name: p.name, msg: e?.message || 'Error' });
      }
      setBulkProcessing(prev => ({ ...prev, done: i + 1, errors }));
    }
    setBulkProcessing(prev => ({ ...prev, active: false }));
    const actionName = action === 'removeBg' ? 'Quitar fondo' : 'Centrar producto';
    toast.success(`${actionName}: ${withImage.length - errors.length}/${withImage.length} completados`);
    if (errors.length > 0) toast.error(`${errors.length} fallaron`);
    clearProductSelection();
  };

  const handleCreateProduct = async (e) => {
    e.preventDefault();
    const imgs = newProduct.images?.length ? newProduct.images : (newProduct.image ? [newProduct.image] : []);
    const payload = {
      name: newProduct.name,
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
      visible: newProduct.visible !== false
    };
    try {
      const saved = await apiClient.createProduct(payload);
      toast.success("Producto creado");
      if (saved) {
        setProducts(prev => [...prev, {
          ...saved,
          ofertaType: saved.oferta_type,
          ofertaValue: saved.oferta_value,
          subCategoryId: saved.sub_category_id,
          images: imgs,
          image: imgs[0] || saved.image || '',
          giftProduct: saved.gift_product || false
        }]);
      } else fetchData();
      setNewProduct({ name: "", price: 0, stock: 10, category: "", subCategoryId: "", image: "", images: [], description: "", oferta: false, oferta_type: "percent", oferta_value: 0, giftProduct: false, visible: true });
    } catch (err) {
      toast.error("Error al crear: " + (err.message || "Error"));
    }
  };

  const downloadImportTemplate = () => {
    const headers = ['name', 'price', 'stock', 'image', 'category', 'sub_category_id', 'description', 'oferta', 'oferta_type', 'oferta_value', 'gift_product', 'visible'];
    const example = ['Ejemplo Producto', '2.50', '10', '', '1', '', 'Descripción opcional', 'false', 'percent', '0', 'false', 'true'];
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
      const payload = {
        name,
        price,
        stock: parseInt(get('stock'), 10) || 10,
        image: get('image') || '',
        category: resolveCategory(get('category')),
        sub_category_id: (() => { const v = get('sub_category_id'); const n = parseInt(v, 10); return (v && !Number.isNaN(n)) ? n : null; })(),
        description: get('description') || '',
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
    doc.text(isService ? 'RESGUARDO REPARACION' : 'TICKET DE CAJA', centerX, y, { align: 'center' });
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
      doc.text((item.name || '').substring(0, 25), 5, y);
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
        doc.text(`${(item.name || '').substring(0, 22)} [REGALO]`, 5, y);
        y += 5;
        doc.text(`${item.quantity} x 0.00`.padEnd(20) + 'GRATIS', 5, y);
        y += 6;
      });
    }
    y += 3;
    doc.text('--------------------------------', centerX, y, { align: 'center' });
    y += 6;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.text(`TOTAL:     EUR ${(order.total || 0).toFixed(2)}`, 5, y);
    y += 7;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.text('(IVA Incluido)', 5, y);
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
      doc.text(isService ? 'FACTURA DE SERVICIO' : 'FACTURA SIMPLIFICADA', 140, 55);
      doc.setFont('helvetica', 'normal');
      doc.text(`Núm: ${order.id.slice(0, 8).toUpperCase()}`, 140, 62);
      doc.text(`Fecha: ${new Date(order.created_at).toLocaleDateString('es-ES')}`, 140, 67);
      doc.text(`Forma de Pago: ${(order.payment_method || 'CONTADO').toUpperCase()}`, 140, 72);
      const regularItems = (order.items || []).filter(i => !(i.isGift || i.price === 0));
      const giftItems = (order.items || []).filter(i => i.isGift || i.price === 0);
      let startY = 80;
      if (regularItems.length > 0) {
        const tableRows = regularItems.map(item => [
          item.name || '',
          item.quantity,
          `${((item.price || 0) / 1.21).toFixed(2)}`,
          '21%',
          `€${((item.price || 0) * (item.quantity || 0)).toFixed(2)}`
        ]);
        autoTable(doc, {
          startY,
          head: [['Descripción', 'Cant.', 'Precio Base', 'IVA', 'TOTAL']],
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
          '—',
          '€0.00'
        ]);
        autoTable(doc, {
          startY,
          head: [['Descripción', 'Cant.', 'Precio Base', 'IVA', 'TOTAL']],
          body: giftRows,
          theme: 'grid',
          headStyles: { fillColor: [180, 80, 120] },
          styles: { fontSize: 9 },
        });
        startY = doc.lastAutoTable.finalY + 8;
      }
      const finalY = startY + 2;
      const subTotal = (order.total || 0) / 1.21;
      const iva = (order.total || 0) - subTotal;
      doc.setFontSize(10);
      doc.text('Base Imponible:', 160, finalY, { align: 'right' });
      doc.text(`€${subTotal.toFixed(2)}`, 190, finalY, { align: 'right' });
      doc.text('IVA (21%):', 160, finalY + 5, { align: 'right' });
      doc.text(`€${iva.toFixed(2)}`, 190, finalY + 5, { align: 'right' });
      doc.setFontSize(14);
      doc.setFont('helvetica', 'bold');
      doc.text('TOTAL A PAGAR:', 160, finalY + 14, { align: 'right' });
      doc.text(`€${(order.total || 0).toFixed(2)}`, 190, finalY + 14, { align: 'right' });
      if (isService) {
        const boxY = finalY + 25;
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
      toast.success('Factura abierta');
    } catch (e) {
      toast.error('Error al abrir factura: ' + (e.message || 'Error'));
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
        setTimeout(() => { try { w.print(); } catch (_) {} }, 800);
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
          setTimeout(() => { URL.revokeObjectURL(url); try { document.body.removeChild(iframe); } catch (_) {} }, 30000);
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

  const renderDashboard = () => (
    <div className="space-y-6 animate-fade-in">
        <h2 className="text-2xl font-bold text-gray-800">Panel General</h2>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
            <div><p className="text-gray-500 text-xs uppercase font-bold">Ingresos</p><h3 className="text-2xl font-bold text-gray-800">€{orders.reduce((a,b)=>a+(b.total||0),0).toFixed(2)}</h3></div>
          </div>
          <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
            <div><p className="text-gray-500 text-xs uppercase font-bold">Pedidos</p><h3 className="text-2xl font-bold text-gray-800">{orders.length}</h3></div>
          </div>
          <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
            <div><p className="text-gray-500 text-xs uppercase font-bold">Pedidos hoy</p><h3 className="text-2xl font-bold text-gray-800">{todayOrders.length}</h3></div>
          </div>
          <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
            <div><p className="text-gray-500 text-xs uppercase font-bold">Productos</p><h3 className="text-2xl font-bold text-gray-800">{products.length}</h3></div>
          </div>
        </div>
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
                      <div className="font-bold text-gray-800 truncate">{p.name}</div>
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
                        className="px-3 py-1.5 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
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
                      <button type="button" onClick={() => openOrderFactura(o)} className="p-1.5 rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-600" title="Ver factura">
                        <FileText size={16}/>
                      </button>
                      <button type="button" onClick={() => openOrderTicket(o)} className="p-1.5 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-600" title="Ver ticket">
                        <FileText size={16}/>
                      </button>
                      <button type="button" onClick={() => printOrderTicket(o)} className="p-1.5 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-600" title="Imprimir ticket">
                        <Printer size={16}/>
                      </button>
                      <button type="button" onClick={() => { setActiveTab('orders'); }} className="text-xs text-blue-600 font-bold">Ver</button>
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
    const filtered = products.filter(p => !searchLower || (p.name || '').toLowerCase().includes(searchLower));
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

    const renderProductRow = (p) => (
      <tr key={p.id}>
        <td className="p-2 w-10">
          {(p.image || p.images?.[0]) && (
            <input type="checkbox" checked={selectedProductIds.has(p.id)} onChange={() => toggleProductSelect(p.id)} className="rounded" />
          )}
        </td>
        <td className="p-4 flex items-center gap-3">
          <img src={p.image || "https://via.placeholder.com/40"} alt="" className="w-10 h-10 rounded object-cover bg-gray-100"/>
          <div><div className="font-bold">{p.name}</div>{p.oferta && <span className="text-red-500 text-xs font-bold">OFERTA</span>}</div>
        </td>
        <td className="p-4">€{p.price}</td>
        <td className="p-4">{p.stock}</td>
        <td className="p-4 text-right"><button type="button" onClick={() => { setCurrentProduct(p); setIsEditing(true); }} className="text-blue-600 mr-2"><Edit2 size={18}/></button><button type="button" onClick={() => handleDeleteProduct(p.id)} className="text-red-600"><Trash2 size={18}/></button></td>
      </tr>
    );

    const renderProductCard = (p) => (
      <div key={p.id} className="bg-white rounded-xl shadow-sm border p-4 flex gap-3">
        {(p.image || p.images?.[0]) && (
          <div className="flex-shrink-0 pt-1">
            <input type="checkbox" checked={selectedProductIds.has(p.id)} onChange={() => toggleProductSelect(p.id)} className="rounded" />
          </div>
        )}
        <div className="flex-1 min-w-0">
        <div className="flex items-start gap-3 mb-3">
          <img src={p.image || "https://via.placeholder.com/40"} alt="" className="w-12 h-12 rounded object-cover bg-gray-100 flex-shrink-0"/>
          <div className="flex-1 min-w-0">
            <div className="font-bold text-gray-800 truncate">{p.name}</div>
            {p.oferta && <span className="text-red-500 text-xs font-bold">OFERTA</span>}
            <div className="flex items-center gap-4 mt-2 text-sm">
              <span className="font-bold text-gray-800">€{p.price}</span>
              <span className="text-gray-500">Stock: {p.stock}</span>
            </div>
          </div>
        </div>
        <div className="flex gap-2 justify-end">
          <button type="button" onClick={() => { setCurrentProduct(p); setIsEditing(true); }} className="text-blue-600 px-3 py-1.5 rounded-lg hover:bg-blue-50 flex items-center gap-1"><Edit2 size={16}/><span className="text-xs">Editar</span></button>
          <button type="button" onClick={() => handleDeleteProduct(p.id)} className="text-red-600 px-3 py-1.5 rounded-lg hover:bg-red-50 flex items-center gap-1"><Trash2 size={16}/><span className="text-xs">Eliminar</span></button>
        </div>
        </div>
      </div>
    );

    return (
      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row gap-3 bg-white p-4 rounded-xl shadow-sm items-stretch sm:items-center">
          <input id="search-products" name="search-products" placeholder="Buscar..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} className="flex-1 pl-4 pr-4 py-2 border rounded-lg text-sm outline-none focus:ring-2 ring-blue-100"/>
          <select value={selectedProductCategory} onChange={e => setSelectedProductCategory(e.target.value)} className="sm:w-48 pl-4 pr-4 py-2 border rounded-lg text-sm outline-none focus:ring-2 ring-blue-100 bg-white">
            <option value="">Todas las categorías</option>
            {categories.map(c => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
            <option value="_none">Sin categoría</option>
          </select>
          <button type="button" onClick={() => { setImportModalOpen(true); setImportPreview(null); setImportProgress({ done: 0, total: 0, errors: [] }); }} className="px-4 py-2 rounded-lg bg-emerald-600 text-white font-medium text-sm inline-flex items-center justify-center gap-2 hover:bg-emerald-700">
            <FileSpreadsheet size={18}/>
            Importar CSV
          </button>
        </div>

        {/* Bulk AI: barra cuando hay selección */}
        {(selectedProductIds.size > 0 || bulkProcessing.active) && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex flex-wrap items-center gap-3">
            {bulkProcessing.active ? (
              <span className="text-sm font-medium text-amber-800">
                {bulkProcessing.action === 'removeBg' ? 'Quitar fondo' : 'Centrar producto'}: {bulkProcessing.done}/{bulkProcessing.total}
              </span>
            ) : (
              <>
                <span className="text-sm font-medium text-amber-800">{selectedProductIds.size} seleccionados</span>
                <button type="button" onClick={() => runBulkAction('removeBg')} className="px-4 py-2 rounded-lg bg-gray-200 hover:bg-gray-300 text-sm font-medium">
                  Quitar fondo (AI)
                </button>
                <button type="button" onClick={() => runBulkAction('center')} className="px-4 py-2 rounded-lg bg-purple-200 hover:bg-purple-300 text-purple-800 text-sm font-medium">
                  Centrar producto (AI)
                </button>
                <button type="button" onClick={clearProductSelection} className="px-4 py-2 rounded-lg border border-amber-300 text-amber-700 hover:bg-amber-100 text-sm">
                  Cancelar
                </button>
                <button type="button" onClick={() => selectAllProducts(filtered.filter(p => p.image || p.images?.[0]).map(p => p.id))} className="text-xs text-amber-600 hover:underline">
                  Seleccionar todos (con imagen)
                </button>
              </>
            )}
          </div>
        )}

        {/* Inline: Añadir producto (form above categories) */}
        <form onSubmit={handleCreateProduct} className="bg-white rounded-xl shadow-sm border p-4 sm:p-6 space-y-4">
          <h3 className="font-bold text-gray-800 text-lg">Añadir producto nuevo</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="lg:col-span-2"><label className="text-xs font-bold text-gray-500 mb-1 block">Nombre</label><textarea required rows={2} value={newProduct.name} onChange={e => setNewProduct(p => ({ ...p, name: e.target.value }))} placeholder="Nombre completo del producto" className="w-full border p-2 rounded-lg text-sm resize-y min-h-[2.5rem]"/></div>
            <div><label className="text-xs font-bold text-gray-500 mb-1 block">Precio €</label><input required type="number" step="0.01" value={newProduct.price || ''} onChange={e => setNewProduct(p => ({ ...p, price: parseFloat(e.target.value) || 0 }))} className="w-full border p-2 rounded-lg text-sm"/></div>
            <div><label className="text-xs font-bold text-gray-500 mb-1 block">Stock</label><input required type="number" value={newProduct.stock ?? ''} onChange={e => setNewProduct(p => ({ ...p, stock: parseInt(e.target.value, 10) || 0 }))} className="w-full border p-2 rounded-lg text-sm"/></div>
            <div className="sm:col-span-2 lg:col-span-1 flex flex-col justify-end"><label className="text-xs font-bold text-gray-500 mb-1 block">Categoría</label><select required value={newProduct.category || ''} onChange={e => { const v = e.target.value; setNewProduct(p => ({ ...p, category: v ? parseInt(v, 10) : '', subCategoryId: '' })); }} className="w-full border p-2 rounded-lg text-sm bg-white"><option value="">—</option>{categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div><label className="text-xs font-bold text-gray-500 mb-1 block">Subcategoría</label><select value={newProduct.subCategoryId || ''} onChange={e => setNewProduct(p => ({ ...p, subCategoryId: e.target.value ? parseInt(e.target.value, 10) : '' }))} disabled={!newProduct.category} className="w-full border p-2 rounded-lg text-sm bg-white"><option value="">—</option>{subCategories.filter(s => s.parent_id === (Number(newProduct.category) || null)).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
            <div><label className="text-xs font-bold text-gray-500 mb-1 block">Descripción</label><textarea rows={5} value={newProduct.description || ''} onChange={e => setNewProduct(p => ({ ...p, description: e.target.value }))} placeholder="Opcional. AI puede rellenar con «Extraer información»." className="w-full border p-2 rounded-lg text-sm resize-y min-h-[5rem]"/></div>
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
                <button type="button" onClick={handleNewProductCenterProduct} disabled={centeringProduct || removingBg} className="px-3 py-1.5 text-sm font-medium rounded-lg bg-purple-100 text-purple-800 hover:bg-purple-200 disabled:opacity-50">
                  {centeringProduct ? "..." : "Centrar producto (AI)"}
                </button>
                <button type="button" onClick={handleNewProductGenerateDescription} disabled={generatingDesc || centeringProduct} className="px-3 py-1.5 text-sm font-medium rounded-lg bg-indigo-100 text-indigo-800 hover:bg-indigo-200 disabled:opacity-50">
                  {generatingDesc ? "..." : `Extraer información (AI)${(newProduct.images?.length || (newProduct.image ? 1 : 0)) > 1 ? ` (${newProduct.images?.length || 1} imágenes)` : ""}`}
                </button>
              </div>
            )}
          </div>
          <button type="submit" disabled={uploading || removingBg || generatingDesc || centeringProduct} className="bg-blue-600 text-white px-6 py-2 rounded-lg font-bold hover:bg-blue-700 disabled:opacity-50">Guardar producto</button>
        </form>

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
                              <table className="w-full text-left text-sm"><thead className="bg-gray-100/80 text-gray-500 font-bold"><tr><th className="p-2 w-10"></th><th className="p-4">Producto</th><th className="p-4">Precio</th><th className="p-4">Stock</th><th className="p-4 text-right">Acción</th></tr></thead><tbody className="divide-y bg-white">{list.map(renderProductRow)}</tbody></table>
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
                                {subExpanded && (list.length === 0 ? <div className="px-8 py-6 text-center text-gray-500 text-sm">No hay productos en esta subcategoría.</div> : <table className="w-full text-left text-sm"><thead className="bg-gray-100/80 text-gray-500 font-bold"><tr><th className="p-2 w-10"></th><th className="p-4 pl-8">Producto</th><th className="p-4">Precio</th><th className="p-4">Stock</th><th className="p-4 text-right">Acción</th></tr></thead><tbody className="divide-y bg-white">{list.map(renderProductRow)}</tbody></table>)}
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
                          (() => { const list = (byCategoryAndSub[cid] || {})['__none__'] || []; return list.length === 0 ? <div className="px-4 py-6 text-center text-gray-500 text-sm">No hay productos.</div> : <div className="px-4 py-3 space-y-3">{list.map(renderProductCard)}</div>; })()
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
                                {subExpanded && (list.length === 0 ? <div className="px-6 py-4 text-center text-gray-500 text-sm">No hay productos.</div> : <div className="px-4 py-3 space-y-3">{list.map(renderProductCard)}</div>)}
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
      </div>
    );
  };

  const renderCategoryManager = () => (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row gap-3 mb-6 bg-white p-4 rounded-xl border border-gray-100 shadow-sm">
        <div className="flex-1"><label className="text-xs font-bold text-gray-500 block mb-1">Nombre</label><input id="category-name" name="category-name" value={newCatName} onChange={e => setNewCatName(e.target.value)} className="border p-2 rounded-lg w-full"/></div>
        <div className="sm:w-40"><label className="text-xs font-bold text-gray-500 block mb-1">Icono</label><select id="category-icon" name="category-icon" value={newCatIcon} onChange={e => setNewCatIcon(e.target.value)} className="border p-2 rounded-lg w-full">{AVAILABLE_ICONS.map(i=><option key={i} value={i}>{i}</option>)}</select></div>
        <button onClick={handleAddCategory} className="bg-gray-900 text-white px-4 py-2.5 rounded-lg font-bold whitespace-nowrap sm:self-end">Crear</button>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {categories.map(c => (
          <div key={c.id} className="bg-white border rounded-xl overflow-hidden shadow-sm">
            <div className="bg-gray-50 p-3 flex justify-between font-bold text-gray-800 border-b"><span>{c.icon} {c.name}</span><button onClick={() => handleDeleteCategory(c.id)} className="text-gray-400 hover:text-red-600"><Trash2 size={16}/></button></div>
            <div className="p-3">
               <ul className="space-y-2 mb-2">{subCategories.filter(s => s.parent_id === c.id).map(s => <li key={s.id} className="flex justify-between text-sm text-gray-600"><span>- {s.name}</span><button onClick={() => handleDeleteCategory(s.id, true)} className="text-gray-300 hover:text-red-600"><Trash2 size={14}/></button></li>)}</ul>
               {selectedParentForSub === c.id ? (
                 <div className="flex gap-1"><input id="sub-category-name" name="sub-category-name" autoFocus placeholder="Sub..." value={newSubName} onChange={e => setNewSubName(e.target.value)} className="border p-1 text-sm rounded w-full"/><button onClick={() => handleAddSubCategory(c.id)} className="bg-blue-600 text-white px-2 rounded text-xs">OK</button></div>
               ) : <button onClick={() => setSelectedParentForSub(c.id)} className="w-full py-1 text-xs text-blue-600 border border-dashed border-blue-200 rounded">+ Añadir Sub</button>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );

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
                      <span className="bg-blue-50 text-blue-600 text-[10px] px-2 py-0.5 rounded font-bold uppercase">{r.model}</span>
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
  
  const renderOrders = () => (
     <div className="space-y-4">
        <h2 className="text-xl md:text-2xl font-bold text-gray-800">Pedidos ({orders.length})</h2>
        {/* Desktop table */}
        <div className="hidden md:block bg-white rounded-xl shadow-sm border overflow-hidden">
          <table className="w-full text-left text-sm">
             <thead className="bg-gray-50 font-bold text-gray-500">
               <tr>
                 <th className="p-4">Info</th>
                 <th className="p-4">Fecha</th>
                 <th className="p-4">Items</th>
                 <th className="p-4">Total</th>
                 <th className="p-4">Pago</th>
                 <th className="p-4">Estado</th>
                 <th className="p-4 text-center">Factura / Ticket</th>
               </tr>
             </thead>
             <tbody>
               {orders.map(o => {
                 const paymentMethod = o.payment_method || 'No especificado';
                 const paymentColor = paymentMethod === 'Contra Reembolso' 
                   ? 'bg-orange-100 text-orange-700' 
                   : paymentMethod === 'Bizum' 
                   ? 'bg-green-100 text-green-700' 
                   : 'bg-gray-100 text-gray-600';
                 const orderDate = o.created_at ? new Date(o.created_at) : null;
                 const dateStr = orderDate ? orderDate.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
                 return (
                 <tr key={o.id} className="border-b hover:bg-gray-50">
                   <td className="p-4 align-top">
                      <div className="font-mono text-xs font-bold text-gray-500">#{o.id.slice(0,8)}</div>
                      <div className="font-bold text-gray-800 mt-1">{o.phone}</div>
                      <div className="text-xs text-gray-500">{o.address}</div>
                      {o.note && <div className="text-xs bg-yellow-50 p-1 mt-1 rounded text-yellow-700">Nota: {o.note}</div>}
                   </td>
                   <td className="p-4 align-top text-xs text-gray-600 whitespace-nowrap">{dateStr}</td>
                   <td className="p-4 align-top">
                      {Array.isArray(o.items) && o.items.map((item, idx) => {
                        const isGift = item.isGift || item.price === 0;
                        return (
                          <div key={idx} className={`flex justify-between items-center text-xs mb-1 border-b border-dashed pb-1 ${isGift ? 'bg-pink-50 border-pink-200 px-2 py-1 rounded' : 'border-gray-100'}`}>
                              <span className="flex items-center gap-1.5">
                                {isGift && <Gift size={12} className="text-pink-600 flex-shrink-0"/>}
                                <span className={isGift ? 'font-bold text-pink-700' : ''}>
                                  {item.quantity}x {item.name}
                                </span>
                                {isGift && <span className="text-[10px] bg-pink-200 text-pink-800 px-1.5 py-0.5 rounded font-bold">GRATIS</span>}
                              </span>
                              {!isGift && <span className="text-gray-500">€{(item.price * item.quantity).toFixed(2)}</span>}
                          </div>
                        );
                      })}
                   </td>
                   <td className="p-4 align-top font-bold">€{o.total?.toFixed(2)}</td>
                   <td className="p-4 align-top">
                      <span className={`px-2 py-1 rounded text-xs font-bold ${paymentColor}`}>
                        {paymentMethod}
                      </span>
                   </td>
                   <td className="p-4 align-top">
                      <select value={o.status} onChange={(e) => updateOrderStatus(o.id, e.target.value)} className={`border rounded px-2 py-1 text-xs font-bold cursor-pointer ${o.status === 'Entregado' ? 'bg-green-100 text-green-700' : o.status === 'Pendiente de Pago' ? 'bg-orange-100 text-orange-700' : 'bg-blue-100 text-blue-700'}`}>
                        <option>Procesando</option>
                        <option>Pendiente de Pago</option>
                        <option>Enviado</option>
                        <option>Entregado</option>
                        <option>Cancelado</option>
                      </select>
                   </td>
                   <td className="p-4 align-top">
                      <div className="flex flex-wrap items-center justify-center gap-1">
                        <button type="button" onClick={() => openOrderFactura(o)} className="inline-flex items-center gap-1 px-2 py-1.5 rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-700 text-xs font-bold" title="Ver factura">
                          <FileText size={14}/> Factura
                        </button>
                        <button type="button" onClick={() => openOrderTicket(o)} className="inline-flex items-center gap-1 px-2 py-1.5 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-bold" title="Ver ticket">
                          <FileText size={14}/> Ticket
                        </button>
                        <button type="button" onClick={() => printOrderTicket(o)} className="inline-flex items-center gap-1 px-2 py-1.5 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-bold" title="Imprimir ticket">
                          <Printer size={14}/> Imprimir
                        </button>
                      </div>
                   </td>
                 </tr>
               )})}
             </tbody>
          </table>
        </div>
        {/* Mobile cards */}
        <div className="md:hidden space-y-4">
          {orders.map(o => {
            const paymentMethod = o.payment_method || 'No especificado';
            const paymentColor = paymentMethod === 'Contra Reembolso' 
              ? 'bg-orange-100 text-orange-700' 
              : paymentMethod === 'Bizum' 
              ? 'bg-green-100 text-green-700' 
              : 'bg-gray-100 text-gray-600';
            
            const orderDate = o.created_at ? new Date(o.created_at) : null;
            const dateStr = orderDate ? orderDate.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
            return (
              <div key={o.id} className="bg-white rounded-xl shadow-sm border p-4 space-y-3">
                <div className="flex justify-between items-start">
                  <div className="flex-1">
                    <div className="font-mono text-xs font-bold text-gray-500">#{o.id.slice(0,8)}</div>
                    <div className="text-xs text-gray-600 font-medium mt-0.5">📅 {dateStr}</div>
                  </div>
                  <span className={`px-2 py-1 rounded text-xs font-bold ${paymentColor}`}>
                    {paymentMethod}
                  </span>
                </div>
                <div>
                  <div className="font-bold text-gray-800">{o.phone}</div>
                  <div className="text-xs text-gray-500 mt-1">{o.address}</div>
                  {o.note && <div className="text-xs bg-yellow-50 p-2 mt-2 rounded text-yellow-700">Nota: {o.note}</div>}
                </div>
                <div className="border-t pt-3">
                  <div className="text-xs text-gray-600 mb-2 font-bold">Items:</div>
                  {Array.isArray(o.items) && o.items.map((item, idx) => {
                    const isGift = item.isGift || item.price === 0;
                    return (
                      <div key={idx} className={`flex justify-between items-center text-xs mb-1 pb-1 border-b border-dashed ${isGift ? 'bg-pink-50 border-pink-200 px-2 py-1.5 rounded' : 'border-gray-100'}`}>
                        <span className="flex items-center gap-1.5 flex-1">
                          {isGift && <Gift size={12} className="text-pink-600 flex-shrink-0"/>}
                          <span className={isGift ? 'font-bold text-pink-700' : ''}>
                            {item.quantity}x {item.name}
                          </span>
                          {isGift && <span className="text-[10px] bg-pink-200 text-pink-800 px-1.5 py-0.5 rounded font-bold ml-1">GRATIS</span>}
                        </span>
                        {!isGift && <span className="text-gray-500">€{(item.price * item.quantity).toFixed(2)}</span>}
                      </div>
                    );
                  })}
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t">
                  <span className="font-bold text-lg text-gray-800">€{o.total?.toFixed(2)}</span>
                  <div className="flex flex-wrap items-center gap-2">
                    <button type="button" onClick={() => openOrderFactura(o)} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-700 text-xs font-bold">
                      <FileText size={14}/> Factura
                    </button>
                    <button type="button" onClick={() => openOrderTicket(o)} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-bold">
                      <FileText size={14}/> Ticket
                    </button>
                    <button type="button" onClick={() => printOrderTicket(o)} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-bold">
                      <Printer size={14}/> Imprimir
                    </button>
                    <select value={o.status} onChange={(e) => updateOrderStatus(o.id, e.target.value)} className={`border rounded px-3 py-1.5 text-xs font-bold cursor-pointer ${o.status === 'Entregado' ? 'bg-green-100 text-green-700' : o.status === 'Pendiente de Pago' ? 'bg-orange-100 text-orange-700' : 'bg-blue-100 text-blue-700'}`}>
                      <option>Procesando</option>
                      <option>Pendiente de Pago</option>
                      <option>Enviado</option>
                      <option>Entregado</option>
                      <option>Cancelado</option>
                    </select>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
     </div>
  );

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
            <label className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 cursor-pointer flex items-center gap-2">
              <Upload size={16}/>
              Elegir CSV
              <input type="file" accept=".csv,text/csv" className="hidden" onChange={handleImportFileSelect}/>
            </label>
          </div>
          <p className="text-xs text-gray-500">Cabeceras admitidas: name/nombre, price/precio, stock, image, category, sub_category_id, description, oferta, oferta_type, oferta_value, gift_product. category puede ser ID o nombre.</p>
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
          <button type="button" onClick={runImport} disabled={!importPreview?.rows?.length || importing} className="px-6 py-2 rounded-lg bg-emerald-600 text-white font-bold hover:bg-emerald-700 disabled:opacity-50">
            {importing ? 'Importando…' : 'Importar'}
          </button>
        </div>
      </div>
    </div>
  );

  // ... Product Modal ... (保持原样，为了简洁我这里没改动)
  const renderProductModal = () => {
    const filteredSubs = subCategories.filter(s => s.parent_id === parseInt(currentProduct.category));
    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-2 sm:p-4 backdrop-blur-sm animate-fade-in">
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg p-4 sm:p-6 max-h-[95vh] sm:max-h-[90vh] overflow-y-auto">
          <div className="flex justify-between items-center mb-6">
            <h3 className="text-xl font-bold text-gray-800">{currentProduct.id ? 'Editar' : 'Nuevo'} Producto</h3>
            <button onClick={() => setIsEditing(false)} className="p-2 hover:bg-gray-100 rounded-full"><X className="text-gray-500" size={20}/></button>
          </div>
          <form onSubmit={handleSaveProduct} className="space-y-4">
            
            {/* 基本信息 */}
            <div>
              <label className="text-xs font-bold text-gray-500 mb-1 block">Nombre</label>
              <textarea id="product-name" name="product-name" required rows={2} value={currentProduct.name} onChange={e => setCurrentProduct({...currentProduct, name: e.target.value})} className="w-full border p-2 rounded-lg text-sm resize-y min-h-[2.5rem]" placeholder="Nombre completo del producto"/>
            </div>
            
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div><label className="text-xs font-bold text-gray-500 mb-1 block">Precio</label><input id="product-price" name="product-price" required type="number" step="0.01" value={currentProduct.price} onChange={e => setCurrentProduct({...currentProduct, price: parseFloat(e.target.value)})} className="w-full border p-2 rounded-lg"/></div>
              <div><label className="text-xs font-bold text-gray-500 mb-1 block">Stock</label><input id="product-stock" name="product-stock" required type="number" value={currentProduct.stock} onChange={e => setCurrentProduct({...currentProduct, stock: parseInt(e.target.value)})} className="w-full border p-2 rounded-lg"/></div>
            </div>

            {/* 👇 商品描述：多行可见 AI 生成内容 */}
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

            {/* 👇 Mostrar en tienda */}
            <div className="flex items-center gap-2 p-4 rounded-xl border border-gray-200 bg-gray-50">
                <input type="checkbox" id="product-visible" checked={currentProduct.visible !== false} onChange={e => setCurrentProduct({...currentProduct, visible: e.target.checked})} className="w-4 h-4 rounded"/>
                <label htmlFor="product-visible" className="font-bold text-sm text-gray-800">Mostrar en tienda (visible para clientes)</label>
            </div>

            {/* 👇 新增：免费商品标记 */}
            <div className="bg-pink-50 p-4 rounded-xl border border-pink-100">
                <div className="flex items-center gap-2">
                   <input 
                     type="checkbox" 
                     id="isGiftProduct" 
                     checked={currentProduct.giftProduct || false} 
                     onChange={e => setCurrentProduct({...currentProduct, giftProduct: e.target.checked})} 
                     className="w-4 h-4 text-pink-600 rounded"
                   />
                   <label htmlFor="isGiftProduct" className="font-bold text-sm text-pink-800">Producto de Regalo (订单满€65可选)</label>
                </div>
            </div>

            {/* 👇 新增：促销设置 */}
            <div className="bg-blue-50 p-4 rounded-xl border border-blue-100">
                <div className="flex items-center gap-2 mb-3">
                   <input 
                     type="checkbox" 
                     id="isOferta" 
                     checked={currentProduct.oferta || false} 
                     onChange={e => setCurrentProduct({...currentProduct, oferta: e.target.checked})} 
                     className="w-4 h-4 text-blue-600 rounded"
                   />
                   <label htmlFor="isOferta" className="font-bold text-sm text-blue-800">¿Activar Oferta?</label>
                </div>
                
                {/* 只有勾选了才显示详细设置 */}
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
                        <span className="absolute top-1 left-1 bg-blue-600 text-white text-xs px-1.5 py-0.5 rounded font-bold">Principal</span>
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
                  <button type="button" onClick={handleCenterProduct} disabled={centeringProduct || removingBg} className="px-3 py-1.5 text-sm font-medium rounded-lg bg-purple-100 text-purple-800 hover:bg-purple-200 disabled:opacity-50">
                    {centeringProduct ? "..." : "Centrar producto (AI)"}
                  </button>
                  <button type="button" onClick={handleGenerateDescription} disabled={generatingDesc || centeringProduct} className="px-3 py-1.5 text-sm font-medium rounded-lg bg-indigo-100 text-indigo-800 hover:bg-indigo-200 disabled:opacity-50">
                    {generatingDesc ? "..." : `Extraer información (AI) ${currentProduct?.images?.length > 1 ? `(${currentProduct.images.length} imágenes)` : ''}`}
                  </button>
                </div>
              )}
            </div>

            {/* 分类选择 */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <select id="product-category" name="product-category" required value={currentProduct.category} onChange={e => setCurrentProduct({...currentProduct, category: parseInt(e.target.value)})} className="w-full border p-2 rounded-lg"><option value="">Categoría</option>{categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
                <select id="product-subcategory" name="product-subcategory" value={currentProduct.subCategoryId || ""} onChange={e => setCurrentProduct({...currentProduct, subCategoryId: parseInt(e.target.value)})} className="w-full border p-2 rounded-lg" disabled={!currentProduct.category}><option value="">Subcategoría</option>{filteredSubs.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
            </div>

            <button type="submit" disabled={uploading || removingBg || generatingDesc || centeringProduct} className="w-full bg-blue-600 text-white py-3 rounded-xl font-bold hover:bg-blue-700 transition-colors">Guardar Producto</button>
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
            <button onClick={() => { setActiveTab("orders"); setSidebarOpen(false); }} className={`w-full p-3 px-4 flex items-center gap-3 rounded-xl ${activeTab==='orders'?'bg-red-600':'hover:bg-gray-800'}`}><ShoppingBag size={20}/><span>Pedidos</span></button>
        </nav>
        <div className="px-4 pt-4 border-t border-gray-800"><button onClick={handleLogout} className="w-full p-3 flex items-center gap-3 text-gray-400 hover:text-white rounded-xl"><LogOut size={20}/><span>Salir</span></button></div>
      </aside>
      <main className="flex-1 min-w-0 overflow-x-hidden overflow-y-auto h-screen pt-14 pl-4 pr-4 pb-4 md:pt-8 md:pl-8 md:pr-8 md:pb-8">
        {/* Mobile menu button - reserve space so content is not hidden */}
        <button 
          type="button"
          onClick={() => setSidebarOpen(true)}
          aria-label="Abrir menú"
          className="md:hidden fixed top-4 left-4 z-30 bg-gray-900 text-white p-2.5 rounded-lg shadow-lg"
        >
          <Menu size={22} />
        </button>
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
            {activeTab === 'orders' && renderOrders()}
          </>
        )}
      </main>
      {isEditing && renderProductModal()}
      {importModalOpen && renderImportModal()}

    </div>
  );
}