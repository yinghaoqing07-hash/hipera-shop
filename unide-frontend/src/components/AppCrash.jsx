export default function AppCrash({ resetError }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-6">
      <div className="max-w-md bg-white border border-gray-200 rounded-2xl shadow-sm p-6 text-center space-y-4">
        <h1 className="text-xl font-bold text-gray-900">Algo ha fallado</h1>
        <p className="text-sm text-gray-600">
          Ha ocurrido un error inesperado al cargar la página. Vuelve a
          intentarlo; si el problema continúa, recarga la web.
        </p>
        <div className="flex gap-2 justify-center pt-2">
          <button
            type="button"
            onClick={() => { resetError?.(); window.location.reload(); }}
            className="px-4 py-2 rounded-lg bg-red-600 text-white text-sm font-medium hover:bg-red-700 transition-colors"
          >
            Recargar
          </button>
          <a
            href="/"
            className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 text-sm font-medium hover:bg-gray-50 transition-colors"
          >
            Ir al inicio
          </a>
        </div>
      </div>
    </div>
  );
}
