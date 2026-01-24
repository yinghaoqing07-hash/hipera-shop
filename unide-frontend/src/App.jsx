import QRCode from 'qrcode'; // <--- 新增这个
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { Download } from "lucide-react"; // 记得确保引入了 Download 图标
import { supabase } from './supabaseClient'; // 保留用于用户认证
import { apiClient } from './api/client'; // 新增：API客户端
import React, { useCallback, useEffect, useState } from "react";
import { 
  ShoppingCart, Search, Package, MapPin, Clock, ArrowLeft, ArrowRight,
  Tag, Trash2, ChevronRight, Home, Gift, Truck, Heart,
  Utensils, Coffee, Apple, Baby, Loader2, Wrench, Smartphone,
  LayoutGrid, Percent, ClipboardList, User, LogOut, Plus, Minus, X, CreditCard, Lock,
  Cookie, ShieldCheck, FileText, Info, Calendar, Users, Wallet, CheckCircle2, RotateCcw,
  // --- 新增的超市分类图标 ---
  Beef, Fish, Milk, Wheat, Croissant, Sandwich, Droplet, Candy, 
  Wine, Beer, Salad, Globe, Bone, BriefcaseMedical
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import toast, { Toaster } from 'react-hot-toast';

const BANNERS = [
  "https://images.unsplash.com/photo-1607082349566-187342175e2f?w=1200",
  "https://images.unsplash.com/photo-1542838132-92c53300491e?w=1200",
  "https://images.unsplash.com/photo-1586201375754-12a5b2fda9b4?w=1200"
];

const ProductSkeleton = () => (
  <div className="bg-white p-3 rounded-xl shadow-sm border border-gray-100 animate-pulse">
    <div className="w-full aspect-square bg-gray-200 rounded-lg mb-2"></div>
    <div className="h-4 bg-gray-200 rounded w-3/4 mb-2"></div>
    <div className="h-6 bg-gray-200 rounded w-1/2"></div>
  </div>
);

// --- 组件：图标映射 (已扩充全品类) ---
const IconByName = ({ name, size=24, className }) => {
  const icons = {
    // 现有图标
    Apple: <Apple size={size} className={className}/>,       // Frutas (水果)
    Coffee: <Coffee size={size} className={className}/>,     // Café (咖啡)
    Baby: <Baby size={size} className={className}/>,         // Infantil (婴儿)
    
    // 新增图标 (请在数据库对应填入 key)
    Meat: <Beef size={size} className={className}/>,         // Carne (肉)
    Fish: <Fish size={size} className={className}/>,         // Pescado (鱼)
    Dairy: <Milk size={size} className={className}/>,        // Lácteos (乳制品)
    Bakery: <Croissant size={size} className={className}/>,  // Panadería (面包)
    Cereals: <Wheat size={size} className={className}/>,     // Cereales (谷物)
    Prepared: <Sandwich size={size} className={className}/>, // Comida Prep (熟食)
    Oil: <Droplet size={size} className={className}/>,       // Aceites (油)
    Snacks: <Candy size={size} className={className}/>,      // Snacks (零食)
    Drinks: <Utensils size={size} className={className}/>,   // Bebidas (饮料 - 通用)
    Alcohol: <Wine size={size} className={className}/>,      // Alcohol (酒)
    Beer: <Beer size={size} className={className}/>,         // Cerveza (啤酒)
    Healthy: <Salad size={size} className={className}/>,     // Saludable (健康)
    International: <Globe size={size} className={className}/>, // Internacional (国际)
    Pets: <Bone size={size} className={className}/>,         // Mascotas (宠物)
    Pharmacy: <BriefcaseMedical size={size} className={className}/>, // Farmacia (药房)
    
    // 默认
    Package: <Package size={size} className={className}/>,

  };
  return icons[name] || <Package size={size} className={className}/>;
};

// --- 新增：支付方式选择弹窗组件 ---
const PaymentModal = ({ total, onClose, onConfirm, isProcessing, selectedPayment, setSelectedPayment }) => {
  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-fade-in">
      <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="bg-gray-50 p-4 border-b flex justify-between items-center">
           <div className="flex items-center gap-2">
             <div className="bg-blue-600 text-white p-1 rounded"><Wallet size={18}/></div>
             <span className="font-bold text-gray-800">Método de Pago</span>
           </div>
           <button onClick={onClose} disabled={isProcessing} className="text-gray-400 hover:text-gray-600"><X size={20}/></button>
        </div>
        
        {/* Body */}
        <div className="p-6 space-y-4">
           <div className="text-center mb-6">
              <p className="text-gray-500 text-sm">Total a pagar</p>
              <p className="text-4xl font-extrabold text-gray-900">€{total.toFixed(2)}</p>
           </div>

           {/* 支付方式选择 */}
           <div className="space-y-3">
              {/* 货到付款 */}
              <button
                onClick={() => setSelectedPayment('contra_reembolso')}
                className={`w-full p-4 rounded-xl border-2 transition-all text-left ${
                  selectedPayment === 'contra_reembolso'
                    ? 'border-blue-600 bg-blue-50'
                    : 'border-gray-200 hover:border-gray-300 bg-white'
                }`}
              >
                <div className="flex items-center gap-3">
                  <div className={`p-2 rounded-lg ${selectedPayment === 'contra_reembolso' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600'}`}>
                    <Wallet size={20}/>
                  </div>
                  <div className="flex-1">
                    <p className="font-bold text-gray-900">Pago Contra Reembolso</p>
                    <p className="text-xs text-gray-500 mt-0.5">Paga cuando recibas tu pedido</p>
                  </div>
                  {selectedPayment === 'contra_reembolso' && (
                    <CheckCircle2 size={20} className="text-blue-600"/>
                  )}
                </div>
              </button>

              {/* Bizum */}
              <button
                onClick={() => setSelectedPayment('bizum')}
                className={`w-full p-4 rounded-xl border-2 transition-all text-left ${
                  selectedPayment === 'bizum'
                    ? 'border-green-600 bg-green-50'
                    : 'border-gray-200 hover:border-gray-300 bg-white'
                }`}
              >
                <div className="flex items-center gap-3">
                  <div className={`p-2 rounded-lg ${selectedPayment === 'bizum' ? 'bg-green-600 text-white' : 'bg-gray-100 text-gray-600'}`}>
                    <Smartphone size={20}/>
                  </div>
                  <div className="flex-1">
                    <p className="font-bold text-gray-900">Bizum</p>
                    <p className="text-xs text-gray-500 mt-0.5">Pago instantáneo desde tu móvil</p>
                  </div>
                  {selectedPayment === 'bizum' && (
                    <CheckCircle2 size={20} className="text-green-600"/>
                  )}
                </div>
              </button>
           </div>
           
           {selectedPayment === 'bizum' && (
             <div className="bg-green-50 border border-green-200 rounded-xl p-3 text-xs text-green-700">
               <p className="font-bold mb-1">📱 Instrucciones Bizum:</p>
               <p>Envía el pago al número: <strong>640517893</strong></p>
               <p className="mt-1">Concepto: Pedido HIPERA</p>
             </div>
           )}

           {selectedPayment === 'contra_reembolso' && (
             <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 text-xs text-blue-700">
               <p className="font-bold mb-1">💵 Pago contra reembolso:</p>
               <p>Pagarás el importe total cuando recibas tu pedido en casa.</p>
             </div>
           )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t bg-gray-50">
           <button 
             onClick={onConfirm} 
             disabled={isProcessing || !selectedPayment}
             className="w-full bg-blue-600 hover:bg-blue-700 text-white py-4 rounded-xl font-bold text-lg shadow-lg shadow-blue-200 disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none transition-all flex items-center justify-center gap-2"
           >
             {isProcessing ? (
               <><Loader2 className="animate-spin"/> Procesando pedido...</>
             ) : selectedPayment === 'contra_reembolso' ? (
               <>Confirmar Pedido €{total.toFixed(2)}</>
             ) : (
               <>Confirmar con Bizum €{total.toFixed(2)}</>
             )}
           </button>
        </div>
      </div>
    </div>
  );
};

// --- 新增组件：Cookie 弹窗 (GDPR 合规) ---
const CookieConsent = () => {
  const [accepted, setAccepted] = useState(() => localStorage.getItem('cookieConsent'));

  if (accepted) return null;

  return (
    <div className="fixed bottom-0 left-0 right-0 bg-gray-900/95 backdrop-blur text-white p-4 z-50 animate-slide-up border-t border-gray-700 shadow-2xl">
      <div className="max-w-4xl mx-auto flex flex-col md:flex-row items-center gap-4 text-sm">
        <div className="flex items-start gap-3">
           <Cookie className="text-yellow-500 flex-shrink-0" size={24}/>
           <p className="text-gray-300">
             Usamos cookies propias y de terceros para mejorar tu experiencia y gestionar tus pedidos. 
             Si continúas navegando, aceptas su uso.
           </p>
        </div>
        <div className="flex gap-2 w-full md:w-auto">
           <button onClick={() => {localStorage.setItem('cookieConsent', 'true'); setAccepted(true);}} className="flex-1 md:flex-none bg-white text-gray-900 px-6 py-2 rounded-lg font-bold hover:bg-gray-200 transition-colors">Aceptar</button>
           <button onClick={() => {localStorage.setItem('cookieConsent', 'false'); setAccepted(true);}} className="flex-1 md:flex-none border border-gray-600 text-gray-400 px-6 py-2 rounded-lg font-medium hover:text-white hover:border-gray-400 transition-colors">Rechazar</button>
        </div>
      </div>
    </div>
  );
};

// --- 新增组件：法律条款页面内容 ---
// --- 组件：法律页面 (已更新真实地址) ---
const LegalPage = ({ type, onBack }) => {
  const content = {
    aviso: { 
      title: "Aviso Legal", 
      icon: <Info/>, 
      // 👇 更新了这里的地址
      text: "Este sitio web es propiedad de QIANG GUO SL © con NIF B86126638 y domicilio fiscal en Paseo del Sol 1, 28880 Meco (Madrid). Inscrita en el Registro Mercantil de Madrid. Para cualquier consulta, contáctenos en el local o al teléfono +34 918 782 602." 
    },
    privacidad: { 
      title: "Política de Privacidad", 
      icon: <ShieldCheck/>, 
      text: "En HIPERA respetamos su privacidad. Los datos personales recogidos (nombre, dirección, teléfono) se utilizan exclusivamente para la gestión de pedidos, envíos y garantías de reparación. Cumplimos con el Reglamento General de Protección de Datos (RGPD). Usted tiene derecho a acceder, rectificar o suprimir sus datos solicitándolo en tienda." 
    },
    cookies: { 
      title: "Política de Cookies", 
      icon: <Cookie/>, 
      text: "Utilizamos cookies técnicas imprescindibles para el funcionamiento de la cesta de la compra y el inicio de sesión. No utilizamos cookies publicitarias de terceros ni vendemos sus datos de navegación." 
    },
    devoluciones: {
      title: "Política de Devoluciones y Reembolsos",
      icon: <RotateCcw/>,
      text: null // 使用自定义内容
    }
  };
  const data = content[type] || content.aviso;

  // 退货政策特殊内容
  const renderDevolucionesContent = () => (
    <div className="space-y-6">
      {/* 14天退货权 */}
      <div className="bg-blue-50 border-l-4 border-blue-600 p-5 rounded-r-xl">
        <h3 className="font-bold text-blue-900 text-lg mb-3 flex items-center gap-2">
          <Calendar size={20}/> Derecho de Desistimiento - 14 Días
        </h3>
        <p className="text-blue-800 text-sm leading-relaxed mb-3">
          De acuerdo con la <strong>Directiva Europea 2011/83/EU</strong> y la legislación española de consumo, 
          usted tiene derecho a desistir del contrato de compra en un plazo de <strong>14 días naturales</strong> 
          desde la recepción del producto, sin necesidad de indicar el motivo.
        </p>
        <div className="bg-white p-4 rounded-lg mt-3">
          <p className="text-xs text-blue-700 font-bold mb-2">📅 Plazo de desistimiento:</p>
          <p className="text-sm text-blue-800">14 días naturales contados desde la fecha de recepción del pedido.</p>
        </div>
      </div>

      {/* 退货条件 */}
      <div className="bg-gray-50 p-5 rounded-xl border border-gray-200">
        <h3 className="font-bold text-gray-900 text-lg mb-4">Condiciones para la Devolución</h3>
        <ul className="space-y-3 text-sm text-gray-700">
          <li className="flex items-start gap-3">
            <CheckCircle2 size={18} className="text-green-600 flex-shrink-0 mt-0.5"/>
            <span>El producto debe estar <strong>sin usar</strong> y en su estado original.</span>
          </li>
          <li className="flex items-start gap-3">
            <CheckCircle2 size={18} className="text-green-600 flex-shrink-0 mt-0.5"/>
            <span>Debe conservar el <strong>embalaje original</strong> y todas las etiquetas.</span>
          </li>
          <li className="flex items-start gap-3">
            <CheckCircle2 size={18} className="text-green-600 flex-shrink-0 mt-0.5"/>
            <span>Debe incluir todos los <strong>accesorios y documentación</strong> que venían con el producto.</span>
          </li>
          <li className="flex items-start gap-3">
            <CheckCircle2 size={18} className="text-green-600 flex-shrink-0 mt-0.5"/>
            <span>Los productos perecederos o personalizados <strong>no son elegibles</strong> para devolución.</span>
          </li>
        </ul>
      </div>

      {/* 退货流程 */}
      <div className="bg-gray-50 p-5 rounded-xl border border-gray-200">
        <h3 className="font-bold text-gray-900 text-lg mb-4">Proceso de Devolución</h3>
        <ol className="space-y-3 text-sm text-gray-700 list-decimal list-inside">
          <li className="pl-2">
            <strong>Contacte con nosotros:</strong> Llame al <strong>+34 918 782 602</strong> o visite nuestra tienda física 
            en Paseo del Sol 1, 28880 Meco (Madrid) dentro del plazo de 14 días.
          </li>
          <li className="pl-2">
            <strong>Prepare el paquete:</strong> Empaque el producto en su embalaje original con todos los accesorios.
          </li>
          <li className="pl-2">
            <strong>Devolución:</strong> Puede traer el producto a nuestra tienda o acordaremos la recogida (según disponibilidad).
          </li>
          <li className="pl-2">
            <strong>Inspección:</strong> Revisaremos el producto para verificar que cumple las condiciones de devolución.
          </li>
          <li className="pl-2">
            <strong>Reembolso:</strong> Una vez aprobada la devolución, procesaremos el reembolso en un plazo máximo de 14 días.
          </li>
        </ol>
      </div>

      {/* 退款信息 */}
      <div className="bg-green-50 border-l-4 border-green-600 p-5 rounded-r-xl">
        <h3 className="font-bold text-green-900 text-lg mb-3">Reembolso</h3>
        <div className="space-y-2 text-sm text-green-800">
          <p><strong>Método de reembolso:</strong> El reembolso se realizará mediante el mismo método de pago utilizado en la compra original.</p>
          <p><strong>Plazo:</strong> Máximo 14 días hábiles desde la aprobación de la devolución.</p>
          <p><strong>Gastos de envío:</strong> Si el cliente devuelve el producto, los gastos de envío iniciales no serán reembolsados, salvo que el producto esté defectuoso o no corresponda con el pedido.</p>
        </div>
      </div>

      {/* 维修服务例外条款 */}
      <div className="bg-red-50 border-l-4 border-red-600 p-5 rounded-r-xl">
        <h3 className="font-bold text-red-900 text-lg mb-3 flex items-center gap-2">
          <Wrench size={20}/> Excepción: Servicios de Reparación
        </h3>
        <p className="text-red-800 text-sm leading-relaxed mb-3">
          <strong>IMPORTANTE:</strong> Los servicios de reparación de dispositivos móviles <strong>NO están sujetos</strong> 
          al derecho de desistimiento de 14 días, según el artículo 103.m) de la Ley General para la Defensa de los 
          Consumidores y Usuarios.
        </p>
        <div className="bg-white p-4 rounded-lg mt-3">
          <p className="text-xs text-red-700 font-bold mb-2">⚠️ Excepciones aplicables:</p>
          <ul className="text-sm text-red-800 space-y-1 list-disc list-inside">
            <li>Servicios de reparación de móviles y dispositivos electrónicos</li>
            <li>Servicios que han comenzado con el consentimiento del consumidor antes del fin del plazo de desistimiento</li>
            <li>Servicios completamente ejecutados antes del fin del plazo de desistimiento</li>
          </ul>
        </div>
        <div className="bg-yellow-50 border border-yellow-300 p-4 rounded-lg mt-4">
          <p className="text-xs text-yellow-800 font-bold mb-1">📋 Garantía de Reparación:</p>
          <p className="text-sm text-yellow-900">
            Aunque no aplica el derecho de desistimiento, todos nuestros servicios de reparación incluyen una 
            <strong> garantía de 180 días (6 meses)</strong> sobre la reparación efectuada. Si la reparación presenta 
            defectos dentro de este período, la repararemos nuevamente sin coste adicional.
          </p>
        </div>
      </div>

      {/* 联系信息 */}
      <div className="bg-gray-50 p-5 rounded-xl border border-gray-200">
        <h3 className="font-bold text-gray-900 text-lg mb-3">Contacto para Devoluciones</h3>
        <div className="space-y-2 text-sm text-gray-700">
          <p><strong>Dirección:</strong> Paseo del Sol 1, 28880 Meco (Madrid)</p>
          <p><strong>Teléfono:</strong> +34 918 782 602</p>
          <p><strong>Horario:</strong> Lunes a Domingo, de 9:00 a 22:00</p>
          <p className="text-xs text-gray-500 mt-3">
            Para cualquier consulta sobre devoluciones, puede visitarnos en tienda o contactarnos por teléfono.
          </p>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-white p-6 animate-fade-in">
       <button onClick={onBack} className="flex items-center gap-2 text-gray-500 mb-6 hover:text-gray-900 font-medium px-2 py-1 rounded-lg hover:bg-gray-100 w-fit transition-colors">
         <ArrowLeft size={18}/> Volver a la tienda
       </button>
       
       <div className="max-w-2xl mx-auto mt-4">
          <div className="flex items-center gap-3 mb-6 pb-4 border-b border-gray-100">
             <div className="text-red-600 p-2 bg-red-50 rounded-xl">{data.icon}</div>
             <h1 className="text-2xl font-bold text-gray-900">{data.title}</h1>
          </div>
          
          <div className="prose text-gray-600 leading-relaxed bg-gray-50 p-8 rounded-2xl border border-gray-100 shadow-sm text-sm md:text-base">
             {type === 'devoluciones' ? (
               renderDevolucionesContent()
             ) : (
               <>
                 <p className="font-medium text-gray-800 mb-4">{data.text}</p>
                 
                 {/* 通用的填充文本，增加篇幅感 */}
                 <div className="space-y-4 text-gray-500">
                   <p>El acceso y/o uso de este portal atribuye la condición de USUARIO, que acepta, desde dicho acceso y/o uso, las Condiciones Generales de Uso aquí reflejadas.</p>
                   <p>HIPERA se reserva el derecho de efectuar sin previo aviso las modificaciones que considere oportunas en su portal, pudiendo cambiar, suprimir o añadir tanto los contenidos y servicios que se presten a través de la misma como la forma en la que éstos aparezcan presentados.</p>
                 </div>
               </>
             )}

             <div className="mt-8 pt-4 border-t border-gray-200 text-xs text-gray-400 flex justify-between items-center">
               <span>QIANG GUO SL © {new Date().getFullYear()}</span>
               <span>Actualizado: Enero 2026</span>
             </div>
          </div>
       </div>
    </div>
  );
};

