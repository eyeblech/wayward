import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  Bookmark,
  Check,
  ChevronDown,
  Copy,
  Crosshair,
  LocateFixed,
  Navigation,
  Trash2,
} from "lucide-react";
import { FieldMap } from "@/components/field-map";
import { searchPlaces, type PlaceHit } from "@/lib/geocode";
import {
  MODES,
  RADIUS_MAX,
  RADIUS_MIN,
  RADIUS_STEP,
  bearingDeg,
  cardinal,
  cardinalLong,
  createRoll,
  formatDistance,
  formatPretty,
  formatSigned,
  formatWhen,
  haversine,
  journalToRoll,
  mapsWalkUrl,
  osmUrl,
  toJournal,
  walkLabel,
  type JournalItem,
  type LatLng,
  type Mode,
  type Roll,
} from "@/lib/geo";
import { defaultState, loadSaved, writeSaved } from "@/lib/wayward-store";

const SOURCE = "https://github.com/eyeblech/wayward";
const EMPTY: LatLng[] = [];

export function WaywardApp() {
  const initial = defaultState();
  const [origin, setOrigin] = useState<LatLng | null>(initial.origin);
  const [originLabel, setOriginLabel] = useState(initial.originLabel);
  const [radiusM, setRadiusM] = useState(initial.radiusM);
  const [mode, setMode] = useState<Mode>(initial.mode);
  const [journal, setJournal] = useState<JournalItem[]>([]);
  const [active, setActive] = useState<Roll | null>(null);
  const [here, setHere] = useState<LatLng | null>(null);
  const [accuracy, setAccuracy] = useState<number | null>(null);
  const [locating, setLocating] = useState(false);
  const [gpsNote, setGpsNote] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [showCloud, setShowCloud] = useState(true);
  const [focusNonce, setFocusNonce] = useState(0);
  const [copied, setCopied] = useState<"idle" | "copied" | "failed">("idle");
  const [manualError, setManualError] = useState<string | null>(null);
  const [latDraft, setLatDraft] = useState("");
  const [lngDraft, setLngDraft] = useState("");
  const [confirmClear, setConfirmClear] = useState(false);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<PlaceHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  const pinned = useRef(false);
  const adopted = useRef(false);
  const gotFix = useRef(false);
  const copyTimer = useRef<number | null>(null);

  useEffect(() => {
    const saved = loadSaved();
    if (saved) {
      setOrigin(saved.origin);
      setOriginLabel(saved.originLabel);
      setRadiusM(saved.radiusM);
      setMode(saved.mode);
      setJournal(saved.journal);
      if (saved.origin && saved.originLabel !== "Your location") pinned.current = true;
    }
    setHydrated(true);

    if (!navigator.geolocation) {
      setGpsNote("This browser has no GPS. Search any place, or enter coordinates.");
      return;
    }

    setLocating(true);
    const id = navigator.geolocation.watchPosition(
      (pos) => {
        gotFix.current = true;
        const next = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setHere(next);
        setAccuracy(Math.round(pos.coords.accuracy));
        setLocating(false);
        setGpsNote(null);
        if (!pinned.current && !adopted.current) {
          adopted.current = true;
          setOrigin(next);
          setOriginLabel("Your location");
        }
      },
      (err) => {
        setLocating(false);
        if (gotFix.current) return;
        setGpsNote(gpsMessage(err));
      },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 12000 },
    );

    return () => navigator.geolocation.clearWatch(id);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    writeSaved({ origin, originLabel, radiusM, mode, journal });
  }, [hydrated, origin, originLabel, radiusM, mode, journal]);

  useEffect(() => {
    if (!origin) {
      setLatDraft("");
      setLngDraft("");
      return;
    }
    setLatDraft(origin.lat.toFixed(5));
    setLngDraft(origin.lng.toFixed(5));
  }, [origin]);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setHits([]);
      setSearching(false);
      setSearchError(null);
      return;
    }
    const ctrl = new AbortController();
    const timer = window.setTimeout(async () => {
      setSearching(true);
      try {
        const next = await searchPlaces(q, ctrl.signal);
        setHits(next);
        setSearchError(null);
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setHits([]);
        setSearchError("Place search is unavailable. Enter coordinates instead.");
      } finally {
        if (!ctrl.signal.aborted) setSearching(false);
      }
    }, 280);
    return () => {
      ctrl.abort();
      window.clearTimeout(timer);
    };
  }, [query]);

  useEffect(() => {
    return () => {
      if (copyTimer.current) window.clearTimeout(copyTimer.current);
    };
  }, []);

  const modeMeta = MODES.find((item) => item.id === mode) ?? MODES[0];
  const kept = Boolean(active && journal.some((item) => item.id === active.id));

  const nav = useMemo(() => {
    if (!active) return null;
    const from = here ?? active.origin;
    const distanceM = haversine(from, active.point);
    const deg = bearingDeg(from, active.point);
    const arrived =
      here !== null && distanceM <= Math.min(80, Math.max(40, accuracy ?? 40));
    return { from, distanceM, deg, arrived, live: here !== null };
  }, [active, here, accuracy]);

  const cloud =
    showCloud && active && origin && active.samples.length > 0 && sameSpot(active.origin, origin) && active.radiusM === radiusM
      ? active.samples
      : EMPTY;

  const hereMarker = here && origin && haversine(here, origin) > 30 ? here : null;

  function roll() {
    if (!origin) return;
    const next = createRoll(origin, originLabel || "Chosen start", radiusM, mode);
    setActive(next);
    setCopied("idle");
    setFocusNonce((n) => n + 1);
  }

  function keep() {
    if (!active || kept) return;
    setJournal((items) => [toJournal(active), ...items].slice(0, 24));
  }

  function drop(id: string) {
    setJournal((items) => items.filter((item) => item.id !== id));
  }

  function toggleVisited(id: string) {
    setJournal((items) => items.map((item) => (item.id === id ? { ...item, visited: !item.visited } : item)));
  }

  function openJournal(item: JournalItem) {
    pinned.current = true;
    adopted.current = true;
    setOrigin(item.origin);
    setOriginLabel(item.originLabel);
    setRadiusM(item.radiusM);
    setMode(item.mode);
    setActive(journalToRoll(item));
    setCopied("idle");
    setFocusNonce((n) => n + 1);
  }

  function chooseHit(hit: PlaceHit) {
    pinned.current = true;
    adopted.current = true;
    setOrigin({ lat: hit.lat, lng: hit.lng });
    setOriginLabel(hit.label);
    setQuery("");
    setHits([]);
    setGpsNote(null);
    setManualError(null);
    setFocusNonce((n) => n + 1);
  }

  function useMyLocation() {
    setManualError(null);
    if (!navigator.geolocation) {
      setGpsNote("This browser has no GPS. Search any place, or enter coordinates.");
      return;
    }
    if (here) {
      pinned.current = false;
      adopted.current = true;
      setOrigin(here);
      setOriginLabel("Your location");
      setGpsNote(null);
      return;
    }
    pinned.current = false;
    adopted.current = false;
    setLocating(true);
    setGpsNote(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        gotFix.current = true;
        const next = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setHere(next);
        setAccuracy(Math.round(pos.coords.accuracy));
        setLocating(false);
        adopted.current = true;
        setOrigin(next);
        setOriginLabel("Your location");
      },
      (err) => {
        setLocating(false);
        setGpsNote(gpsMessage(err));
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 5000 },
    );
  }

  function submitManual(event: FormEvent) {
    event.preventDefault();
    let latStr = latDraft.trim();
    let lngStr = lngDraft.trim();
    if (latStr.includes(",")) {
      const [a, b] = latStr.split(",");
      latStr = a?.trim() ?? "";
      if (b) lngStr = b.trim();
    }
    const lat = Number(latStr);
    const lng = Number(lngStr);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
      setManualError("Latitude is −90 to 90. Longitude is −180 to 180.");
      return;
    }
    pinned.current = true;
    adopted.current = true;
    setManualError(null);
    setOrigin({ lat, lng });
    setOriginLabel("Custom pin");
  }

  async function copyPoint() {
    if (!active) return;
    const lines = [formatSigned(active.point), `${labelFor(active.mode)} · ${formatDistance(active.distanceM)} ${cardinal(active.bearingDeg)} of ${active.originLabel}`];
    const ok = await writeClipboard(lines.join("\n"));
    setCopied(ok ? "copied" : "failed");
    if (copyTimer.current) window.clearTimeout(copyTimer.current);
    copyTimer.current = window.setTimeout(() => setCopied("idle"), 1600);
  }

  const pretty = active ? formatPretty(active.point) : null;
  const chipTitle = origin ? originLabel || "Chosen start" : "Worldwide";
  const chipMeta = origin
    ? [formatDistance(radiusM) + " radius", originLabel === "Your location" && accuracy !== null ? `±${accuracy} m` : null]
        .filter(Boolean)
        .join(" · ")
    : "Search a place or share location";

  return (
    <div className="shell">
      <section className="map-stage" aria-label="Field map">
        <FieldMap
          origin={origin}
          radiusM={radiusM}
          point={active?.point ?? null}
          samples={cloud}
          here={hereMarker}
          focusNonce={focusNonce}
        />
        <div className="map-chip">
          <p className="text-sm font-medium">{chipTitle}</p>
          <p className="text-xs text-mist tabular-nums">{chipMeta}</p>
        </div>
        <button type="button" className="map-fab" onClick={() => setFocusNonce((n) => n + 1)} aria-label="Re-center map">
          <Crosshair className="size-5" />
        </button>
      </section>

      <aside className="panel">
        <header>
          <p className="text-xs font-medium uppercase tracking-widest text-lime">Free · worldwide</p>
          <h1 className="mt-1 font-display text-4xl leading-none">Wayward</h1>
          <p className="mt-2 text-sm leading-relaxed text-mist text-pretty">
            A walk to a place you have not chosen yet. Start from where you are, or search any city on earth. No account, no fee.
          </p>
        </header>

        {active && nav && pretty && (
          <section className="rise rounded-2xl bg-panel p-4 ring-1 ring-line" aria-live="polite">
            {nav.arrived ? (
              <p className="rounded-xl bg-lime px-3 py-3 text-sm font-medium text-lime-ink">You’re in the spot. Look around.</p>
            ) : (
              <div className="flex items-center gap-4">
                <Compass deg={nav.deg} label={cardinalLong(nav.deg)} />
                <div className="min-w-0">
                  <p className="text-xs font-medium uppercase tracking-widest text-mist">
                    {nav.live ? "From you" : "From the pin"}
                  </p>
                  <p className="font-display text-3xl leading-none tabular-nums">{formatDistance(nav.distanceM)}</p>
                  <p className="mt-1 text-sm text-mist">
                    Head {cardinal(nav.deg)} · {walkLabel(nav.distanceM)}
                  </p>
                </div>
              </div>
            )}

            <div className="mt-4">
              <p className="text-xs font-medium uppercase tracking-widest text-lime">{labelFor(active.mode)}</p>
              <p className="mt-1 font-display text-2xl leading-tight tabular-nums">{pretty.lat}</p>
              <p className="font-display text-2xl leading-tight tabular-nums">{pretty.lng}</p>
              <p className="mt-2 text-sm text-mist text-pretty">{noteFor(active)}</p>
            </div>

            <div className="mt-4 grid gap-2">
              <a className="btn-primary" href={mapsWalkUrl(nav.from, active.point)} target="_blank" rel="noreferrer">
                <Navigation className="size-4" />
                Walk there
              </a>
              <div className="grid grid-cols-2 gap-2">
                <button type="button" className="btn-ghost" onClick={copyPoint}>
                  <Copy className="size-4" />
                  {copied === "copied" ? "Copied" : copied === "failed" ? "Copy failed" : "Copy"}
                </button>
                <button type="button" className="btn-ghost" onClick={kept ? () => drop(active.id) : keep}>
                  <Bookmark className="size-4" />
                  {kept ? "Remove" : "Keep"}
                </button>
              </div>
              <a
                className="text-center text-sm text-lime underline-offset-2 hover:underline"
                href={osmUrl(nav.from, active.point)}
                target="_blank"
                rel="noreferrer"
              >
                OpenStreetMap
              </a>
            </div>
          </section>
        )}

        <section>
          <h2 className="text-xs font-medium uppercase tracking-widest text-mist">Start anywhere</h2>
          <button type="button" className="btn-ghost mt-2 w-full" onClick={useMyLocation}>
            <LocateFixed className="size-4" />
            {locating ? "Listening for GPS…" : "Use my location"}
          </button>
          {gpsNote && <p className="mt-2 text-sm text-flag text-pretty">{gpsNote}</p>}
          <label className="mt-3 grid gap-1 text-xs text-mist">
            Search any place
            <input
              className="field"
              value={query}
              placeholder="Lisbon, Kyoto, Nairobi"
              autoComplete="off"
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          {searching && <p className="mt-2 text-sm text-mist">Searching…</p>}
          {searchError && <p className="mt-2 text-sm text-flag text-pretty">{searchError}</p>}
          {!searching && query.trim().length >= 2 && hits.length === 0 && !searchError && (
            <p className="mt-2 text-sm text-mist">No matches. Try another name, or enter coordinates.</p>
          )}
          {hits.length > 0 && (
            <ul className="mt-1">
              {hits.map((hit) => (
                <li key={hit.id} className="border-t border-line">
                  <button type="button" className="search-hit" onClick={() => chooseHit(hit)}>
                    {hit.label}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <details className="mt-3">
            <summary className="flex min-h-11 items-center justify-between text-sm font-medium">
              Enter coordinates
              <ChevronDown className="size-4 text-mist" />
            </summary>
            <form className="mt-2 grid gap-2" onSubmit={submitManual}>
              <label className="grid gap-1 text-xs text-mist">
                Latitude
                <input
                  className="field"
                  inputMode="decimal"
                  autoComplete="off"
                  value={latDraft}
                  onChange={(event) => setLatDraft(event.target.value)}
                />
              </label>
              <label className="grid gap-1 text-xs text-mist">
                Longitude
                <input
                  className="field"
                  inputMode="decimal"
                  autoComplete="off"
                  value={lngDraft}
                  onChange={(event) => setLngDraft(event.target.value)}
                />
              </label>
              {manualError && <p className="text-sm text-flag">{manualError}</p>}
              <button type="submit" className="btn-ghost">
                Use this pin
              </button>
            </form>
          </details>
        </section>

        <section>
          <h2 className="text-xs font-medium uppercase tracking-widest text-mist">Roll type</h2>
          <div className="mt-2 grid grid-cols-3 gap-2" role="radiogroup" aria-label="Roll type">
            {MODES.map((item) => {
              const selected = item.id === mode;
              return (
                <button
                  key={item.id}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  className={selected ? "mode-btn mode-btn-on" : "mode-btn"}
                  onClick={() => setMode(item.id)}
                >
                  {item.title}
                </button>
              );
            })}
          </div>
          <p className="mt-2 text-sm text-mist text-pretty">{modeMeta.blurb}</p>
        </section>

        <section>
          <div className="flex items-baseline justify-between gap-3">
            <label htmlFor="radius" className="text-xs font-medium uppercase tracking-widest text-mist">
              Radius
            </label>
            <span className="tabular-nums font-medium">{formatDistance(radiusM)}</span>
          </div>
          <input
            id="radius"
            className="range"
            type="range"
            min={RADIUS_MIN}
            max={RADIUS_MAX}
            step={RADIUS_STEP}
            value={radiusM}
            aria-valuemin={RADIUS_MIN}
            aria-valuemax={RADIUS_MAX}
            aria-valuenow={radiusM}
            aria-valuetext={formatDistance(radiusM)}
            onChange={(event) => setRadiusM(Number(event.target.value))}
          />
          <div className="flex justify-between text-xs text-mist tabular-nums">
            <span>{formatDistance(RADIUS_MIN)}</span>
            <span>{formatDistance(RADIUS_MAX)}</span>
          </div>
        </section>

        <button id="roll" type="button" className="btn-primary" onClick={roll} disabled={!origin}>
          <Crosshair className="size-4" />
          {!origin ? "Choose a start first" : active ? "Roll again" : "Roll a point"}
        </button>

        {active && active.samples.length > 0 && (
          <label className="flex min-h-11 items-center gap-3 text-sm">
            <input
              type="checkbox"
              className="size-4 accent-lime"
              checked={showCloud}
              onChange={(event) => setShowCloud(event.target.checked)}
            />
            Show the sample cloud
          </label>
        )}

        <p className="legend" aria-hidden="true">
          <span>
            <i className="swatch swatch-lime" /> Start
          </span>
          {here && (
            <span>
              <i className="swatch swatch-you" /> You
            </span>
          )}
          <span>
            <i className="swatch swatch-flag" /> Point
          </span>
          <span>
            <i className="swatch swatch-mist" /> Samples
          </span>
        </p>

        <section>
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-xs font-medium uppercase tracking-widest text-mist">Journal</h2>
            {journal.length > 0 &&
              (confirmClear ? (
                <button
                  type="button"
                  className="text-sm text-flag"
                  onClick={() => {
                    setJournal([]);
                    setConfirmClear(false);
                  }}
                >
                  Confirm clear
                </button>
              ) : (
                <button type="button" className="text-sm text-mist" onClick={() => setConfirmClear(true)}>
                  Clear
                </button>
              ))}
          </div>
          {journal.length === 0 ? (
            <p className="mt-2 text-sm text-mist text-pretty">Rolls you keep stay on this device.</p>
          ) : (
            <ul className="mt-1">
              {journal.map((item) => {
                const coords = formatPretty(item.point);
                return (
                  <li key={item.id} className="border-t border-line">
                    <div className="flex items-center gap-1 py-1">
                      <button type="button" className="min-h-11 min-w-0 flex-1 py-1 text-left" onClick={() => openJournal(item)}>
                        <span className="block text-sm">
                          {labelFor(item.mode)} · {formatDistance(item.distanceM)} {cardinal(item.bearingDeg)}
                        </span>
                        <span className="block truncate text-xs text-mist tabular-nums">
                          {coords.lat} · {formatWhen(item.createdAt)}
                        </span>
                      </button>
                      <button
                        type="button"
                        className={item.visited ? "icon-btn text-lime" : "icon-btn text-mist"}
                        aria-pressed={item.visited}
                        aria-label={item.visited ? "Mark as not visited" : "Mark as visited"}
                        onClick={() => toggleVisited(item.id)}
                      >
                        <Check className="size-4" />
                      </button>
                      <button type="button" className="icon-btn text-mist" aria-label="Remove from journal" onClick={() => drop(item.id)}>
                        <Trash2 className="size-4" />
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <footer className="text-sm leading-relaxed text-mist text-pretty">
          <p>Free for anyone, anywhere. No account and no fee.</p>
          <p className="mt-2">
            Attractor and void scan a cloud of cryptographic random points for a dense cluster or an empty cell. It’s a walk
            prompt, not a prediction.
          </p>
          <p className="mt-2">
            Stay on public paths. If the point lands on a private compound, a road you shouldn’t cross, or anywhere that feels
            wrong, skip it and roll again.
          </p>
          <p className="mt-2">
            <a className="text-lime underline-offset-2 hover:underline" href={SOURCE} target="_blank" rel="noreferrer">
              Source on GitHub
            </a>{" "}
            · MIT
          </p>
        </footer>
      </aside>
    </div>
  );
}

function Compass({ deg, label }: { deg: number; label: string }) {
  return (
    <svg viewBox="0 0 64 64" className="size-16 shrink-0 text-line" role="img" aria-label={`Bearing ${label}`}>
      <circle cx="32" cy="32" r="30" fill="none" stroke="currentColor" strokeWidth="1" />
      <path d="M32 6 v6 M32 52 v6 M6 32 h6 M52 32 h6" stroke="currentColor" strokeWidth="1" />
      <g transform={`rotate(${deg} 32 32)`} className="text-flag">
        <path d="M32 12 L37 36 L32 32 L27 36 Z" fill="currentColor" />
      </g>
    </svg>
  );
}

function labelFor(mode: Mode): string {
  return MODES.find((item) => item.id === mode)?.title ?? mode;
}

function noteFor(roll: Roll): string {
  if (roll.sampleCount <= 1 && roll.mode === "blind") return "One uniform roll inside the circle.";
  if (roll.sampleCount === 0) return `Kept ${formatWhen(roll.createdAt)} · ${formatDistance(roll.distanceM)} from ${roll.originLabel}.`;
  if (roll.mode === "attractor") return `Densest cell in a cloud of ${roll.sampleCount} random points.`;
  if (roll.mode === "void") return `Emptiest cell in a cloud of ${roll.sampleCount} random points.`;
  return "";
}

function sameSpot(a: LatLng, b: LatLng): boolean {
  return Math.abs(a.lat - b.lat) < 1e-7 && Math.abs(a.lng - b.lng) < 1e-7;
}

function gpsMessage(err: GeolocationPositionError): string {
  if (err.code === err.PERMISSION_DENIED) {
    return "Location is off. Search any place, or enter coordinates. Nothing is picked for you.";
  }
  if (err.code === err.TIMEOUT) return "GPS timed out. The pin below is still the start.";
  return "No GPS fix. The pin below is still the start.";
}

async function writeClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const area = document.createElement("textarea");
      area.value = text;
      area.setAttribute("readonly", "");
      area.style.position = "fixed";
      area.style.left = "-9999px";
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand("copy");
      area.remove();
      return ok;
    } catch {
      return false;
    }
  }
}
