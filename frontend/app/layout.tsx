import type { Metadata } from "next";
import "./globals.css";
import "leaflet/dist/leaflet.css";
export const metadata: Metadata = {
  title: "Parkside · Find your space",
  description:
    "Find parking, reserve a space, and manage your listings. Portfolio demonstration.",
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
