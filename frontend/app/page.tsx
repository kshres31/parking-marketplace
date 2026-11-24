"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { AuthDialog, type Credentials } from "./components/AuthDialog";
import { BookingsView } from "./components/BookingsView";
import { ConfirmDialog } from "./components/ConfirmDialog";
import { HostView } from "./components/HostView";
import { ListingDialog } from "./components/ListingDialog";
import { Alert } from "./components/Modal";
import { CITIES, SearchPanel } from "./components/SearchPanel";
import { SpaceDialog } from "./components/SpaceDialog";
import { SpaceList } from "./components/SpaceList";
import { api, json, uploadImages } from "./lib/api";
import { localInput, searchQuery, toPeriod } from "./lib/format";
import type {
  Booking,
  ListingBody,
  Period,
  SearchFilters,
  Space,
  User,
} from "./lib/types";

const ParkingMap = dynamic(() => import("./map"), {
  ssr: false,
  loading: () => <div className="map map-loading">Loading map…</div>,
});

type View = "search" | "bookings" | "host";
const VIEW_ROLE = { bookings: "customer", host: "owner" } as const;
const BOOKING_PAGE = 20;

export default function Home() {
  const [view, setView] = useState<View>("search");
  const [user, setUser] = useState<User | null>(null);
  const [mode, setMode] = useState("demo");
  const [city, setCity] = useState("Chicago");
  const [filters, setFilters] = useState<SearchFilters>({
    center: CITIES.Chicago,
    start: "",
    end: "",
    radius: "5000",
    maxPrice: "",
    features: [],
    sort: "distance",
  });
  const [spaces, setSpaces] = useState<Space[]>([]);
  const [period, setPeriod] = useState<Period | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [selected, setSelected] = useState<Space | null>(null);
  const [auth, setAuth] = useState<"login" | "register" | null>(null);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [moreBookings, setMoreBookings] = useState(false);
  const [hostSpaces, setHostSpaces] = useState<Space[]>([]);
  const [hostBookings, setHostBookings] = useState<Booking[]>([]);
  const [editing, setEditing] = useState<Space | "new" | null>(null);
  const [cancelling, setCancelling] = useState<Booking | null>(null);
  const [deleting, setDeleting] = useState<Space | null>(null);
  const retry = useRef<{ payload: string; key: string } | null>(null);
  const requestVersion = useRef(0);

  const search = useCallback(async (next: SearchFilters) => {
    // Only the newest search may update results, so slow responses cannot overwrite fresh ones.
    const version = ++requestVersion.current;
    setBusy(true);
    setError("");
    try {
      const chosen = toPeriod(next.start, next.end);
      const rows = await api<Space[]>("/listings?" + searchQuery(next, chosen));
      if (version === requestVersion.current) {
        setSpaces(rows);
        setPeriod(chosen);
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
  }, []);

  useEffect(() => {
    const beginning = new Date(Date.now() + 86400000);
    beginning.setMinutes(0, 0, 0);
    const initial: SearchFilters = {
      center: CITIES.Chicago,
      start: localInput(beginning),
      end: localInput(new Date(beginning.getTime() + 7200000)),
      radius: "5000",
      maxPrice: "",
      features: [],
      sort: "distance",
    };
    setFilters(initial);
    void search(initial);
    void api<{ payments_mode: string }>("/config")
      .then((c) => setMode(c.payments_mode))
      .catch(() => {});
    void api<User>("/me")
      .then(setUser)
      .catch(() => {});
    if (
      new URLSearchParams(window.location.search).get("view") === "bookings"
    ) {
      setView("bookings");
      setNotice(
        "Payment status comes from the payment provider. Refresh if confirmation is still pending.",
      );
    }
  }, [search]);

  const refresh = useCallback(async () => {
    if (!user) return;
    try {
      if (view === "bookings" && user.role === "customer") {
        const first = await api<Booking[]>(`/bookings?limit=${BOOKING_PAGE}`);
        setBookings(first);
        setMoreBookings(first.length === BOOKING_PAGE);
      }
      if (view === "host" && user.role === "owner") {
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

  function navigate(next: View) {
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

  const signIn = (credentials: Credentials) =>
    void act(async () => {
      const result = await api<{ user: User }>(
        "/auth/" + auth,
        json("POST", credentials),
      );
      setUser(result.user);
      setAuth(null);
      setNotice("Signed in as " + result.user.username + ".");
    });

  const signOut = () =>
    void act(async () => {
      await api("/auth/logout", { method: "POST" });
      setUser(null);
      setBookings([]);
      setHostSpaces([]);
      setHostBookings([]);
      navigate("search");
    });

  function reserve() {
    if (!user) return setAuth("login");
    if (!selected || !period) return;
    void act(async () => {
      const payload = JSON.stringify({ listing_id: selected.id, ...period });
      // Reuse the idempotency key when retrying the same request after a failure.
      if (retry.current?.payload !== payload)
        retry.current = { payload, key: crypto.randomUUID() };
      const booking = await api<Booking>("/bookings", {
        method: "POST",
        headers: { "Idempotency-Key": retry.current.key },
        body: payload,
      });
      retry.current = null;
      setSelected(null);
      navigate("bookings");
      setNotice(
        booking.status === "held"
          ? "Your space is held for 35 minutes. Continue to test checkout."
          : "Your demo reservation is confirmed. No payment was taken.",
      );
    });
  }

  function saveListing(body: ListingBody, files: File[]) {
    void act(async () => {
      const target = editing === "new" ? null : editing;
      const saved = target
        ? await api<Space>(`/listings/${target.id}`, json("PATCH", body))
        : await api<Space>("/listings", json("POST", body));
      setEditing(null);
      try {
        await uploadImages(saved.id, files);
      } finally {
        await refresh();
      }
      setNotice(target ? "Listing updated." : "Listing published.");
    });
  }

  function removeImage(imageId: string) {
    if (!editing || editing === "new") return;
    const space = editing;
    void act(async () => {
      await api(`/listings/${space.id}/images/${imageId}`, {
        method: "DELETE",
      });
      setEditing({
        ...space,
        image_ids: space.image_ids?.filter((id) => id !== imageId),
      });
      await refresh();
    });
  }

  const select = useCallback((space: Space) => {
    setSelected(space);
    setError("");
  }, []);

  const allowed = view === "search" || !user || user.role === VIEW_ROLE[view];
  const navItems: [View, string][] = [
    ["search", "Find parking"],
    ...(user?.role !== "owner"
      ? [["bookings", "My bookings"] as [View, string]]
      : []),
    ...(user?.role !== "customer"
      ? [["host", "Host a space"] as [View, string]]
      : []),
  ];

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
          {navItems.map(([key, label]) => (
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
            <span>
              {user.username} · {user.role}
            </span>
            <button className="text-button" onClick={signOut}>
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
            <SearchPanel
              city={city}
              filters={filters}
              busy={busy}
              setCity={(name) => {
                setCity(name);
                setFilters((f) => ({ ...f, center: CITIES[name] }));
                setSpaces([]);
                setPeriod(null);
              }}
              change={(next) => setFilters((f) => ({ ...f, ...next }))}
              submit={() => void search(filters)}
            />
            <Alert error={error} notice={notice} />
            <section className="results-layout">
              <SpaceList
                spaces={spaces}
                busy={busy}
                sort={filters.sort}
                selected={selected?.id}
                select={select}
              />
              <div className="map-wrap">
                <ParkingMap
                  spaces={spaces}
                  center={filters.center}
                  selected={selected?.id}
                  select={select}
                  pick={(center) => {
                    const next = { ...filters, center };
                    setCity("Map pin");
                    setFilters(next);
                    void search(next);
                  }}
                />
                <div className="map-caption">
                  Click the map to search around that spot.
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
              {user && allowed && (
                <button
                  className="button dark"
                  onClick={() =>
                    view === "host" ? setEditing("new") : void refresh()
                  }
                >
                  {view === "host" ? "+ List a space" : "Refresh status"}
                </button>
              )}
            </div>
            <Alert error={error} notice={notice} />
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
            ) : !allowed ? (
              <div className="empty">
                <h2>
                  {view === "host"
                    ? "Hosting needs an owner account"
                    : "Bookings need a customer account"}
                </h2>
                <p>
                  {view === "host"
                    ? "Customer accounts reserve parking. Create an owner account to list spaces."
                    : "Owner accounts manage listings. Create a customer account to reserve parking."}
                </p>
              </div>
            ) : view === "bookings" ? (
              <BookingsView
                bookings={bookings}
                busy={busy}
                loadMore={
                  moreBookings
                    ? () =>
                        void act(async () => {
                          const next = await api<Booking[]>(
                            `/bookings?limit=${BOOKING_PAGE}&offset=${bookings.length}`,
                          );
                          // Offsets can shift if a booking is made meanwhile; drop repeats.
                          setBookings((rows) => [
                            ...rows,
                            ...next.filter(
                              (b) => !rows.some((r) => r.id === b.id),
                            ),
                          ]);
                          setMoreBookings(next.length === BOOKING_PAGE);
                        })
                    : undefined
                }
                findParking={() => navigate("search")}
                cancel={setCancelling}
                checkout={(b) =>
                  void act(async () => {
                    const result = await api<{ url: string }>(
                      `/bookings/${b.id}/checkout`,
                      { method: "POST" },
                    );
                    window.location.assign(result.url);
                  })
                }
              />
            ) : (
              <HostView
                spaces={hostSpaces}
                bookings={hostBookings}
                busy={busy}
                edit={(s) => {
                  setError("");
                  setEditing(s);
                }}
                remove={(s) => {
                  setError("");
                  setDeleting(s);
                }}
                toggle={(s) =>
                  void act(async () => {
                    await api(
                      `/listings/${s.id}`,
                      json("PATCH", { active: !s.active }),
                    );
                    await refresh();
                  })
                }
              />
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
        <SpaceDialog
          space={selected}
          period={period}
          user={user}
          mode={mode}
          busy={busy}
          error={error}
          reserve={reserve}
          close={() => setSelected(null)}
        />
      )}
      {auth && (
        <AuthDialog
          mode={auth}
          busy={busy}
          error={error}
          submit={signIn}
          switchMode={() => {
            setAuth(auth === "login" ? "register" : "login");
            setError("");
          }}
          close={() => {
            setAuth(null);
            setError("");
          }}
        />
      )}
      {editing && (
        <ListingDialog
          key={editing === "new" ? "new" : editing.id}
          space={editing === "new" ? undefined : editing}
          busy={busy}
          error={error}
          save={saveListing}
          removeImage={removeImage}
          close={() => setEditing(null)}
        />
      )}
      {cancelling && (
        <ConfirmDialog
          title="Cancel this booking?"
          subject={cancelling.title}
          explanation={
            "Your space will be released immediately. " +
            (cancelling.payment_status === "paid"
              ? "A full test refund will be queued; its status will appear in your bookings."
              : "No payment was taken for this booking.")
          }
          keepLabel="Keep booking"
          confirmLabel="Confirm cancellation"
          busy={busy}
          error={error}
          close={() => setCancelling(null)}
          confirm={() =>
            void act(async () => {
              await api(`/bookings/${cancelling.id}/cancel`, {
                method: "POST",
              });
              setCancelling(null);
              await refresh();
              setNotice("Booking cancelled.");
            })
          }
        />
      )}
      {deleting && (
        <ConfirmDialog
          title="Delete this listing?"
          subject={deleting.title}
          explanation="A space with past reservations is archived so those records stay intact. A space with upcoming reservations cannot be deleted; pause it instead."
          keepLabel="Keep listing"
          confirmLabel="Delete listing"
          busy={busy}
          error={error}
          close={() => setDeleting(null)}
          confirm={() =>
            void act(async () => {
              const result = await api<{ outcome: string }>(
                `/listings/${deleting.id}`,
                { method: "DELETE" },
              );
              setDeleting(null);
              await refresh();
              setNotice(
                result.outcome === "archived"
                  ? "Listing archived; its booking history is kept."
                  : "Listing deleted.",
              );
            })
          }
        />
      )}
    </>
  );
}
