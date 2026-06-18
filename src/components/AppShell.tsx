"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { AviatorBrandMark } from "@/components/AviatorBrandMark";

const WORKSPACE_NAV = [
  { href: "/precedents", label: "Assistant", match: ["/precedents"] },
  { href: "/", label: "Upload Documents", match: ["/", "/documents"] },
  { href: "/search", label: "Search", match: ["/search"] },
] as const;

function isActive(pathname: string, match: readonly string[]): boolean {
  if (match.includes("/")) {
    if (pathname === "/") return match.includes("/");
    return match.some((m) => m !== "/" && pathname.startsWith(m));
  }
  return match.some((m) => pathname.startsWith(m));
}

function contextLabel(pathname: string): string {
  if (pathname.startsWith("/drafts/")) return "LOI draft";
  if (pathname.startsWith("/documents/")) return "Document";
  if (pathname === "/precedents") return "Assistant";
  if (pathname === "/search") return "Search";
  if (pathname === "/documents") return "All documents";
  return "Upload documents";
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? "/";

  return (
    <div className="app-shell">
      <header className="topbar">
        <Link href="/precedents" className="brand flex items-center gap-3">
          <AviatorBrandMark />
          <span className="brand-name">Aviator</span>
        </Link>
        <div className="topdiv" aria-hidden />
        <span className="topbar-product">CLM · Legal</span>
        <div className="topbar-right">
          <span className="tb-context hidden sm:inline-flex">
            <strong>{contextLabel(pathname)}</strong>
          </span>
        </div>
      </header>

      <aside className="sidebar">
        <div className="side-sec">
          <div className="side-label">Workspace</div>
          {WORKSPACE_NAV.map((item) => {
            const active = isActive(pathname, item.match);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`side-item${active ? " active" : ""}`}
              >
                <span className="side-text">{item.label}</span>
              </Link>
            );
          })}
        </div>
        <div className="side-spacer" />
        <div className="side-sec">
          <Link href="/documents" className="side-item">
            <span className="side-text">All documents</span>
          </Link>
        </div>
      </aside>

      <main className="main-area">{children}</main>
    </div>
  );
}
