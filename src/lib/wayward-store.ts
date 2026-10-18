import { RADIUS_MAX, RADIUS_MIN, type JournalItem, type LatLng, type Mode } from "@/lib/geo";

const KEY = "wayward.v2";

export type SavedState = {
  origin: LatLng | null;
  originLabel: string;
  radiusM: number;
  mode: Mode;
  journal: JournalItem[];
};

const MODES: Mode[] = ["blind", "attractor", "void"];

function isLatLng(v: unknown): v is LatLng {
  if (!v || typeof v !== "object") return false;
  const o = v as LatLng;
  return Number.isFinite(o.lat) && Number.isFinite(o.lng) && Math.abs(o.lat) <= 90 && Math.abs(o.lng) <= 180;
}

function isMode(v: unknown): v is Mode {
  return typeof v === "string" && MODES.includes(v as Mode);
}

function isJournalItem(v: unknown): v is JournalItem {
  if (!v || typeof v !== "object") return false;
  const o = v as JournalItem;
  return (
    typeof o.id === "string" &&
    isMode(o.mode) &&
    isLatLng(o.origin) &&
    typeof o.originLabel === "string" &&
    isLatLng(o.point) &&
    Number.isFinite(o.radiusM) &&
    Number.isFinite(o.distanceM) &&
    Number.isFinite(o.bearingDeg) &&
    Number.isFinite(o.createdAt)
  );
}

export function defaultState(): SavedState {
  return {
    origin: null,
    originLabel: "",
    radiusM: 2000,
    mode: "attractor",
    journal: [],
  };
}

export function loadSaved(): SavedState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as Partial<SavedState>;
    const base = defaultState();
    const journal = Array.isArray(data.journal) ? data.journal.filter(isJournalItem).slice(0, 24) : [];
    return {
      origin: isLatLng(data.origin) ? data.origin : null,
      originLabel: typeof data.originLabel === "string" ? data.originLabel.slice(0, 120) : "",
      radiusM: clampRadius(data.radiusM),
      mode: isMode(data.mode) ? data.mode : base.mode,
      journal: journal.map((item) => ({ ...item, visited: Boolean(item.visited) })),
    };
  } catch {
    return null;
  }
}

export function writeSaved(state: SavedState): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* private mode / quota — the session still works */
  }
}

function clampRadius(v: unknown): number {
  const n = typeof v === "number" ? v : 2000;
  if (!Number.isFinite(n)) return 2000;
  return Math.min(RADIUS_MAX, Math.max(RADIUS_MIN, Math.round(n)));
}
