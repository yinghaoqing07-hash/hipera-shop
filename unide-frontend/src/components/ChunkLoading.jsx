export default function ChunkLoading({ label = 'Cargando…' }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="flex flex-col items-center gap-3 text-gray-500">
        <div className="w-8 h-8 border-4 border-gray-200 border-t-gray-600 rounded-full animate-spin" aria-hidden="true" />
        <span className="text-sm">{label}</span>
      </div>
    </div>
  );
}
