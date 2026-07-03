// Resolución del icono de una categoría por palabras clave del nombre
// cuando la BD trae icon='Package' (genérico) o vacío.
const ICON_BY_KEYWORD = [
  { match: /congelad/i, icon: 'Frozen' },     // Congelados
  { match: /higiene/i, icon: 'Hygiene' },     // Higiene personal
  { match: /limpieza/i, icon: 'Cleaning' },   // Limpieza del hogar
];

export const resolveCategoryIcon = (c) => {
  if (c?.icon && c.icon !== 'Package') return c.icon;
  const found = ICON_BY_KEYWORD.find(k => k.match.test(c?.name || ''));
  return found ? found.icon : (c?.icon || 'Package');
};
