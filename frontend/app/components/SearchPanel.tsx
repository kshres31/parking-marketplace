"use client";
import {
  FEATURES,
  type Feature,
  type SearchFilters,
  type Sort,
} from "../lib/types";

export const CITIES: Record<string, [number, number]> = {
  Chicago: [41.88, -87.63],
  "New York": [40.75, -73.99],
  "San Francisco": [37.78, -122.42],
};

export function SearchPanel({
  city,
  filters,
  busy,
  setCity,
  change,
  submit,
}: {
  city: string;
  filters: SearchFilters;
  busy: boolean;
  setCity: (city: string) => void;
  change: (next: Partial<SearchFilters>) => void;
  submit: () => void;
}) {
  const toggle = (feature: Feature) =>
    change({
      features: filters.features.includes(feature)
        ? filters.features.filter((f) => f !== feature)
        : [...filters.features, feature],
    });
  return (
    <form
      className="search-form"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <div className="search-bar">
        <label className="destination">
          Where are you going?
          <select value={city} onChange={(e) => setCity(e.target.value)}>
            {!(city in CITIES) && <option>{city}</option>}
            {Object.keys(CITIES).map((name) => (
              <option key={name}>{name}</option>
            ))}
          </select>
        </label>
        <label>
          Arrive
          <input
            required
            type="datetime-local"
            value={filters.start}
            onChange={(e) => change({ start: e.target.value })}
          />
        </label>
        <label>
          Leave
          <input
            required
            type="datetime-local"
            value={filters.end}
            onChange={(e) => change({ end: e.target.value })}
          />
        </label>
        <label>
          Within
          <select
            value={filters.radius}
            onChange={(e) => change({ radius: e.target.value })}
          >
            <option value="1000">1 km</option>
            <option value="5000">5 km</option>
            <option value="10000">10 km</option>
          </select>
        </label>
        <button className="button dark" disabled={busy}>
          {busy ? "Searching…" : "Find a space"}
        </button>
      </div>
      <div className="filters" role="group" aria-label="Search filters">
        <label>
          Max price
          <select
            value={filters.maxPrice}
            onChange={(e) => change({ maxPrice: e.target.value })}
          >
            <option value="">Any price</option>
            <option value="3">Up to $3/hr</option>
            <option value="5">Up to $5/hr</option>
            <option value="8">Up to $8/hr</option>
          </select>
        </label>
        <label>
          Sort by
          <select
            value={filters.sort}
            onChange={(e) => change({ sort: e.target.value as Sort })}
          >
            <option value="distance">Closest first</option>
            <option value="price">Lowest price</option>
          </select>
        </label>
        <div className="feature-chips">
          {FEATURES.map(([key, label]) => (
            <label
              key={key}
              className={filters.features.includes(key) ? "chip on" : "chip"}
            >
              <input
                type="checkbox"
                checked={filters.features.includes(key)}
                onChange={() => toggle(key)}
              />
              {label}
            </label>
          ))}
        </div>
      </div>
    </form>
  );
}