// --- 工具：高级票据生成系统 (Factura A4 + Ticket 80mm) ---
const generateDocuments = async (order, type = 'both') => {
  const isService = order.items.some(i => i.isService);
  const companyData = {
    name: "QIANG GUO SL",
    address: "Paseo del Sol 1, 28880 Meco",
    nif: "B86126638",
    phone: "+34 918 782 602",
    web: "hipera.vercel.app"
  };
  const generateInvoice = (order) => generateDocuments(order, 'invoice');

  // 生成二维码 Data URL - 包含可访问的URL链接
  const orderQueryUrl = `${window.location.origin}/?order=${order.id}`;
  const qrCodeUrl = await QRCode.toDataURL(orderQueryUrl, {
    errorCorrectionLevel: 'H',
    width: 300,
    margin: 2
  });

  // --- 模版 A: A4 正式发票 (Factura) ---
  const createA4Invoice = () => {
    const doc = new jsPDF();
    
    // 1. Header
    doc.setFillColor(220, 38, 38); // Red Brand Color
    doc.rect(0, 0, 210, 40, 'F');
    
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(24);
    doc.setFont("helvetica", "bold");
    doc.text(companyData.name, 14, 20);
    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    doc.text("Mercado & Reparaciones", 14, 26);

    doc.setFontSize(10);
    doc.text(companyData.address, 196, 15, { align: 'right' });
    doc.text(`NIF: ${companyData.nif}`, 196, 20, { align: 'right' });
    doc.text(`Tel: ${companyData.phone}`, 196, 25, { align: 'right' });

    // 2. Client & Order Info
    doc.setTextColor(0, 0, 0);
    doc.setFontSize(11);
    doc.text(`CLIENTE:`, 14, 55);
    doc.setFont("helvetica", "normal");
    doc.text(order.address || "Cliente General", 14, 62);
    doc.text(order.phone || "", 14, 67);

    doc.setFont("helvetica", "bold");
    doc.text(isService ? "FACTURA DE SERVICIO" : "FACTURA SIMPLIFICADA", 140, 55);
    doc.setFont("helvetica", "normal");
    doc.text(`Núm: ${order.id.slice(0, 8).toUpperCase()}`, 140, 62);
    doc.text(`Fecha: ${new Date(order.created_at).toLocaleDateString()}`, 140, 67);
    doc.text(`Forma de Pago: ${order.payment_method?.toUpperCase() || 'CONTADO'}`, 140, 72);

    // 3. Tablas: productos y regalos por separado
    const regularItems = order.items.filter(item => !(item.isGift || item.price === 0));
    const giftItems = order.items.filter(item => item.isGift || item.price === 0);

    let startY = 80;

    if (regularItems.length > 0) {
      const tableRows = regularItems.map(item => [
        item.name,
        item.quantity,
        `${(item.price / 1.21).toFixed(2)}`,
        '21%',
        `€${(item.price * item.quantity).toFixed(2)}`
      ]);
      autoTable(doc, {
        startY,
        head: [["Descripción", "Cant.", "Precio Base", "IVA", "TOTAL"]],
        body: tableRows,
        theme: 'grid',
        headStyles: { fillColor: [31, 41, 55] },
        styles: { fontSize: 9 },
      });
      startY = doc.lastAutoTable.finalY + 8;
    }

    if (giftItems.length > 0) {
      doc.setFontSize(10);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(180, 80, 120);
      doc.text("Regalo(s) — GRATIS", 14, startY);
      startY += 6;
      doc.setTextColor(0, 0, 0);
      doc.setFont("helvetica", "normal");
      const giftRows = giftItems.map(item => [
        `${item.name} [REGALO]`,
        item.quantity,
        '0.00',
        '—',
        '€0.00'
      ]);
      autoTable(doc, {
        startY,
        head: [["Descripción", "Cant.", "Precio Base", "IVA", "TOTAL"]],
        body: giftRows,
        theme: 'grid',
        headStyles: { fillColor: [180, 80, 120] },
        styles: { fontSize: 9 },
      });
      startY = doc.lastAutoTable.finalY + 8;
    }

    // 4. Totals
    const finalY = startY + 2;
    const subTotal = order.total / 1.21;
    const iva = order.total - subTotal;

    doc.setFontSize(10);
    doc.text(`Base Imponible:`, 160, finalY, { align: 'right' });
    doc.text(`€${subTotal.toFixed(2)}`, 190, finalY, { align: 'right' });
    
    doc.text(`IVA (21%):`, 160, finalY + 5, { align: 'right' });
    doc.text(`€${iva.toFixed(2)}`, 190, finalY + 5, { align: 'right' });

    doc.setFontSize(14);
    doc.setFont("helvetica", "bold");
    doc.text(`TOTAL A PAGAR:`, 160, finalY + 14, { align: 'right' });
    doc.text(`€${order.total.toFixed(2)}`, 190, finalY + 14, { align: 'right' });

    // 5. Warranty Box (维修专用)
    if (isService) {
      const boxY = finalY + 25;
      doc.setDrawColor(200);
      doc.setFillColor(248, 248, 248);
      doc.rect(14, boxY, 182, 50, 'FD');
      
      doc.setFontSize(10);
      doc.setTextColor(220, 38, 38);
      doc.text("GARANTÍA Y CONDICIONES", 18, boxY + 8);
      
      doc.setFontSize(8);
      doc.setTextColor(80);
      const terms = [
        "1. Validez: 180 días de garantía sobre la reparación efectuada.",
        "2. Exclusiones: No cubre daños por humedad, golpes posteriores o manipulación externa.",
        "3. Recogida: Dispone de 3 meses para recoger su dispositivo. Pasado este tiempo,",
        "   será enviado a reciclaje según normativa vigente.",
        "4. Datos: La empresa no se hace responsable de la pérdida de software o datos."
      ];
      terms.forEach((line, i) => doc.text(line, 18, boxY + 16 + (i*5)));
    }

    // 6. Footer QR
    doc.addImage(qrCodeUrl, 'PNG', 14, 250, 25, 25);
    doc.setFontSize(8);
    doc.setTextColor(150);
    doc.text("Escanea para ver tu pedido online", 42, 260);
    doc.text("Gracias por su visita.", 42, 265);

    doc.save(`Factura_${order.id.slice(0, 8)}.pdf`);
  };

  // --- 模版 B: 80mm 热敏小票 (Ticket) ---
  const createThermalTicket = () => {
    // 80mm 宽, 高度根据内容大概估算，这里设长一点 250mm
    const doc = new jsPDF({
      orientation: 'p',
      unit: 'mm',
      format: [80, 260] 
    });

    let y = 10;
    const centerX = 40; // 80 / 2

    // Header
    doc.setFont("courier", "bold");
    doc.setFontSize(16);
    doc.text(companyData.name, centerX, y, { align: 'center' });
    y += 5;
    doc.setFontSize(8);
    doc.setFont("courier", "normal");
    doc.text("Mercado & Servicios", centerX, y, { align: 'center' });
    y += 5;
    doc.text(companyData.address, centerX, y, { align: 'center' });
    y += 4;
    doc.text(`NIF: ${companyData.nif}`, centerX, y, { align: 'center' });
    y += 4;
    doc.text(new Date().toLocaleString(), centerX, y, { align: 'center' });
    y += 8;

    // Ticket Info
    doc.text("--------------------------------", centerX, y, { align: 'center' });
    y += 4;
    doc.setFont("courier", "bold");
    doc.text(isService ? "RESGUARDO REPARACION" : "TICKET DE CAJA", centerX, y, { align: 'center' });
    y += 4;
    doc.setFont("courier", "normal");
    doc.text(`Ref: ${order.id.slice(0, 8)}`, centerX, y, { align: 'center' });
    y += 4;
    doc.text("--------------------------------", centerX, y, { align: 'center' });
    y += 6;

    // Items: productos y regalos por separado
    doc.setFontSize(8);
    const regularForTicket = order.items.filter(item => !(item.isGift || item.price === 0));
    const giftsForTicket = order.items.filter(item => item.isGift || item.price === 0);

    regularForTicket.forEach(item => {
      doc.text(item.name.substring(0, 25), 5, y);
      y += 4;
      const line = `${item.quantity} x ${item.price.toFixed(2)}`.padEnd(20) + `€${(item.price * item.quantity).toFixed(2)}`;
      doc.text(line, 5, y);
      y += 5;
    });

    if (giftsForTicket.length > 0) {
      y += 2;
      doc.text("--------------------------------", centerX, y, { align: 'center' });
      y += 4;
      doc.setFont("courier", "bold");
      doc.text("REGALO(S) — GRATIS", centerX, y, { align: 'center' });
      y += 5;
      doc.setFont("courier", "normal");
      giftsForTicket.forEach(item => {
        doc.text(`${item.name.substring(0, 22)} [REGALO]`, 5, y);
        y += 4;
        doc.text(`${item.quantity} x 0.00`.padEnd(20) + `GRATIS`, 5, y);
        y += 5;
      });
    }

    y += 2;
    doc.text("--------------------------------", centerX, y, { align: 'center' });
    y += 6;

    // Totals
    doc.setFont("courier", "bold");
    doc.setFontSize(12);
    doc.text(`TOTAL:     EUR ${order.total.toFixed(2)}`, 5, y);
    y += 6;
    doc.setFontSize(8);
    doc.setFont("courier", "normal");
    doc.text(`(IVA Incluido)`, 5, y);
    y += 8;

    // Payment Method
    doc.text(`Pago: ${order.payment_method?.toUpperCase() || 'Efectivo/Bizum'}`, 5, y);
    y += 10;

    // Warranty Note (Short version)
    if (isService) {
      doc.setFontSize(7);
      doc.text("GARANTIA DE REPARACION: 6 MESES", centerX, y, { align: 'center' });
      y += 3;
      doc.text("Imprescindible presentar este ticket", centerX, y, { align: 'center' });
      y += 6;
    }

    // QR Code
    doc.addImage(qrCodeUrl, 'PNG', 20, y, 40, 40);
    y += 45;

    // Footer
    doc.setFontSize(8);
    doc.text("¡Gracias por su visita!", centerX, y, { align: 'center' });

    doc.save(`Ticket_${order.id.slice(0, 8)}.pdf`);
  };

  // 执行下载
  if (type === 'invoice' || type === 'both') createA4Invoice();
  if (type === 'ticket' || type === 'both') {
     // 稍微延迟一下，防止浏览器拦截
     setTimeout(() => createThermalTicket(), 500);
  }
};

