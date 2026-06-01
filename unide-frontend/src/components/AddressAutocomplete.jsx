// Campo de dirección con sugerencias de Google Places (API New).
//
// Por qué este enfoque:
//   • El cliente escribe en SU PROPIO campo de dirección y debajo aparecen
//     las sugerencias (como en cualquier web moderna). No usamos el
//     Web Component con su caja de búsqueda aparte, que quedaba feo.
//   • Usamos la "Autocomplete Data API" (AutocompleteSuggestion) para pedir
//     predicciones y pintamos nuestro propio desplegable con estilo propio.
//   • Al elegir una sugerencia resolvemos la dirección formateada real y la
//     metemos en el campo (que sigue siendo la única fuente de verdad, con
//     su validación). El cliente puede luego añadir piso/puerta a mano.
//
// Si NO hay VITE_GOOGLE_MAPS_API_KEY, el componente se comporta como un
// input normal (sin sugerencias), así nunca rompe el checkout.
//
// Requiere en Google Cloud: "Maps JavaScript API" + "Places API (New)".

import React, { useEffect, useRef, useState } from 'react';
import { setOptions, importLibrary } from '@googlemaps/js-api-loader';

const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;

// Centro aproximado de Meco (Madrid) para sesgar (no restringir) los
// resultados hacia la zona de reparto. includedRegionCodes ya limita a ES.
const MECO = { lat: 40.5547, lng: -3.3290 };

// Cargamos la librería 'places' una sola vez para toda la app.
let _placesPromise = null;
function loadPlaces() {
  if (!apiKey) return Promise.resolve(null);
  if (!_placesPromise) {
    setOptions({ key: apiKey, v: 'weekly' });
    _placesPromise = importLibrary('places');
  }
  return _placesPromise;
}

export default function AddressAutocomplete({
  value,
  onChange,
  onBlur,
  onSelect,
  hasError = false,
  placeholder = 'Dirección completa (calle, número, piso) *',
  id = 'address',
  name = 'address',
}) {
  const [suggestions, setSuggestions] = useState([]);
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(-1);

  const placesRef = useRef(null);       // { AutocompleteSuggestion, AutocompleteSessionToken }
  const tokenRef = useRef(null);        // sesión de facturación de Places
  const wrapRef = useRef(null);
  const debounceRef = useRef(null);
  const reqIdRef = useRef(0);           // descarta respuestas obsoletas
  const justSelectedRef = useRef(false);

  // Carga perezosa de la librería de Places.
  useEffect(() => {
    if (!apiKey) return;
    let cancelled = false;
    loadPlaces()
      .then((places) => {
        if (cancelled || !places) return;
        placesRef.current = places;
      })
      .catch((e) => {
        if (!import.meta.env.PROD) console.warn('[places] load:', e?.message || e);
      });
    return () => { cancelled = true; };
  }, []);

  // Cierra el desplegable al hacer clic fuera.
  useEffect(() => {
    function onDocClick(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  function newToken() {
    const p = placesRef.current;
    if (!p?.AutocompleteSessionToken) return null;
    return new p.AutocompleteSessionToken();
  }

  async function fetchSuggestions(input) {
    const p = placesRef.current;
    if (!p?.AutocompleteSuggestion || !input || input.trim().length < 3) {
      setSuggestions([]);
      setOpen(false);
      return;
    }
    if (!tokenRef.current) tokenRef.current = newToken();
    const myReq = ++reqIdRef.current;
    try {
      const request = {
        input,
        includedRegionCodes: ['es'],
        language: 'es',
        region: 'es',
        locationBias: { center: MECO, radius: 40000 },
        sessionToken: tokenRef.current || undefined,
      };
      const res = await p.AutocompleteSuggestion.fetchAutocompleteSuggestions(request);
      if (myReq !== reqIdRef.current) return; // llegó una respuesta más nueva
      const list = (res?.suggestions || [])
        .map((s) => s.placePrediction)
        .filter(Boolean);
      setSuggestions(list);
      setHighlight(-1);
      setOpen(list.length > 0);
    } catch (e) {
      if (!import.meta.env.PROD) console.warn('[places] fetch:', e?.message || e);
      setSuggestions([]);
      setOpen(false);
    }
  }

  function handleInputChange(e) {
    const val = e.target.value;
    onChange?.(val);
    justSelectedRef.current = false;
    if (!apiKey) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchSuggestions(val), 250);
  }

  async function pick(prediction) {
    try {
      const place = prediction.toPlace();
      await place.fetchFields({ fields: ['formattedAddress'] });
      const addr = place.formattedAddress || predictionText(prediction);
      justSelectedRef.current = true;
      onChange?.(addr);
      onSelect?.(addr);
    } catch (e) {
      const addr = predictionText(prediction);
      if (addr) { onChange?.(addr); onSelect?.(addr); }
      if (!import.meta.env.PROD) console.warn('[places] pick:', e?.message || e);
    } finally {
      tokenRef.current = newToken(); // la sesión se cierra al elegir
      setSuggestions([]);
      setOpen(false);
      setHighlight(-1);
    }
  }

  function predictionText(prediction) {
    return prediction?.text?.text
      || [prediction?.mainText?.text, prediction?.secondaryText?.text].filter(Boolean).join(', ')
      || '';
  }

  function handleKeyDown(e) {
    if (!open || suggestions.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlight((h) => (h + 1) % suggestions.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((h) => (h - 1 + suggestions.length) % suggestions.length);
    } else if (e.key === 'Enter') {
      if (highlight >= 0 && highlight < suggestions.length) {
        e.preventDefault();
        pick(suggestions[highlight]);
      }
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  }

  function handleBlur() {
    // Pequeño retardo para permitir el clic en una sugerencia.
    setTimeout(() => onBlur?.(), 120);
  }

  return (
    <div ref={wrapRef} className="relative">
      <input
        id={id}
        name={name}
        autoComplete="off"
        value={value}
        onChange={handleInputChange}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        onFocus={() => { if (suggestions.length > 0) setOpen(true); }}
        placeholder={placeholder}
        className={`w-full p-3.5 bg-gray-50 rounded-xl font-medium outline-none focus:ring-2 transition-all ${hasError ? 'ring-2 ring-red-300 bg-red-50' : 'ring-red-100'}`}
      />
      {open && suggestions.length > 0 && (
        <ul className="absolute z-30 left-0 right-0 mt-1 bg-white border border-gray-100 rounded-xl shadow-lg overflow-hidden max-h-72 overflow-y-auto">
          {suggestions.map((s, i) => {
            const main = s?.mainText?.text || predictionText(s);
            const secondary = s?.secondaryText?.text || '';
            return (
              <li
                key={s.placeId || i}
                // onMouseDown en vez de onClick para que dispare antes del blur.
                onMouseDown={(e) => { e.preventDefault(); pick(s); }}
                onMouseEnter={() => setHighlight(i)}
                className={`px-4 py-2.5 cursor-pointer text-sm ${i === highlight ? 'bg-red-50' : 'hover:bg-gray-50'}`}
              >
                <span className="font-medium text-gray-800">{main}</span>
                {secondary && <span className="text-gray-400"> · {secondary}</span>}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
