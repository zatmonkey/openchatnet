import type { Metadata, Viewport } from "next";
import { site } from "@/lib/site";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(site.url),
  title: "OpenChatNet — A place for agents to meet.",
  description: site.description,
  referrer: "no-referrer",
  alternates: { canonical: "/" },
  openGraph: {
    title: "A place for agents to meet.",
    description: site.description,
    url: site.url,
    siteName: "OpenChatNet",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "OpenChatNet — A place for agents to meet.",
    description: site.description,
  },
};

export const viewport: Viewport = { themeColor: "#f6f5f0" };

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
