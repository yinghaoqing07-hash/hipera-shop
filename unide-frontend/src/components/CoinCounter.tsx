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
  const parsed = Number(value.trim().replace(',', '.'));
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
    const peso = parseWeight(weights[coin.id] || '');
    const monedas = peso > 0 ? Math.round(peso / coin.weight) : 0;
    return {
      ...coin,
      monedas,
      importe: monedas * coin.value,
    };
  }), [weights]);

  const totals = useMemo(() => rows.reduce(
    (acc, row) => ({
      monedas: acc.monedas + row.monedas,
      efectivo: acc.efectivo + row.importe,
    }),
    { monedas: 0, efectivo: 0 }
  ), [rows]);

  return (
    <section className="max-w-3xl mx-auto text-gray-900">
      <div className="flex items-center justify-between gap-3 mb-3">
        <h1 className="text-2xl font-black">Contador monedas</h1>
        <button
          type="button"
          onClick={() => setWeights({})}
          className="px-3 py-2 rounded border border-gray-300 bg-white text-sm font-bold hover:bg-gray-50"
        >
          Limpiar
        </button>
      </div>

      <div className="overflow-hidden rounded-lg border border-gray-300 bg-white">
        <table className="w-full table-fixed border-collapse text-sm">
          <thead className="bg-gray-50 border-b border-gray-300">
            <tr className="text-left">
              <th className="w-[30%] px-2 py-2 font-black">Moneda</th>
              <th className="w-[28%] px-2 py-2 font-black">Peso g</th>
              <th className="w-[20%] px-2 py-2 text-right font-black">Monedas</th>
              <th className="w-[22%] px-2 py-2 text-right font-black">Importe</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-b border-gray-200 last:border-b-0">
                <td className="px-2 py-2 align-middle">
                  <div className="font-black leading-tight">{row.label}</div>
                  <div className="text-xs text-gray-500">{row.weight.toFixed(2)}g</div>
                </td>
                <td className="px-2 py-2 align-middle">
                  <input
                    inputMode="decimal"
                    value={weights[row.id] || ''}
                    onChange={(event) => setWeights((prev) => ({ ...prev, [row.id]: event.target.value }))}
                    className="w-full h-10 rounded border border-gray-300 px-2 text-base font-bold outline-none focus:border-gray-900"
                    placeholder="0"
                    aria-label={`${row.label} peso en gramos`}
                  />
                </td>
                <td className="px-2 py-2 align-middle text-right text-lg font-black">
                  {row.monedas}
                </td>
                <td className="px-2 py-2 align-middle text-right font-bold">
                  {formatMoney(row.importe)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="sticky bottom-0 mt-3 border border-gray-300 bg-white px-3 py-3 rounded-lg shadow-sm">
        <div className="flex items-center justify-between gap-3 text-sm">
          <span className="font-bold text-gray-600">Total monedas</span>
          <span className="text-xl font-black">{totals.monedas}</span>
        </div>
        <div className="mt-1 flex items-center justify-between gap-3 text-sm">
          <span className="font-bold text-gray-600">Total efectivo</span>
          <span className="text-xl font-black">{formatMoney(totals.efectivo)}</span>
        </div>
      </div>
    </section>
  );
}
