import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "Naise Coffee",
    template: "%s · Naise Coffee",
  },
  description:
    "Order coffee from Naise Coffee — browse the menu, customize your drink, and check out over WhatsApp.",
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000",
  ),
  openGraph: {
    title: "Naise Coffee",
    description:
      "Order coffee from Naise Coffee — browse the menu, customize your drink, and check out over WhatsApp.",
    type: "website",
  },
  // ponytail: no apple-touch-startup-image (splash) — needs a per-device PNG
  // matrix generated from a source launch design; add when that art exists.
  appleWebApp: { capable: true, title: "Naise", statusBarStyle: "black" },
  icons: { apple: "/icons/apple-touch-icon.png" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#171717",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
