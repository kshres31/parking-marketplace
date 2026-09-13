"use client";
import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import type { Space } from "./map";
const ParkingMap = dynamic(() => import("./map"), {
  ssr: false,
  loading: () => <div className="map map-loading">Loading map…</div>,
});
type User = { id: string; username: string };
type Booking = {
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
type Period = { starts_at: string; ends_at: string };
const money = (cents: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    cents / 100,
  );
const date = (value: string) =>
  new Date(value).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
const localInput = (value: Date) =>
  new Date(value.getTime() - value.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      "X-Browser-Session": "1",
      ...init?.headers,
    },
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(
      typeof data.detail === "string"
        ? data.detail
        : Array.isArray(data.detail)
          ? data.detail.map((e: { msg: string }) => e.msg).join(". ")
          : "Unable to complete this request. Please try again.",
    );
  }
  return response.status === 204 ? (undefined as T) : response.json();
}
function Modal({
  title,
  close,
  children,
}: {
  title: string;
  close: () => void;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog ref={ref} onCancel={close}>
      <div className="modal-head">
        <h2>{title}</h2>
        <button
          className="icon-button"
          aria-label="Close dialog"
          onClick={close}
        >
          ×
        </button>
      </div>
      {children}
    </dialog>
  );
}
export default function Home() {
  const [view, setView] = useState("search");
  const [user, setUser] = useState<User | null>(null);
  const [mode, setMode] = useState("demo");
  const [spaces, setSpaces] = useState<Space[]>([]);
  const [center, setCenter] = useState<[number, number]>([41.88, -87.63]);
  const [city, setCity] = useState("Chicago");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [radius, setRadius] = useState("5000");
  const [period, setPeriod] = useState<Period | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [selected, setSelected] = useState<Space | null>(null);
  const [auth, setAuth] = useState<"login" | "register" | null>(null);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [hostSpaces, setHostSpaces] = useState<Space[]>([]);
  const [hostBookings, setHostBookings] = useState<Booking[]>([]);
  const [adding, setAdding] = useState(false);
  const [cancelling, setCancelling] = useState<Booking | null>(null);
  const retry = useRef<{ payload: string; key: string } | null>(null);
  const requestVersion = useRef(0);
  const search = useCallback(
    async (
      where: [number, number],
      from: string,
      to: string,
      range: string,
    ) => {
      const version = ++requestVersion.current;
      setBusy(true);
      setError("");
      try {
        const duration = new Date(to).getTime() - new Date(from).getTime();
        if (
          !Number.isFinite(duration) ||
          duration <= 0 ||
          duration > 30 * 86400000
        )
          throw new Error("Choose an end after the start, within 30 days.");
        if (new Date(from).getTime() <= Date.now())
          throw new Error("Choose a start time in the future.");
        const next = {
          starts_at: new Date(from).toISOString(),
          ends_at: new Date(to).toISOString(),
        };
        const rows = await api<Space[]>(
          "/listings?" +
            new URLSearchParams({
              ...next,
              latitude: String(where[0]),
              longitude: String(where[1]),
              radius_m: range,
            }),
        );
        if (version === requestVersion.current) {
          setSpaces(rows);
          setPeriod(next);
          setSelected(null);
        }
      } catch (e) {
        if (version === requestVersion.current) {
          setError((e as Error).message);
          setSpaces([]);
          setPeriod(null);
        }
      } finally {
        if (version === requestVersion.current) setBusy(false);
      }
    },
    [],
  );
  useEffect(() => {
    const beginning = new Date(Date.now() + 86400000);
    beginning.setMinutes(0, 0, 0);
    const from = localInput(beginning),
      to = localInput(new Date(beginning.getTime() + 7200000));
    setStart(from);
    setEnd(to);
    void search([41.88, -87.63], from, to, "5000");
    void api<{ payments_mode: string }>("/config")
      .then((c) => setMode(c.payments_mode))
      .catch(() => {});
    void api<User>("/me")
      .then(setUser)
      .catch(() => {});
    const initialView = new URLSearchParams(window.location.search).get("view");
    if (initialView === "bookings") {
      setView("bookings");
      setNotice(
        "Payment status comes from the payment provider. Refresh if confirmation is still pending.",
      );
    }
  }, [search]);
  const refresh = useCallback(async () => {
    if (!user) return;
    try {
      if (view === "bookings") setBookings(await api<Booking[]>("/bookings"));
      if (view === "host") {
        const [owned, reservations] = await Promise.all([
          api<Space[]>("/host/listings"),
          api<Booking[]>("/host/bookings"),
        ]);
        setHostSpaces(owned);
        setHostBookings(reservations);
      }
    } catch (e) {
      setError((e as Error).message);
    }
  }, [user, view]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  function navigate(next: string) {
    setView(next);
    setError("");
    setNotice("");
    setSelected(null);
    window.history.replaceState(
      null,
      "",
      next === "search" ? "/" : "/?view=" + next,
    );
  }
  async function act(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    await act(async () => {
      const result = await api<{ user: User }>("/auth/" + auth, {
        method: "POST",
        body: JSON.stringify(Object.fromEntries(data)),
      });
      setUser(result.user);
      setAuth(null);
      setNotice("Signed in as " + result.user.username + ".");
    });
  }
  async function reserve() {
    if (!user) {
      setAuth("login");
      return;
    }
    if (!selected || !period) return;
    await act(async () => {
      const payload = JSON.stringify({ listing_id: selected.id, ...period });
      if (retry.current?.payload !== payload)
        retry.current = { payload, key: crypto.randomUUID() };
      const booking = await api<Booking>("/bookings", {
        method: "POST",
        headers: { "Idempotency-Key": retry.current.key },
        body: payload,
      });
      retry.current = null;
      setSelected(null);
      setView("bookings");
      setBookings(await api<Booking[]>("/bookings"));
      setNotice(
        booking.status === "held"
          ? "Your space is held for 35 minutes. Continue to test checkout."
          : "Your demo reservation is confirmed. No payment was taken.",
      );
    });
  }
  const select = useCallback((space: Space) => {
    setSelected(space);
    setError("");
  }, []);
  const total =
    selected && period
      ? Math.ceil(
          (selected.hourly_price_cents *
            (Date.parse(period.ends_at) - Date.parse(period.starts_at))) /
            3600000,
        )
      : 0;
  const message = (
    <>
      {error && (
        <p className="alert error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="alert success" role="status">
          {notice}
        </p>
      )}
    </>
  );
  return (
    <>
      <a className="skip" href="#main">
        Skip to content
      </a>
      <header className="header">
        <a href="/" className="brand" aria-label="Parkside home">
          <span className="brand-icon">P</span>parkside
          <span className="brand-dot">.</span>
        </a>
        <nav aria-label="Main navigation">
          {[
            ["search", "Find parking"],
            ["bookings", "My bookings"],
            ["host", "Host a space"],
          ].map(([key, label]) => (
            <button
              key={key}
              className={view === key ? "nav-active" : ""}
              onClick={() => navigate(key)}
            >
              {label}
            </button>
          ))}
        </nav>
        {user ? (
          <div className="account">
            <span>{user.username}</span>
            <button
              className="text-button"
              onClick={() =>
                void act(async () => {
                  await api("/auth/logout", { method: "POST" });
                  setUser(null);
                  setBookings([]);
                  setHostSpaces([]);
                  setHostBookings([]);
                  navigate("search");
                })
              }
            >
              Sign out
            </button>
          </div>
        ) : (
          <button
            className="button dark small"
            onClick={() => {
              setError("");
              setAuth("login");
            }}
          >
            Sign in
          </button>
        )}
      </header>
      <div className="demo-bar">
        <span className="label-tag">
          {mode === "demo" ? "PORTFOLIO DEMO" : "STRIPE TEST MODE"}
        </span>
        <span>
          Fictional spaces.{" "}
          {mode === "demo"
            ? "No payments or real parking rights."
            : "Use test cards only. No real parking rights."}
        </span>
      </div>
      <main id="main">
        {view === "search" ? (
          <>
            <section className="search-heading">
              <div>
                <p className="eyebrow">LESS CIRCLING. MORE ARRIVING.</p>
                <h1>A space for your next stop.</h1>
              </div>
              <span className="city-label">
                {city} · {Intl.DateTimeFormat().resolvedOptions().timeZone}
              </span>
            </section>
            <form
              className="search-bar"
              onSubmit={(e) => {
                e.preventDefault();
                void search(center, start, end, radius);
              }}
            >
              <label className="destination">
                Where are you going?
                <select
                  value={city}
                  onChange={(e) => {
                    const choices: Record<string, [number, number]> = {
                      Chicago: [41.88, -87.63],
                      "New York": [40.75, -73.99],
                      "San Francisco": [37.78, -122.42],
                    };
                    setCity(e.target.value);
                    setCenter(choices[e.target.value]);
                    setSpaces([]);
                    setPeriod(null);
                  }}
                >
                  <option>Chicago</option>
                  <option>New York</option>
                  <option>San Francisco</option>
                </select>
              </label>
              <label>
                Arrive
                <input
                  required
                  type="datetime-local"
                  value={start}
                  onChange={(e) => setStart(e.target.value)}
                />
              </label>
              <label>
                Leave
                <input
                  required
                  type="datetime-local"
                  value={end}
                  onChange={(e) => setEnd(e.target.value)}
                />
              </label>
              <label>
                Within
                <select
                  value={radius}
                  onChange={(e) => setRadius(e.target.value)}
                >
                  <option value="1000">1 km</option>
                  <option value="5000">5 km</option>
                  <option value="10000">10 km</option>
                </select>
              </label>
              <button className="button dark" disabled={busy}>
                {busy ? "Searching…" : "Find a space"}
              </button>
            </form>
            {message}
            <section className="results-layout">
              <div className="results">
                <div className="results-heading">
                  <div>
                    <h2>
                      {busy
                        ? "Finding your options…"
                        : `${spaces.length} available spaces`}
                    </h2>
                    <p>Closest first · hourly prices in USD</p>
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
                      Try a wider radius or different times. The local demo
                      includes fictional Chicago listings.
                    </p>
                  </div>
                )}
                {spaces.map((space, i) => (
                  <button
                    className={`space-card ${selected?.id === space.id ? "selected" : ""}`}
                    key={space.id}
                    onClick={() => select(space)}
                  >
                    <span className="space-number">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <span className="space-info">
                      <strong>{space.title}</strong>
                      <span>{space.address}</span>
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
              <div className="map-wrap">
                <ParkingMap
                  spaces={spaces}
                  center={center}
                  selected={selected?.id}
                  select={select}
                />
                <div className="map-caption">
                  A little closer to where you’re going.
                </div>
              </div>
            </section>
          </>
        ) : (
          <section className="workspace">
            <div className="section-heading">
              <div>
                <p className="eyebrow">
                  {view === "bookings"
                    ? "YOUR NEXT STOPS"
                    : "MAKE ROOM FOR SOMEONE"}
                </p>
                <h1>
                  {view === "bookings" ? "My bookings" : "Your parking spaces"}
                </h1>
              </div>
              {user && (
                <button
                  className="button dark"
                  onClick={() =>
                    view === "host" ? setAdding(true) : void refresh()
                  }
                >
                  {view === "host" ? "+ List a space" : "Refresh status"}
                </button>
              )}
            </div>
            {message}
            {!user ? (
              <div className="empty">
                <h2>A space of your own</h2>
                <p>Sign in to manage your bookings and parking listings.</p>
                <button
                  className="button dark"
                  onClick={() => setAuth("login")}
                >
                  Sign in
                </button>
              </div>
            ) : view === "bookings" ? (
              <>
                {bookings.length === 0 && (
                  <div className="empty">
                    <h2>No bookings yet</h2>
                    <p>Your next stop starts with a parking space.</p>
                    <button
                      className="button dark"
                      onClick={() => navigate("search")}
                    >
                      Find parking
                    </button>
                  </div>
                )}
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
                      {b.status === "held" && (
                        <p>Hold ends {date(b.hold_expires_at!)}.</p>
                      )}
                      <div className="card-actions">
                        {b.status === "held" && (
                          <button
                            className="button dark"
                            disabled={busy}
                            onClick={() =>
                              void act(async () => {
                                const result = await api<{ url: string }>(
                                  `/bookings/${b.id}/checkout`,
                                  { method: "POST" },
                                );
                                window.location.assign(result.url);
                              })
                            }
                          >
                            Continue to test checkout
                          </button>
                        )}
                        {b.status !== "cancelled" &&
                          new Date(b.starts_at).getTime() > Date.now() && (
                            <button
                              className="text-button danger"
                              onClick={() => setCancelling(b)}
                            >
                              Cancel booking
                            </button>
                          )}
                      </div>
                    </article>
                  ))}
                </div>
              </>
            ) : (
              <>
                <div className="booking-grid">
                  {hostSpaces.length === 0 && (
                    <div className="empty">
                      <h2>Your first space belongs here</h2>
                      <p>
                        Add a fictional listing to try the hosting workflow.
                      </p>
                    </div>
                  )}
                  {hostSpaces.map((s) => (
                    <article className="booking-card" key={s.id}>
                      <span
                        className={`status ${s.active ? "confirmed" : "cancelled"}`}
                      >
                        {s.active ? "Accepting bookings" : "Paused"}
                      </span>
                      <h2>{s.title}</h2>
                      <p>{s.address}</p>
                      <p className="host-price">
                        {money(s.hourly_price_cents)} <small>/ hour</small>
                      </p>
                      <button
                        className="button outline"
                        disabled={busy}
                        onClick={() =>
                          void act(async () => {
                            await api(`/listings/${s.id}`, {
                              method: "PATCH",
                              body: JSON.stringify({ active: !s.active }),
                            });
                            await refresh();
                          })
                        }
                      >
                        {s.active ? "Pause listing" : "Resume listing"}
                      </button>
                    </article>
                  ))}
                </div>
                <h2 className="subheading">Reservations at your spaces</h2>
                {hostBookings.length === 0 ? (
                  <p className="muted">New reservations will appear here.</p>
                ) : (
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Space</th>
                          <th>Customer</th>
                          <th>Arrival</th>
                          <th>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {hostBookings.map((b) => (
                          <tr key={b.id}>
                            <td>{b.title}</td>
                            <td>{b.customer}</td>
                            <td>{date(b.starts_at)}</td>
                            <td>{b.status}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}
          </section>
        )}
      </main>
      <footer>
        <span className="footer-brand">parkside.</span>
        <span>Built for the journey between here and there.</span>
        <a href="/docs">API documentation</a>
      </footer>
      {selected && !auth && (
        <Modal title="Your parking space" close={() => setSelected(null)}>
          <p className="eyebrow">
            {selected.distance_m
              ? Math.round(selected.distance_m) + " M FROM YOUR SEARCH"
              : "PARKING DETAILS"}
          </p>
          <h3 className="modal-title">{selected.title}</h3>
          <p className="muted">{selected.address}</p>
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
            <strong>{money(total)}</strong>
          </div>
          <p className="muted">
            {mode === "demo"
              ? "Demo reservation. No payment will be taken."
              : "Test card checkout follows your reservation. Hold valid for 35 minutes."}
          </p>
          {error && (
            <p className="alert error" role="alert">
              {error}
            </p>
          )}
          <button
            className="button dark full"
            disabled={busy}
            onClick={() => void reserve()}
          >
            {busy
              ? "Reserving…"
              : user
                ? mode === "demo"
                  ? "Reserve demo space"
                  : "Hold space for checkout"
                : "Sign in to reserve"}
          </button>
        </Modal>
      )}
      {auth && (
        <Modal
          title={auth === "login" ? "Welcome back" : "Make yourself at home"}
          close={() => {
            setAuth(null);
            setError("");
          }}
        >
          <p className="muted">
            {auth === "login"
              ? "Sign in to find your next space."
              : "One account for finding and hosting parking."}
          </p>
          <form className="stack" onSubmit={signIn}>
            <label>
              Username
              <input
                name="username"
                autoComplete="username"
                required
                minLength={3}
                maxLength={40}
                pattern="[a-z][a-z0-9_-]{2,39}"
                placeholder="e.g. alex_parks"
              />
            </label>
            <label>
              Password
              <input
                name="password"
                type="password"
                autoComplete={
                  auth === "login" ? "current-password" : "new-password"
                }
                required
                minLength={12}
                maxLength={128}
              />
            </label>
            <p className="field-note">
              Lowercase username. Password must have at least 12 characters.
            </p>
            {error && (
              <p className="alert error" role="alert">
                {error}
              </p>
            )}
            <button className="button dark full" disabled={busy}>
              {busy
                ? "Please wait…"
                : auth === "login"
                  ? "Sign in"
                  : "Create account"}
            </button>
          </form>
          <button
            className="text-button auth-switch"
            onClick={() => {
              setAuth(auth === "login" ? "register" : "login");
              setError("");
            }}
          >
            {auth === "login"
              ? "New here? Create an account"
              : "Already have an account? Sign in"}
          </button>
        </Modal>
      )}
      {adding && (
        <Modal title="List a parking space" close={() => setAdding(false)}>
          <form
            className="stack"
            onSubmit={(e) => {
              e.preventDefault();
              const data = new FormData(e.currentTarget);
              void act(async () => {
                await api("/listings", {
                  method: "POST",
                  body: JSON.stringify({
                    title: data.get("title"),
                    address: data.get("address"),
                    latitude: Number(data.get("latitude")),
                    longitude: Number(data.get("longitude")),
                    hourly_price_cents: Math.round(
                      Number(data.get("price")) * 100,
                    ),
                  }),
                });
                setAdding(false);
                await refresh();
              });
            }}
          >
            <label>
              Space name
              <input
                name="title"
                minLength={3}
                maxLength={120}
                required
                placeholder="e.g. River North covered space"
              />
            </label>
            <label>
              Address
              <input
                name="address"
                minLength={3}
                maxLength={250}
                required
                placeholder="Fictional demo address"
              />
            </label>
            <div className="two-columns">
              <label>
                Latitude
                <input
                  name="latitude"
                  type="number"
                  step="any"
                  min="-90"
                  max="90"
                  required
                  defaultValue="41.88"
                />
              </label>
              <label>
                Longitude
                <input
                  name="longitude"
                  type="number"
                  step="any"
                  min="-180"
                  max="180"
                  required
                  defaultValue="-87.63"
                />
              </label>
            </div>
            <label>
              Hourly price (USD)
              <input
                name="price"
                type="number"
                step="0.01"
                min="0.01"
                max="1000"
                defaultValue="4.00"
                required
              />
            </label>
            <p className="field-note">
              Listings are available around the clock until paused. Add
              fictional locations only.
            </p>
            {error && (
              <p className="alert error" role="alert">
                {error}
              </p>
            )}
            <button className="button dark full" disabled={busy}>
              {busy ? "Saving…" : "Publish demo listing"}
            </button>
          </form>
        </Modal>
      )}
      {cancelling && (
        <Modal title="Cancel this booking?" close={() => setCancelling(null)}>
          <p>{cancelling.title}</p>
          <p className="muted">
            Your space will be released immediately.{" "}
            {cancelling.payment_status === "paid"
              ? "A full test refund will be queued; its status will appear in your bookings."
              : "No payment was taken for this booking."}
          </p>
          {error && (
            <p className="alert error" role="alert">
              {error}
            </p>
          )}
          <div className="card-actions">
            <button
              className="button outline"
              onClick={() => setCancelling(null)}
            >
              Keep booking
            </button>
            <button
              className="button dark"
              disabled={busy}
              onClick={() =>
                void act(async () => {
                  await api(`/bookings/${cancelling.id}/cancel`, {
                    method: "POST",
                  });
                  setCancelling(null);
                  await refresh();
                  setNotice("Booking cancelled.");
                })
              }
            >
              Confirm cancellation
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
