import { useEffect, useRef, useState } from "react";
import type { LatLng } from "@/lib/geo";
import { destination } from "@/lib/geo";
import "leaflet/dist/leaflet.css";

type BoundsLike = { extend(latlng: [number, number]): void };

type LayerLike = {
  addTo(target: unknown): LayerLike;
  getBounds(): BoundsLike;
};

type GroupLike = {
  clearLayers(): void;
  addTo(map: MapLike): void;
};

type MapLike = {
  remove(): void;
  invalidateSize(): void;
  setView(center: [number, number], zoom: number): void;
  fitBounds(bounds: BoundsLike, options?: Record<string, unknown>): void;
};

type LeafletApi = {
  map(el: HTMLElement, options: Record<string, unknown>): MapLike;
  tileLayer(url: string, options: Record<string, unknown>): { addTo(map: MapLike): void };
  layerGroup(): GroupLike;
  circle(latlng: [number, number], options: Record<string, unknown>): LayerLike;
  circleMarker(latlng: [number, number], options: Record<string, unknown>): LayerLike;
  latLngBounds(a: [number, number], b: [number, number]): BoundsLike;
  control: { zoom(options: { position: string }): { addTo(map: MapLike): void } };
};

export type FieldMapProps = {
  origin: LatLng | null;
  radiusM: number;
  point: LatLng | null;
  samples: LatLng[];
  here: LatLng | null;
  focusNonce: number;
};

const EMPTY: LatLng[] = [];

function resolveLeaflet(mod: unknown): LeafletApi {
  const m = mod as { map?: unknown; default?: unknown };
  if (typeof m.map === "function") return mod as LeafletApi;
  const d = m.default as { map?: unknown; default?: unknown } | undefined;
  if (d && typeof d.map === "function") return d as LeafletApi;
  if (d?.default && typeof (d.default as { map?: unknown }).map === "function") {
    return d.default as LeafletApi;
  }
  throw new Error("Leaflet did not load");
}

function cssColor(name: string, fallback: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

export function FieldMap({ origin, radiusM, point, samples = EMPTY, here, focusNonce }: FieldMapProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const apiRef = useRef<{
    L: LeafletApi;
    map: MapLike;
    base: GroupLike;
    you: GroupLike;
  } | null>(null);
  const paintRef = useRef<() => void>(() => {});
  const [epoch, setEpoch] = useState(0);
  const [failed, setFailed] = useState(false);

  const fitKey = origin
    ? `${origin.lat.toFixed(5)}:${origin.lng.toFixed(5)}:${radiusM}:${point?.lat.toFixed(5) ?? ""}:${point?.lng.toFixed(5) ?? ""}:${focusNonce}:${samples.length}`
    : `world:${focusNonce}`;
  const lastFit = useRef("");

  function draw(fit: boolean) {
    const api = apiRef.current;
    const host = hostRef.current;
    if (!api || !host || host.clientWidth === 0) return;
    try {
      const { L, map, base, you } = api;
    const lime = cssColor("--color-lime", "#d6f25c");
    const flag = cssColor("--color-flag", "#e25b3a");
    const mist = cssColor("--color-mist", "#a8b5ae");
    const paper = cssColor("--color-paper", "#e7efe6");
    const ink = cssColor("--color-ink", "#101614");

    base.clearLayers();
    you.clearLayers();

    if (!origin) {
      if (fit) {
        map.invalidateSize();
        map.setView([20, 0], 2);
      }
      return;
    }

    for (const sample of samples) {
      L.circleMarker([sample.lat, sample.lng], {
        radius: 3,
        stroke: false,
        color: mist,
        fillColor: mist,
        fillOpacity: 0.45,
      }).addTo(base);
    }

    L.circle([origin.lat, origin.lng], {
      radius: radiusM,
      color: lime,
      weight: 2,
      opacity: 1,
      fillColor: lime,
      fillOpacity: 0.08,
      dashArray: "5 8",
    }).addTo(base);

    L.circleMarker([origin.lat, origin.lng], {
      radius: 6,
      color: lime,
      weight: 2,
      fillColor: ink,
      fillOpacity: 1,
    }).addTo(base);

    if (point) {
      L.circleMarker([point.lat, point.lng], {
        radius: 8,
        color: paper,
        weight: 2,
        fillColor: flag,
        fillOpacity: 1,
      }).addTo(base);
    }

    if (here) {
      L.circleMarker([here.lat, here.lng], {
        radius: 5,
        color: ink,
        weight: 2,
        fillColor: lime,
        fillOpacity: 1,
      }).addTo(you);
    }

    if (!fit) return;
    const north = destination(origin, radiusM, 0);
    const south = destination(origin, radiusM, 180);
    const east = destination(origin, radiusM, 90);
    const west = destination(origin, radiusM, 270);
    const bounds = L.latLngBounds([south.lat, west.lng], [north.lat, east.lng]);
    if (point) bounds.extend([point.lat, point.lng]);
    if (here) bounds.extend([here.lat, here.lng]);
    map.invalidateSize();
    map.fitBounds(bounds, { padding: [48, 48], maxZoom: 17, animate: false });
    } catch {
      setFailed(true);
    }
  }

  paintRef.current = () => draw(true);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let cancelled = false;
    let map: MapLike | null = null;
    let observer: ResizeObserver | null = null;

    (async () => {
      try {
        const mod = await import("leaflet");
        if (cancelled) return;
        const L = resolveLeaflet(mod);
        map = L.map(host, {
          zoomControl: false,
          attributionControl: true,
          scrollWheelZoom: true,
        });
        map.setView([20, 0], 2);
        L.control.zoom({ position: "topright" }).addTo(map);
        L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
          attribution: "&copy; OpenStreetMap &copy; CARTO",
          subdomains: "abcd",
          maxZoom: 20,
        }).addTo(map);
        const base = L.layerGroup();
        base.addTo(map);
        const you = L.layerGroup();
        you.addTo(map);
        apiRef.current = { L, map, base, you };
        let w = 0;
        let h = 0;
        observer = new ResizeObserver(() => {
          const nw = host.clientWidth;
          const nh = host.clientHeight;
          if (nw === w && nh === h) return;
          w = nw;
          h = nh;
          apiRef.current?.map.invalidateSize();
          paintRef.current();
        });
        observer.observe(host);
        if (!cancelled) setEpoch((n) => n + 1);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();

    return () => {
      cancelled = true;
      observer?.disconnect();
      map?.remove();
      apiRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (epoch === 0) return;
    const shouldFit = lastFit.current !== fitKey;
    if (shouldFit) lastFit.current = fitKey;
    draw(shouldFit);
  }, [epoch, fitKey, here?.lat, here?.lng, samples]);

  return (
    <>
      <div ref={hostRef} className="map-host" role="application" aria-label="Map of the search radius" />
      {epoch === 0 && (
        <p className="map-wait">{failed ? "Map didn’t start. The coordinates below still work." : "Charting the field…"}</p>
      )}
    </>
  );
}
