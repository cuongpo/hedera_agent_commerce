import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Agent Commerce | Hedera",
  description:
    "Autonomous agent procurement with HCS-10 discovery and bounded HBAR settlement.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
