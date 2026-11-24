"use client";
import { date, money } from "../lib/format";
import type { Booking } from "../lib/types";

export function BookingsView({
  bookings,
  busy,
  checkout,
  cancel,
  findParking,
  loadMore,
}: {
  bookings: Booking[];
  busy: boolean;
  checkout: (booking: Booking) => void;
  cancel: (booking: Booking) => void;
  findParking: () => void;
  loadMore?: () => void;
}) {
  if (bookings.length === 0)
    return (
      <div className="empty">
        <h2>No bookings yet</h2>
        <p>Your next stop starts with a parking space.</p>
        <button className="button dark" onClick={findParking}>
          Find parking
        </button>
      </div>
    );
  return (
    <>
      <div className="booking-grid">
        {bookings.map((b) => (
          <article className="booking-card" key={b.id}>
            <div className="booking-top">
              <span className={`status ${b.status}`}>
                {b.status === "held" ? "Awaiting payment" : b.status}
              </span>
              <span>{money(b.total_price_cents)}</span>
            </div>
            <h2>{b.title}</h2>
            <p>{b.address}</p>
            <dl>
              <dt>Arrive</dt>
              <dd>{date(b.starts_at)}</dd>
              <dt>Leave</dt>
              <dd>{date(b.ends_at)}</dd>
              <dt>Payment</dt>
              <dd>{b.payment_status.replaceAll("_", " ")}</dd>
            </dl>
            {b.status === "held" && b.hold_expires_at && (
              <p>Hold ends {date(b.hold_expires_at)}.</p>
            )}
            <div className="card-actions">
              {b.status === "held" && (
                <button
                  className="button dark"
                  disabled={busy}
                  onClick={() => checkout(b)}
                >
                  Continue to test checkout
                </button>
              )}
              {b.status !== "cancelled" &&
                new Date(b.starts_at).getTime() > Date.now() && (
                  <button
                    className="text-button danger"
                    onClick={() => cancel(b)}
                  >
                    Cancel booking
                  </button>
                )}
            </div>
          </article>
        ))}
      </div>
      {loadMore && (
        <button
          className="button outline load-more"
          disabled={busy}
          onClick={loadMore}
        >
          Load more bookings
        </button>
      )}
    </>
  );
}
