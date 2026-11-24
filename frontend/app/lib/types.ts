export type Role = "customer" | "owner";
export type User = { id: string; username: string; role: Role };
export const FEATURES = [
  ["covered", "Covered"],
  ["ev_charging", "EV charging"],
  ["security", "Security"],
  ["accessible", "Step-free access"],
  ["oversize", "Fits large vehicles"],
] as const;
export type Feature = (typeof FEATURES)[number][0];
export type Space = {
  id: string;
  title: string;
  address: string;
  description?: string;
  features?: Feature[];
  image_ids?: string[];
  latitude: number;
  longitude: number;
  hourly_price_cents: number;
  distance_m?: number;
  active?: boolean;
};
export type Booking = {
  id: string;
  title: string;
  address: string;
  starts_at: string;
  ends_at: string;
  total_price_cents: number;
  status: string;
  payment_status: string;
  hold_expires_at?: string;
  customer?: string;
};
export type Period = { starts_at: string; ends_at: string };
export type Sort = "distance" | "price";
export type SearchFilters = {
  center: [number, number];
  start: string;
  end: string;
  radius: string;
  maxPrice: string;
  features: Feature[];
  sort: Sort;
};
export type ListingBody = {
  title: string;
  address: string;
  description: string;
  latitude: number;
  longitude: number;
  hourly_price_cents: number;
  features: Feature[];
};
