// Placeholder de carga de tarjeta de producto (pulse skeleton).
const ProductSkeleton = () => (
  <div className="bg-white p-3 rounded-xl shadow-sm border border-gray-100 animate-pulse">
    <div className="w-full aspect-square bg-gray-200 rounded-lg mb-2"></div>
    <div className="h-4 bg-gray-200 rounded w-3/4 mb-2"></div>
    <div className="h-6 bg-gray-200 rounded w-1/2"></div>
  </div>
);

export default ProductSkeleton;
