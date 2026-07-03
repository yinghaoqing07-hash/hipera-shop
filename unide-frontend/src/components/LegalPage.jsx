// --- 组件：法律页面 (已更新真实地址) ---
// Envuelve las páginas legales (src/pages/legal/*) con la cabecera común
// y el botón de volver a la tienda.
import {
  ArrowLeft, Info, ShieldCheck, Cookie, RotateCcw, Truck, ClipboardList,
} from 'lucide-react';
import TerminosCondiciones from '../pages/legal/TerminosCondiciones';
import PoliticaPrivacidad from '../pages/legal/PoliticaPrivacidad';
import PoliticaDevoluciones from '../pages/legal/PoliticaDevoluciones';
import PoliticaEnvios from '../pages/legal/PoliticaEnvios';
import PoliticaCookies from '../pages/legal/PoliticaCookies';
import AvisoLegal from '../pages/legal/AvisoLegal';

const LegalPage = ({ type, onBack }) => {
  const content = {
    aviso: {
      title: "Aviso Legal",
      icon: <Info/>,
      text: null // 渲染外部组件 AvisoLegal
    },
    privacidad: {
      title: "Política de Privacidad",
      icon: <ShieldCheck/>,
      text: null // 渲染外部组件 PoliticaPrivacidad
    },
    cookies: {
      title: "Política de Cookies",
      icon: <Cookie/>,
      text: null // 渲染外部组件 PoliticaCookies (v1.0, 2026-05-27)
    },
    devoluciones: {
      title: "Política de Devoluciones y Reembolsos",
      icon: <RotateCcw/>,
      text: null // 使用自定义内容
    },
    envios: {
      title: "Política de Envíos",
      icon: <Truck/>,
      text: null // 渲染外部组件 PoliticaEnvios
    },
    terminos: {
      title: "Términos y Condiciones",
      icon: <ClipboardList/>,
      text: null // 渲染外部组件 TerminosCondiciones
    }
  };
  const data = content[type] || content.aviso;

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
               <PoliticaDevoluciones />
             ) : type === 'envios' ? (
               <PoliticaEnvios />
             ) : type === 'terminos' ? (
               <TerminosCondiciones />
             ) : type === 'privacidad' ? (
               <PoliticaPrivacidad />
             ) : type === 'cookies' ? (
               <PoliticaCookies />
             ) : type === 'aviso' ? (
               <AvisoLegal />
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
          </div>
       </div>
    </div>
  );
};

export default LegalPage;