export default function App() {
  // --- Core Data ---
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
  
  // --- Navigation ---
  const [page, setPage] = useState("home"); 
  const [history, setHistory] = useState(["home"]); 
  const [mainCat, setMainCat] = useState(null); 
  const [subCat, setSubCat] = useState(null);   
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [bannerIndex, setBannerIndex] = useState(0);

  // --- Orders & Payment ---
  const [myOrders, setMyOrders] = useState([]);
  const [checkoutForm, setCheckoutForm] = useState({ address: "", phone: "", note: "" });
  
  // New Payment States
  const [showPayment, setShowPayment] = useState(false); // 控制弹窗
  const [isProcessingPayment, setIsProcessingPayment] = useState(false); // 控制支付Loading
  const [selectedPayment, setSelectedPayment] = useState(""); // 选择的支付方式
  const [legalType, setLegalType] = useState("aviso"); // 新增法律页面状态
  const [selectedGift, setSelectedGift] = useState(null); // 选中的免费商品

  // 新增这两个状态用于筛选
  const [selectedBrand, setSelectedBrand] = useState("Apple"); // 默认选 Apple
  const [selectedModel, setSelectedModel] = useState("");
  const [selectedRepairType, setSelectedRepairType] = useState(null); // 'pantalla' | 'bateria' | null

  const navigate = useNavigate();
  const [queryOrderId, setQueryOrderId] = useState(null);
  const [queryOrder, setQueryOrder] = useState(null);
  const [queryLoading, setQueryLoading] = useState(false);

  const fetchOrderById = async (orderId) => {
    setQueryLoading(true);
    try {
      const order = await apiClient.getOrderById(orderId);
      setQueryOrder(order);
    } catch (error) {
      console.error('Error fetching order:', error);
      toast.error('Pedido no encontrado');
      setQueryOrder(null);
    } finally {
      setQueryLoading(false);
    }
  };

  // --- Init ---
  useEffect(() => {
    // 检查URL中是否有订单ID（从二维码扫描）
    const urlParams = new URLSearchParams(window.location.search);
    const orderId = urlParams.get('order');
    if (orderId && !queryOrderId) {
      setQueryOrderId(orderId);
      fetchOrderById(orderId);
    }
  }, []);

  useEffect(() => {
    const savedAddress = JSON.parse(localStorage.getItem('lastAddress') || '{}');
    if (savedAddress.address) setCheckoutForm(prev => ({...prev, ...savedAddress}));

    supabase.auth.getSession().then(({ data: { session } }) => setUser(session?.user ?? null));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => setUser(session?.user ?? null));

    fetchData();
    return () => subscription.unsubscribe();
  }, []);

  // 同步应用内导航与浏览器历史：右划返回上一个应用内页面，而不是跳到 /login 或 /admin
  useEffect(() => {
    const url = window.location.pathname + window.location.search;
    window.history.replaceState({ app: true }, '', url);
  }, []);

  const fetchData = async () => {
    setLoading(true);
    try {
      // 使用API客户端获取数据
      const [productsData, categoriesData, subCategoriesData, repairsData] = await Promise.all([
        apiClient.getProducts().catch(e => { console.error("Products API error:", e); return null; }),
        apiClient.getCategories().catch(e => { console.error("Categories API error:", e); return null; }),
        apiClient.getSubCategories().catch(e => { console.error("SubCategories API error:", e); return null; }),
        apiClient.getRepairServices().catch(e => { console.error("Repairs API error:", e); return null; })
      ]);

      if (productsData) {
        setProducts(productsData.map(p => ({
          ...p,
          ofertaType: p.oferta_type,
          ofertaValue: p.oferta_value,
          subCategoryId: p.sub_category_id,
          giftProduct: p.gift_product || false
        })));
      } else {
        const msg = import.meta.env.PROD
          ? "No se pudieron cargar los productos. Compruebe su conexión; si usa Railway, el backend puede estar en reposo (espérale 1 min o revisa el panel)."
          : "No se pudieron cargar los productos. ¿Está el backend en marcha? (npm run dev en /backend)";
        toast.error(msg);
      }

      if (categoriesData) setCategories(categoriesData);
      if (subCategoriesData) setSubCategories(subCategoriesData);
      if (repairsData) setRepairs(repairsData);

    } catch (error) {
      console.error("Data load error:", error);
      const msg = import.meta.env.PROD
        ? "Error al cargar datos. Compruebe su conexión o que el backend (Railway) esté activo."
        : "Error al cargar datos. Compruebe que el backend esté en ejecución (npm run dev en /backend).";
      toast.error(msg);
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
        try {
          const data = await apiClient.getUserOrders(user.id);
          if (data) setMyOrders(data);
        } catch (error) {
          console.error("Error fetching orders:", error);
        }
      };
      fetchOrders();
    }
  }, [page, user]);

  const goBack = useCallback(() => {
    if (history.length <= 1) return;
    const next = [...history];
    next.pop();
    setHistory(next);
    setPage(next[next.length - 1]);
    window.scrollTo(0, 0);
  }, [history]);

  const handleBack = () => {
    if (history.length > 1) window.history.back();
  };

  const navTo = (newPage) => {
    const nextStack = [...history, newPage];
    setHistory(nextStack);
    setPage(newPage);
    window.scrollTo(0, 0);
    window.history.pushState({ app: true }, '', window.location.pathname + window.location.search);
  };

  useEffect(() => {
    const onPopState = () => { goBack(); };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [goBack]);

  // --- Logic ---
  const addToCart = (item) => {
    const isService = !item.stock && item.title; 
    const stock = Number(item.stock);
    if (!isService && (isNaN(stock) || stock <= 0)) {
      toast.error("Producto agotado");
      return;
    }
    const newItem = { ...item, name: item.name || item.title, id: item.id, isService: isService, stock: isService ? undefined : stock };
    const ex = cart.find(i => i.id === newItem.id && i.name === newItem.name);
    if (ex) {
      const exStock = Number(ex.stock);
      if (!isService && !isNaN(exStock) && ex.quantity >= exStock) { toast.error("Max stock alcanzado"); return; }
      setCart(cart.map(i => (i.id === newItem.id && i.name === newItem.name) ? { ...i, quantity: i.quantity + 1 } : i));
    } else {
      setCart([...cart, { ...newItem, quantity: 1 }]);
    }
    toast.success("Añadido a la cesta");
  };

  const toggleFavorite = (e, productId) => {
    e.stopPropagation();
    setFavorites(prev => prev.includes(productId) ? prev.filter(id=>id!==productId) : [...prev, productId]);
    toast(favorites.includes(productId) ? "Eliminado" : "Guardado", {icon: favorites.includes(productId)?'💔':'❤️'});
  };

  const removeFromCart = (id, name) => setCart(cart.filter(i => !(i.id === id && i.name === name)));
  const updateQty = (id, name, delta) => {
    setCart(cart.map(i => {
      if (i.id === id && i.name === name) {
        const newQty = Math.max(1, i.quantity + delta);
        const stock = Number(i.stock);
        if (!i.isService && !isNaN(stock) && newQty > stock) { toast.error("No hay más stock"); return i; }
        return { ...i, quantity: newQty };
      }
      return i;
    }));
  };

  // 生成发票/票据的函数（供订单页面使用）
  const generateInvoice = (order) => {
    generateDocuments(order, 'both');
  };

  const subtotal = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
  const shippingFee = subtotal >= 50 ? 0 : 4.50; 
  const total = subtotal + shippingFee;
  const minOrderMet = subtotal >= 20;
  const isFreeShipping = subtotal >= 50;
  const isGiftEligible = subtotal >= 65;

  // --- Step 1: Open Payment Modal ---
  const handleInitiateCheckout = () => {
    if (!checkoutForm.address || !checkoutForm.phone) {
      toast.error("Faltan datos de envío");
      return;
    }
    setSelectedPayment(""); // 重置支付方式选择
    setShowPayment(true); // 打开支付弹窗
  };

  // --- Step 2: Simulate Payment & Save Order ---
  const handleConfirmPayment = async () => {
    setIsProcessingPayment(true);

    try {
      localStorage.setItem('lastAddress', JSON.stringify({ address: checkoutForm.address, phone: checkoutForm.phone }));

      // 创建订单（通过API，后端会处理库存检查和扣减）
      const paymentMethodName = selectedPayment === 'contra_reembolso' ? 'Contra Reembolso' : selectedPayment === 'bizum' ? 'Bizum' : 'Pendiente';
      
      // 如果有选中的免费商品，添加到订单中（价格为0）
      const finalCart = [...cart];
      if (selectedGift) {
        finalCart.push({
          ...selectedGift,
          quantity: 1,
          price: 0, // 免费商品价格为0
          isGift: true // 标记为免费商品
        });
      }

      const orderData = await apiClient.createOrder({
        user_id: user?.id || null, 
        address: checkoutForm.address,
        phone: checkoutForm.phone,
        note: checkoutForm.note,
        total: total, // 总价不变（免费商品不计入总价）
        status: selectedPayment === 'contra_reembolso' ? "Pendiente de Pago" : "Procesando",
        payment_method: paymentMethodName,
        items: finalCart
      });

      toast.success(selectedPayment === 'contra_reembolso' ? "¡Pedido Confirmado! Paga al recibir." : "¡Pedido Confirmado! Revisa tu Bizum.");
      
      // 重置免费商品选择
      setSelectedGift(null);
      
      // 询问用户是否下载票据
      if(window.confirm("Pago completado. ¿Quieres descargar los recibos?")) {
         // 分离商品和服务（包括免费商品）
         const productItems = finalCart.filter(item => !item.isService);
         const serviceItems = finalCart.filter(item => item.isService);
         
         const productTotal = productItems.reduce((sum, item) => sum + (item.price * item.quantity), 0);
         const serviceTotal = serviceItems.reduce((sum, item) => sum + (item.price * item.quantity), 0);
         
         // 如果同时有商品和服务，生成两张发票
         if (productItems.length > 0 && serviceItems.length > 0) {
            // 商品发票
            const productOrder = {
               id: orderData?.id || Math.random().toString(36).substr(2, 9),
               created_at: orderData?.created_at || new Date().toISOString(),
               items: productItems,
               total: productTotal,
               address: checkoutForm.address,
               phone: checkoutForm.phone,
               payment_method: paymentMethodName
            };
            await generateDocuments(productOrder, 'both');
            
            // 稍等片刻，避免浏览器阻止多个下载
            await new Promise(resolve => setTimeout(resolve, 500));
            
            // 维修服务发票
            const serviceOrder = {
               id: (orderData?.id || Math.random().toString(36).substr(2, 9)) + '-SERV',
               created_at: orderData?.created_at || new Date().toISOString(),
               items: serviceItems,
               total: serviceTotal,
               address: checkoutForm.address,
               phone: checkoutForm.phone,
               payment_method: paymentMethodName
            };
            await generateDocuments(serviceOrder, 'both');
         } else {
            // 只有一种类型，生成一张发票（必须用 finalCart 才能包含礼品）
            const orderForDocuments = {
               id: orderData?.id || Math.random().toString(36).substr(2, 9),
               created_at: orderData?.created_at || new Date().toISOString(),
               items: finalCart,
               total: total,
               address: checkoutForm.address,
               phone: checkoutForm.phone,
               payment_method: paymentMethodName
            };
            await generateDocuments(orderForDocuments, 'both');
         }
      }
      
      setCart([]);
      setCheckoutForm(prev => ({ ...prev, note: "" }));
      setSelectedPayment(""); // 重置支付方式
      setShowPayment(false); // 关闭弹窗
      
      // 刷新产品列表（通过API）
      const pData = await apiClient.getProducts();
      if(pData) setProducts(pData.map(p => ({...p, ofertaType: p.oferta_type, ofertaValue: p.oferta_value, subCategoryId: p.sub_category_id, giftProduct: p.gift_product || false})));
      
      navTo("home"); 
    } catch (e) {
      toast.error(e.message);
    } finally {
      setIsProcessingPayment(false);
    }
  };

  // --- Renders ---
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
        <button onClick={(e) => {e.stopPropagation(); addToCart(p);}} className="bg-gray-900 text-white w-8 h-8 rounded-full flex items-center justify-center shadow-lg active:bg-red-600 transition-colors"><Plus size={16}/></button>
      </div>
    </div>
  );

  const renderDiscountTag = (p) => {
    // 只有当 oferta 为 true 时才显示标签
    if (!p.oferta || !p.ofertaType) return null;
    let text = "";
    if (p.ofertaType === "percent") {
      // 只有当 ofertaValue 大于 0 时才显示百分比
      if (!p.ofertaValue || p.ofertaValue <= 0) return null;
      text = `-${p.ofertaValue}%`;
    }
    if (p.ofertaType === "second") text = "2ª -50%";
    if (p.ofertaType === "gift") text = "2x1";
    // 如果 text 为空，不显示标签
    if (!text) return null;
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
      <CookieConsent /> {/* 🍪 新增：Cookie 弹窗 */}

      {/* Payment Modal */}
      {showPayment && (
        <PaymentModal 
           total={total} 
           onClose={() => {
             setShowPayment(false);
             setSelectedPayment("");
           }} 
           onConfirm={handleConfirmPayment}
           isProcessing={isProcessingPayment}
           selectedPayment={selectedPayment}
           setSelectedPayment={setSelectedPayment}
        />
      )}

      {/* HEADER */}
      <header className="bg-white/80 backdrop-blur-md shadow-sm sticky top-0 z-40 transition-all">
        <div className="px-4 py-3">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-3" onClick={() => navTo("home")}>
              <div className="w-10 h-10 bg-red-600 rounded-xl flex items-center justify-center text-white font-extrabold shadow-lg shadow-red-200">H</div>
              <div><h1 className="font-bold text-lg leading-none text-gray-900">HIPERA</h1><p className="text-[10px] text-gray-500 tracking-wider font-medium">MERCADO ONLINE</p></div>
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
              <input id="search" name="search" placeholder="Buscar productos..." value={searchQuery} onChange={e => {setSearchQuery(e.target.value); if(e.target.value && page==='home') navTo("products");}} className="w-full pl-10 pr-4 py-2.5 bg-gray-100 border-none rounded-xl text-sm focus:bg-white focus:ring-2 focus:ring-red-100 outline-none transition-all shadow-inner" />
            </div>
          )}
        </div>
      </header>

      {/* ⚖️ 法律页面 */}
      {page === "legal" && <LegalPage type={legalType} onBack={handleBack}/>}

      {/* --- HOME PAGE --- */}
      {page === "home" && (
        <div className="p-4 space-y-6 animate-fade-in">
          <div className="grid grid-cols-4 gap-2">
            <button onClick={() => navTo("main")} className="bg-white p-2 rounded-xl shadow-sm flex flex-col items-center justify-center gap-1 active:scale-95 transition-transform aspect-square"><div className="p-2 bg-blue-50 text-blue-600 rounded-full"><LayoutGrid size={18} /></div><span className="text-[10px] font-bold text-gray-700">Todo</span></button>
            <button onClick={() => navTo("offers")} className="bg-white p-2 rounded-xl shadow-sm flex flex-col items-center justify-center gap-1 active:scale-95 transition-transform aspect-square"><div className="p-2 bg-red-50 text-red-600 rounded-full"><Percent size={18} /></div><span className="text-[10px] font-bold text-gray-700">Ofertas</span></button>
            <button onClick={() => navTo("favorites")} className="bg-white p-2 rounded-xl shadow-sm flex flex-col items-center justify-center gap-1 active:scale-95 transition-transform aspect-square"><div className="p-2 bg-pink-50 text-pink-600 rounded-full"><Heart size={18} /></div><span className="text-[10px] font-bold text-gray-700">Favs</span></button>
            <button onClick={() => navTo("orders")} className="bg-white p-2 rounded-xl shadow-sm flex flex-col items-center justify-center gap-1 active:scale-95 transition-transform aspect-square"><div className="p-2 bg-green-50 text-green-600 rounded-full"><ClipboardList size={18} /></div><span className="text-[10px] font-bold text-gray-700">Pedidos</span></button>
          </div>
          <div className="relative rounded-2xl overflow-hidden shadow-lg aspect-[2.2/1]">
            <img src={BANNERS[bannerIndex]} className="w-full h-full object-cover transition-all duration-700 hover:scale-105" />
            <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent flex items-end p-5"><div><span className="bg-red-600 text-white text-[10px] px-2 py-1 rounded font-bold mb-1 inline-block">NUEVO</span><p className="text-white font-bold text-xl leading-tight">Frescura<br/>Garantizada</p></div></div>
          </div>
          <div className="grid grid-cols-1 gap-4">
             <div onClick={() => navTo("repair")} className="bg-gray-900 text-white p-5 rounded-2xl shadow-lg relative overflow-hidden group cursor-pointer active:scale-95 transition-transform">
                <div className="absolute right-0 top-0 bottom-0 w-1/3 bg-gradient-to-l from-red-600 to-transparent opacity-50 group-hover:opacity-80 transition-opacity"></div>
                <div className="relative z-10 flex justify-between items-center">
                   <div>
                      <div className="flex items-center gap-2 mb-2"><Wrench className="text-red-500 animate-pulse" size={20}/><span className="font-bold text-[10px] bg-red-600 px-2 py-0.5 rounded text-white tracking-wider">SERVICIO OFICIAL</span></div>
                      <h3 className="text-xl font-bold mb-1">Reparación Móvil</h3><p className="text-gray-400 text-xs">Cambio de pantalla, batería...<br/>Por cita · Consulta precio por WhatsApp.</p>
                   </div>
                   <Smartphone size={56} className="text-gray-600 group-hover:text-white transition-colors transform group-hover:rotate-12"/>
                </div>
             </div>
          </div>
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-bold text-xl text-gray-800">Ofertas Flash</h3>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {loading ? (
                [1,2,3,4,5,6].map(i => <ProductSkeleton key={i}/>)
              ) : (
                products.filter(p => p.oferta).slice(0, 6).map(p => renderProductCard(p))
              )}
            </div>
            {!loading && products.filter(p => p.oferta).length > 6 && (
              <button 
                onClick={() => navTo("offers")} 
                className="w-full mt-4 bg-red-600 text-white py-3 rounded-xl font-bold text-sm shadow-lg hover:bg-red-700 active:scale-95 transition-all flex items-center justify-center gap-2"
              >
                Ver más ofertas <ChevronRight size={18}/>
              </button>
            )}
          </div>
          <div>
             <h4 className="text-sm font-bold text-gray-400 uppercase tracking-wide mb-3">Categorías</h4>
             <div className="flex gap-3 overflow-x-auto pb-4 -mx-4 px-4 scrollbar-hide">
               {categories.map(c => (
                 <button 
                   key={c.id} 
                   onClick={() => {setMainCat(c); setSubCat(null); navTo("sub");}} 
                   className="flex flex-col items-center gap-2 group w-24 flex-shrink-0"
                 >
                   <div className="w-20 h-20 bg-white p-4 rounded-2xl shadow-sm border border-gray-100 flex items-center justify-center text-red-600 group-active:scale-95 transition-transform">
                     <IconByName name={c.icon} size={32}/>
                   </div>
                   <span className="text-xs font-bold text-gray-800 text-center leading-tight line-clamp-2 h-8 flex items-start justify-center">
                     {c.name}
                   </span>
                 </button>
               ))}
             </div>
          </div>
        </div>
      )}

