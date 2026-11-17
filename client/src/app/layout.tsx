import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "SAGENT - Autonomous CLI Coding Agent",
  description: "Autonomous coding agent that plans, edits, and verifies code directly in your terminal. Zero context switching. Full autonomy.",
  keywords: ["cli", "coding agent", "autonomous", "ai", "developer tools", "typescript", "bun"],
  authors: [{ name: "SAGENT Team" }],
  creator: "SAGENT Team",
  publisher: "SAGENT",
  robots: "index, follow",
  openGraph: {
    type: "website",
    locale: "en_US",
    url: "https://sagent.dev",
    title: "SAGENT - Autonomous CLI Coding Agent",
    description: "Autonomous coding agent that plans, edits, and verifies code directly in your terminal.",
    siteName: "SAGENT",
    images: [
      {
        url: "/og-image.png",
        width: 1200,
        height: 630,
        alt: "SAGENT - Autonomous CLI Coding Agent",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "SAGENT - Autonomous CLI Coding Agent",
    description: "Autonomous coding agent that plans, edits, and verifies code directly in your terminal.",
    images: ["/og-image.png"],
    creator: "@sagent",
  },
  icons: {
    icon: "/favicon.ico",
    shortcut: "/favicon-16x16.png",
    apple: "/apple-touch-icon.png",
  },
  manifest: "/site.webmanifest",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0a" },
  ],
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased scroll-smooth`}
    >
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      </head>
      <body className="min-h-full flex flex-col bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100">
        {children}
      </body>
    </html>
  );
}