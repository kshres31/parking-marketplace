"use client";
import { imageUrl } from "../lib/api";
import { date, featureLabel, money, stayTotal } from "../lib/format";
import type { Period, Space, User } from "../lib/types";
import { Alert, Modal } from "./Modal";

export function SpaceDialog({
  space,
  period,
  user,
  mode,
  busy,
  error,
  reserve,
  close,
}: {
  space: Space;
  period: Period | null;
  user: User | null;
  mode: string;
  busy: boolean;
  error: string;
  reserve: () => void;
  close: () => void;
}) {
  const label = busy
    ? "Reserving…"
    : user?.role === "owner"
      ? "Owner accounts cannot reserve"
      : !user
        ? "Sign in to reserve"
        : mode === "demo"
          ? "Reserve demo space"
          : "Hold space for checkout";
  return (
    <Modal title="Your parking space" close={close}>
      <p className="eyebrow">
        {space.distance_m
          ? Math.round(space.distance_m) + " M FROM YOUR SEARCH"
          : "PARKING DETAILS"}
      </p>
      <h3 className="modal-title">{space.title}</h3>
      <p className="muted">{space.address}</p>
      {!!space.image_ids?.length && (
        <div className="gallery">
          {space.image_ids.map((id, i) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={id}
              src={imageUrl(space.id, id)}
              alt={`${space.title}, photo ${i + 1}`}
            />
          ))}
        </div>
      )}
      {space.description && <p className="description">{space.description}</p>}
      {!!space.features?.length && (
        <ul className="feature-list" aria-label="Features">
          {space.features.map((f) => (
            <li key={f}>{featureLabel(f)}</li>
          ))}
        </ul>
      )}
      {period && (
        <div className="reservation-times">
          <div>
            <span>Arrive</span>
            <strong>{date(period.starts_at)}</strong>
          </div>
          <div>
            <span>Leave</span>
            <strong>{date(period.ends_at)}</strong>
          </div>
        </div>
      )}
      <div className="total">
        <span>Total for your stay</span>
        <strong>
          {money(period ? stayTotal(space.hourly_price_cents, period) : 0)}
        </strong>
      </div>
      <p className="muted">
        {mode === "demo"
          ? "Demo reservation. No payment will be taken."
          : "Test card checkout follows your reservation. Hold valid for 35 minutes."}
      </p>
      <Alert error={error} />
      <button
        className="button dark full"
        disabled={busy || user?.role === "owner"}
        onClick={reserve}
      >
        {label}
      </button>
    </Modal>
  );
}
