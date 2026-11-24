"use client";
import { useState } from "react";
import { imageUrl } from "../lib/api";
import { date, featureLabel, money } from "../lib/format";
import type { Booking, Space } from "../lib/types";

export function HostView({
  spaces,
  bookings,
  busy,
  toggle,
  edit,
  remove,
}: {
  spaces: Space[];
  bookings: Booking[];
  busy: boolean;
  toggle: (space: Space) => void;
  edit: (space: Space) => void;
  remove: (space: Space) => void;
}) {
  const [when, setWhen] = useState<"upcoming" | "past">("upcoming");
  // shortcut: filters the newest 100 rows the API returns; add a server-side filter if owners need deeper history.
  const shown = bookings.filter(
    (b) => Date.parse(b.ends_at) > Date.now() === (when === "upcoming"),
  );
  return (
    <>
      <div className="booking-grid">
        {spaces.length === 0 && (
          <div className="empty">
            <h2>Your first space belongs here</h2>
            <p>Add a fictional listing to try the hosting workflow.</p>
          </div>
        )}
        {spaces.map((s) => (
          <article className="booking-card" key={s.id}>
            {!!s.image_ids?.length && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                className="card-photo"
                src={imageUrl(s.id, s.image_ids[0])}
                alt=""
              />
            )}
            <span className={`status ${s.active ? "confirmed" : "cancelled"}`}>
              {s.active ? "Accepting bookings" : "Paused"}
            </span>
            <h2>{s.title}</h2>
            <p>{s.address}</p>
            {s.description && <p>{s.description}</p>}
            {!!s.features?.length && (
              <p className="tags">{s.features.map(featureLabel).join(" · ")}</p>
            )}
            <p className="host-price">
              {money(s.hourly_price_cents)} <small>/ hour</small>
            </p>
            <div className="card-actions">
              <button
                className="button outline"
                disabled={busy}
                onClick={() => toggle(s)}
              >
                {s.active ? "Pause listing" : "Resume listing"}
              </button>
              <button className="text-button" onClick={() => edit(s)}>
                Edit
              </button>
              <button className="text-button danger" onClick={() => remove(s)}>
                Delete
              </button>
            </div>
          </article>
        ))}
      </div>
      <div className="subheading-row">
        <h2 className="subheading">Reservations at your spaces</h2>
        <label>
          Show
          <select
            value={when}
            onChange={(e) => setWhen(e.target.value as "upcoming" | "past")}
          >
            <option value="upcoming">Upcoming</option>
            <option value="past">Past</option>
          </select>
        </label>
      </div>
      {shown.length === 0 ? (
        <p className="muted">
          {when === "upcoming"
            ? "New reservations will appear here."
            : "No past reservations yet."}
        </p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Space</th>
                <th>Customer</th>
                <th>Arrival</th>
                <th>Total</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((b) => (
                <tr key={b.id}>
                  <td>{b.title}</td>
                  <td>{b.customer}</td>
                  <td>{date(b.starts_at)}</td>
                  <td>{money(b.total_price_cents)}</td>
                  <td>{b.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
