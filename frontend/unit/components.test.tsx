import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AuthDialog } from "../app/components/AuthDialog";
import { BookingsView } from "../app/components/BookingsView";
import { HostView } from "../app/components/HostView";
import { ListingDialog } from "../app/components/ListingDialog";
import { SearchPanel } from "../app/components/SearchPanel";
import { SpaceDialog } from "../app/components/SpaceDialog";
import type { Booking, SearchFilters, Space } from "../app/lib/types";

const space: Space = {
  id: "11111111-1111-1111-1111-111111111111",
  title: "River bay",
  address: "Demo street",
  description: "Covered bay near the river.",
  features: ["covered", "ev_charging"],
  image_ids: ["22222222-2222-2222-2222-222222222222"],
  latitude: 41.88,
  longitude: -87.63,
  hourly_price_cents: 450,
  active: true,
};
const period = {
  starts_at: "2027-01-01T10:00:00Z",
  ends_at: "2027-01-01T12:00:00Z",
};

describe("AuthDialog", () => {
  const props = { busy: false, error: "", switchMode: vi.fn(), close: vi.fn() };
  it("sends the chosen role when registering", async () => {
    const submit = vi.fn();
    render(<AuthDialog {...props} mode="register" submit={submit} />);
    await userEvent.click(screen.getByLabelText("List my parking spaces"));
    await userEvent.type(screen.getByLabelText("Username"), "host_one");
    await userEvent.type(
      screen.getByLabelText("Password"),
      "long-enough-password",
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Create account" }),
    );
    expect(submit).toHaveBeenCalledWith({
      username: "host_one",
      password: "long-enough-password",
      role: "owner",
    });
  });
  it("does not send a role when signing in", async () => {
    const submit = vi.fn();
    render(<AuthDialog {...props} mode="login" submit={submit} />);
    expect(screen.queryByText("I want to")).not.toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Username"), "host_one");
    await userEvent.type(
      screen.getByLabelText("Password"),
      "long-enough-password",
    );
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(submit.mock.calls[0][0]).not.toHaveProperty("role");
  });
});

describe("SearchPanel", () => {
  const filters: SearchFilters = {
    center: [41.88, -87.63],
    start: "2027-01-01T10:00",
    end: "2027-01-01T12:00",
    radius: "5000",
    maxPrice: "",
    features: ["covered"],
    sort: "distance",
  };
  it("toggles features and changes price and sort", async () => {
    const change = vi.fn();
    render(
      <SearchPanel
        city="Chicago"
        filters={filters}
        busy={false}
        setCity={vi.fn()}
        change={change}
        submit={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByLabelText("EV charging"));
    expect(change).toHaveBeenLastCalledWith({
      features: ["covered", "ev_charging"],
    });
    await userEvent.click(screen.getByLabelText("Covered"));
    expect(change).toHaveBeenLastCalledWith({ features: [] });
    await userEvent.selectOptions(screen.getByLabelText("Max price"), "5");
    expect(change).toHaveBeenLastCalledWith({ maxPrice: "5" });
    await userEvent.selectOptions(screen.getByLabelText("Sort by"), "price");
    expect(change).toHaveBeenLastCalledWith({ sort: "price" });
  });
});

describe("SpaceDialog", () => {
  const props = {
    space,
    period,
    mode: "demo",
    busy: false,
    error: "",
    reserve: vi.fn(),
    close: vi.fn(),
  };
  it("shows details, photos and the stay total", () => {
    render(
      <SpaceDialog
        {...props}
        user={{ id: "c", username: "cust", role: "customer" }}
      />,
    );
    expect(screen.getByText("Covered bay near the river.")).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "Features" })).toHaveTextContent(
      "EV charging",
    );
    expect(screen.getByAltText("River bay, photo 1")).toHaveAttribute(
      "src",
      `/listings/${space.id}/images/${space.image_ids![0]}`,
    );
    expect(screen.getByText("$9.00")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Reserve demo space" }),
    ).toBeEnabled();
  });
  it("stops owners from reserving", () => {
    render(
      <SpaceDialog
        {...props}
        user={{ id: "o", username: "host", role: "owner" }}
      />,
    );
    expect(
      screen.getByRole("button", { name: "Owner accounts cannot reserve" }),
    ).toBeDisabled();
  });
});

