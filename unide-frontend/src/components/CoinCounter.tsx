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
  const n = Number(value.trim().replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? n : 0;
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
    return {
      ...coin,
      grams,
      count,
      amount: count * coin.value,
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

  const clear = () => setWeights({});

  return (
    <section className="max-w-7xl mx-auto">
      <div className="flex items-center justify-between gap-3 mb-4">
        <div>
          <p className="text-sm font-bold text-gray-500">Caja</p>
          <h1 className="text-2xl sm:text-3xl font-black text-gray-900">Contador de monedas</h1>
        </div>
        <button
          type="button"
          onClick={clear}
          className="px-4 py-2.5 rounded-xl bg-gray-900 text-white text-sm font-bold hover:bg-gray-800"
        >
          Limpiar
        </button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-8 gap-3">
        {rows.map((row) => (
          <div key={row.id} className="bg-white border border-gray-200 rounded-xl p-3 shadow-sm">
            <div className="flex items-start justify-between gap-2 mb-2">
              <div className="text-3xl font-black text-gray-900">{row.label}</div>
              <div className="text-[11px] font-bold text-gray-400 mt-1">{row.weight.toFixed(2)}g</div>
            </div>

            <label htmlFor={`coin-${row.id}`} className="block text-xs font-bold text-gray-500 mb-1">
              Peso
            </label>
            <div className="relative">
              <input
                id={`coin-${row.id}`}
                inputMode="decimal"
                value={weights[row.id] || ''}
                onChange={(event) => setWeights((prev) => ({ ...prev, [row.id]: event.target.value }))}
                placeholder="0"
                className="w-full h-14 rounded-xl border border-gray-300 px-3 pr-9 text-xl font-black text-gray-900 outline-none focus:border-gray-900 focus:ring-2 focus:ring-gray-900/10"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm font-bold text-gray-400">g</span>
            </div>

            <div className="mt-3 rounded-lg bg-gray-50 px-3 py-2">
              <div className="text-xs font-bold text-gray-500">Monedas</div>
              <div className="text-3xl font-black text-red-600 leading-tight">{row.count}</div>
            </div>

            {row.lowWeight && (
              <p className="mt-2 text-[11px] font-semibold text-amber-700">
                La báscula puede ser menos precisa por debajo de 40g.
              </p>
            )}
          </div>
        ))}
      </div>

      <div className="mt-4 flex flex-col sm:flex-row gap-3">
        <div className="flex-1 rounded-xl bg-gray-900 text-white px-5 py-4">
          <div className="text-sm font-bold text-gray-300">Total monedas</div>
          <div className="text-3xl font-black">{totals.count}</div>
        </div>
        <div className="flex-1 rounded-xl bg-red-600 text-white px-5 py-4">
          <div className="text-sm font-bold text-red-100">Total importe</div>
          <div className="text-3xl font-black">{formatMoney(totals.amount)}</div>
        </div>
      </div>
    </section>
  );
}
