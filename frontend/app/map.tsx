"use client";
import { useEffect, useRef } from "react";
import L from "leaflet";
export type Space = {
  id: string;
  title: string;
  address: string;
  latitude: number;
  longitude: number;
  hourly_price_cents: number;
  distance_m?: number;
  active?: boolean;
};
export default function ParkingMap({
  spaces,
  center,
  selected,
  select,
}: {
  spaces: Space[];
  center: [number, number];
  selected?: string;
  select: (space: Space) => void;
}) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const pins = useRef<L.LayerGroup | null>(null);
  useEffect(() => {
    if (!el.current) return;
    map.current = L.map(el.current, { zoomControl: false }).setView(center, 14);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 19,
    }).addTo(map.current);
    L.control.zoom({ position: "bottomright" }).addTo(map.current);
    pins.current = L.layerGroup().addTo(map.current);
    return () => {
      map.current?.remove();
      map.current = null;
    };
    // This effect owns the map instance; center updates are handled below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    map.current?.setView(center, 14);
  }, [center]);
  useEffect(() => {
    pins.current?.clearLayers();
    for (const space of spaces) {
      const pin = L.marker([space.latitude, space.longitude], {
        title: space.title,
        keyboard: true,
        icon: L.divIcon({
          className: `price-pin ${selected === space.id ? "chosen" : ""}`,
          html: `$${(space.hourly_price_cents / 100).toFixed(2)}`,
          iconSize: [76, 36],
          iconAnchor: [38, 36],
        }),
      });
      pin.on("click", () => select(space));
      if (pins.current) pin.addTo(pins.current);
    }
  }, [spaces, selected, select]);
  return (
    <div
      className="map"
      ref={el}
      role="region"
      aria-label="Parking locations map. All spaces are also listed beside the map."
    />
  );
}
