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
  ChevronRight, FolderPlus, ImageIcon, LogOut, Upload, Wrench,
  CheckCircle, Clock, Gift, Printer, Menu
} from "lucide-react";
import toast, { Toaster } from 'react-hot-toast';
import Cropper from 'react-easy-crop';

const AVAILABLE_ICONS = ["Package", "Apple", "Coffee", "Utensils", "Baby", "Home", "Gift"];

async function getCroppedImg(imageSrc, pixelCrop) {
  const img = await new Promise((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = reject;
    i.src = imageSrc;
  });
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(pixelCrop.width);
  canvas.height = Math.round(pixelCrop.height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('No canvas context');
  ctx.drawImage(img, Math.round(pixelCrop.x), Math.round(pixelCrop.y), Math.round(pixelCrop.width), Math.round(pixelCrop.height), 0, 0, Math.round(pixelCrop.width), Math.round(pixelCrop.height));
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('toBlob failed'))), 'image/jpeg', 0.92);
  });
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
  const [uploading, setUploading] = useState(false);
  const [removingBg, setRemovingBg] = useState(false);
  const [generatingDesc, setGeneratingDesc] = useState(false);
  const [centeringProduct, setCenteringProduct] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [loadError, setLoadError] = useState(false);
  const [ordersError, setOrdersError] = useState(false);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const fetchDataRetryCountRef = useRef(0);
  const RETRY_DELAYS = [5000, 15000, 35000]; // 3 reintentos: 5s, 15s, 35s (cold start ~60s)
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Crop modal: después de subir/seleccionar foto, recortar antes de usar
  const [cropModal, setCropModal] = useState(null); // { src, file, queue: File[] }
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const croppedAreaPixelsRef = useRef(null);

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

  const fetchOrdersOnly = async () => {
    setOrdersLoading(true);
    setOrdersError(false);
    try {
      const data = await apiClient.getAdminOrders();
      setOrders(data || []);
      setOrdersError(false);
    } catch (e) {
      console.error("Orders fetch error:", e);
      setOrdersError(true);
      toast.error("No se pudieron cargar los pedidos. Reintente.");
    } finally {
      setOrdersLoading(false);
    }
  };

  const fetchData = async () => {
    setLoading(true);
    setLoadError(false);
    setOrdersError(false);
    try {
      // Primero: products, categories, subcategories, repairs (sin auth o más ligeros)
      const results = await Promise.allSettled([
        apiClient.getProducts(),
        apiClient.getCategories(),
        apiClient.getSubCategories(),
        apiClient.getRepairServices()
      ]);
      const [pResult, cResult, sResult, rResult] = results;

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

      // Pedidos aparte (auth): evita bloquear el resto; en móvil suele fallar más
      await new Promise(r => setTimeout(r, 200));
      try {
        const ordersData = await apiClient.getAdminOrders();
        setOrders(ordersData || []);
        setOrdersError(false);
      } catch (e) {
        console.error("Orders error:", e);
        setOrdersError(true);
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
      // 直接从状态中移除，避免重新获取所有数据
      setProducts(prev => prev.filter(p => p.id !== id));
    } catch (error) {
      toast.error("Error al eliminar: " + error.message);
      console.error("Error deleting product:", error);
      // 如果删除失败，重新获取数据以确保同步
      fetchData();
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
      gift_product: currentProduct.giftProduct || false
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

  const openCropModal = (files) => {
    const queue = Array.from(files);
    if (queue.length === 0) return;
    const file = queue[0];
    const src = URL.createObjectURL(file);
    croppedAreaPixelsRef.current = null;
    setCrop({ x: 0, y: 0 });
    setZoom(1);
    setCropModal({ src, file, queue: queue.slice(1), total: queue.length, doneCount: 0 });
  };

  const closeCropModal = () => {
    if (cropModal?.src) URL.revokeObjectURL(cropModal.src);
    setCropModal(null);
  };

  const handleImageUpload = (event) => {
    const files = event.target.files;
    if (!files?.length) return;
    openCropModal(files);
    event.target.value = '';
  };

  const handleCropApply = async () => {
    if (!cropModal) return;
    const pixels = croppedAreaPixelsRef.current;
    if (!pixels) {
      toast.error("Ajusta el recorte y prueba de nuevo.");
      return;
    }
    try {
      setUploading(true);
      const blob = await getCroppedImg(cropModal.src, pixels);
      const fileName = `${Date.now()}-${Math.random().toString(36).slice(2, 11)}.jpg`;
      const { error } = await supabase.storage.from('products').upload(fileName, blob, { contentType: 'image/jpeg' });
      if (error) throw error;
      const { data } = supabase.storage.from('products').getPublicUrl(fileName);
      const existingImages = currentProduct.images || (currentProduct.image ? [currentProduct.image] : []);
      const allImages = [...existingImages, data.publicUrl];
      setCurrentProduct({ ...currentProduct, images: allImages, image: allImages[0] });

      URL.revokeObjectURL(cropModal.src);
      const nextQueue = cropModal.queue.slice(1);
      const done = (cropModal.doneCount ?? 0) + 1;
      if (cropModal.queue.length === 0) {
        setCropModal(null);
        toast.success(cropModal.total > 1 ? `${cropModal.total} imágenes subidas y recortadas.` : "Imagen subida y recortada.");
      } else {
        const next = cropModal.queue[0];
        const nextSrc = URL.createObjectURL(next);
        croppedAreaPixelsRef.current = null;
        setCrop({ x: 0, y: 0 });
        setZoom(1);
        setCropModal({ src: nextSrc, file: next, queue: nextQueue, total: cropModal.total, doneCount: done });
      }
    } catch (e) {
      toast.error("Error al subir: " + (e.message || "Error"));
    } finally {
      setUploading(false);
    }
  };
  
  const handleRemoveImage = (indexToRemove) => {
    const images = currentProduct.images || (currentProduct.image ? [currentProduct.image] : []);
    const newImages = images.filter((_, idx) => idx !== indexToRemove);
    setCurrentProduct({
      ...currentProduct,
      images: newImages,
      image: newImages[0] || '' // 更新主图
    });
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
      toast.error("Quitar fondo: " + (e.message || "Error"));
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

  const printOrderTicket = async (order) => {
    try {
      const isService = order.items?.some(i => i.isService) ?? false;
      const orderQueryUrl = `${window.location.origin.replace(/\/admin.*$/, '')}/?order=${order.id}`;
      const qrCodeUrl = await QRCode.toDataURL(orderQueryUrl, { errorCorrectionLevel: 'H', width: 300, margin: 2 });
      const doc = new jsPDF({ orientation: 'p', unit: 'mm', format: [80, 260] });
      let y = 10;
      const centerX = 40;
      doc.setFont('courier', 'bold');
      doc.setFontSize(16);
      doc.text('QIANG GUO SL', centerX, y, { align: 'center' });
      y += 5;
      doc.setFont('courier', 'normal');
      doc.setFontSize(8);
      doc.text('Mercado & Servicios', centerX, y, { align: 'center' });
      y += 5;
      doc.text('Paseo del Sol 1, 28880 Meco', centerX, y, { align: 'center' });
      y += 4;
      doc.text('NIF: B86126638', centerX, y, { align: 'center' });
      y += 4;
      doc.text(new Date(order.created_at).toLocaleString('es-ES'), centerX, y, { align: 'center' });
      y += 8;
      doc.text('--------------------------------', centerX, y, { align: 'center' });
      y += 4;
      doc.setFont('courier', 'bold');
      doc.text(isService ? 'RESGUARDO REPARACION' : 'TICKET DE CAJA', centerX, y, { align: 'center' });
      y += 4;
      doc.setFont('courier', 'normal');
      doc.text(`Ref: ${order.id.slice(0, 8)}`, centerX, y, { align: 'center' });
      y += 4;
      doc.text('--------------------------------', centerX, y, { align: 'center' });
      y += 6;
      doc.setFontSize(8);
      const regular = order.items?.filter(i => !(i.isGift || i.price === 0)) ?? [];
      const gifts = order.items?.filter(i => i.isGift || i.price === 0) ?? [];
      regular.forEach((item) => {
        doc.text((item.name || '').substring(0, 25), 5, y);
        y += 4;
        doc.text(`${item.quantity} x ${(item.price || 0).toFixed(2)}`.padEnd(20) + `€${((item.price || 0) * (item.quantity || 0)).toFixed(2)}`, 5, y);
        y += 5;
      });
      if (gifts.length > 0) {
        y += 2;
        doc.text('--------------------------------', centerX, y, { align: 'center' });
        y += 4;
        doc.setFont('courier', 'bold');
        doc.text('REGALO(S) — GRATIS', centerX, y, { align: 'center' });
        y += 5;
        doc.setFont('courier', 'normal');
        gifts.forEach((item) => {
          doc.text(`${(item.name || '').substring(0, 22)} [REGALO]`, 5, y);
          y += 4;
          doc.text(`${item.quantity} x 0.00`.padEnd(20) + 'GRATIS', 5, y);
          y += 5;
        });
      }
      y += 2;
      doc.text('--------------------------------', centerX, y, { align: 'center' });
      y += 6;
      doc.setFont('courier', 'bold');
      doc.setFontSize(12);
      doc.text(`TOTAL:     EUR ${(order.total || 0).toFixed(2)}`, 5, y);
      y += 6;
      doc.setFontSize(8);
      doc.setFont('courier', 'normal');
      doc.text('(IVA Incluido)', 5, y);
      y += 8;
      doc.text(`Pago: ${(order.payment_method || 'Efectivo/Bizum').toUpperCase()}`, 5, y);
      y += 10;
      if (isService) {
        doc.setFontSize(7);
        doc.text('GARANTIA DE REPARACION: 6 MESES', centerX, y, { align: 'center' });
        y += 3;
        doc.text('Imprescindible presentar este ticket', centerX, y, { align: 'center' });
        y += 6;
      }
      doc.addImage(qrCodeUrl, 'PNG', 20, y, 40, 40);
      y += 45;
      doc.setFontSize(8);
      doc.text('¡Gracias por su visita!', centerX, y, { align: 'center' });
      const blob = doc.output('blob');
      const url = URL.createObjectURL(blob);
      const iframe = document.createElement('iframe');
      iframe.style.cssText = 'position:fixed;width:0;height:0;border:none;';
      document.body.appendChild(iframe);
      iframe.src = url;
      iframe.onload = () => {
        try { iframe.contentWindow?.print(); } catch (_) { window.open(url, '_blank'); }
        setTimeout(() => { URL.revokeObjectURL(url); document.body.removeChild(iframe); }, 1000);
      };
      toast.success('Imprimir ticket');
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

  const renderProducts = () => (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row gap-3 bg-white p-4 rounded-xl shadow-sm">
        <input id="search-products" name="search-products" placeholder="Buscar..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} className="flex-1 pl-4 pr-4 py-2 border rounded-lg text-sm outline-none focus:ring-2 ring-blue-100"/>
        <button onClick={() => { 
          setCurrentProduct({ 
            name: "", price: 0, stock: 10, category: "", subCategoryId: "", image: "", images: [],
            // 👇 初始化新字段
            description: "", oferta: false, oferta_type: "percent", oferta_value: 0, giftProduct: false
          }); 
          setIsEditing(true); 
        }} className="bg-blue-600 text-white px-4 py-2 rounded-lg flex items-center justify-center gap-2 font-bold hover:bg-blue-700 whitespace-nowrap"><Plus size={18}/> Nuevo</button>
      </div>
      {/* Desktop table */}
      <div className="hidden md:block bg-white rounded-xl shadow-sm border overflow-hidden">
        <table className="w-full text-left text-sm">
          <thead className="bg-gray-50 text-gray-500 font-bold"><tr><th className="p-4">Producto</th><th className="p-4">Precio</th><th className="p-4">Stock</th><th className="p-4 text-right">Acción</th></tr></thead>
          <tbody className="divide-y">
            {products.filter(p => p.name.toLowerCase().includes(searchTerm.toLowerCase())).map(p => (
              <tr key={p.id}>
                <td className="p-4 flex items-center gap-3">
                  <img src={p.image || "https://via.placeholder.com/40"} className="w-10 h-10 rounded object-cover bg-gray-100"/>
                  <div><div className="font-bold">{p.name}</div>{p.oferta && <span className="text-red-500 text-xs font-bold">OFERTA</span>}</div>
                </td>
                <td className="p-4">€{p.price}</td>
                <td className="p-4">{p.stock}</td>
                <td className="p-4 text-right"><button onClick={() => {setCurrentProduct(p); setIsEditing(true);}} className="text-blue-600 mr-2"><Edit2 size={18}/></button><button onClick={() => handleDeleteProduct(p.id)} className="text-red-600"><Trash2 size={18}/></button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {/* Mobile cards */}
      <div className="md:hidden space-y-3">
        {products.filter(p => p.name.toLowerCase().includes(searchTerm.toLowerCase())).map(p => (
          <div key={p.id} className="bg-white rounded-xl shadow-sm border p-4">
            <div className="flex items-start gap-3 mb-3">
              <img src={p.image || "https://via.placeholder.com/40"} className="w-12 h-12 rounded object-cover bg-gray-100 flex-shrink-0"/>
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
              <button onClick={() => {setCurrentProduct(p); setIsEditing(true);}} className="text-blue-600 px-3 py-1.5 rounded-lg hover:bg-blue-50 flex items-center gap-1"><Edit2 size={16}/><span className="text-xs">Editar</span></button>
              <button onClick={() => handleDeleteProduct(p.id)} className="text-red-600 px-3 py-1.5 rounded-lg hover:bg-red-50 flex items-center gap-1"><Trash2 size={16}/><span className="text-xs">Eliminar</span></button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );

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
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-xl md:text-2xl font-bold text-gray-800">Pedidos ({orders.length})</h2>
          {ordersError && orders.length === 0 && (
            <div className="flex items-center gap-2">
              <span className="text-amber-700 text-sm">No se pudieron cargar los pedidos.</span>
              <button type="button" onClick={fetchOrdersOnly} disabled={ordersLoading} className="px-4 py-2 bg-amber-600 text-white rounded-lg text-sm font-bold hover:bg-amber-700 disabled:opacity-60">
                {ordersLoading ? "Cargando…" : "Reintentar"}
              </button>
            </div>
          )}
        </div>
        {ordersLoading && orders.length === 0 ? (
          <div className="py-12 text-center text-gray-500">Cargando pedidos…</div>
        ) : (
        <>
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
                 <th className="p-4 text-center">Ticket</th>
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
                   <td className="p-4 align-top text-center">
                      <button type="button" onClick={() => printOrderTicket(o)} className="inline-flex items-center gap-1 px-2 py-1.5 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-bold transition-colors" title="Imprimir ticket">
                        <Printer size={14}/> Imprimir
                      </button>
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
                  <div className="flex items-center gap-2">
                    <button type="button" onClick={() => printOrderTicket(o)} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-bold">
                      <Printer size={14}/> Ticket
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
        </>
        )}
     </div>
  );

  // ... Product Modal ...
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
            <div><label className="text-xs font-bold text-gray-500 mb-1 block">Nombre</label><input id="product-name" name="product-name" required value={currentProduct.name} onChange={e => setCurrentProduct({...currentProduct, name: e.target.value})} className="w-full border p-2 rounded-lg"/></div>
            
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div><label className="text-xs font-bold text-gray-500 mb-1 block">Precio</label><input id="product-price" name="product-price" required type="number" step="0.01" value={currentProduct.price} onChange={e => setCurrentProduct({...currentProduct, price: parseFloat(e.target.value)})} className="w-full border p-2 rounded-lg"/></div>
              <div><label className="text-xs font-bold text-gray-500 mb-1 block">Stock</label><input id="product-stock" name="product-stock" required type="number" value={currentProduct.stock} onChange={e => setCurrentProduct({...currentProduct, stock: parseInt(e.target.value)})} className="w-full border p-2 rounded-lg"/></div>
            </div>

            {/* 👇 新增：商品描述 */}
            <div>
               <label className="text-xs font-bold text-gray-500 mb-1 block">Descripción</label>
               <textarea 
                 id="product-description"
                 name="product-description"
                 value={currentProduct.description || ""} 
                 onChange={e => setCurrentProduct({...currentProduct, description: e.target.value})} 
                 className="w-full border p-2 rounded-lg h-24 text-sm"
                 placeholder="Escribe detalles del producto..."
               />
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
                    <div className="text-gray-400 text-sm">Click para subir o hacer foto · Podrás recortar antes de usar</div>
                  )}
                  <input id="product-image" name="product-image" type="file" accept="image/*" capture="environment" multiple onChange={handleImageUpload} className="absolute inset-0 opacity-0"/>
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

      {/* Modal recortar imagen (tras seleccionar/subir foto) */}
      {cropModal && (
        <div className="fixed inset-0 z-[60] flex flex-col items-center justify-center bg-black/80 p-4">
          <div className="bg-white rounded-2xl w-full max-w-lg overflow-hidden flex flex-col shadow-2xl">
            <div className="p-3 border-b flex items-center justify-between">
              <span className="font-bold text-gray-800">
                Recortar imagen{cropModal.total > 1 ? ` (${(cropModal.doneCount ?? 0) + 1} de ${cropModal.total})` : ''}
              </span>
              <button type="button" onClick={closeCropModal} className="p-2 hover:bg-gray-100 rounded-full"><X size={20}/></button>
            </div>
            <div className="relative w-full h-[50vh] min-h-[280px] bg-gray-900">
              <Cropper
                image={cropModal.src}
                crop={crop}
                zoom={zoom}
                aspect={1}
                onCropChange={setCrop}
                onZoomChange={setZoom}
                onCropComplete={(_, croppedAreaPixels) => { croppedAreaPixelsRef.current = croppedAreaPixels; }}
              />
            </div>
            <div className="p-4 border-t space-y-3">
              <label className="block text-xs font-bold text-gray-500">Zoom</label>
              <input
                type="range"
                min={1}
                max={3}
                step={0.1}
                value={zoom}
                onChange={(e) => setZoom(Number(e.target.value))}
                className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
              />
              <div className="flex gap-2">
                <button type="button" onClick={closeCropModal} className="flex-1 py-2.5 rounded-xl border border-gray-300 font-bold text-gray-700 hover:bg-gray-50">Cancelar</button>
                <button type="button" onClick={handleCropApply} disabled={uploading} className="flex-1 py-2.5 rounded-xl bg-blue-600 text-white font-bold hover:bg-blue-700 disabled:opacity-50">{uploading ? "Subiendo…" : "Aplicar"}</button>
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}