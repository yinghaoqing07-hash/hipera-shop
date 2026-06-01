// Buscador de direcciones (Google Places Autocomplete, API New).
//
// Por qué este enfoque:
//   • La clase clásica `google.maps.places.Autocomplete` dejó de estar
//     disponible para claves/proyectos nuevos (desde 2025-03-01). El
//     componente vigente es `PlaceAutocompleteElement` (Web Component).
//   • Lo usamos como AYUDA de búsqueda: al elegir una dirección real,
//     rellenamos el campo de dirección editable del checkout (que sigue
//     siendo la única fuente de verdad, con su validación y su uso en el
//     resumen/backend). Así el cliente puede además añadir piso/puerta.
//
// Requiere en Google Cloud: "Maps JavaScript API" + "Places API (New)"
// habilitadas, y la clave en VITE_GOOGLE_MAPS_API_KEY. Si la clave no
// está configurada, el componente no renderiza nada (el input manual del
// checkout sigue funcionando como hasta ahora).

import React, { useEffect, useRef } from 'react';
import { Loader } from '@googlemaps/js-api-loader';

const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;

// Centro aproximado de Meco (Madrid) para sesgar (no restringir) los
// resultados hacia la zona de reparto. includedRegionCodes ya limita a ES.
const MECO = { lat: 40.5547, lng: -3.3290 };

// Cargamos la librería 'places' una sola vez para toda la app.
let _placesPromise = null;
function loadPlaces() {
  if (!apiKey) return Promise.resolve(null);
  if (!_placesPromise) {
    const loader = new Loader({ apiKey, version: 'weekly' });
    _placesPromise = loader.importLibrary('places');
  }
  return _placesPromise;
}

export default function AddressAutocomplete({ onSelect, placeholder = 'Busca tu dirección…' }) {
  const containerRef = useRef(null);
  // Guardamos onSelect en un ref para no recrear el elemento en cada render.
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  useEffect(() => {
    if (!apiKey) return undefined;
    let el = null;
    let handler = null;
    let cancelled = false;

    loadPlaces()
      .then((places) => {
        if (cancelled || !places || !containerRef.current) return;
        const { PlaceAutocompleteElement } = places;
        const baseOpts = {
          includedRegionCodes: ['es'],
          requestedLanguage: 'es',
          requestedRegion: 'es',
          placeholder,
        };
        try {
          el = new PlaceAutocompleteElement({
            ...baseOpts,
            locationBias: { center: MECO, radius: 40000 },
          });
        } catch {
          // Si el formato de locationBias no fuese aceptado, seguimos sin él.
          el = new PlaceAutocompleteElement(baseOpts);
        }
        el.style.width = '100%';
        containerRef.current.appendChild(el);

        handler = async (event) => {
          try {
            const place = event.placePrediction.toPlace();
            await place.fetchFields({ fields: ['formattedAddress'] });
            const addr = place.formattedAddress || '';
            if (addr && onSelectRef.current) onSelectRef.current(addr);
          } catch (e) {
            if (!import.meta.env.PROD) console.warn('[places] select:', e?.message || e);
          }
        };
        el.addEventListener('gmp-select', handler);
      })
      .catch((e) => {
        if (!import.meta.env.PROD) console.warn('[places] load:', e?.message || e);
      });

    return () => {
      cancelled = true;
      if (el && handler) el.removeEventListener('gmp-select', handler);
      if (el && el.parentNode) el.parentNode.removeChild(el);
    };
  }, [placeholder]);

  if (!apiKey) return null;
  return <div ref={containerRef} className="w-full" />;
}
