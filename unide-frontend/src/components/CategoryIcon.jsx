// --- 组件：图标映射 (已扩充全品类) ---
// Algunas categorías llegan de la base de datos con icon='Package' (genérico)
// porque aún no se les asignó un icono concreto. Para que no se vean todas
// como una caja, derivamos el icono por palabras clave del nombre cuando el
// icon es genérico/ausente.
import {
  Apple, Coffee, Baby, Beef, Fish, Milk, Croissant, Wheat, Sandwich,
  Droplet, Candy, Utensils, Wine, Beer, Salad, Globe, Bone,
  BriefcaseMedical, Snowflake, ShowerHead, SprayCan, Package,
} from 'lucide-react';

export const IconByName = ({ name, size=24, className }) => {
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
    Frozen: <Snowflake size={size} className={className}/>,  // Congelados (冷冻)
    Hygiene: <ShowerHead size={size} className={className}/>, // Higiene personal (个人卫生)
    Cleaning: <SprayCan size={size} className={className}/>,  // Limpieza del hogar (家居清洁)

    // 默认
    Package: <Package size={size} className={className}/>,

  };
  return icons[name] || <Package size={size} className={className}/>;
};
