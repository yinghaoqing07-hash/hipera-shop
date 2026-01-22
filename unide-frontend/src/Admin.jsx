import QRCode from 'qrcode';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import React, { useEffect, useState } from "react";
import { supabase } from './supabaseClient'; // 保留用于用户认证
import { apiClient } from './api/client'; // 新增：API客户端
import { useNavigate } from "react-router-dom"; 
import { 
  LayoutDashboard, Package, List, ShoppingBag, 
  Plus, Trash2, Edit2, X, DollarSign, AlertCircle, RefreshCw,
  ChevronRight, FolderPlus, ImageIcon, LogOut, Upload, Wrench, Search,
  CheckCircle, Clock
} from "lucide-react";
import toast, { Toaster } from 'react-hot-toast';

const AVAILABLE_ICONS = ["Package", "Apple", "Coffee", "Utensils", "Baby", "Home", "Gift"];

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
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // States for forms
  const [newCatName, setNewCatName] = useState("");
  const [newCatIcon, setNewCatIcon] = useState("Package");
  const [newSubName, setNewSubName] = useState("");
  const [selectedParentForSub, setSelectedParentForSub] = useState(null);
  const [newRepair, setNewRepair] = useState({ title: "", price: "", original_price: "", description: "Incluye limpieza interna + Cristal y Funda (o Cargador) de REGALO." });

  // 修改：增加了 description, oferta, oferta_type, oferta_value
  const [formData, setFormData] = useState({
    name: "", price: "", category: "", image: "", stock: "", 
    description: "", oferta: false, oferta_type: "percent", oferta_value: 0
  });

  useEffect(() => { fetchData(); }, []);

  const fetchData = async () => {
    setLoading(true);
    try {
      // 使用API客户端获取所有数据
      const [pData, oData, cData, sData, rData] = await Promise.all([
        apiClient.getProducts().catch(e => { console.error("Products error:", e); return null; }),
        apiClient.getAdminOrders().catch(e => { console.error("Orders error:", e); return null; }),
        apiClient.getCategories().catch(e => { console.error("Categories error:", e); return null; }),
        apiClient.getSubCategories().catch(e => { console.error("SubCategories error:", e); return null; }),
        apiClient.getRepairServices().catch(e => { console.error("Repairs error:", e); return null; })
      ]);

      if (pData) setProducts(pData.map(p => {
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
          image: images[0] || p.image || ''
        };
      }));
      if (oData) setOrders(oData);
      if (cData) setCategories(cData);
      if (sData) setSubCategories(sData);
      if (rData) setRepairs(rData);

    } catch (error) {
      toast.error("Error cargando datos. Verifique que el servidor backend esté ejecutándose.");
      console.error(error);
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
      fetchData();
    } catch (error) {
      toast.error("Error al eliminar: " + error.message);
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
      // 👇 新增这 4 个字段
      description: currentProduct.description,
      oferta: currentProduct.oferta, 
      oferta_type: currentProduct.oferta_type || 'percent', 
      oferta_value: currentProduct.oferta_value || 0
    };
    
    try {
      if (currentProduct.id) {
        await apiClient.updateProduct(currentProduct.id, dbPayload);
        toast.success("Producto actualizado");
      } else {
        await apiClient.createProduct(dbPayload);
        toast.success("Producto creado");
      }
      setIsEditing(false); 
      setCurrentProduct(null); 
      fetchData();
    } catch (error) {
      toast.error("Error al guardar: " + error.message);
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
      
      // 更新描述
      const updatedProduct = { ...currentProduct, description: result.description || "" };
      
      // 如果有数量信息，尝试提取数字并更新stock（如果stock为空或默认值）
      if (result.productInfo?.quantity) {
        const qtyMatch = result.productInfo.quantity.match(/(\d+)/);
        if (qtyMatch && (!currentProduct.stock || currentProduct.stock === 10)) {
          updatedProduct.stock = parseInt(qtyMatch[1]);
        }
      }
      
      setCurrentProduct(updatedProduct);
      
      const infoParts = [];
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
      await apiClient.createCategory({ name: newCatName, icon: newCatIcon });
      toast.success("Categoría creada");
      setNewCatName(""); 
      fetchData();
    } catch (error) {
      toast.error("Error: " + error.message);
    }
  };
  
  const handleAddSubCategory = async (pid) => { 
    if (!newSubName) return; 
    try {
      await apiClient.createSubCategory({ parent_id: pid, name: newSubName });
      toast.success("Subcategoría creada");
      setNewSubName(""); 
      setSelectedParentForSub(null); 
      fetchData();
    } catch (error) {
      toast.error("Error: " + error.message);
    }
  };
  
  const handleDeleteCategory = async (id, isSub) => { 
    if(!window.confirm("¿Borrar?")) return; 
    try {
      if (isSub) {
        await apiClient.deleteSubCategory(id);
      } else {
        await apiClient.deleteCategory(id);
      }
      toast.success("Eliminado");
      fetchData();
    } catch (error) {
      toast.error("Error: " + error.message);
    }
  };
  
  const handleDeleteRepair = async (id) => { 
    if(!window.confirm("¿Borrar?")) return; 
    try {
      await apiClient.deleteRepairService(id);
      toast.success("Servicio eliminado");
      fetchData();
    } catch (error) {
      toast.error("Error: " + error.message);
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

  // --- Renders ---
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
            <div><p className="text-gray-500 text-xs uppercase font-bold">Productos</p><h3 className="text-2xl font-bold text-gray-800">{products.length}</h3></div>
          </div>
        </div>
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
            description: "", oferta: false, oferta_type: "percent", oferta_value: 0 
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
        <h3 className="font-bold text-gray-800 text-sm">Añadir Nuevo Servicio</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-2 mb-2">
           <input id="repair-brand" name="repair-brand" placeholder="Marca (ej: Apple)" value={newRepair.brand || ""} onChange={e => setNewRepair({...newRepair, brand: e.target.value})} className="border p-2 rounded-lg text-sm"/>
           <input id="repair-model" name="repair-model" placeholder="Modelo (ej: iPhone 13)" value={newRepair.model || ""} onChange={e => setNewRepair({...newRepair, model: e.target.value})} className="border p-2 rounded-lg text-sm"/>
           <input id="repair-type" name="repair-type" placeholder="Tipo (ej: Pantalla)" value={newRepair.repair_type || ""} onChange={e => setNewRepair({...newRepair, repair_type: e.target.value})} className="border p-2 rounded-lg text-sm"/>
           <input id="repair-price" name="repair-price" type="number" placeholder="Precio (€)" value={newRepair.price} onChange={e => setNewRepair({...newRepair, price: e.target.value})} className="border p-2 rounded-lg text-sm"/>
        </div>
        <div className="mb-2">
           <input id="repair-description" name="repair-description" placeholder="Descripción" value={newRepair.description || ""} onChange={e => setNewRepair({...newRepair, description: e.target.value})} className="w-full border p-2 rounded-lg text-sm" />
           <p className="text-xs text-gray-500 mt-1">Esta descripción se mostrará en la página de reparación (por defecto: Incluye limpieza interna + Cristal y Funda (o Cargador) de REGALO.)</p>
        </div>
        <button onClick={async () => {
    // 1. 检查必填项 (如果有空的，弹窗提示)
    if (!newRepair.brand) { toast.error("Falta la Marca (品牌)"); return; }
    if (!newRepair.model) { toast.error("Falta el Modelo (型号)"); return; }
    if (!newRepair.price) { toast.error("Falta el Precio (价格)"); return; }

    const toastId = toast.loading("Guardando...");

    try {
        // 2. 构造标题
        const title = `${newRepair.model} - ${newRepair.repair_type || 'Reparación'}`;
        
        // 3. 发送给数据库（通过API）
        await apiClient.createRepairService({
            brand: newRepair.brand,
            model: newRepair.model,
            repair_type: newRepair.repair_type,
            price: parseFloat(newRepair.price),
            title: title,
            description: newRepair.description || "Incluye limpieza interna + Cristal y Funda (o Cargador) de REGALO."
        });

        // 4. 成功
        toast.success("Servicio añadido", { id: toastId });
        setNewRepair({title:"", price:"", original_price:"", brand: "", model: "", repair_type: "", description: "Incluye limpieza interna + Cristal y Funda (o Cargador) de REGALO."}); 
        fetchData();

    } catch (err) {
        // 5. 捕获并显示错误
        console.error(err);
        toast.error("Error: " + err.message, { id: toastId });
    }
}} className="bg-gray-900 text-white px-4 py-2 rounded-lg font-bold text-sm">
    Añadir
</button>
      </div>

      {/* 列表显示 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {repairs.map(r => (
          <div key={r.id} className="bg-white p-4 rounded-xl shadow-sm border border-gray-100">
             <div className="flex justify-between items-start mb-2">
                <div className="flex-1">
                   <div className="flex gap-2 mb-1">
                      <span className="bg-gray-100 text-gray-600 text-[10px] px-2 py-0.5 rounded font-bold uppercase">{r.brand}</span>
                      <span className="bg-blue-50 text-blue-600 text-[10px] px-2 py-0.5 rounded font-bold uppercase">{r.model}</span>
                   </div>
                   <h3 className="font-bold text-gray-800 text-sm mb-1">{r.repair_type || r.title}</h3>
                   <p className="text-xs text-gray-500 mb-2">{r.description || "Reparación rápida*"}</p>
                   <span className="text-red-600 font-bold">€{r.price}</span>
                </div>
                <button onClick={() => handleDeleteRepair(r.id)} className="text-gray-300 hover:text-red-600 p-2 flex-shrink-0"><Trash2 size={18}/></button>
             </div>
             <button 
               onClick={async () => {
                 const newDesc = prompt("Editar descripción:", r.description || "Reparación rápida*");
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
                 <th className="p-4">Items</th>
                 <th className="p-4">Total</th>
                 <th className="p-4">Pago</th>
                 <th className="p-4">Estado</th>
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
                 
                 return (
                 <tr key={o.id} className="border-b hover:bg-gray-50">
                   <td className="p-4 align-top">
                      <div className="font-mono text-xs font-bold text-gray-500">#{o.id.slice(0,8)}</div>
                      <div className="text-xs text-gray-400">{new Date(o.created_at).toLocaleString()}</div>
                      <div className="font-bold text-gray-800 mt-1">{o.phone}</div>
                      <div className="text-xs text-gray-500">{o.address}</div>
                      {o.note && <div className="text-xs bg-yellow-50 p-1 mt-1 rounded text-yellow-700">Nota: {o.note}</div>}
                   </td>
                   <td className="p-4 align-top">
                      {Array.isArray(o.items) && o.items.map((item, idx) => (
                          <div key={idx} className="flex justify-between text-xs mb-1 border-b border-dashed border-gray-100 pb-1">
                              <span>{item.quantity}x {item.name}</span>
                          </div>
                      ))}
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
            
            return (
              <div key={o.id} className="bg-white rounded-xl shadow-sm border p-4 space-y-3">
                <div className="flex justify-between items-start">
                  <div className="flex-1">
                    <div className="font-mono text-xs font-bold text-gray-500">#{o.id.slice(0,8)}</div>
                    <div className="text-xs text-gray-400">{new Date(o.created_at).toLocaleString()}</div>
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
                  {Array.isArray(o.items) && o.items.map((item, idx) => (
                    <div key={idx} className="flex justify-between text-xs mb-1 pb-1 border-b border-dashed border-gray-100">
                      <span>{item.quantity}x {item.name}</span>
                    </div>
                  ))}
                </div>
                <div className="flex items-center justify-between pt-2 border-t">
                  <span className="font-bold text-lg text-gray-800">€{o.total?.toFixed(2)}</span>
                  <select value={o.status} onChange={(e) => updateOrderStatus(o.id, e.target.value)} className={`border rounded px-3 py-1.5 text-xs font-bold cursor-pointer ${o.status === 'Entregado' ? 'bg-green-100 text-green-700' : o.status === 'Pendiente de Pago' ? 'bg-orange-100 text-orange-700' : 'bg-blue-100 text-blue-700'}`}>
                    <option>Procesando</option>
                    <option>Pendiente de Pago</option>
                    <option>Enviado</option>
                    <option>Entregado</option>
                    <option>Cancelado</option>
                  </select>
                </div>
              </div>
            );
          })}
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
      <main className="flex-1 p-4 md:p-8 overflow-y-auto h-screen">
        {/* Mobile menu button */}
        <button 
          onClick={() => setSidebarOpen(true)}
          className="md:hidden fixed top-4 left-4 z-30 bg-gray-900 text-white p-2 rounded-lg shadow-lg"
        >
          <LayoutDashboard size={20} />
        </button>
        {loading ? <div className="flex h-full items-center justify-center"><RefreshCw className="animate-spin text-gray-400" size={32}/></div> : (
          <>
            {activeTab === 'dashboard' && renderDashboard()} 
            {activeTab === 'products' && renderProducts()}
            {activeTab === 'categories' && renderCategoryManager()}
            {activeTab === 'repairs' && renderRepairs()}
            {activeTab === 'orders' && renderOrders()}
          </>
        )}
      </main>
      {isEditing && renderProductModal()}
    </div>
  );
}