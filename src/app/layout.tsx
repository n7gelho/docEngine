import type { Metadata } from "next";
import {
  Fraunces,
  IBM_Plex_Mono,
  IBM_Plex_Sans,
} from "next/font/google";
import Link from "next/link";
import "./globals.css";

const fraunces = Fraunces({
  variable: "--font-serif-fraunces",
  subsets: ["latin"],
});

const ibmSans = IBM_Plex_Sans({
  variable: "--font-sans-ibm",
  weight: ["300", "400", "500", "600"],
  subsets: ["latin"],
});

const ibmMono = IBM_Plex_Mono({
  variable: "--font-mono-ibm",
  weight: ["400", "500"],
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "miniAviator",
  description: "Aircraft deal document intelligence and LOI generation.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${fraunces.variable} ${ibmSans.variable} ${ibmMono.variable} flex min-h-screen flex-col antialiased`}
      >
        <header className="topbar relative z-10 h-[58px] shrink-0">
          <div className="mx-auto flex h-full max-w-[1600px] items-center justify-between gap-4 px-4 sm:px-6">
            <Link href="/" className="flex items-center gap-3">
              <span className="brand-mark" aria-hidden>
                m
              </span>
              <span className="brand-name">miniAviator</span>
            </Link>
            <nav className="flex items-center gap-1 text-sm">
              <Link href="/" className="nav-link">
                Home
              </Link>
              <Link href="/documents" className="nav-link">
                Documents
              </Link>
              <Link href="/search" className="nav-link">
                Search
              </Link>
              <Link href="/precedents" className="nav-link">
                Contract Generator
              </Link>
            </nav>
          </div>
        </header>
        <main className="flex min-h-0 flex-1 flex-col px-4 sm:px-6">
          {children}
        </main>
      </body>
    </html>
  );
}
