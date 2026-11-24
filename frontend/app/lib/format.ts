import {
  FEATURES,
  type Feature,
  type ListingBody,
  type Period,
  type SearchFilters,
} from "./types";

const MAX_DAYS = 30;
export const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
export const MAX_IMAGES = 6;

export const money = (cents: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    cents / 100,
  );

export const date = (value: string) =>
  new Date(value).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

/** Format a Date for a datetime-local input in the browser's timezone. */
export const localInput = (value: Date) =>
  new Date(value.getTime() - value.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);

export const featureLabel = (feature: Feature) =>
  FEATURES.find(([key]) => key === feature)?.[1] ?? feature;

/** Mirror of the server's rounding: hourly price times elapsed time, rounded up once. */
export const stayTotal = (hourlyCents: number, period: Period) =>
  Math.ceil(
    (hourlyCents *
      (Date.parse(period.ends_at) - Date.parse(period.starts_at))) /
      3600000,
  );

/** Validate local datetime inputs and convert them to the UTC period the API expects. */
export function toPeriod(from: string, to: string, now = Date.now()): Period {
  const start = new Date(from).getTime();
  const duration = new Date(to).getTime() - start;
  if (
    !Number.isFinite(duration) ||
    duration <= 0 ||
    duration > MAX_DAYS * 86400000
  )
    throw new Error(`Choose an end after the start, within ${MAX_DAYS} days.`);
  if (start <= now) throw new Error("Choose a start time in the future.");
  return {
    starts_at: new Date(from).toISOString(),
    ends_at: new Date(to).toISOString(),
  };
}

export function searchQuery(filters: SearchFilters, period: Period): string {
  const params = new URLSearchParams({
    ...period,
    latitude: String(filters.center[0]),
    longitude: String(filters.center[1]),
    radius_m: filters.radius,
    sort: filters.sort,
  });
  if (filters.maxPrice)
    params.set(
      "max_price_cents",
      String(Math.round(Number(filters.maxPrice) * 100)),
    );
  for (const feature of filters.features) params.append("features", feature);
  return params.toString();
}

/** Build and validate the listing request body from the listing form. */
export function listingBody(data: FormData): ListingBody {
  const text = (name: string) => String(data.get(name) ?? "").trim();
  const price = Number(data.get("price"));
  const latitude = Number(data.get("latitude"));
  const longitude = Number(data.get("longitude"));
  if (text("title").length < 3)
    throw new Error("Give the space a name of at least 3 characters.");
  if (text("address").length < 3)
    throw new Error("Add an address of at least 3 characters.");
  if (!Number.isFinite(price) || price < 0.01 || price > 1000)
    throw new Error("Hourly price must be between $0.01 and $1,000.");
  if (
    !Number.isFinite(latitude) ||
    Math.abs(latitude) > 90 ||
    !Number.isFinite(longitude) ||
    Math.abs(longitude) > 180
  )
    throw new Error("Enter a valid latitude and longitude.");
  const known = new Set<string>(FEATURES.map(([key]) => key));
  return {
    title: text("title"),
    address: text("address"),
    description: text("description"),
    latitude,
    longitude,
    hourly_price_cents: Math.round(price * 100),
    features: data
      .getAll("features")
      .map(String)
      .filter((f): f is Feature => known.has(f)),
  };
}

/** Reject files the server would refuse, before uploading them. */
export function checkImages(files: File[], existing = 0): string | null {
  if (existing + files.length > MAX_IMAGES)
    return `A listing can have at most ${MAX_IMAGES} photos.`;
  for (const file of files) {
    if (!IMAGE_TYPES.includes(file.type))
      return `${file.name} is not a JPEG, PNG or WebP image.`;
    if (file.size > MAX_IMAGE_BYTES) return `${file.name} is larger than 2 MB.`;
  }
  return null;
}

export function errorMessage(data: unknown): string {
  const detail = (data as { detail?: unknown } | null)?.detail;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail))
    return detail.map((e: { msg: string }) => e.msg).join(". ");
  return "Unable to complete this request. Please try again.";
}