describe("ListingDialog", () => {
  const props = { busy: false, error: "", close: vi.fn() };
  it("submits a new listing with features in cents", async () => {
    const save = vi.fn();
    render(<ListingDialog {...props} save={save} />);
    await userEvent.type(screen.getByLabelText("Space name"), "New bay");
    await userEvent.type(screen.getByLabelText("Address"), "Demo address");
    await userEvent.type(
      screen.getByLabelText("Description"),
      "Tight turn at entry",
    );
    await userEvent.click(screen.getByLabelText("Security"));
    await userEvent.click(
      screen.getByRole("button", { name: "Publish demo listing" }),
    );
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "New bay",
        description: "Tight turn at entry",
        hourly_price_cents: 400,
        features: ["security"],
      }),
      [],
    );
  });
  it("shows validation problems instead of saving", async () => {
    const save = vi.fn();
    render(<ListingDialog {...props} save={save} />);
    await userEvent.type(screen.getByLabelText("Space name"), "ab");
    await userEvent.click(
      screen.getByRole("button", { name: "Publish demo listing" }),
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      /at least 3 characters/,
    );
    expect(save).not.toHaveBeenCalled();
  });
  it("rejects unsupported photos before uploading", async () => {
    const save = vi.fn();
    render(<ListingDialog {...props} save={save} space={space} />);
    const svg = new File(["<svg/>"], "logo.svg", { type: "image/svg+xml" });
    await userEvent.upload(screen.getByLabelText("Add photos"), svg, {
      applyAccept: false,
    });
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(screen.getByRole("alert")).toHaveTextContent(/logo.svg/);
    expect(save).not.toHaveBeenCalled();
  });
  it("prefills an existing listing and removes photos", async () => {
    const removeImage = vi.fn();
    render(
      <ListingDialog
        {...props}
        save={vi.fn()}
        space={space}
        removeImage={removeImage}
      />,
    );
    expect(screen.getByLabelText("Space name")).toHaveValue("River bay");
    expect(screen.getByLabelText("Hourly price (USD)")).toHaveValue(4.5);
    expect(screen.getByLabelText("Covered")).toBeChecked();
    expect(screen.getByLabelText("Security")).not.toBeChecked();
    await userEvent.click(
      screen.getByRole("button", { name: "Remove photo 1" }),
    );
    expect(removeImage).toHaveBeenCalledWith(space.image_ids![0]);
  });
});

describe("HostView", () => {
  it("wires pause, edit and delete for each listing", async () => {
    const toggle = vi.fn(),
      edit = vi.fn(),
      remove = vi.fn();
    render(
      <HostView
        spaces={[space]}
        bookings={[]}
        busy={false}
        toggle={toggle}
        edit={edit}
        remove={remove}
      />,
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Pause listing" }),
    );
    await userEvent.click(screen.getByRole("button", { name: "Edit" }));
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(toggle).toHaveBeenCalledWith(space);
    expect(edit).toHaveBeenCalledWith(space);
    expect(remove).toHaveBeenCalledWith(space);
    expect(
      screen.getByText("New reservations will appear here."),
    ).toBeInTheDocument();
  });
});

const booking = (id: string, hoursFromNow: number): Booking => ({
  id,
  title: "Bay " + id,
  address: "Demo street",
  starts_at: new Date(Date.now() + (hoursFromNow - 1) * 3600000).toISOString(),
  ends_at: new Date(Date.now() + hoursFromNow * 3600000).toISOString(),
  total_price_cents: 400,
  status: "confirmed",
  payment_status: "demo",
  customer: "cust",
});

describe("BookingsView", () => {
  const props = {
    busy: false,
    checkout: vi.fn(),
    cancel: vi.fn(),
    findParking: vi.fn(),
  };
  it("offers more bookings only when another page exists", async () => {
    const loadMore = vi.fn();
    const { rerender } = render(
      <BookingsView
        {...props}
        bookings={[booking("a", 5)]}
        loadMore={loadMore}
      />,
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Load more bookings" }),
    );
    expect(loadMore).toHaveBeenCalled();
    rerender(<BookingsView {...props} bookings={[booking("a", 5)]} />);
    expect(
      screen.queryByRole("button", { name: "Load more bookings" }),
    ).not.toBeInTheDocument();
  });
});

describe("HostView reservations", () => {
  it("switches between upcoming and past reservations", async () => {
    render(
      <HostView
        spaces={[]}
        bookings={[booking("next", 5), booking("done", -5)]}
        busy={false}
        toggle={vi.fn()}
        edit={vi.fn()}
        remove={vi.fn()}
      />,
    );
    expect(screen.getByText("Bay next")).toBeInTheDocument();
    expect(screen.queryByText("Bay done")).not.toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText("Show"), "past");
    expect(screen.getByText("Bay done")).toBeInTheDocument();
    expect(screen.queryByText("Bay next")).not.toBeInTheDocument();
  });
});
