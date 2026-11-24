import { describe, expect, it } from "vitest";
import {
  checkImages,
  errorMessage,
  listingBody,
  money,
  searchQuery,
  stayTotal,
  toPeriod,
} from "../app/lib/format";
import type { SearchFilters } from "../app/lib/types";

const form = (fields: Record<string, string | string[]>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields))
    for (const item of Array.isArray(value) ? value : [value])
      data.append(key, item);
  return data;
};
const valid = {
  title: "  River bay ",
  address: "Demo street",
  latitude: "41.9",
  longitude: "-87.6",
  price: "4.55",
};

describe("money and totals", () => {
  it("formats cents as USD", () => expect(money(12345)).toBe("$123.45"));
  it("rounds a partial hour up once, like the server", () => {
    const period = {
      starts_at: "2027-01-01T10:00:00Z",
      ends_at: "2027-01-01T11:20:00Z",
    };
    expect(stayTotal(301, period)).toBe(402); // 301 * 4/3 = 401.33
  });
});

describe("toPeriod", () => {
  const now = Date.parse("2027-01-01T00:00:00Z");
  it("converts local inputs to ISO strings", () => {
    const period = toPeriod("2027-01-02T10:00", "2027-01-02T12:00", now);
    expect(Date.parse(period.ends_at) - Date.parse(period.starts_at)).toBe(
      7200000,
    );
  });
  it.each([
    ["2027-01-02T10:00", "2027-01-02T10:00", /end after the start/],
    ["2027-01-02T10:00", "2027-02-05T10:00", /within 30 days/],
    ["2026-12-31T10:00", "2026-12-31T12:00", /future/],
    ["", "", /end after the start/],
  ])("rejects %s to %s", (from, to, message) => {
    expect(() => toPeriod(from, to, now)).toThrow(message);
  });
});

describe("searchQuery", () => {
  const filters: SearchFilters = {
    center: [41.88, -87.63],
    start: "",
    end: "",
    radius: "1000",
    maxPrice: "5",
    features: ["covered", "ev_charging"],
    sort: "price",
  };
  const period = {
    starts_at: "2027-01-01T10:00:00.000Z",
    ends_at: "2027-01-01T12:00:00.000Z",
  };
  it("sends price in cents, repeated features and the sort", () => {
    const params = new URLSearchParams(searchQuery(filters, period));
    expect(params.get("max_price_cents")).toBe("500");
    expect(params.getAll("features")).toEqual(["covered", "ev_charging"]);
    expect(params.get("sort")).toBe("price");
    expect(params.get("radius_m")).toBe("1000");
    expect(params.get("latitude")).toBe("41.88");
  });
  it("omits an empty price filter", () => {
    const params = new URLSearchParams(
      searchQuery({ ...filters, maxPrice: "", features: [] }, period),
    );
    expect(params.has("max_price_cents")).toBe(false);
    expect(params.has("features")).toBe(false);
  });
});

describe("listingBody", () => {
  it("trims text, converts dollars to cents and keeps known features", () => {
    const body = listingBody(
      form({
        ...valid,
        description: " Gate code at desk ",
        features: ["covered", "helipad"],
      }),
    );
    expect(body).toEqual({
      title: "River bay",
      address: "Demo street",
      description: "Gate code at desk",
      latitude: 41.9,
      longitude: -87.6,
      hourly_price_cents: 455,
      features: ["covered"],
    });
  });
  it.each([
    [{ title: "ab" }, /name/],
    [{ address: "" }, /address/],
    [{ price: "0" }, /price/],
    [{ price: "abc" }, /price/],
    [{ latitude: "91" }, /latitude/],
  ])("rejects %o", (change, message) => {
    expect(() => listingBody(form({ ...valid, ...change }))).toThrow(message);
  });
});

describe("checkImages", () => {
  const file = (name: string, type: string, size = 10) =>
    new File([new Uint8Array(size)], name, { type });
  it("accepts supported images", () =>
    expect(checkImages([file("a.png", "image/png")])).toBeNull());
  it("rejects other types", () =>
    expect(checkImages([file("a.svg", "image/svg+xml")])).toMatch(/a.svg/));
  it("rejects large files", () =>
    expect(
      checkImages([file("big.jpg", "image/jpeg", 2 * 1024 * 1024 + 1)]),
    ).toMatch(/2 MB/));
  it("counts existing photos toward the limit", () =>
    expect(
      checkImages([file("a.png", "image/png"), file("b.png", "image/png")], 5),
    ).toMatch(/at most 6/));
});

describe("errorMessage", () => {
  it("uses a string detail", () =>
    expect(errorMessage({ detail: "Nope" })).toBe("Nope"));
  it("joins validation errors", () =>
    expect(errorMessage({ detail: [{ msg: "A" }, { msg: "B" }] })).toBe(
      "A. B",
    ));
  it("falls back for unknown bodies", () =>
    expect(errorMessage(null)).toMatch(/Unable/));
});