{/* --- REPAIR PAGE (已修正：深色风格 + 完整购买须知) --- */}
      {page === "repair" && (
        <div className="min-h-screen bg-gray-900 text-white animate-fade-in pb-24">
           {/* Header */}
           <div className="px-4 py-4 flex items-center gap-3 sticky top-0 bg-gray-900/95 backdrop-blur z-20 border-b border-gray-800">
             <button onClick={handleBack} className="w-10 h-10 bg-white/10 rounded-full flex items-center justify-center hover:bg-white/20 transition-colors"><ArrowLeft size={20}/></button>
             <h2 className="text-xl font-bold">Centro de Reparación</h2>
           </div>
           
           <div className="p-4 space-y-6">
              {/* 1. 顶部 Banner */}
              <div className="bg-gradient-to-br from-gray-800 to-gray-900 p-6 rounded-3xl border border-gray-700 text-center relative overflow-hidden shadow-2xl">
                 <div className="absolute top-0 right-0 w-24 h-24 bg-red-600 blur-[60px] opacity-20"></div>
                 <Wrench size={40} className="mx-auto text-red-500 mb-4"/>
                 <h3 className="text-xl font-bold mb-2">Reparación por cita</h3>
                 <p className="text-gray-400 text-sm leading-relaxed">Elige modelo y tipo de reparación, luego consulta el precio por WhatsApp.</p>
              </div>

              {/* 2. 核心：智能筛选器 (改为深色风格) */}
              <div className="bg-gray-800/40 p-2 rounded-3xl border border-gray-700 backdrop-blur-sm">
                 
                 {/* 品牌 Tabs (黑底) */}
                 <div className="flex p-1 bg-gray-900 rounded-2xl mb-4 overflow-x-auto border border-gray-800">
                    {['Apple', 'Samsung', 'Xiaomi', 'Oppo'].map(brand => (
                      <button 
                        key={brand}
                        onClick={() => { setSelectedBrand(brand); setSelectedModel(""); setSelectedRepairType(null); }} 
                        className={`flex-1 py-3 rounded-xl text-sm font-bold transition-all whitespace-nowrap px-4 ${selectedBrand === brand ? 'bg-gray-800 text-white shadow-lg border border-gray-700' : 'text-gray-500 hover:text-gray-300'}`}
                      >
                        {brand}
                      </button>
                    ))}
                 </div>

                 <div className="px-2 pb-2">
                    {/* 型号选择 (已修改：增加"找不到型号"选项) */}
                    <div className="mb-6">
                       <label className="text-xs font-bold text-gray-500 uppercase ml-2 mb-2 block">Selecciona Modelo</label>
                       <div className="relative">
                         <select 
                           value={selectedModel} 
                           onChange={e => { setSelectedModel(e.target.value); setSelectedRepairType(null); }}
                           className="w-full p-4 bg-gray-900 border border-gray-700 rounded-xl text-white font-bold outline-none focus:ring-2 focus:ring-red-900/50 appearance-none transition-all"
                         >
                           <option value="" className="text-gray-500">-- Elige tu dispositivo --</option>
                           
                           {/* 1. 正常的数据库型号 */}
                           {[...new Set(repairs.filter(r => r.brand?.toLowerCase() === selectedBrand.toLowerCase()).map(r => r.model))].sort().map(model => (
                              <option key={model} value={model}>{model}</option>
                           ))}

                           {/* 2. 👇 新增：兜底选项 (手动加上去的) */}
                           <option value="others" className="text-red-400 font-bold">❓ No encuentro mi modelo</option>
                         </select>
                         <ChevronRight className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-500 rotate-90 pointer-events-none" size={16}/>
                       </div>
                    </div>

                    {/* 预约制：选型号 → 简单信息 + Cambiar pantalla / batería → WhatsApp 咨询价格 */}
                    <div className="space-y-3">
                       {/* A: 未选型号 */}
                       {!selectedModel && (
                         <div className="text-center py-10 border-2 border-dashed border-gray-800 rounded-2xl">
                            <Smartphone size={32} className="mx-auto mb-3 text-gray-700"/>
                            <p className="text-sm text-gray-500">👆 Selecciona un modelo arriba</p>
                         </div>
                       )}

                       {/* B: "找不到型号" → 直接 WhatsApp */}
                       {selectedModel === 'others' && (
                         <div className="bg-gray-800 p-6 rounded-2xl text-center border border-gray-700 animate-fade-in">
                            <div className="w-16 h-16 bg-gray-700 rounded-full flex items-center justify-center mx-auto mb-4 text-yellow-400">
                               <Info size={32} />
                            </div>
                            <h3 className="text-xl font-bold text-white mb-2">¿Tu modelo no está en la lista?</h3>
                            <p className="text-gray-400 text-sm mb-6 leading-relaxed">
                               Trabajamos con casi todas las marcas. Contáctanos por WhatsApp para consultar precio.
                            </p>
                            <a 
                              href="https://wa.me/34646569480?text=Hola,%20quiero%20reparar%20un%20móvil%20que%20no%20aparece%20en%20la%20web.%20Quisiera%20consultar%20precio."
                              target="_blank" 
                              rel="noreferrer"
                              className="bg-[#25D366] hover:bg-[#20bd5a] text-white py-3 px-6 rounded-xl font-bold flex items-center justify-center gap-2 shadow-lg transition-transform active:scale-95 mx-auto w-full"
                            >
                               <Smartphone size={20}/> Consultar precio por WhatsApp
                            </a>
                         </div>
                       )}

                       {/* C: 已选型号 → 简单信息 + Cambiar pantalla / batería（点击仅选中）→ 再显示 Consultar / Pedir cita → WhatsApp */}
                       {selectedModel && selectedModel !== 'others' && (
                         <div className="space-y-4 animate-fade-in">
                           {(() => {
                             const modelRepair = repairs.find(r => r.brand?.toLowerCase() === selectedBrand.toLowerCase() && r.model === selectedModel);
                             const desc = modelRepair?.description;
                             return (
                           <div className="bg-gray-800 p-4 rounded-2xl border border-gray-700">
                             <p className="text-xs text-gray-500 uppercase font-bold mb-1">{selectedBrand}</p>
                             <h3 className="text-lg font-bold text-white">{selectedModel}</h3>
                             {desc ? <p className="text-gray-400 text-sm mt-1">{desc}</p> : null}
                             <p className="text-gray-400 text-sm mt-1">
                               {!selectedRepairType
                                 ? "Elige el tipo de reparación."
                                 : `Has elegido: Cambiar ${selectedRepairType === 'pantalla' ? 'pantalla' : 'batería'}. Pulsa abajo para consultar o pedir cita.`}
                             </p>
                           </div>
                           ); })()}

                           {!selectedRepairType ? (
                             <>
                               <div className="grid grid-cols-1 gap-3">
                                 <button
                                   type="button"
                                   onClick={() => setSelectedRepairType('pantalla')}
                                   className="bg-gray-800 hover:bg-gray-700 p-4 rounded-2xl border border-gray-700 flex items-center gap-4 transition-all active:scale-[0.98] w-full text-left"
                                 >
                                   <div className="w-12 h-12 bg-gray-900 rounded-xl flex items-center justify-center text-red-400">
                                     <Smartphone size={24}/>
                                   </div>
                                   <div className="flex-1">
                                     <h4 className="font-bold text-white">Cambiar pantalla</h4>
                                     <p className="text-gray-500 text-xs">Seleccionar</p>
                                   </div>
                                   <ChevronRight className="text-gray-500" size={20}/>
                                 </button>
                                 <button
                                   type="button"
                                   onClick={() => setSelectedRepairType('bateria')}
                                   className="bg-gray-800 hover:bg-gray-700 p-4 rounded-2xl border border-gray-700 flex items-center gap-4 transition-all active:scale-[0.98] w-full text-left"
                                 >
                                   <div className="w-12 h-12 bg-gray-900 rounded-xl flex items-center justify-center text-amber-400">
                                     <Wrench size={24}/>
                                   </div>
                                   <div className="flex-1">
                                     <h4 className="font-bold text-white">Cambiar batería</h4>
                                     <p className="text-gray-500 text-xs">Seleccionar</p>
                                   </div>
                                   <ChevronRight className="text-gray-500" size={20}/>
                                 </button>
                               </div>
                             </>
                           ) : (
                             <a
                               href={`https://wa.me/34646569480?text=${encodeURIComponent(`Hola, quiero consultar precio para ${selectedBrand} ${selectedModel} - cambiar ${selectedRepairType === 'pantalla' ? 'pantalla' : 'batería'}.`)}`}
                               target="_blank"
                               rel="noreferrer"
                               className="bg-[#25D366] hover:bg-[#20bd5a] text-white py-3 px-6 rounded-xl font-bold flex items-center justify-center gap-2 shadow-lg transition-transform active:scale-95 w-full"
                             >
                               <Smartphone size={20}/> Consultar / Pedir cita por WhatsApp
                             </a>
                           )}
                         </div>
                       )}
                    </div>
                 </div>
              </div>

              {/* 3. 购买须知 (完整版 - 5条) */}
              <div className="bg-gray-900/50 p-5 rounded-3xl border border-gray-800 mt-4">
                 <h3 className="font-bold text-gray-200 mb-5 text-sm flex items-center gap-2">
                    <Info size={16} className="text-red-500"/> Información Importante
                 </h3>
                 
                 <div className="space-y-5">
                    {/* 时间 */}
                    <div className="flex gap-4">
                       <div className="w-8 h-8 bg-gray-800 rounded-full flex items-center justify-center flex-shrink-0 border border-gray-700 text-yellow-400"><Clock size={14}/></div>
                       <div><p className="text-xs font-bold text-gray-300 uppercase tracking-wide">Horario</p><p className="text-xs text-gray-500 mt-0.5">Lunes a Domingo, de 9:00 a 22:00.</p></div>
                    </div>
                    {/* 库存等待时间 */}
                    <div className="flex gap-4">
                       <div className="w-8 h-8 bg-gray-800 rounded-full flex items-center justify-center flex-shrink-0 border border-gray-700 text-orange-400"><Package size={14}/></div>
                       <div><p className="text-xs font-bold text-gray-300 uppercase tracking-wide">Disponibilidad de Piezas</p><p className="text-xs text-gray-500 mt-0.5">Algunos modelos pueden requerir <strong>2-3 días</strong> para disponibilidad de piezas. Le notificaremos cuando esté listo.</p></div>
                    </div>
                    {/* 保修 */}
                    <div className="flex gap-4">
                       <div className="w-8 h-8 bg-gray-800 rounded-full flex items-center justify-center flex-shrink-0 border border-gray-700 text-red-400"><ShieldCheck size={14}/></div>
                       <div><p className="text-xs font-bold text-gray-300 uppercase tracking-wide">Garantía Extendida</p><p className="text-xs text-gray-500 mt-0.5">Cobertura total de <strong>6 meses</strong>.</p></div>
                    </div>
                 </div>
              </div>
           </div>
        </div>
      )}

      {/* --- ORDER QUERY PAGE (从二维码扫描) --- */}
      {queryOrderId && (
        <div className="p-4 min-h-screen bg-gray-50">
          <div className="flex items-center gap-2 mb-6 sticky top-0 bg-gray-50 z-10 py-2">
            <button onClick={() => { setQueryOrderId(null); setQueryOrder(null); navTo("home"); }} className="p-2 bg-white rounded-full shadow-sm text-gray-700">
              <ArrowLeft size={20}/>
            </button>
            <h2 className="font-bold text-xl text-gray-800">Consulta de Pedido</h2>
          </div>
          
          {queryLoading ? (
            <div className="text-center py-20">
              <Loader2 className="animate-spin mx-auto mb-4 text-red-500" size={32}/>
              <p className="text-gray-500">Cargando pedido...</p>
            </div>
          ) : queryOrder ? (
            <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 space-y-4">
              <div className="flex justify-between items-start mb-4">
                <div>
                  <span className="font-bold text-gray-800 block text-sm font-mono bg-gray-100 px-3 py-1.5 rounded-lg mb-2">
                    #{queryOrder.id.slice(0, 8).toUpperCase()}
                  </span>
                  <span className="text-xs text-gray-400">
                    {new Date(queryOrder.created_at).toLocaleString('es-ES')}
                  </span>
                </div>
                <span className={`text-xs uppercase tracking-wider px-3 py-1.5 rounded-lg font-bold ${
                  queryOrder.status === 'Entregado' ? 'bg-green-100 text-green-700' :
                  queryOrder.status === 'Pendiente de Pago' ? 'bg-orange-100 text-orange-700' :
                  'bg-blue-100 text-blue-700'
                }`}>
                  {queryOrder.status}
                </span>
              </div>

              <div className="border-t pt-4 space-y-3">
                <div>
                  <p className="text-xs font-bold text-gray-500 uppercase mb-1">Cliente</p>
                  <p className="text-sm text-gray-800">{queryOrder.address || 'Cliente General'}</p>
                  <p className="text-sm text-gray-600">{queryOrder.phone || ''}</p>
                </div>

                <div>
                  <p className="text-xs font-bold text-gray-500 uppercase mb-2">Productos</p>
                  <div className="space-y-2">
                    {queryOrder.items?.map((item, idx) => (
                      <div key={idx} className="flex justify-between items-center py-2 border-b border-gray-100 last:border-0">
                        <div className="flex-1">
                          <p className="text-sm font-medium text-gray-800">{item.name}</p>
                          <p className="text-xs text-gray-500">€{item.price.toFixed(2)} x {item.quantity}</p>
                        </div>
                        <p className="text-sm font-bold text-gray-900">€{(item.price * item.quantity).toFixed(2)}</p>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="flex justify-between items-center pt-3 border-t">
                  <span className="text-sm font-bold text-gray-700">Total</span>
                  <span className="text-xl font-extrabold text-gray-900">€{queryOrder.total?.toFixed(2)}</span>
                </div>

                {queryOrder.payment_method && (
                  <div className="pt-2">
                    <p className="text-xs font-bold text-gray-500 uppercase mb-1">Forma de Pago</p>
                    <p className="text-sm text-gray-800">{queryOrder.payment_method}</p>
                  </div>
                )}

                {queryOrder.note && (
                  <div className="pt-2">
                    <p className="text-xs font-bold text-gray-500 uppercase mb-1">Nota</p>
                    <p className="text-sm text-gray-600 bg-yellow-50 p-2 rounded-lg">{queryOrder.note}</p>
                  </div>
                )}

                <button 
                  onClick={() => generateInvoice(queryOrder)} 
                  className="mt-4 w-full border-2 border-red-600 text-red-600 py-3 rounded-xl text-sm font-bold flex items-center justify-center gap-2 hover:bg-red-50 transition-colors"
                >
                  <Download size={18}/> Descargar Factura / Ticket
                </button>
              </div>
            </div>
          ) : (
            <div className="text-center py-20 bg-white rounded-2xl shadow-sm">
              <div className="w-20 h-20 bg-red-100 text-red-600 rounded-full mx-auto mb-4 flex items-center justify-center">
                <X size={32}/>
              </div>
              <p className="text-gray-600 font-medium mb-2">Pedido no encontrado</p>
              <p className="text-sm text-gray-400 mb-6">Verifica que el número de pedido sea correcto</p>
              <button 
                onClick={() => { setQueryOrderId(null); navTo("home"); }} 
                className="bg-red-600 text-white px-6 py-2 rounded-xl font-bold"
              >
                Volver al inicio
              </button>
            </div>
          )}
        </div>
      )}
      
      {/* --- FAVORITES / ORDERS --- */}
      {(page === "orders" || page === "favorites") && (
        <div className="p-4 min-h-screen bg-gray-50">
          <div className="flex items-center gap-2 mb-6 sticky top-0 bg-gray-50 z-10 py-2"><button onClick={handleBack} className="p-2 bg-white rounded-full shadow-sm text-gray-700"><ArrowLeft size={20}/></button><h2 className="font-bold text-xl text-gray-800">{page === "orders" ? "Mis Pedidos" : "Mis Favoritos"}</h2></div>
          {page === "favorites" ? (
             <div className="grid grid-cols-2 gap-3">{filteredProducts.length === 0 ? <div className="col-span-2 text-center py-20 text-gray-400">No tienes favoritos aún 💔</div> : filteredProducts.map(p => renderProductCard(p))}</div>
          ) : (
             !user ? (
               <div className="text-center py-20"><div className="w-20 h-20 bg-gray-200 rounded-full mx-auto mb-4 flex items-center justify-center text-gray-400"><User size={32}/></div><p className="text-gray-500 mb-6">Inicia sesión para ver tu historial</p><button onClick={() => navigate("/login")} className="bg-gray-900 text-white px-8 py-3 rounded-xl font-bold shadow-lg">Login</button></div>
            ) : (
              <div className="space-y-4">
                <div className="bg-white p-4 rounded-xl flex justify-between items-center mb-6 border border-gray-100 shadow-sm">
                   <div className="flex items-center gap-3"><div className="w-10 h-10 bg-red-100 text-red-600 rounded-full flex items-center justify-center font-bold">{user.email[0].toUpperCase()}</div><div className="flex flex-col"><span className="text-xs text-gray-400 uppercase font-bold">Cuenta</span><span className="font-bold text-gray-800 text-sm">{user.email.split('@')[0]}</span></div></div>
                   <button onClick={() => {supabase.auth.signOut(); navTo("home"); toast("Sesión cerrada");}} className="text-red-600 bg-red-50 p-2 rounded-lg"><LogOut size={18}/></button>
                </div>
                {myOrders.length === 0 ? <p className="text-center text-gray-400 py-10">No tienes pedidos aún.</p> : myOrders.map(order => (
                  <div key={order.id} className="bg-white p-5 rounded-2xl shadow-sm border border-gray-100">
                    <div className="flex justify-between items-start mb-3"><div><span className="font-bold text-gray-800 block text-xs font-mono bg-gray-100 px-2 py-1 rounded w-fit mb-1">#{order.id.slice(0,8)}</span><span className="text-xs text-gray-400">{new Date(order.created_at).toLocaleDateString()}</span></div><span className={`text-[10px] uppercase tracking-wider px-2 py-1 rounded-lg font-bold ${order.status==='Entregado'?'bg-green-100 text-green-700':'bg-blue-100 text-blue-700'}`}>{order.status}</span></div>
                    <div className="flex justify-between items-end border-t pt-3 border-gray-50"><span className="text-sm text-gray-500">{order.items?.length || 0} productos</span><span className="font-extrabold text-lg text-gray-900">€{order.total?.toFixed(2)}</span></div>
                    <button 
                      onClick={() => generateInvoice(order)} 
                      className="mt-4 w-full border border-gray-200 py-2 rounded-xl text-sm font-bold text-gray-600 flex items-center justify-center gap-2 hover:bg-gray-50 transition-colors"
                    >
                      <Download size={16}/> Descargar Factura / Ticket
                    </button>
                  </div>
                ))}
              </div>
            )
          )}
        </div>
      )}

{/* --- CART PAGE (已修改：商品与服务分组显示) --- */}
      {page === "cart" && (
        <div className="flex flex-col h-[calc(100vh-80px)]">
          {/* Header */}
          <div className="p-4 bg-white shadow-sm flex items-center gap-2">
            <button onClick={handleBack} className="p-2 hover:bg-gray-100 rounded-full"><ArrowLeft className="text-gray-600"/></button>
            <h2 className="font-bold text-lg">Mi Cesta ({cart.reduce((a,b)=>a+b.quantity,0)})</h2>
            {cart.length > 0 && <button onClick={() => setCart([])} className="ml-auto text-xs text-red-500 font-bold bg-red-50 px-2 py-1 rounded">Vaciar</button>}
          </div>

          {/* Body: 分组显示逻辑 */}
          <div className="flex-1 overflow-y-auto p-4">
            {cart.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-64 text-gray-400">
                <ShoppingCart size={64} className="mb-4 text-gray-200"/>
                <p className="font-medium">Tu cesta está vacía</p>
                <button onClick={() => navTo("home")} className="mt-6 bg-red-600 text-white px-8 py-3 rounded-xl font-bold shadow-lg shadow-red-200">Empezar a comprar</button>
              </div>
            ) : (
              <div className="space-y-6">
                {/* 1. 普通商品部分 */}
                {cart.filter(i => !i.isService).length > 0 && (
                   <div className="space-y-3">
                      {/* 如果同时有服务，加个小标题区分，否则不加 */}
                      {cart.some(i => i.isService) && <h3 className="font-bold text-gray-800 text-sm flex items-center gap-2"><Package size={16}/> Productos para envío</h3>}
                      
                      {cart.filter(i => !i.isService).map(item => (
                        <div key={`${item.id}-${item.name}`} className={`flex gap-3 p-3 rounded-2xl shadow-sm border ${item.isGift ? 'bg-pink-50 border-pink-200' : 'bg-white border-gray-100'}`}>
                           <img src={item.image} className="w-20 h-20 object-cover rounded-xl bg-gray-50"/>
                           <div className="flex-1 flex flex-col justify-between py-1">
                              <div>
                                <p className="font-bold text-gray-800 line-clamp-1">{item.name}</p>
                                {item.isGift ? (
                                  <p className="text-pink-600 font-extrabold text-sm">🎁 GRATIS</p>
                                ) : (
                                  <p className="text-red-600 font-extrabold">€{item.price}</p>
                                )}
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
                      ))}
                   </div>
                )}

                {/* 分隔线 (只有当两种都有时才显示) */}
                {cart.some(i => !i.isService) && cart.some(i => i.isService) && (
                  <div className="border-t-2 border-dashed border-gray-200 my-4 relative">
                     <div className="absolute left-1/2 -translate-x-1/2 -top-3 bg-gray-50 px-2 text-xs text-gray-400 font-bold uppercase">Y</div>
                  </div>
                )}

                {/* 2. 维修服务部分 (强制在最下面) */}
                {cart.filter(i => i.isService).length > 0 && (
                   <div className="space-y-3">
                      <h3 className="font-bold text-gray-800 text-sm flex items-center gap-2"><Wrench size={16}/> Servicios de Taller</h3>
                      {cart.filter(i => i.isService).map(item => (
                        <div key={`${item.id}-${item.name}`} className="flex gap-3 bg-gray-800 p-3 rounded-2xl shadow-lg border border-gray-700 text-white relative overflow-hidden">
                           <div className="absolute right-0 top-0 w-20 h-20 bg-blue-500 blur-[40px] opacity-20"></div>
                           <div className="w-20 h-20 bg-gray-700 rounded-xl flex items-center justify-center text-gray-400 flex-shrink-0"><Wrench size={24}/></div>
                           <div className="flex-1 flex flex-col justify-between py-1 relative z-10">
                              <div><p className="font-bold text-gray-100 line-clamp-1">{item.name}</p><p className="text-blue-400 font-extrabold">€{item.price}</p></div>
                              <div className="flex items-center justify-between">
                                 <div className="flex items-center gap-3 bg-gray-700 rounded-lg p-1">
                                    <button onClick={() => updateQty(item.id, item.name, -1)} className="w-7 h-7 bg-gray-600 rounded shadow-sm flex items-center justify-center text-gray-300 active:scale-90 transition-transform"><Minus size={14}/></button>
                                    <span className="text-sm font-bold w-4 text-center">{item.quantity}</span>
                                    <button onClick={() => updateQty(item.id, item.name, 1)} className="w-7 h-7 bg-white text-gray-900 rounded shadow-sm flex items-center justify-center active:scale-90 transition-transform"><Plus size={14}/></button>
                                 </div>
                                 <button onClick={() => removeFromCart(item.id, item.name)} className="text-gray-500 hover:text-red-400 p-2"><Trash2 size={18}/></button>
                              </div>
                           </div>
                        </div>
                      ))}
                   </div>
                )}
              </div>
            )}
          </div>

          {/* Footer 结算区域 */}
          {cart.length > 0 && (
            <div className="bg-white p-5 shadow-[0_-4px_30px_rgba(0,0,0,0.05)] rounded-t-3xl z-20">
               <div className="space-y-2 mb-6">
                  {!isFreeShipping && (
                    <div className="text-xs text-gray-600 bg-blue-50 p-2 rounded-lg flex items-center gap-2">
                      <div className="flex-1">
                        Faltan <span className="font-bold text-blue-600">€{(50 - subtotal).toFixed(2)}</span> para envío GRATIS
                        <div className="h-1.5 w-full bg-blue-100 rounded-full mt-1 overflow-hidden">
                          <div className="h-full bg-blue-500 rounded-full transition-all duration-500" style={{width: `${Math.min((subtotal/50)*100, 100)}%`}}></div>
                        </div>
                      </div>
                      <Truck size={16} className="text-blue-400"/>
                    </div>
                  )}
                  
                  {/* 达到免运费后，显示免费商品进度条 */}
                  {isFreeShipping && !isGiftEligible && (
                    <>
                      <div className="text-xs bg-green-50 text-green-700 p-2 rounded-lg font-bold flex items-center gap-2">
                        <Truck size={14}/> ¡Envío GRATIS activado!
                      </div>
                      <div className="text-xs text-gray-600 bg-pink-50 p-2 rounded-lg flex items-center gap-2 border border-pink-200">
                        <div className="flex-1">
                          Faltan <span className="font-bold text-pink-600">€{(65 - subtotal).toFixed(2)}</span> para elegir un regalo GRATIS
                          <div className="h-1.5 w-full bg-pink-100 rounded-full mt-1 overflow-hidden">
                            <div 
                              className="h-full bg-pink-500 rounded-full transition-all duration-500" 
                              style={{width: `${Math.min(((subtotal - 50) / 15) * 100, 100)}%`}}
                            ></div>
                          </div>
                        </div>
                        <Gift size={16} className="text-pink-400 flex-shrink-0"/>
                      </div>
                    </>
                  )}
                  
                  {isFreeShipping && isGiftEligible && (
                    <>
                      <div className="text-xs bg-green-50 text-green-700 p-2 rounded-lg font-bold flex items-center gap-2">
                        <Truck size={14}/> ¡Envío GRATIS activado!
                      </div>
                      <div className="text-xs bg-pink-50 text-pink-700 p-2 rounded-lg font-bold flex items-center gap-2 border border-pink-300">
                        <Gift size={14}/> ¡Puedes elegir un regalo GRATIS en el checkout!
                      </div>
                    </>
                  )}
               </div>
               <div className="space-y-1 text-sm text-gray-500 mb-6"><div className="flex justify-between"><span>Subtotal</span><span>€{subtotal.toFixed(2)}</span></div><div className="flex justify-between"><span>Envío</span><span className={shippingFee === 0 ? "text-green-600 font-bold" : ""}>{shippingFee === 0 ? "GRATIS" : `€${shippingFee.toFixed(2)}`}</span></div><div className="flex justify-between font-extrabold text-xl text-gray-900 pt-3 border-t border-dashed"><span>Total</span><span>€{total.toFixed(2)}</span></div></div>
               {minOrderMet ? (
                 <button onClick={() => navTo("checkout")} className="w-full bg-gray-900 text-white py-4 rounded-xl font-bold text-lg shadow-xl shadow-gray-300 flex items-center justify-center gap-2 active:scale-95 transition-transform">Tramitar Pedido <ArrowRight size={20}/></button>
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
          <div className="flex items-center gap-2 mb-6"><button onClick={handleBack} className="p-2 bg-white rounded-full shadow-sm"><ArrowLeft size={20}/></button><h2 className="font-bold text-xl">Finalizar Compra</h2></div>
          <div className="space-y-6">
             {/* 免费商品选择 - 当订单 >= 65 欧元时显示 */}
             {subtotal >= 65 && (
               <div className="bg-gradient-to-br from-red-50 to-pink-50 p-5 rounded-2xl shadow-sm border-2 border-red-200">
                 <div className="flex items-center gap-2 mb-3">
                   <Gift size={20} className="text-red-600"/>
                   <h3 className="font-bold text-gray-800">¡Elige un regalo gratis!</h3>
                 </div>
                 <p className="text-sm text-gray-600 mb-4">Tu pedido supera €65. Puedes elegir un producto gratis:</p>
                 {selectedGift ? (
                   <div className="bg-white p-4 rounded-xl border-2 border-red-500 flex items-center justify-between">
                     <div className="flex items-center gap-3 flex-1">
                       <img src={selectedGift.image} alt={selectedGift.name} className="w-16 h-16 object-cover rounded-lg"/>
                       <div className="flex-1">
                         <p className="font-bold text-gray-800 text-sm">{selectedGift.name}</p>
                         <p className="text-xs text-red-600 font-bold">GRATIS</p>
                       </div>
                     </div>
                     <button 
                       onClick={() => setSelectedGift(null)}
                       className="text-gray-400 hover:text-red-600 p-2"
                       title="Cambiar regalo"
                     >
                       <X size={18}/>
                     </button>
                   </div>
                 ) : (
                   <div className="grid grid-cols-2 gap-3 max-h-64 overflow-y-auto">
                     {(() => {
                       const giftProducts = products.filter(p => p.giftProduct && p.stock > 0);
                       console.log('免费商品列表:', giftProducts.length, '个产品');
                       console.log('所有产品数量:', products.length);
                       console.log('标记为免费商品的产品:', products.filter(p => p.giftProduct));
                       
                       return giftProducts.length > 0 ? (
                         giftProducts.map(p => (
                           <button
                             key={p.id}
                             onClick={() => setSelectedGift(p)}
                             className="bg-white p-3 rounded-xl border-2 border-gray-200 hover:border-red-500 transition-all text-left active:scale-95"
                           >
                             <img src={p.image} alt={p.name} className="w-full h-20 object-cover rounded-lg mb-2"/>
                             <p className="text-xs font-bold text-gray-800 line-clamp-2 mb-1">{p.name}</p>
                             <p className="text-xs text-red-600 font-bold">GRATIS</p>
                           </button>
                         ))
                       ) : (
                         <div className="col-span-2 text-center py-4 text-gray-400 text-sm space-y-2">
                           <p>No hay productos de regalo disponibles</p>
                           <p className="text-xs text-gray-500">提示：需要在后台将产品标记为"Producto de Regalo"</p>
                         </div>
                       );
                     })()}
                   </div>
                 )}
               </div>
             )}

             <div className="bg-white p-5 rounded-2xl shadow-sm space-y-4 border border-gray-100">
                <h3 className="font-bold flex items-center gap-2 text-gray-800"><MapPin size={18} className="text-red-600"/> Datos de entrega</h3>
                <input id="address" name="address" value={checkoutForm.address} onChange={e => setCheckoutForm({...checkoutForm, address: e.target.value})} placeholder="Dirección completa *" className="w-full p-3.5 bg-gray-50 rounded-xl font-medium outline-none focus:ring-2 ring-red-100 transition-all"/>
                <input id="phone" name="phone" type="tel" value={checkoutForm.phone} onChange={e => setCheckoutForm({...checkoutForm, phone: e.target.value})} placeholder="Teléfono *" className="w-full p-3.5 bg-gray-50 rounded-xl font-medium outline-none focus:ring-2 ring-red-100 transition-all"/>
                <textarea id="note" name="note" value={checkoutForm.note} onChange={e => setCheckoutForm({...checkoutForm, note: e.target.value})} placeholder="Nota para repartidor (Opcional)" className="w-full p-3.5 bg-gray-50 rounded-xl font-medium outline-none focus:ring-2 ring-red-100 transition-all" rows={2}/>
             </div>
             {/* 按钮修改：现在是打开支付弹窗 */}
             <button disabled={!checkoutForm.address || !checkoutForm.phone} onClick={handleInitiateCheckout} className="w-full bg-red-600 text-white py-4 rounded-xl font-bold text-lg shadow-xl shadow-red-200 disabled:opacity-50 disabled:shadow-none active:scale-95 transition-transform flex justify-center items-center gap-2">
               Continuar al Pago <Wallet size={20}/>
             </button>
          </div>
        </div>
      )}

      {/* --- PRODUCT LIST PAGES --- */}
      {(page === "offers" || page === "products" || page === "sub" || page === "main") && (
        <div className="p-4 min-h-screen">
          <div className="flex items-center gap-2 mb-4 sticky top-20 z-30 bg-gray-50/90 backdrop-blur-sm py-2">
            <button onClick={handleBack} className="w-8 h-8 bg-white rounded-full shadow-sm flex items-center justify-center text-gray-700 active:scale-90 transition-transform"><ArrowLeft size={18}/></button>
            <h2 className="font-bold text-lg text-gray-800">{page === "offers" && "Todas las Ofertas"}{page === "main" && "Categorías"}{page === "sub" && mainCat?.name}{page === "products" && subCat?.name}</h2>
          </div>
          {page === "main" ? (
             <div className="grid grid-cols-2 gap-3">{categories.map(c => <button key={c.id} className="bg-white p-4 rounded-xl shadow-sm text-left flex flex-col justify-between h-24 border-l-4 border-red-500 active:scale-95 transition-transform" onClick={() => {setMainCat(c); setSubCat(null); navTo("sub");}}><span className="font-bold text-lg text-gray-800">{c.name}</span><ChevronRight size={18} className="text-gray-300 self-end"/></button>)}</div>
          ) : page === "sub" ? (
             <div className="space-y-6">
               {/* 子类别选项 - 固定在顶部 */}
               <div className="sticky top-20 z-20 bg-gray-50/95 backdrop-blur-sm -mx-4 px-4 pt-2 pb-4 border-b border-gray-200">
                 <h3 className="text-sm font-bold text-gray-500 mb-3 uppercase">Subcategorías</h3>
                 <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide snap-x snap-mandatory -mx-1 px-1">
                   {subCategories.filter(s => s.parent_id === mainCat?.id).map(s => (
                     <button 
                       key={s.id} 
                       className={`px-4 py-2 rounded-xl font-medium text-sm whitespace-nowrap snap-start flex-shrink-0 transition-all ${
                         subCat?.id === s.id 
                           ? 'bg-red-600 text-white shadow-md' 
                           : 'bg-white text-gray-700 hover:bg-gray-100'
                       }`}
                       onClick={() => {
                         if (subCat?.id === s.id) {
                           setSubCat(null); // 取消选择
                         } else {
                           setSubCat(s); // 选择子类别
                         }
                       }}
                     >
                       {s.name}
                     </button>
                   ))}
                 </div>
               </div>
               {/* 商品列表 - 显示这个大类别下的所有商品 */}
               <div>
                 <h3 className="text-sm font-bold text-gray-500 mb-3 uppercase">
                   {subCat ? `Productos: ${subCat.name}` : 'Todos los productos'}
                 </h3>
                 <div className="grid grid-cols-2 gap-3">
                   {loading ? (
                     <div className="col-span-2 text-center py-20">
                       <Loader2 className="animate-spin mx-auto mb-2 text-red-500"/>Cargando...
                     </div>
                   ) : (
                     products.filter(p => {
                       const mainMatch = mainCat ? p.category === mainCat.id : true;
                       const subMatch = subCat ? p.subCategoryId === subCat.id : true;
                       const searchMatch = p.name?.toLowerCase().includes(searchQuery.toLowerCase());
                       return mainMatch && subMatch && searchMatch;
                     }).map(p => renderProductCard(p))
                   )}
                 </div>
               </div>
             </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">{loading ? <div className="col-span-2 text-center py-20"><Loader2 className="animate-spin mx-auto mb-2 text-red-500"/>Cargando...</div> : products.filter(p => { const mainMatch = mainCat ? p.category === mainCat.id : true; const subMatch = subCat ? p.subCategoryId === subCat.id : true; const searchMatch = p.name?.toLowerCase().includes(searchQuery.toLowerCase()); return mainMatch && subMatch && searchMatch && (page === "offers" ? p.oferta : true); }).map(p => renderProductCard(p))}</div>
          )}
        </div>
      )}

{/* --- DETAIL PAGE (已修正：显示真实描述) --- */}
      {page === "detail" && selectedProduct && (
        <div className="bg-white min-h-screen pb-24">
          {/* 顶部大图 */}
          <div className="relative h-[45vh]">
            <img src={selectedProduct.image} className="w-full h-full object-cover" />
            <div className="absolute inset-0 bg-gradient-to-b from-black/30 to-transparent h-24"></div>
            <button onClick={handleBack} className="absolute top-4 left-4 w-10 h-10 bg-white/20 backdrop-blur-md rounded-full flex items-center justify-center text-white active:bg-white/40"><ArrowLeft size={24}/></button>
          </div>
          
          {/* 内容卡片 */}
          <div className="p-6 -mt-10 bg-white rounded-t-[2.5rem] relative z-10 min-h-[50vh] shadow-[0_-10px_40px_rgba(0,0,0,0.1)]">
             <div className="w-12 h-1.5 bg-gray-200 rounded-full mx-auto mb-8"></div>
             
             {/* 标题和价格 */}
             <div className="flex justify-between items-start mb-2">
               <h2 className="text-2xl font-extrabold text-gray-900 w-3/4 leading-tight">{selectedProduct.name}</h2>
               <div className="text-right"><p className="text-3xl font-extrabold text-red-600">€{selectedProduct.price.toFixed(2)}</p></div>
             </div>
             
             {/* 标签 */}
             <div className="flex gap-2 mb-6">
               {selectedProduct.stock > 0 ? <span className="text-[10px] uppercase bg-green-100 text-green-700 px-2 py-1 rounded-lg font-bold">En Stock: {selectedProduct.stock}</span> : <span className="text-[10px] uppercase bg-red-100 text-red-700 px-2 py-1 rounded-lg font-bold">Agotado</span>}
               {selectedProduct.oferta && <span className="text-[10px] uppercase bg-red-100 text-red-600 px-2 py-1 rounded-lg font-bold">Oferta</span>}
             </div>
             
             {/* 👇👇👇 这里是关键修改：描述区域 👇👇👇 */}
             <div className="bg-gray-50 p-5 rounded-2xl mb-6">
               <h4 className="font-bold text-gray-800 text-sm mb-2">Descripción</h4>
               <p className="text-gray-500 text-sm leading-relaxed whitespace-pre-line">
                 {/* 如果数据库有描述，显示数据库的；如果没有，显示默认的废话 */}
                 {selectedProduct.description || "Producto seleccionado por su calidad y frescura. Ideal para el consumo diario de toda la familia."}
               </p>
             </div>
             {/* 👆👆👆 修改结束 👆👆👆 */}

             {/* 推荐商品 - 手机端缩小卡片 */}
             <div className="mb-8">
               <h4 className="font-bold text-gray-800 text-sm mb-3">Quizás te interese</h4>
               <div className="flex gap-2 md:gap-3 overflow-x-auto pb-4 -mx-1 px-1 scrollbar-hide snap-x snap-mandatory">
                 {products.filter(p => p.category === selectedProduct.category && p.id !== selectedProduct.id).slice(0, 4).map(p => (
                   <div key={p.id} onClick={() => {setSelectedProduct(p); window.scrollTo(0,0);}} className="min-w-[100px] sm:min-w-[120px] md:min-w-[140px] w-[100px] sm:w-[120px] md:w-[140px] flex-shrink-0 snap-start bg-gray-50 p-1.5 md:p-2 rounded-xl border border-gray-100 cursor-pointer active:scale-95 transition-transform">
                     <img src={p.image} alt={p.name} className="w-full aspect-square object-cover rounded-lg mb-1.5 md:mb-2"/>
                     <p className="text-[11px] md:text-xs font-bold text-gray-700 truncate">{p.name}</p>
                     <p className="text-[11px] md:text-xs font-bold text-red-600">€{p.price}</p>
                   </div>
                 ))}
               </div>
             </div>
          </div>
          
          {/* 底部加购栏 */}
          <div className="fixed bottom-0 left-0 right-0 p-4 bg-white border-t border-gray-100 z-20">
            <button onClick={() => { addToCart(selectedProduct); handleBack(); }} disabled={selectedProduct.stock <= 0} className="w-full bg-gray-900 text-white py-4 rounded-2xl font-bold text-lg shadow-xl shadow-gray-300 disabled:bg-gray-300 disabled:shadow-none active:scale-95 transition-transform flex justify-center items-center gap-2">
              {selectedProduct.stock > 0 ? <><Plus size={20}/> Añadir a la cesta</> : "Agotado"}
            </button>
          </div>
        </div>
      )}
      
      {/* --- FOOTER --- */}
      {page === "home" && (
        <footer className="bg-white mt-10 p-8 border-t border-gray-100 text-center">
          <div className="w-10 h-10 bg-gray-900 rounded-xl flex items-center justify-center text-white font-bold mx-auto mb-4 shadow-lg">H</div>
          <h3 className="font-bold text-gray-900 mb-1">HIPERA</h3>
          <p className="text-gray-400 text-xs mb-6">Tu mercado de confianza desde 2024</p>
          <div className="mb-8 space-y-2 border-b border-gray-50 pb-6 mx-auto max-w-xs">
             <div className="flex items-center justify-center gap-2 text-xs font-medium text-gray-600">
                <MapPin size={14} className="text-red-600"/>
                <span>Paseo del Sol 1, 28880 Meco</span>
             </div>
             <div className="flex items-center justify-center gap-2 text-xs font-medium text-gray-600">
                <Clock size={14} className="text-red-600"/>
                <span>Lunes a Domingo: 9:00 - 22:00</span>
             </div>
          </div>

          {/* 新增的法律链接区 */}
          <div className="flex flex-wrap justify-center gap-4 text-xs font-bold text-gray-400">
             <button onClick={() => { setLegalType("aviso"); navTo("legal"); }} className="hover:text-gray-900 transition-colors">Aviso Legal</button>
             <button onClick={() => { setLegalType("privacidad"); navTo("legal"); }} className="hover:text-gray-900 transition-colors">Privacidad</button>
             <button onClick={() => { setLegalType("cookies"); navTo("legal"); }} className="hover:text-gray-900 transition-colors">Cookies</button>
             <button onClick={() => { setLegalType("devoluciones"); navTo("legal"); }} className="hover:text-gray-900 transition-colors">Devoluciones</button>
          </div>
          
          <p className="text-[10px] text-gray-300 mt-6">© {new Date().getFullYear()} QIANG GUO SL. Todos los derechos reservados.</p>
        </footer>
      )}
    </div>
  );
}