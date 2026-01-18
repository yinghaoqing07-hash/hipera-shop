import React, { useEffect, useState } from "react";
import { supabase } from './supabaseClient';
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
  const [searchTerm, setSearchTerm] = useState("");

  // States for forms
  const [newCatName, setNewCatName] = useState("");
  const [newCatIcon, setNewCatIcon] = useState("Package");
  const [newSubName, setNewSubName] = useState("");
  const [selectedParentForSub, setSelectedParentForSub] = useState(null);
  const [newRepair, setNewRepair] = useState({ title: "", price: "", original_price: "" });

  useEffect(() => { fetchData(); }, []);

  const fetchData = async () => {
    setLoading(true);
    try {
      // 1. 获取产品
      const { data: pData } = await supabase.from('products').select('*').order('id', { ascending: true });
      
      // 2. 获取订单 (⚠️ 关键修改：只查 *，不查关联 user，防止报错)
      const { data: oData, error: oError } = await supabase.from('orders').select('*').order('created_at', { ascending: false });
      
      // 3. 获取其他数据
      const { data: cData } = await supabase.from('categories').select('*').order('id', { ascending: true });
      const { data: sData } = await supabase.from('sub_categories').select('*').order('id', { ascending: true });
      const { data: rData } = await supabase.from('repair_services').select('*').order('id', { ascending: true });

      if (oError) console.error("Order Error:", oError); // 在控制台打印错误

      if (pData) setProducts(pData.map(p => ({...p, ofertaType: p.oferta_type, ofertaValue: p.oferta_value, subCategoryId: p.sub_category_id })));
      if (oData) setOrders(oData);
      if (cData) setCategories(cData);
      if (sData) setSubCategories(sData);
      if (rData) setRepairs(rData);

    } catch (error) {
      toast.error("Error cargando datos");
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => { await supabase.auth.signOut(); navigate("/login"); };

  // --- Actions ---
  const handleDeleteProduct = async (id) => { if(!window.confirm("¿Eliminar?")) return; await supabase.from('products').delete().eq('id', id); fetchData(); };
  
  const handleSaveProduct = async (e) => {
    e.preventDefault();
    const dbPayload = { name: currentProduct.name, price: currentProduct.price, stock: currentProduct.stock, image: currentProduct.image, category: currentProduct.category, sub_category_id: currentProduct.subCategoryId, oferta: currentProduct.oferta, oferta_type: currentProduct.ofertaType, oferta_value: currentProduct.ofertaValue };
    if (currentProduct.id) await supabase.from('products').update(dbPayload).eq('id', currentProduct.id);
    else await supabase.from('products').insert([dbPayload]);
    setIsEditing(false); setCurrentProduct(null); fetchData();
  };

  const handleImageUpload = async (event) => {
    try {
      setUploading(true);
      const file = event.target.files[0];
      if (!file) return;
      const fileExt = file.name.split('.').pop();
      const fileName = `${Date.now()}.${fileExt}`;
      const { error } = await supabase.storage.from('products').upload(fileName, file);
      if(error) throw error;
      const { data } = supabase.storage.from('products').getPublicUrl(fileName);
      setCurrentProduct({ ...currentProduct, image: data.publicUrl });
    } catch(e) { toast.error("Upload error"); } finally { setUploading(false); }
  };

  const handleAddCategory = async () => { if (!newCatName) return; await supabase.from('categories').insert([{ name: newCatName, icon: newCatIcon }]); setNewCatName(""); fetchData(); };
  const handleAddSubCategory = async (pid) => { if (!newSubName) return; await supabase.from('sub_categories').insert([{ parent_id: pid, name: newSubName }]); setNewSubName(""); setSelectedParentForSub(null); fetchData(); };
  const handleDeleteCategory = async (id, isSub) => { if(!window.confirm("¿Borrar?")) return; await supabase.from(isSub?'sub_categories':'categories').delete().eq('id', id); fetchData(); };
  
  const handleAddRepair = async () => { if (!newRepair.title) return; await supabase.from('repair_services').insert([newRepair]); setNewRepair({title:"", price:"", original_price:""}); fetchData(); };
  const handleDeleteRepair = async (id) => { if(!window.confirm("¿Borrar?")) return; await supabase.from('repair_services').delete().eq('id', id); fetchData(); };

  const updateOrderStatus = async (oid, st) => { await supabase.from('orders').update({ status: st }).eq('id', oid); fetchData(); };

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
      <div className="flex justify-between items-center bg-white p-4 rounded-xl shadow-sm">
        <input placeholder="Buscar..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} className="pl-4 pr-4 py-2 border rounded-lg w-64 text-sm outline-none focus:ring-2 ring-blue-100"/>
        <button onClick={() => { setCurrentProduct({ name: "", price: 0, stock: 10, category: "", subCategoryId: "", image: "", oferta: false }); setIsEditing(true); }} className="bg-blue-600 text-white px-4 py-2 rounded-lg flex items-center gap-2 font-bold hover:bg-blue-700"><Plus size={18}/> Nuevo</button>
      </div>
      <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
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
    </div>
  );

  const renderCategoryManager = () => (
    <div className="space-y-6">
      <div className="flex gap-2 mb-6 bg-white p-4 rounded-xl border border-gray-100 shadow-sm items-end">
        <div className="flex-1"><label className="text-xs font-bold text-gray-500 block mb-1">Nombre</label><input value={newCatName} onChange={e => setNewCatName(e.target.value)} className="border p-2 rounded-lg w-full"/></div>
        <div><label className="text-xs font-bold text-gray-500 block mb-1">Icono</label><select value={newCatIcon} onChange={e => setNewCatIcon(e.target.value)} className="border p-2 rounded-lg">{AVAILABLE_ICONS.map(i=><option key={i} value={i}>{i}</option>)}</select></div>
        <button onClick={handleAddCategory} className="bg-gray-900 text-white px-4 py-2.5 rounded-lg font-bold">Crear</button>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {categories.map(c => (
          <div key={c.id} className="bg-white border rounded-xl overflow-hidden shadow-sm">
            <div className="bg-gray-50 p-3 flex justify-between font-bold text-gray-800 border-b"><span>{c.icon} {c.name}</span><button onClick={() => handleDeleteCategory(c.id)} className="text-gray-400 hover:text-red-600"><Trash2 size={16}/></button></div>
            <div className="p-3">
               <ul className="space-y-2 mb-2">{subCategories.filter(s => s.parent_id === c.id).map(s => <li key={s.id} className="flex justify-between text-sm text-gray-600"><span>- {s.name}</span><button onClick={() => handleDeleteCategory(s.id, true)} className="text-gray-300 hover:text-red-600"><Trash2 size={14}/></button></li>)}</ul>
               {selectedParentForSub === c.id ? (
                 <div className="flex gap-1"><input autoFocus placeholder="Sub..." value={newSubName} onChange={e => setNewSubName(e.target.value)} className="border p-1 text-sm rounded w-full"/><button onClick={() => handleAddSubCategory(c.id)} className="bg-blue-600 text-white px-2 rounded text-xs">OK</button></div>
               ) : <button onClick={() => setSelectedParentForSub(c.id)} className="w-full py-1 text-xs text-blue-600 border border-dashed border-blue-200 rounded">+ Añadir Sub</button>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  const renderRepairs = () => (
    <div className="space-y-6">
      <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-100 flex gap-2 items-end flex-wrap">
        <div className="flex-1"><label className="text-xs font-bold text-gray-500 block mb-1">Título</label><input value={newRepair.title} onChange={e => setNewRepair({...newRepair, title: e.target.value})} className="w-full border p-2 rounded-lg"/></div>
        <div className="w-24"><label className="text-xs font-bold text-gray-500 block mb-1">Precio</label><input type="number" value={newRepair.price} onChange={e => setNewRepair({...newRepair, price: e.target.value})} className="w-full border p-2 rounded-lg"/></div>
        <div className="w-24"><label className="text-xs font-bold text-gray-500 block mb-1">Original</label><input type="number" value={newRepair.original_price} onChange={e => setNewRepair({...newRepair, original_price: e.target.value})} className="w-full border p-2 rounded-lg"/></div>
        <button onClick={handleAddRepair} className="bg-gray-900 text-white px-4 py-2.5 rounded-lg font-bold">Añadir</button>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {repairs.map(r => (
          <div key={r.id} className="bg-white p-4 rounded-xl shadow-sm flex justify-between items-center">
             <div><h3 className="font-bold text-gray-800">{r.title}</h3><span className="text-red-600 font-bold">€{r.price}</span></div>
             <button onClick={() => handleDeleteRepair(r.id)} className="text-red-600"><Trash2/></button>
          </div>
        ))}
      </div>
    </div>
  );

  const renderOrders = () => (
     <div className="space-y-4">
        <h2 className="text-2xl font-bold text-gray-800">Pedidos ({orders.length})</h2>
        <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
          <table className="w-full text-left text-sm">
             <thead className="bg-gray-50 font-bold text-gray-500"><tr><th className="p-4">Info</th><th className="p-4">Items</th><th className="p-4">Total</th><th className="p-4">Estado</th></tr></thead>
             <tbody>
               {orders.map(o => (
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
                      <select value={o.status} onChange={(e) => updateOrderStatus(o.id, e.target.value)} className={`border rounded px-2 py-1 text-xs font-bold cursor-pointer ${o.status === 'Entregado' ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'}`}>
                        <option>Procesando</option><option>Enviado</option><option>Entregado</option><option>Cancelado</option>
                      </select>
                   </td>
                 </tr>
               ))}
             </tbody>
          </table>
        </div>
     </div>
  );

  // ... Product Modal ... (保持原样，为了简洁我这里没改动)
  const renderProductModal = () => {
    const filteredSubs = subCategories.filter(s => s.parent_id === parseInt(currentProduct.category));
    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 backdrop-blur-sm animate-fade-in">
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto">
          <div className="flex justify-between items-center mb-6">
            <h3 className="text-xl font-bold text-gray-800">{currentProduct.id ? 'Editar' : 'Nuevo'} Producto</h3>
            <button onClick={() => setIsEditing(false)} className="p-2 hover:bg-gray-100 rounded-full"><X className="text-gray-500" size={20}/></button>
          </div>
          <form onSubmit={handleSaveProduct} className="space-y-4">
            <div><label className="text-xs font-bold text-gray-500 mb-1 block">Nombre</label><input required value={currentProduct.name} onChange={e => setCurrentProduct({...currentProduct, name: e.target.value})} className="w-full border p-2 rounded-lg"/></div>
            <div className="grid grid-cols-2 gap-4">
              <div><label className="text-xs font-bold text-gray-500 mb-1 block">Precio</label><input required type="number" step="0.01" value={currentProduct.price} onChange={e => setCurrentProduct({...currentProduct, price: parseFloat(e.target.value)})} className="w-full border p-2 rounded-lg"/></div>
              <div><label className="text-xs font-bold text-gray-500 mb-1 block">Stock</label><input required type="number" value={currentProduct.stock} onChange={e => setCurrentProduct({...currentProduct, stock: parseInt(e.target.value)})} className="w-full border p-2 rounded-lg"/></div>
            </div>
            <div>
              <label className="text-xs font-bold text-gray-500 mb-1 block">Imagen</label>
              <div className="border-2 border-dashed border-gray-300 rounded-xl p-4 text-center hover:bg-gray-50 cursor-pointer relative">
                 {uploading ? "Subiendo..." : (currentProduct.image ? <img src={currentProduct.image} className="h-20 mx-auto object-contain"/> : "Click para subir")}
                 <input type="file" accept="image/*" onChange={handleImageUpload} className="absolute inset-0 opacity-0"/>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
                <select required value={currentProduct.category} onChange={e => setCurrentProduct({...currentProduct, category: parseInt(e.target.value)})} className="w-full border p-2 rounded-lg"><option value="">Categoría</option>{categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
                <select value={currentProduct.subCategoryId || ""} onChange={e => setCurrentProduct({...currentProduct, subCategoryId: parseInt(e.target.value)})} className="w-full border p-2 rounded-lg" disabled={!currentProduct.category}><option value="">Subcategoría</option>{filteredSubs.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
            </div>
            <button type="submit" disabled={uploading} className="w-full bg-blue-600 text-white py-3 rounded-xl font-bold">Guardar</button>
          </form>
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-gray-100 flex font-sans text-gray-800">
      <Toaster position="top-right" />
      <aside className="w-20 md:w-64 bg-gray-900 text-white flex-shrink-0 flex flex-col py-6 space-y-2 shadow-xl z-20">
        <div className="md:px-6 mb-8 font-bold text-xl text-center md:text-left flex items-center justify-center md:justify-start gap-2">
            <div className="w-8 h-8 bg-red-600 rounded-lg flex items-center justify-center font-extrabold">H</div><span className="hidden md:inline">HIPERA</span>
        </div>
        <nav className="flex-1 space-y-1 px-2">
            <button onClick={() => setActiveTab("dashboard")} className={`w-full p-3 md:px-4 flex items-center gap-3 rounded-xl ${activeTab==='dashboard'?'bg-red-600':'hover:bg-gray-800'}`}><LayoutDashboard size={20}/><span className="hidden md:inline">Dashboard</span></button>
            <button onClick={() => setActiveTab("products")} className={`w-full p-3 md:px-4 flex items-center gap-3 rounded-xl ${activeTab==='products'?'bg-red-600':'hover:bg-gray-800'}`}><Package size={20}/><span className="hidden md:inline">Productos</span></button>
            <button onClick={() => setActiveTab("categories")} className={`w-full p-3 md:px-4 flex items-center gap-3 rounded-xl ${activeTab==='categories'?'bg-red-600':'hover:bg-gray-800'}`}><List size={20}/><span className="hidden md:inline">Categorías</span></button>
            <button onClick={() => setActiveTab("repairs")} className={`w-full p-3 md:px-4 flex items-center gap-3 rounded-xl ${activeTab==='repairs'?'bg-red-600':'hover:bg-gray-800'}`}><Wrench size={20}/><span className="hidden md:inline">Reparaciones</span></button>
            <button onClick={() => setActiveTab("orders")} className={`w-full p-3 md:px-4 flex items-center gap-3 rounded-xl ${activeTab==='orders'?'bg-red-600':'hover:bg-gray-800'}`}><ShoppingBag size={20}/><span className="hidden md:inline">Pedidos</span></button>
        </nav>
        <div className="px-4 pt-4 border-t border-gray-800"><button onClick={handleLogout} className="w-full p-3 flex items-center gap-3 text-gray-400 hover:text-white rounded-xl"><LogOut size={20}/><span className="hidden md:inline">Salir</span></button></div>
      </aside>
      <main className="flex-1 p-4 md:p-8 overflow-y-auto h-screen">
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