"use client";
import { imageUrl } from "../lib/api";
import { featureLabel, money } from "../lib/format";
import type { Sort, Space } from "../lib/types";

export function SpaceList({
  spaces,
  busy,
  sort,
  selected,
  select,
}: {
  spaces: Space[];
  busy: boolean;
  sort: Sort;
  selected?: string;
  select: (space: Space) => void;
}) {
  return (
    <div className="results">
      <div className="results-heading">
        <div>
          <h2>
            {busy
              ? "Finding your options…"
              : `${spaces.length} available spaces`}
          </h2>
          <p>
            {sort === "price" ? "Lowest price first" : "Closest first"} · hourly
            prices in USD
          </p>
        </div>
        <span className="list-mark" aria-hidden="true">
          ☷
        </span>
      </div>
      {!busy && spaces.length === 0 && (
        <div className="empty">
          <span className="empty-symbol">P</span>
          <h3>No spaces in this search</h3>
          <p>
            Try a wider radius, different times or fewer filters. The local demo
            includes fictional Chicago listings.
          </p>
        </div>
      )}
      {spaces.map((space, i) => (
        <button
          className={`space-card ${selected === space.id ? "selected" : ""}`}
          key={space.id}
          onClick={() => select(space)}
        >
          {space.image_ids?.length ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              className="space-thumb"
              src={imageUrl(space.id, space.image_ids[0])}
              alt=""
            />
          ) : (
            <span className="space-number">
              {String(i + 1).padStart(2, "0")}
            </span>
          )}
          <span className="space-info">
            <strong>{space.title}</strong>
            <span>{space.address}</span>
            {!!space.features?.length && (
              <span className="tags">
                {space.features.map(featureLabel).join(" · ")}
              </span>
            )}
            <span className="distance">
              {Math.round(space.distance_m || 0)} m from search center
            </span>
          </span>
          <span className="space-price">
            <strong>{money(space.hourly_price_cents)}</strong>
            <span>/ hour</span>
            <span className="view-space">View space ↗</span>
          </span>
        </button>
      ))}
      <p className="results-note">
        Availability is checked again when you reserve.
      </p>
    </div>
  );
}
