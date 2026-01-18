import { supabase } from './supabaseClient';
import React, { useEffect, useState } from "react";
import { 
  ShoppingCart, Search, Package, MapPin, Clock, ArrowLeft, ArrowRight,
  Tag, Trash2, ChevronRight, Home, Gift, Truck, Heart,
  Utensils, Coffee, Apple, Baby, Loader2, Wrench, Smartphone,
  LayoutGrid, Percent, ClipboardList, User, LogOut, Plus, Minus, X
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import toast, { Toaster } from 'react-hot-toast';

const BANNERS = [
  "https://images.unsplash.com/photo-1607082349566-187342175e2f?w=1200",
  "https://images.unsplash.com/photo-1542838132-92c53300491e?w=1200",
  "https://images.unsplash.com/photo-1586201375754-12a5b2fda9b4?w=1200"
];

// 骨架屏组件
const ProductSkeleton = () => (
  <div className="bg-white p-3 rounded-xl shadow-sm border border-gray-100 animate-pulse">
    <div className="w-full aspect-square bg-gray-200 rounded-lg mb-2"></div>
    <div className="h-4 bg-gray-200 rounded w-3/4 mb-2"></div>
    <div className="h-6 bg-gray-200 rounded w-1/2"></div>
  </div>
);

// 图标映射
const IconByName = ({ name, size=24, className }) => {
  const icons = {
    Apple: <Apple size={size} className={className}/>,
    Coffee: <Coffee size={size} className={className}/>,
    Utensils: <Utensils size={size} className={className}/>,
    Package: <Package size={size} className={className}/>,
    Baby: <Baby size={size} className={className}/>,
  };
  return icons[name] || <Package size={size} className={className}/>;
};

export default function App() {
  // --- 核心数据 ---
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [subCategories, setSubCategories] = useState([]);
  const [repairs, setRepairs] = useState([]); 
  
  const [cart, setCart] = useState(() => {
    const saved = localStorage.getItem('cart');
    return saved ? JSON.parse(saved) : [];
  });
  const [favorites, setFavorites] = useState(() => {
    const saved = localStorage.getItem('favorites');
    return saved ? JSON.parse(saved) : [];
  });

  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  
  // --- 导航状态 ---
  const [page, setPage] = useState("home"); 
  const [history, setHistory] = useState(["home"]); 
  const [mainCat, setMainCat] = useState(null); 
  const [subCat, setSubCat] = useState(null);   
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [bannerIndex, setBannerIndex] = useState(0);

  // --- 订单相关 ---
  const [myOrders, setMyOrders] = useState([]);
  const [checkoutForm, setCheckoutForm] = useState({ address: "", phone: "", note: "" });
  const [isSubmitting, setIsSubmitting] = useState(false); 

  const navigate = useNavigate(); 

  // --- 初始化逻辑 ---
  useEffect(() => {
    const savedAddress = JSON.parse(localStorage.getItem('lastAddress') || '{}');
    if (savedAddress.address) setCheckoutForm(prev => ({...prev, ...savedAddress}));

    supabase.auth.getSession().then(({ data: { session } }) => setUser(session?.user ?? null));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => setUser(session?.user ?? null));

    fetchData();
    return () => subscription.unsubscribe();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [pRes, cRes, sRes, rRes] = await Promise.all([
        supabase.from('products').select('*').order('id', { ascending: true }),
        supabase.from('categories').select('*').order('id', { ascending: true }),
        supabase.from('sub_categories').select('*').order('id', { ascending: true }),
        supabase.from('repair_services').select('*').order('id', { ascending: true }) 
      ]);

      if (pRes.data) {
        setProducts(pRes.data.map(p => ({
          ...p,
          ofertaType: p.oferta_type, 
          ofertaValue: p.oferta_value,
          subCategoryId: p.sub_category_id
        })));
      }
      if (cRes.data) setCategories(cRes.data);
      if (sRes.data) setSubCategories(sRes.data);
      if (rRes.data) setRepairs(rRes.data);

    } catch (error) {
      console.error("Data load warning:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { localStorage.setItem('cart', JSON.stringify(cart)); }, [cart]);
  useEffect(() => { localStorage.setItem('favorites', JSON.stringify(favorites)); }, [favorites]);
  useEffect(() => {
    const timer = setInterval(() => setBannerIndex(i => (i + 1) % BANNERS.length), 4000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (page === "orders" && user) {
      const fetchOrders = async () => {
        const { data } = await supabase.from('orders').select('*').eq('user_id', user.id).order('created_at', { ascending: false });
        if (data) setMyOrders(data);
      };
      fetchOrders();
    }
  }, [page, user]);

  // --- 导航函数 ---
  const navTo = (newPage) => {
    setHistory([...history, newPage]);
    setPage(newPage);
    window.scrollTo(0,0);
  };

  const goBack = () => {
    if (history.length <= 1) return;
    const newHistory = [...history];
    newHistory.pop();
    setHistory(newHistory);
    setPage(newHistory[newHistory.length - 1]);
  };

  // --- 购物车 & 收藏逻辑 ---
  const addToCart = (item) => {
    const isService = !item.stock && item.title; 

    if (!isService && item.stock <= 0) {
      toast.error("Producto agotado");
      return;
    }

    const newItem = {
        ...item,
        name: item.name || item.title, 
        id: item.id, 
        isService: isService
    };

    const ex = cart.find(i => i.id === newItem.id && i.name === newItem.name);
    
    if (ex) {
      if (!isService && ex.quantity >= item.stock) {
        toast.error("Max stock alcanzado");
        return;
      }
      setCart(cart.map(i => (i.id === newItem.id && i.name === newItem.name) ? { ...i, quantity: i.quantity + 1 } : i));
    } else {
      setCart([...cart, { ...newItem, quantity: 1 }]);
    }
    toast.success("Añadido a la cesta");
  };

  const toggleFavorite = (e, productId) => {
    e.stopPropagation();
    if (favorites.includes(productId)) {
      setFavorites(favorites.filter(id => id !== productId));
      toast("Eliminado", { icon: '💔' });
    } else {
      setFavorites([...favorites, productId]);
      toast("Guardado", { icon: '❤️' });
    }
  };

  const removeFromCart = (id, name) => setCart(cart.filter(i => !(i.id === id && i.name === name)));
  
  const updateQty = (id, name, delta) => {
    setCart(cart.map(i => {
      if (i.id === id && i.name === name) {
        const newQty = Math.max(1, i.quantity + delta);
        if (!i.isService && newQty > i.stock) {
           toast.error("No hay más stock");
           return i;
        }
        return { ...i, quantity: newQty };
      }
      return i;
    }));
  };

  // 价格计算
  const subtotal = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
  const shippingFee = subtotal >= 50 ? 0 : 4.50; 
  const total = subtotal + shippingFee;
  const minOrderMet = subtotal >= 20;
  const isFreeShipping = subtotal >= 50; // 判断是否免邮

  // 下单逻辑
  const handlePlaceOrder = async () => {
    if (!checkoutForm.address || !checkoutForm.phone) {
      toast.error("Faltan datos de envío");
      return;
    }
    setIsSubmitting(true);
    const toastId = toast.loading("Enviando pedido...");

    try {
      localStorage.setItem('lastAddress', JSON.stringify({ address: checkoutForm.address, phone: checkoutForm.phone }));

      for (const item of cart) {
        if (item.isService) continue; 

        const { data: productNow } = await supabase.from('products').select('stock').eq('id', item.id).single();
        if (productNow && productNow.stock < item.quantity) {
          throw new Error(`Sin stock suficiente: ${item.name}`);
        }
        if (productNow) {
            await supabase.from('products').update({ stock: productNow.stock - item.quantity }).eq('id', item.id);
        }
      }

      const { error } = await supabase.from('orders').insert([{
        user_id: user?.id || null, 
        address: checkoutForm.address,
        phone: checkoutForm.phone,
        note: checkoutForm.note,
        total: total,
        status: "Procesando",
        items: cart, 
        created_at: new Date().toISOString()
      }]);

      if (error) throw error;

      toast.success("¡Pedido Recibido!", { id: toastId });
      setCart([]);
      setCheckoutForm(prev => ({ ...prev, note: "" }));
      
      const { data: pData } = await supabase.from('products').select('*');
      if(pData) setProducts(pData.map(p => ({...p, ofertaType: p.oferta_type, ofertaValue: p.oferta_value, subCategoryId: p.sub_category_id})));
      
      navTo("home"); 
    } catch (e) {
      toast.error(e.message, { id: toastId });
    } finally {
      setIsSubmitting(false);
    }
  };

  // --- 渲染辅助 ---
  const renderProductCard = (p) => (
    <div key={p.id} className="bg-white p-3 rounded-2xl shadow-sm border border-gray-100 active:scale-95 transition-transform relative group" onClick={() => {setSelectedProduct(p); navTo("detail");}}>
      <button onClick={(e) => toggleFavorite(e, p.id)} className="absolute top-2 right-2 z-20 bg-white/80 p-1.5 rounded-full shadow-sm backdrop-blur-sm text-gray-400 hover:text-red-500 transition-colors">
        <Heart size={16} fill={favorites.includes(p.id) ? "currentColor" : "none"} className={favorites.includes(p.id) ? "text-red-500" : ""}/>
      </button>
      <div className="relative mb-2">
        {renderDiscountTag(p)}
        <img src={p.image} className="w-full aspect-square rounded-xl object-cover bg-gray-50" />
      </div>
      <p className="font-medium text-gray-800 text-sm line-clamp-1 mb-1">{p.name}</p>
      <div className="flex justify-between items-end">
        <div>
          <p className="font-extrabold text-red-600 text-lg leading-none">€{p.price.toFixed(2)}</p>
          {p.oferta && <p className="text-[10px] text-gray-400 line-through mt-0.5">€{(p.price * 1.2).toFixed(2)}</p>}
        </div>
        <button onClick={(e) => {e.stopPropagation(); addToCart(p);}} className="bg-gray-900 text-white w-8 h-8 rounded-full flex items-center justify-center shadow-lg active:bg-red-600 transition-colors">
          <Plus size={16}/>
        </button>
      </div>
    </div>
  );

  const renderDiscountTag = (p) => {
    if (!p.ofertaType) return null;
    let text = "";
    if (p.ofertaType === "percent") text = `-${p.ofertaValue}%`;
    if (p.ofertaType === "second") text = "2ª -50%";
    if (p.ofertaType === "gift") text = "2x1";
    return <span className="absolute top-2 left-2 bg-red-600 text-white text-[10px] px-2 py-1 rounded-full font-bold shadow-sm z-10">{text}</span>;
  };

  const filteredProducts = products.filter(p => {
    if (page === "favorites") return favorites.includes(p.id);
    const mainMatch = mainCat ? p.category === mainCat.id : true;
    const subMatch = subCat ? p.subCategoryId === subCat.id : true;
    const searchMatch = p.name?.toLowerCase().includes(searchQuery.toLowerCase());
    return mainMatch && subMatch && searchMatch;
  });

  return (
    <div className="min-h-screen bg-gray-50 pb-20 font-sans selection:bg-red-100">
      <Toaster position="top-center" toastOptions={{style:{borderRadius:'12px', background:'#333', color:'#fff'}}}/>

      {/* HEADER */}
      <header className="bg-white/80 backdrop-blur-md shadow-sm sticky top-0 z-40 transition-all">
        <div className="px-4 py-3">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-3" onClick={() => navTo("home")}>
              <div className="w-10 h-10 bg-red-600 rounded-xl flex items-center justify-center text-white font-extrabold shadow-lg shadow-red-200">H</div>
              <div>
                <h1 className="font-bold text-lg leading-none text-gray-900">HIPERA</h1>
                <p className="text-[10px] text-gray-500 tracking-wider font-medium">MERCADO ONLINE</p>
              </div>
            </div>
            
            <div className="flex items-center gap-4">
               {user ? (
                 <div className="flex items-center gap-2 cursor-pointer" onClick={() => navTo("orders")}>
                    <div className="w-9 h-9 bg-gray-900 text-white rounded-full flex items-center justify-center text-sm font-bold border-2 border-transparent hover:border-red-500 transition-colors">{user.email[0].toUpperCase()}</div>
                 </div>
               ) : (
                 <button onClick={() => navigate("/login")} className="text-xs font-bold text-gray-600 bg-gray-100 px-3 py-1.5 rounded-lg hover:bg-gray-200 transition-colors">Entrar</button>
               )}

               <div className="relative p-1 cursor-pointer transition-transform active:scale-90" onClick={() => navTo("cart")}>
                 <ShoppingCart className="text-gray-700" size={24} />
                 {cart.length > 0 && <span className="absolute -top-1 -right-1 bg-red-600 text-white text-[10px] w-5 h-5 rounded-full flex items-center justify-center border-2 border-white animate-bounce">{cart.length}</span>}
               </div>
            </div>
          </div>

          {page !== 'checkout' && page !== 'repair' && (
            <div className="relative group">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 group-focus-within:text-red-500 transition-colors" size={16} />
              <input 
                placeholder="Buscar productos..." 
                value={searchQuery} 
                onChange={e => {setSearchQuery(e.target.value); if(e.target.value && page==='home') navTo("products");}} 
                className="w-full pl-10 pr-4 py-2.5 bg-gray-100 border-none rounded-xl text-sm focus:bg-white focus:ring-2 focus:ring-red-100 outline-none transition-all shadow-inner" 
              />
            </div>
          )}
        </div>
      </header>

      {/* --- HOME PAGE --- */}
      {page === "home" && (
        <div className="p-4 space-y-6 animate-fade-in">
          {/* Shortcuts */}
          <div className="grid grid-cols-4 gap-2">
            <button onClick={() => navTo("main")} className="bg-white p-2 rounded-xl shadow-sm flex flex-col items-center justify-center gap-1 active:scale-95 transition-transform aspect-square">
              <div className="p-2 bg-blue-50 text-blue-600 rounded-full"><LayoutGrid size={18} /></div>
              <span className="text-[10px] font-bold text-gray-700">Todo</span>
            </button>
            <button onClick={() => navTo("offers")} className="bg-white p-2 rounded-xl shadow-sm flex flex-col items-center justify-center gap-1 active:scale-95 transition-transform aspect-square">
              <div className="p-2 bg-red-50 text-red-600 rounded-full"><Percent size={18} /></div>
              <span className="text-[10px] font-bold text-gray-700">Ofertas</span>
            </button>
            <button onClick={() => navTo("favorites")} className="bg-white p-2 rounded-xl shadow-sm flex flex-col items-center justify-center gap-1 active:scale-95 transition-transform aspect-square">
              <div className="p-2 bg-pink-50 text-pink-600 rounded-full"><Heart size={18} /></div>
              <span className="text-[10px] font-bold text-gray-700">Favs</span>
            </button>
            <button onClick={() => navTo("orders")} className="bg-white p-2 rounded-xl shadow-sm flex flex-col items-center justify-center gap-1 active:scale-95 transition-transform aspect-square">
              <div className="p-2 bg-green-50 text-green-600 rounded-full"><ClipboardList size={18} /></div>
              <span className="text-[10px] font-bold text-gray-700">Pedidos</span>
            </button>
          </div>

          {/* Banner */}
          <div className="relative rounded-2xl overflow-hidden shadow-lg aspect-[2.2/1]">
            <img src={BANNERS[bannerIndex]} className="w-full h-full object-cover transition-all duration-700 hover:scale-105" />
            <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent flex items-end p-5">
              <div>
                 <span className="bg-red-600 text-white text-[10px] px-2 py-1 rounded font-bold mb-1 inline-block">NUEVO</span>
                 <p className="text-white font-bold text-xl leading-tight">Frescura<br/>Garantizada</p>
              </div>
            </div>
          </div>

          {/* 互动式维修广告 */}
          <div className="grid grid-cols-1 gap-4">
             <div 
               onClick={() => navTo("repair")}
               className="bg-gray-900 text-white p-5 rounded-2xl shadow-lg relative overflow-hidden group cursor-pointer active:scale-95 transition-transform"
             >
                <div className="absolute right-0 top-0 bottom-0 w-1/3 bg-gradient-to-l from-red-600 to-transparent opacity-50 group-hover:opacity-80 transition-opacity"></div>
                <div className="relative z-10 flex justify-between items-center">
                   <div>
                      <div className="flex items-center gap-2 mb-2">
                         <Wrench className="text-red-500 animate-pulse" size={20}/>
                         <span className="font-bold text-[10px] bg-red-600 px-2 py-0.5 rounded text-white tracking-wider">SERVICIO OFICIAL</span>
                      </div>
                      <h3 className="text-xl font-bold mb-1">Reparación Móvil</h3>
                      <p className="text-gray-400 text-xs">Cambio de pantalla, batería...<br/>Reserva con precio cerrado.</p>
                   </div>
                   <Smartphone size={56} className="text-gray-600 group-hover:text-white transition-colors transform group-hover:rotate-12"/>
                </div>
             </div>
          </div>

          {/* Categories */}
          <div>
             <h4 className="text-sm font-bold text-gray-400 uppercase tracking-wide mb-3">Categorías</h4>
             <div className="flex gap-3 overflow-x-auto pb-4 -mx-4 px-4 scrollbar-hide">
               {categories.map(c => (
                 <button key={c.id} onClick={() => {setMainCat(c); navTo("sub");}} className="min-w-[72px] flex flex-col items-center gap-2 group">
                    <div className="w-16 h-16 bg-white p-3 rounded-2xl shadow-sm border border-gray-100 flex items-center justify-center text-red-600 group-active:scale-90 transition-transform">
                        <IconByName name={c.icon} size={28}/>
                    </div>
                    <span className="text-xs font-medium text-gray-600 truncate w-full text-center">{c.name}</span>
                 </button>
               ))}
             </div>
          </div>

          {/* Flash Offers */}
          <div>
            <h3 className="font-bold text-xl text-gray-800 mb-3">Ofertas Flash</h3>
            <div className="grid grid-cols-2 gap-3">
              {loading 
                ? [1,2].map(i => <ProductSkeleton key={i}/>) 
                : products.filter(p => p.oferta).slice(0, 4).map(p => renderProductCard(p))
              }
            </div>
          </div>
        </div>
      )}

      {/* --- REPAIR PAGE --- */}
      {page === "repair" && (
        <div className="min-h-screen bg-gray-900 text-white animate-fade-in pb-20">
           <div className="px-4 py-4 flex items-center gap-3 sticky top-0 bg-gray-900/95 backdrop-blur z-20 border-b border-gray-800">
              <button onClick={() => goBack()} className="w-10 h-10 bg-white/10 rounded-full flex items-center justify-center hover:bg-white/20 transition-colors"><ArrowLeft size={20}/></button>
              <h2 className="text-xl font-bold">Centro de Reparación</h2>
           </div>

           <div className="p-4 space-y-6">
              <div className="bg-gradient-to-br from-gray-800 to-gray-800 p-6 rounded-3xl border border-gray-700 text-center relative overflow-hidden">
                 <div className="absolute top-0 right-0 w-20 h-20 bg-red-600 blur-[50px] opacity-20"></div>
                 <Wrench size={40} className="mx-auto text-red-500 mb-4"/>
                 <h3 className="text-xl font-bold mb-2">Reserva tu reparación</h3>
                 <p className="text-gray-400 text-sm leading-relaxed">
                    Elige tu modelo y paga online para asegurar el <span className="text-white font-bold">precio de oferta</span>. Acércate a tienda y te lo arreglamos en 1 hora.
                 </p>
              </div>

              <div>
                 <h3 className="font-bold text-lg mb-4 flex items-center gap-2 text-red-500"><Tag size={18}/> Tarifas Online</h3>
                 <div className="grid grid-cols-1 gap-3">
                    {repairs.length === 0 ? (
                        <div className="text-center py-10 text-gray-500 bg-gray-800/50 rounded-2xl">
                           <p>No hay servicios disponibles.</p>
                           <p className="text-xs mt-2">Prueba a añadir servicios en el Admin.</p>
                        </div>
                    ) : repairs.map(item => (
                       <div key={item.id} className="bg-gray-800 p-4 rounded-2xl flex justify-between items-center shadow-lg border border-gray-700 group active:scale-95 transition-transform">
                          <div>
                             <h4 className="font-bold text-gray-100">{item.title}</h4>
                             <div className="flex items-center gap-2 mt-1">
                                <span className="text-xl font-extrabold text-red-500">€{item.price}</span>
                                {item.original_price && <span className="text-sm text-gray-500 line-through">€{item.original_price}</span>}
                             </div>
                          </div>
                          <button onClick={() => addToCart(item)} className="bg-white text-gray-900 px-4 py-2 rounded-xl font-bold text-sm shadow hover:bg-gray-200 transition-colors flex items-center gap-2">
                             Reservar
                          </button>
                       </div>
                    ))}
                 </div>
              </div>
           </div>
        </div>
      )}

      {/* --- FAVORITES / ORDERS --- */}
      {(page === "orders" || page === "favorites") && (
        <div className="p-4 min-h-screen bg-gray-50">
          <div className="flex items-center gap-2 mb-6 sticky top-0 bg-gray-50 z-10 py-2">
            <button onClick={() => goBack()} className="p-2 bg-white rounded-full shadow-sm text-gray-700"><ArrowLeft size={20}/></button>
            <h2 className="font-bold text-xl text-gray-800">{page === "orders" ? "Mis Pedidos" : "Mis Favoritos"}</h2>
          </div>

          {page === "favorites" ? (
             <div className="grid grid-cols-2 gap-3">
                {filteredProducts.length === 0 ? <div className="col-span-2 text-center py-20 text-gray-400">No tienes favoritos aún 💔</div> : filteredProducts.map(p => renderProductCard(p))}
             </div>
          ) : (
             !user ? (
               <div className="text-center py-20">
                 <div className="w-20 h-20 bg-gray-200 rounded-full mx-auto mb-4 flex items-center justify-center text-gray-400"><User size={32}/></div>
                 <p className="text-gray-500 mb-6">Inicia sesión para ver tu historial</p>
                 <button onClick={() => navigate("/login")} className="bg-gray-900 text-white px-8 py-3 rounded-xl font-bold shadow-lg">Login</button>
               </div>
            ) : (
              <div className="space-y-4">
                <div className="bg-white p-4 rounded-xl flex justify-between items-center mb-6 border border-gray-100 shadow-sm">
                   <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-red-100 text-red-600 rounded-full flex items-center justify-center font-bold">{user.email[0].toUpperCase()}</div>
                      <div className="flex flex-col">
                        <span className="text-xs text-gray-400 uppercase font-bold">Cuenta</span>
                        <span className="font-bold text-gray-800 text-sm">{user.email.split('@')[0]}</span>
                      </div>
                   </div>
                   <button onClick={() => {supabase.auth.signOut(); navTo("home"); toast("Sesión cerrada");}} className="text-red-600 bg-red-50 p-2 rounded-lg"><LogOut size={18}/></button>
                </div>
                {myOrders.length === 0 ? <p className="text-center text-gray-400 py-10">No tienes pedidos aún.</p> : myOrders.map(order => (
                  <div key={order.id} className="bg-white p-5 rounded-2xl shadow-sm border border-gray-100">
                    <div className="flex justify-between items-start mb-3">
                      <div>
                        <span className="font-bold text-gray-800 block text-xs font-mono bg-gray-100 px-2 py-1 rounded w-fit mb-1">#{order.id.slice(0,8)}</span>
                        <span className="text-xs text-gray-400">{new Date(order.created_at).toLocaleDateString()}</span>
                      </div>
                      <span className={`text-[10px] uppercase tracking-wider px-2 py-1 rounded-lg font-bold ${order.status==='Entregado'?'bg-green-100 text-green-700':'bg-blue-100 text-blue-700'}`}>{order.status}</span>
                    </div>
                    <div className="flex justify-between items-end border-t pt-3 border-gray-50">
                      <span className="text-sm text-gray-500">{order.items?.length || 0} productos</span>
                      <span className="font-extrabold text-lg text-gray-900">€{order.total?.toFixed(2)}</span>
                    </div>
                  </div>
                ))}
              </div>
            )
          )}
        </div>
      )}

      {/* --- CART PAGE --- */}
      {page === "cart" && (
        <div className="flex flex-col h-[calc(100vh-80px)]">
          <div className="p-4 bg-white shadow-sm flex items-center gap-2">
            <button onClick={() => goBack()} className="p-2 hover:bg-gray-100 rounded-full"><ArrowLeft className="text-gray-600"/></button>
            <h2 className="font-bold text-lg">Mi Cesta ({cart.reduce((a,b)=>a+b.quantity,0)})</h2>
            {cart.length > 0 && <button onClick={() => setCart([])} className="ml-auto text-xs text-red-500 font-bold bg-red-50 px-2 py-1 rounded">Vaciar</button>}
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {cart.length === 0 ? (
               <div className="flex flex-col items-center justify-center h-64 text-gray-400">
                 <ShoppingCart size={64} className="mb-4 text-gray-200"/>
                 <p className="font-medium">Tu cesta está vacía</p>
                 <button onClick={() => navTo("home")} className="mt-6 bg-red-600 text-white px-8 py-3 rounded-xl font-bold shadow-lg shadow-red-200">Empezar a comprar</button>
               </div>
            ) : (
              cart.map(item => (
                <div key={`${item.id}-${item.name}`} className="flex gap-3 bg-white p-3 rounded-2xl shadow-sm border border-gray-100">
                   {item.image ? (
                       <img src={item.image} className="w-20 h-20 object-cover rounded-xl bg-gray-50"/>
                   ) : (
                       <div className="w-20 h-20 bg-gray-100 rounded-xl flex items-center justify-center text-gray-400"><Wrench size={24}/></div>
                   )}
                   <div className="flex-1 flex flex-col justify-between py-1">
                      <div>
                        <p className="font-bold text-gray-800 line-clamp-1">{item.name}</p>
                        <p className="text-red-600 font-extrabold">€{item.price}</p>
                      </div>
                      <div className="flex items-center justify-between">
                         <div className="flex items-center gap-3 bg-gray-50 rounded-lg p-1">
                            <button onClick={() => updateQty(item.id, item.name, -1)} className="w-7 h-7 bg-white rounded shadow-sm flex items-center justify-center text-gray-600 active:scale-90 transition-transform"><Minus size={14}/></button>
                            <span className="text-sm font-bold w-4 text-center">{item.quantity}</span>
                            <button onClick={() => updateQty(item.id, item.name, 1)} className="w-7 h-7 bg-gray-900 text-white rounded shadow-sm flex items-center justify-center active:scale-90 transition-transform"><Plus size={14}/></button>
                         </div>
                         <button onClick={() => removeFromCart(item.id, item.name)} className="text-gray-300 hover:text-red-500 p-2"><Trash2 size={18}/></button>
                      </div>
                   </div>
                </div>
              ))
            )}
          </div>

          {cart.length > 0 && (
            <div className="bg-white p-5 shadow-[0_-4px_30px_rgba(0,0,0,0.05)] rounded-t-3xl z-20">
               {/* 💡 重新加回：免运费提示条 */}
               <div className="space-y-2 mb-6">
                  {!isFreeShipping && (
                    <div className="text-xs text-gray-600 bg-blue-50 p-2 rounded-lg flex items-center gap-2">
                      <div className="flex-1">
                         Faltan <span className="font-bold text-blue-600">€{(50 - subtotal).toFixed(2)}</span> para envío GRATIS
                         <div className="h-1.5 w-full bg-blue-100 rounded-full mt-1 overflow-hidden"><div className="h-full bg-blue-500 rounded-full transition-all duration-500" style={{width: `${(subtotal/50)*100}%`}}></div></div>
                      </div>
                      <Truck size={16} className="text-blue-400"/>
                    </div>
                  )}
                  {isFreeShipping && <div className="text-xs bg-green-50 text-green-700 p-2 rounded-lg font-bold flex items-center gap-2"><Truck size={14}/> ¡Envío GRATIS activado!</div>}
               </div>

               <div className="space-y-1 text-sm text-gray-500 mb-6">
                 <div className="flex justify-between"><span>Subtotal</span><span>€{subtotal.toFixed(2)}</span></div>
                 <div className="flex justify-between">
                    <span>Envío</span>
                    <span className={shippingFee === 0 ? "text-green-600 font-bold" : ""}>{shippingFee === 0 ? "GRATIS" : `€${shippingFee.toFixed(2)}`}</span>
                 </div>
                 <div className="flex justify-between font-extrabold text-xl text-gray-900 pt-3 border-t border-dashed"><span>Total</span><span>€{total.toFixed(2)}</span></div>
               </div>

               {minOrderMet ? (
                 <button onClick={() => navTo("checkout")} className="w-full bg-gray-900 text-white py-4 rounded-xl font-bold text-lg shadow-xl shadow-gray-300 flex items-center justify-center gap-2 active:scale-95 transition-transform">
                   Tramitar Pedido <ArrowRight size={20}/>
                 </button>
               ) : (
                 <button disabled className="w-full bg-gray-200 text-gray-400 py-4 rounded-xl font-bold cursor-not-allowed">Mínimo €20 (Faltan €{(20-subtotal).toFixed(2)})</button>
               )}
            </div>
          )}
        </div>
      )}

      {/* --- CHECKOUT --- */}
      {page === "checkout" && (
        <div className="p-4 bg-gray-50 min-h-screen animate-slide-up">
          <div className="flex items-center gap-2 mb-6">
            <button onClick={() => goBack()} className="p-2 bg-white rounded-full shadow-sm"><ArrowLeft size={20}/></button>
            <h2 className="font-bold text-xl">Finalizar Compra</h2>
          </div>
          <div className="space-y-6">
             <div className="bg-white p-5 rounded-2xl shadow-sm space-y-4 border border-gray-100">
                <h3 className="font-bold flex items-center gap-2 text-gray-800"><MapPin size={18} className="text-red-600"/> Datos de entrega</h3>
                <input value={checkoutForm.address} onChange={e => setCheckoutForm({...checkoutForm, address: e.target.value})} placeholder="Dirección completa *" className="w-full p-3.5 bg-gray-50 rounded-xl font-medium outline-none focus:ring-2 ring-red-100 transition-all"/>
                <input type="tel" value={checkoutForm.phone} onChange={e => setCheckoutForm({...checkoutForm, phone: e.target.value})} placeholder="Teléfono *" className="w-full p-3.5 bg-gray-50 rounded-xl font-medium outline-none focus:ring-2 ring-red-100 transition-all"/>
                <textarea value={checkoutForm.note} onChange={e => setCheckoutForm({...checkoutForm, note: e.target.value})} placeholder="Nota para repartidor (Opcional)" className="w-full p-3.5 bg-gray-50 rounded-xl font-medium outline-none focus:ring-2 ring-red-100 transition-all" rows={2}/>
             </div>
             <button disabled={!checkoutForm.address || !checkoutForm.phone || isSubmitting} onClick={handlePlaceOrder} className="w-full bg-red-600 text-white py-4 rounded-xl font-bold text-lg shadow-xl shadow-red-200 disabled:opacity-50 disabled:shadow-none active:scale-95 transition-transform flex justify-center items-center gap-2">
               {isSubmitting ? <><Loader2 className="animate-spin"/> Procesando...</> : "Confirmar Pedido"}
             </button>
          </div>
        </div>
      )}

      {/* --- PRODUCT LIST PAGES --- */}
      {(page === "offers" || page === "products" || page === "sub" || page === "main") && (
        <div className="p-4 min-h-screen">
          <div className="flex items-center gap-2 mb-4 sticky top-20 z-30 bg-gray-50/90 backdrop-blur-sm py-2">
            <button onClick={() => goBack()} className="w-8 h-8 bg-white rounded-full shadow-sm flex items-center justify-center text-gray-700 active:scale-90 transition-transform"><ArrowLeft size={18}/></button>
            <h2 className="font-bold text-lg text-gray-800">
              {page === "offers" && "Todas las Ofertas"}
              {page === "main" && "Categorías"}
              {page === "sub" && mainCat?.name}
              {page === "products" && subCat?.name}
            </h2>
          </div>
          
          {page === "main" ? (
             <div className="grid grid-cols-2 gap-3">
               {categories.map(c => (
                 <button key={c.id} className="bg-white p-4 rounded-xl shadow-sm text-left flex flex-col justify-between h-24 border-l-4 border-red-500 active:scale-95 transition-transform" onClick={() => {setMainCat(c); navTo("sub");}}>
                    <span className="font-bold text-lg text-gray-800">{c.name}</span>
                    <ChevronRight size={18} className="text-gray-300 self-end"/>
                 </button>
               ))}
             </div>
          ) : page === "sub" ? (
             <div className="grid grid-cols-1 gap-3">
               {subCategories.filter(s => s.parent_id === mainCat?.id).map(s => (
                 <button key={s.id} className="bg-white p-4 rounded-xl shadow-sm flex justify-between items-center active:scale-95 transition-transform" onClick={() => {setSubCat(s); navTo("products");}}>
                    <span className="font-medium text-gray-700">{s.name}</span>
                    <div className="bg-gray-50 p-1 rounded-full"><ChevronRight size={16} className="text-gray-400"/></div>
                 </button>
               ))}
             </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              {loading ? <div className="col-span-2 text-center py-20"><Loader2 className="animate-spin mx-auto mb-2 text-red-500"/>Cargando...</div> :
               products.filter(p => {
                  const mainMatch = mainCat ? p.category === mainCat.id : true;
                  const subMatch = subCat ? p.subCategoryId === subCat.id : true;
                  const searchMatch = p.name?.toLowerCase().includes(searchQuery.toLowerCase());
                  return mainMatch && subMatch && searchMatch && (page === "offers" ? p.oferta : true);
               }).map(p => renderProductCard(p))}
            </div>
          )}
        </div>
      )}

      {/* --- DETAIL PAGE --- */}
      {page === "detail" && selectedProduct && (
        <div className="bg-white min-h-screen pb-24">
          <div className="relative h-[45vh]">
             <img src={selectedProduct.image} className="w-full h-full object-cover" />
             <div className="absolute inset-0 bg-gradient-to-b from-black/30 to-transparent h-24"></div>
             <button onClick={() => goBack()} className="absolute top-4 left-4 w-10 h-10 bg-white/20 backdrop-blur-md rounded-full flex items-center justify-center text-white active:bg-white/40"><ArrowLeft size={24}/></button>
          </div>
          <div className="p-6 -mt-10 bg-white rounded-t-[2.5rem] relative z-10 min-h-[50vh] shadow-[0_-10px_40px_rgba(0,0,0,0.1)]">
             <div className="w-12 h-1.5 bg-gray-200 rounded-full mx-auto mb-8"></div>
             
             <div className="flex justify-between items-start mb-2">
               <h2 className="text-2xl font-extrabold text-gray-900 w-3/4 leading-tight">{selectedProduct.name}</h2>
               <div className="text-right">
                 <p className="text-3xl font-extrabold text-red-600">€{selectedProduct.price.toFixed(2)}</p>
               </div>
             </div>

             <div className="flex gap-2 mb-6">
                {selectedProduct.stock > 0 ? <span className="text-[10px] uppercase bg-green-100 text-green-700 px-2 py-1 rounded-lg font-bold">En Stock: {selectedProduct.stock}</span> : <span className="text-[10px] uppercase bg-red-100 text-red-700 px-2 py-1 rounded-lg font-bold">Agotado</span>}
                {selectedProduct.oferta && <span className="text-[10px] uppercase bg-red-100 text-red-600 px-2 py-1 rounded-lg font-bold">Oferta</span>}
             </div>
             
             <div className="bg-gray-50 p-5 rounded-2xl mb-6">
               <h4 className="font-bold text-gray-800 text-sm mb-2">Descripción</h4>
               <p className="text-gray-500 text-sm leading-relaxed">
                 Producto seleccionado por su calidad y frescura. Ideal para el consumo diario de toda la familia.
               </p>
             </div>
             
             {/* 相关推荐 */}
             <div className="mb-8">
               <h4 className="font-bold text-gray-800 text-sm mb-3">Quizás te interese</h4>
               <div className="flex gap-3 overflow-x-auto pb-4 scrollbar-hide">
                 {products.filter(p => p.category === selectedProduct.category && p.id !== selectedProduct.id).slice(0, 4).map(p => (
                     <div key={p.id} onClick={() => {setSelectedProduct(p); window.scrollTo(0,0);}} className="min-w-[140px] bg-gray-50 p-2 rounded-xl border border-gray-100 flex-shrink-0 cursor-pointer active:scale-95 transition-transform">
                        <img src={p.image} className="w-full aspect-square object-cover rounded-lg mb-2"/>
                        <p className="text-xs font-bold text-gray-700 truncate">{p.name}</p>
                        <p className="text-xs font-bold text-red-600">€{p.price}</p>
                     </div>
                 ))}
               </div>
             </div>
          </div>

          <div className="fixed bottom-0 left-0 right-0 p-4 bg-white border-t border-gray-100 z-20">
             <button onClick={() => {addToCart(selectedProduct); goBack();}} disabled={selectedProduct.stock <= 0} className="w-full bg-gray-900 text-white py-4 rounded-2xl font-bold text-lg shadow-xl shadow-gray-300 disabled:bg-gray-300 disabled:shadow-none active:scale-95 transition-transform flex justify-center items-center gap-2">
                {selectedProduct.stock > 0 ? <><Plus size={20}/> Añadir a la cesta</> : "Agotado"}
             </button>
          </div>
        </div>
      )}

      {/* --- FOOTER --- */}
      {page === "home" && (
        <footer className="bg-white mt-10 p-8 border-t border-gray-100 text-center">
          <div className="w-10 h-10 bg-gray-900 rounded-xl flex items-center justify-center text-white font-bold mx-auto mb-4">H</div>
          <h3 className="font-bold text-gray-900">HIPERA</h3>
          <p className="text-gray-400 text-sm mb-6">Tu mercado de confianza</p>
        </footer>
      )}
    </div>
  );
}