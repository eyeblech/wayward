export type Mode = "blind" | "attractor" | "void";

export type LatLng = { lat: number; lng: number };

export type Roll = {
  id: string;
  mode: Mode;
  origin: LatLng;
  originLabel: string;
  point: LatLng;
  radiusM: number;
  distanceM: number;
  bearingDeg: number;
  sampleCount: number;
  samples: LatLng[];
  createdAt: number;
};

export type JournalItem = {
  id: string;
  mode: Mode;
  origin: LatLng;
  originLabel: string;
  point: LatLng;
  radiusM: number;
  distanceM: number;
  bearingDeg: number;
  createdAt: number;
  visited: boolean;
};

export const MODES: { id: Mode; title: string; blurb: string }[] = [
  {
    id: "blind",
    title: "Blind",
    blurb: "One even chance anywhere inside the circle.",
  },
  {
    id: "attractor",
    title: "Attractor",
    blurb: "A pocket where random points clump together.",
  },
  {
    id: "void",
    title: "Void",
    blurb: "A pocket the random cloud left empty.",
  },
];

const EARTH_M = 6_371_000;
const CLOUD = 160;
const GRID = 7;

const CARDINALS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"] as const;
const CARDINAL_LONG = [
  "north",
  "north-northeast",
  "northeast",
  "east-northeast",
  "east",
  "east-southeast",
  "southeast",
  "south-southeast",
  "south",
  "south-southwest",
  "southwest",
  "west-southwest",
  "west",
  "west-northwest",
  "northwest",
  "north-northwest",
] as const;

export function cryptoUnit(): number {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0] / 4294967296;
}

export function destination(origin: LatLng, distanceM: number, bearingDeg: number): LatLng {
  const δ = distanceM / EARTH_M;
  const θ = (bearingDeg * Math.PI) / 180;
  const φ1 = (origin.lat * Math.PI) / 180;
  const λ1 = (origin.lng * Math.PI) / 180;
  const sinφ1 = Math.sin(φ1);
  const cosφ1 = Math.cos(φ1);
  const sinδ = Math.sin(δ);
  const cosδ = Math.cos(δ);
  const φ2 = Math.asin(sinφ1 * cosδ + cosφ1 * sinδ * Math.cos(θ));
  const λ2 = λ1 + Math.atan2(Math.sin(θ) * sinδ * cosφ1, cosδ - sinφ1 * Math.sin(φ2));
  return {
    lat: (φ2 * 180) / Math.PI,
    lng: ((((λ2 * 180) / Math.PI + 540) % 360) - 180),
  };
}

