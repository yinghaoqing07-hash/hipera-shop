import React, { useMemo, useState } from 'react';

type Coin = {
  id: string;
  label: string;
  value: number;
  weight: number;
};

const COINS: Coin[] = [
  { id: 'eur2', label: '2€', value: 2, weight: 8.5 },
  { id: 'eur1', label: '1€', value: 1, weight: 7.5 },
  { id: 'cent50', label: '50c', value: 0.5, weight: 7.8 },
  { id: 'cent20', label: '20c', value: 0.2, weight: 5.74 },
  { id: 'cent10', label: '10c', value: 0.1, weight: 4.1 },
  { id: 'cent5', label: '5c', value: 0.05, weight: 3.92 },
  { id: 'cent2', label: '2c', value: 0.02, weight: 3.06 },
  { id: 'cent1', label: '1c', value: 0.01, weight: 2.3 },
];

function parseWeight(value: string): number {
  const normalized = value.trim().replace(',', '.');
  if (!normalized) return 0;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function formatMoney(value: number): string {
  return `${value.toLocaleString('es-ES', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}€`;
}

export default function CoinCounter() {
  const [weights, setWeights] = useState<Record<string, string>>({});

  const rows = useMemo(() => COINS.map((coin) => {
    const grams = parseWeight(weights[coin.id] || '');
    const count = grams > 0 ? Math.round(grams / coin.weight) : 0;
    const amount = count * coin.value;
    return {
      ...coin,
      grams,
      count,
      amount,
      lowWeight: grams > 0 && grams < 40,
    };
  }), [weights]);

  const totals = useMemo(() => rows.reduce(
    (acc, row) => ({
      count: acc.count + row.count,
      amount: acc.amount + row.amount,
    }),
    { count: 0, amount: 0 }
  ), [rows]);

  const hasInput = Object.values(weights).some((value) => value.trim() !== '');

  return (
    <section className="max-w-6xl mx-auto">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between mb-5">
        <div>
          <p className="text-sm font-bold text-gray-500 uppercase tracking-wide">Caja</p>
          <h1 className="text-3xl font-black text-gray-900">Contador de monedas</h1>
          <p className="text-sm text-gray-500 mt-1">Introduce el peso por denominación y el importe se calcula al momento.</p>
        </div>
        <button
          type="button"
          onClick={() => setWeights({})}
          disabled={!hasInput}
          className="w-full sm:w-auto px-5 py-3 rounded-xl bg-gray-900 text-white font-bold hover:bg-gray-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          Limpiar
        </button>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
        <div className="hidden md:grid grid-cols-[1fr_1fr_1.4fr_1fr_1fr] gap-4 px-5 py-3 bg-gray-50 border-b border-gray-200 text-xs font-black text-gray-500 uppercase tracking-wide">
          <span>Moneda</span>
          <span>Peso unitario</span>
          <span>Peso total</span>
          <span>Monedas</span>
          <span className="text-right">Importe</span>
        </div>

        <div className="divide-y divide-gray-100">
          {rows.map((row) => (
            <div key={row.id} className="grid grid-cols-1 md:grid-cols-[1fr_1fr_1.4fr_1fr_1fr] gap-3 md:gap-4 px-4 md:px-5 py-4 md:items-center">
              <div className="flex items-center justify-between md:block">
                <span className="text-xs font-bold text-gray-500 md:hidden">Moneda</span>
                <span className="text-2xl font-black text-gray-900">{row.label}</span>
              </div>

              <div className="flex items-center justify-between md:block">
                <span className="text-xs font-bold text-gray-500 md:hidden">Peso unitario</span>
                <span className="text-sm font-bold text-gray-700">{row.weight.toFixed(2)}g</span>
              </div>

              <div>
                <label htmlFor={`coin-${row.id}`} className="sr-only">{row.label} peso en gramos</label>
                <div className="relative">
                  <input
                    id={`coin-${row.id}`}
                    inputMode="decimal"
                    value={weights[row.id] || ''}
                    onChange={(event) => setWeights((prev) => ({ ...prev, [row.id]: event.target.value }))}
                    placeholder="0"
                    className="w-full h-14 rounded-xl border border-gray-300 bg-white px-4 pr-12 text-xl font-black text-gray-900 outline-none focus:border-gray-900 focus:ring-2 focus:ring-gray-900/10"
                  />
                  <span className="absolute right-4 top-1/2 -translate-y-1/2 text-sm font-bold text-gray-400">g</span>
                </div>
                {row.lowWeight && (
                  <p className="mt-1.5 text-xs font-semibold text-amber-700">
                    La báscula puede ser menos precisa por debajo de 40g.
                  </p>
                )}
              </div>

              <div className="flex items-center justify-between md:block">
                <span className="text-xs font-bold text-gray-500 md:hidden">Monedas</span>
                <span className="text-xl font-black text-gray-900">{row.count}</span>
              </div>

              <div className="flex items-center justify-between md:block md:text-right">
                <span className="text-xs font-bold text-gray-500 md:hidden">Importe</span>
                <span className="text-2xl font-black text-red-600">{formatMoney(row.amount)}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="rounded-xl bg-gray-900 text-white p-5">
          <p className="text-sm font-bold text-gray-300">Total monedas</p>
          <p className="text-4xl font-black mt-1">{totals.count}</p>
        </div>
        <div className="rounded-xl bg-red-600 text-white p-5">
          <p className="text-sm font-bold text-red-100">Total importe</p>
          <p className="text-4xl font-black mt-1">{formatMoney(totals.amount)}</p>
        </div>
      </div>
    </section>
  );
}
