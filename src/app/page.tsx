"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { UploadPanel } from "@/components/UploadPanel";
import {
  dealTypeBadgeClass,
  formatParties,
  statusBadgeClass,
  type DocumentSummary,
} from "@/lib/types";

export default function HomePage() {
  const [recent, setRecent] = useState<DocumentSummary[]>([]);
  const [inProgress, setInProgress] = useState<DocumentSummary[]>([]);
  const [loading, setLoading] = useState(true);

  const loadHomeData = useCallback(async (options: { silent?: boolean } = {}) => {
    if (!options.silent) setLoading(true);
    try {
      const [recentRes, pendingRes, processingRes] = await Promise.all([
        fetch("/api/documents?limit=5"),
        fetch("/api/documents?status=pending&limit=10"),
        fetch("/api/documents?status=processing&limit=10"),
      ]);

      const recentData = await recentRes.json();
      const pendingData = await pendingRes.json();
      const processingData = await processingRes.json();

      setRecent(recentData.documents ?? []);
      const active = [
        ...(pendingData.documents ?? []),
        ...(processingData.documents ?? []),
      ] as DocumentSummary[];
      const seen = new Set<string>();
      setInProgress(
        active.filter((d) => {
          if (seen.has(d.id)) return false;
          seen.add(d.id);
          return true;
        })
      );
    } catch (error) {
      console.error(error);
    } finally {
      if (!options.silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadHomeData();
  }, [loadHomeData]);

  useEffect(() => {
    if (inProgress.length === 0) return;

    const interval = setInterval(() => {
      loadHomeData({ silent: true });
    }, 5000);

    return () => clearInterval(interval);
  }, [inProgress.length, loadHomeData]);

  return (
    <div className="space-y-8">
      <section>
        <h1 className="text-3xl font-bold tracking-tight">
          Upload documents
        </h1>
        <p className="mt-2 max-w-3xl text-muted">
          Add aircraft purchase and lease deal documents to your library. We
          extract structured metadata and link corresponding LOIs and OLAs.
        </p>
      </section>

      <div className="grid gap-8 lg:grid-cols-[360px_1fr]">
        <UploadPanel onUploaded={() => loadHomeData({ silent: true })} />

        <div className="space-y-6">
          {inProgress.length > 0 && (
            <div className="card">
              <h2 className="mb-4 text-lg font-semibold">Processing</h2>
              <ul className="space-y-3 text-sm">
                {inProgress.map((doc) => (
                  <li
                    key={doc.id}
                    className="flex items-center justify-between gap-4"
                  >
                    <Link
                      href={`/documents/${doc.id}`}
                      className="font-medium text-primary hover:underline"
                    >
                      {doc.filename}
                    </Link>
                    <span className={statusBadgeClass(doc.status)}>
                      {doc.status}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="card">
            <div className="mb-4 flex items-center justify-between gap-4">
              <h2 className="text-lg font-semibold">Recent uploads</h2>
              <Link href="/documents" className="btn-secondary">
                View all documents
              </Link>
            </div>
            {loading ? (
              <p className="text-sm text-muted">Loading…</p>
            ) : recent.length === 0 ? (
              <p className="text-sm text-muted">
                No documents yet. Upload a LOI or OLA to get started.
              </p>
            ) : (
              <ul className="space-y-3 text-sm">
                {recent.map((doc) => {
                  const parties = formatParties(doc);
                  return (
                    <li
                      key={doc.id}
                      className="rounded-lg border border-border p-4"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <Link
                          href={`/documents/${doc.id}`}
                          className="font-medium text-primary hover:underline"
                        >
                          {doc.filename}
                        </Link>
                        <div className="flex gap-2">
                          {doc.dealType && (
                            <span className={dealTypeBadgeClass(doc.dealType)}>
                              {doc.dealType}
                            </span>
                          )}
                          <span className={statusBadgeClass(doc.status)}>
                            {doc.status}
                          </span>
                        </div>
                      </div>
                      <p className="mt-1 text-muted">
                        {[doc.documentType, parties.primary, parties.secondary]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