export function haversine(a: LatLng, b: LatLng): number {
  const φ1 = (a.lat * Math.PI) / 180;
  const φ2 = (b.lat * Math.PI) / 180;
  const Δφ = ((b.lat - a.lat) * Math.PI) / 180;
  const Δλ = ((b.lng - a.lng) * Math.PI) / 180;
  const h = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  return 2 * EARTH_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function bearingDeg(a: LatLng, b: LatLng): number {
  const φ1 = (a.lat * Math.PI) / 180;
  const φ2 = (b.lat * Math.PI) / 180;
  const Δλ = ((b.lng - a.lng) * Math.PI) / 180;
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

export function cardinal(deg: number): string {
  return CARDINALS[cardinalIndex(deg)];
}

export function cardinalLong(deg: number): string {
  return CARDINAL_LONG[cardinalIndex(deg)];
}

function cardinalIndex(deg: number): number {
  const wrapped = ((deg % 360) + 360) % 360;
  return Math.round(wrapped / 22.5) % 16;
}

export function randomInCircle(origin: LatLng, radiusM: number): LatLng {
  const r = radiusM * Math.sqrt(cryptoUnit());
  const θ = cryptoUnit() * 360;
  return destination(origin, r, θ);
}

function toLocal(origin: LatLng, p: LatLng): { x: number; y: number } {
  const latRad = (origin.lat * Math.PI) / 180;
  const x = ((p.lng - origin.lng) * Math.PI) / 180 * EARTH_M * Math.cos(latRad);
  const y = ((p.lat - origin.lat) * Math.PI) / 180 * EARTH_M;
  return { x, y };
}

function fromLocal(origin: LatLng, x: number, y: number): LatLng {
  const latRad = (origin.lat * Math.PI) / 180;
  const cos = Math.cos(latRad) || 1e-6;
  return {
    lat: origin.lat + (y / EARTH_M) * (180 / Math.PI),
    lng: origin.lng + (x / (EARTH_M * cos)) * (180 / Math.PI),
  };
}

function clampLocal(x: number, y: number, radiusM: number, factor: number): { x: number; y: number } {
  const d = Math.hypot(x, y);
  const max = radiusM * factor;
  if (d > max && d > 0) {
    const s = max / d;
    return { x: x * s, y: y * s };
  }
  return { x, y };
}

function pick<T>(items: T[]): T {
  return items[Math.floor(cryptoUnit() * items.length)]!;
}

export function createRoll(origin: LatLng, originLabel: string, radiusM: number, mode: Mode): Roll {
  const createdAt = Date.now();
  const id = crypto.randomUUID();

  if (mode === "blind") {
    const point = randomInCircle(origin, radiusM);
    return {
      id,
      mode,
      origin,
      originLabel,
      point,
      radiusM,
      distanceM: haversine(origin, point),
      bearingDeg: bearingDeg(origin, point),
      sampleCount: 1,
      samples: [],
      createdAt,
    };
  }

  const samples: LatLng[] = [];
  for (let i = 0; i < CLOUD; i++) samples.push(randomInCircle(origin, radiusM));

  const cell = (2 * radiusM) / GRID;
  const bins = new Map<string, { n: number; sx: number; sy: number; cx: number; cy: number }>();

  for (let ix = 0; ix < GRID; ix++) {
    for (let iy = 0; iy < GRID; iy++) {
      const cx = -radiusM + (ix + 0.5) * cell;
      const cy = -radiusM + (iy + 0.5) * cell;
      if (cx * cx + cy * cy <= radiusM * radiusM) {
        bins.set(`${ix},${iy}`, { n: 0, sx: 0, sy: 0, cx, cy });
      }
    }
  }

  for (const sample of samples) {
    const { x, y } = toLocal(origin, sample);
    const ix = Math.min(GRID - 1, Math.max(0, Math.floor((x + radiusM) / cell)));
    const iy = Math.min(GRID - 1, Math.max(0, Math.floor((y + radiusM) / cell)));
    const bin = bins.get(`${ix},${iy}`);
    if (!bin) continue;
    bin.n += 1;
    bin.sx += x;
    bin.sy += y;
  }

  const all = [...bins.values()];
  let local = { x: 0, y: 0 };

  if (all.length === 0) {
    const fallback = randomInCircle(origin, radiusM);
    return finish(id, mode, origin, originLabel, fallback, radiusM, samples, createdAt);
  }

  if (mode === "attractor") {
    const max = Math.max(...all.map((b) => b.n));
    const candidates = all.filter((b) => b.n === max && b.n > 0);
    const bin = candidates.length ? pick(candidates) : pick(all);
    const x = bin.n ? bin.sx / bin.n : bin.cx;
    const y = bin.n ? bin.sy / bin.n : bin.cy;
    local = clampLocal(x, y, radiusM, 0.96);
  } else {
    const inner = all.filter((b) => b.cx * b.cx + b.cy * b.cy <= radiusM * radiusM * 0.85);
    const pool = inner.length ? inner : all;
    const min = Math.min(...pool.map((b) => b.n));
    const bin = pick(pool.filter((b) => b.n === min));
    local = clampLocal(bin.cx, bin.cy, radiusM, 0.92);
  }

  return finish(id, mode, origin, originLabel, fromLocal(origin, local.x, local.y), radiusM, samples, createdAt);
}

function finish(
  id: string,
  mode: Mode,
  origin: LatLng,
  originLabel: string,
  point: LatLng,
  radiusM: number,
  samples: LatLng[],
  createdAt: number,
): Roll {
  return {
    id,
    mode,
    origin,
    originLabel,
    point,
    radiusM,
    distanceM: haversine(origin, point),
    bearingDeg: bearingDeg(origin, point),
    sampleCount: samples.length,
    samples,
    createdAt,
  };
}

export function formatDistance(meters: number): string {
  if (!Number.isFinite(meters)) return "—";
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(1)} km`;
}

export function walkLabel(meters: number): string {
  const min = Math.max(1, Math.round(meters / 80));
  if (min < 60) return `${min} min on foot`;
  const h = Math.floor(min / 60);
  const r = min % 60;
  return r ? `${h} h ${r} min on foot` : `${h} h on foot`;
}

export function formatSigned(p: LatLng): string {
  return `${p.lat.toFixed(6)}, ${p.lng.toFixed(6)}`;
}

export function formatPretty(p: LatLng): { lat: string; lng: string } {
  const ns = p.lat >= 0 ? "N" : "S";
  const ew = p.lng >= 0 ? "E" : "W";
  return {
    lat: `${Math.abs(p.lat).toFixed(6)}° ${ns}`,
    lng: `${Math.abs(p.lng).toFixed(6)}° ${ew}`,
  };
}

export function formatWhen(ts: number): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(ts);
}

export function toJournal(roll: Roll): JournalItem {
  return {
    id: roll.id,
    mode: roll.mode,
    origin: roll.origin,
    originLabel: roll.originLabel,
    point: roll.point,
    radiusM: roll.radiusM,
    distanceM: roll.distanceM,
    bearingDeg: roll.bearingDeg,
    createdAt: roll.createdAt,
    visited: false,
  };
}

export function journalToRoll(item: JournalItem): Roll {
  return { ...item, samples: [], sampleCount: 0 };
}

export function mapsWalkUrl(from: LatLng, to: LatLng): string {
  const params = new URLSearchParams({
    api: "1",
    origin: `${from.lat},${from.lng}`,
    destination: `${to.lat},${to.lng}`,
    travelmode: "walking",
  });
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

export function osmUrl(from: LatLng, to: LatLng): string {
  const route = `${from.lat},${from.lng};${to.lat},${to.lng}`;
  return `https://www.openstreetmap.org/directions?engine=fossgis_osrm_foot&route=${encodeURIComponent(route)}`;
}

export const RADIUS_MIN = 250;
export const RADIUS_MAX = 15000;
export const RADIUS_STEP = 50;
