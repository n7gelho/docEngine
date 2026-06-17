import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
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
  title: "Aircraft Deal Document Engine",
  description:
    "Ingest purchase and lease deal documents, extract metadata, filter, and link LOIs to OLAs.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} min-h-screen antialiased`}
      >
        <header className="border-b border-border bg-white">
          <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4 sm:px-6">
            <Link href="/" className="text-lg font-semibold text-slate-900">
              Aircraft Deal Document Engine
            </Link>
            <nav className="flex gap-4 text-sm">
              <Link href="/" className="text-slate-600 hover:text-primary">
                Home
              </Link>
              <Link href="/documents" className="text-slate-600 hover:text-primary">
                Documents
              </Link>
              <Link href="/search" className="text-slate-600 hover:text-primary">
                Semantic Search
              </Link>
              <Link href="/precedents" className="text-slate-600 hover:text-primary">
                Precedent Finder
              </Link>
            </nav>
          </div>
        </header>
        <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6">{children}</main>
      </body>
    </html>
  );
}
