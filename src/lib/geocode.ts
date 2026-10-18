export type PlaceHit = {
  id: string;
  label: string;
  lat: number;
  lng: number;
};

type GeoResult = {
  id?: number;
  name?: string;
  admin1?: string;
  country?: string;
  latitude?: number;
  longitude?: number;
};

export async function searchPlaces(query: string, signal?: AbortSignal): Promise<PlaceHit[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const url = new URL("https://geocoding-api.open-meteo.com/v1/search");
  url.searchParams.set("name", q);
  url.searchParams.set("count", "6");
  url.searchParams.set("language", "en");
  url.searchParams.set("format", "json");
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error("Search failed");
  const data = (await res.json()) as { results?: GeoResult[] };
  const results = Array.isArray(data.results) ? data.results : [];
  return results
    .filter((r) => Number.isFinite(r.latitude) && Number.isFinite(r.longitude) && r.name)
    .map((r) => ({
      id: String(r.id ?? `${r.latitude},${r.longitude}`),
      label: [r.name, r.admin1, r.country].filter(Boolean).join(", "),
      lat: r.latitude as number,
      lng: r.longitude as number,
    }));
}
