"use client";

import Link from "next/link";
import { useState } from "react";
import {
  dealTypeBadgeClass,
  formatParties,
  formatRent,
  statusBadgeClass,
  type DocumentSummary,
} from "@/lib/types";

type PaginationProps = {
  page: number;
  totalPages: number;
  showingFrom: number;
  showingTo: number;
  onPageChange: (page: number) => void;
};

type DocumentListProps = {
  documents: DocumentSummary[];
  total: number;
  loading?: boolean;
  onDelete?: (documentId: string) => Promise<void>;
  pagination?: PaginationProps;
};

export function DocumentList({
  documents,
  total,
  loading,
  onDelete,
  pagination,
}: DocumentListProps) {
  const [deletingId, setDeletingId] = useState<string | null>(null);

  async function handleDelete(doc: DocumentSummary) {
    const confirmed = window.confirm(
      `Delete "${doc.filename}"?\n\nThis removes the document, its metadata, embeddings, and any LOI/OLA link. This cannot be undone.`
    );
    if (!confirmed || !onDelete) return;

    setDeletingId(doc.id);
    try {
      await onDelete(doc.id);
    } catch (err) {
      window.alert(
        err instanceof Error ? err.message : "Failed to delete document"
      );
    } finally {
      setDeletingId(null);
    }
  }

  if (loading) {
    return (
      <div className="card">
        <p className="text-sm text-muted">Loading documents…</p>
      </div>
    );
  }

  return (
    <div className="card overflow-hidden p-0">
      <div className="border-b border-border px-6 py-4 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold">Documents</h2>
          <p className="text-sm text-muted">
            {pagination
              ? `Showing ${pagination.showingFrom}–${pagination.showingTo} of ${total}`
              : `${total} total`}
          </p>
        </div>
        {pagination && pagination.totalPages > 1 && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="btn-secondary"
              disabled={pagination.page === 0}
              onClick={() => pagination.onPageChange(pagination.page - 1)}
            >
              Previous
            </button>
            <span className="text-sm text-muted">
              Page {pagination.page + 1} of {pagination.totalPages}
            </span>
            <button
              type="button"
              className="btn-secondary"
              disabled={pagination.page >= pagination.totalPages - 1}
              onClick={() => pagination.onPageChange(pagination.page + 1)}
            >
              Next
            </button>
          </div>
        )}
      </div>
      {documents.length === 0 ? (
        <div className="px-6 py-10 text-center text-sm text-muted">
          No documents match your filters. Upload a LOI or OLA to get started.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-muted">
              <tr>
                <th className="px-6 py-3">File</th>
                <th className="px-6 py-3">Deal</th>
                <th className="px-6 py-3">Type</th>
                <th className="px-6 py-3">Parties</th>
                <th className="px-6 py-3">Aircraft</th>
                <th className="px-6 py-3">Jurisdiction</th>
                <th className="px-6 py-3">Rent</th>
                <th className="px-6 py-3">Status</th>
                {onDelete && <th className="px-6 py-3">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {documents.map((doc) => {
                const parties = formatParties(doc);
                return (
                  <tr
                    key={doc.id}
                    className="border-t border-border hover:bg-slate-50"
                  >
                    <td className="px-6 py-4">
                      <Link
                        href={`/documents/${doc.id}`}
                        className="font-medium text-primary hover:underline"
                      >
                        {doc.filename}
                      </Link>
                    </td>
                    <td className="px-6 py-4">
                      {doc.dealType ? (
                        <span className={dealTypeBadgeClass(doc.dealType)}>
                          {doc.dealType}
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-6 py-4">{doc.documentType ?? "—"}</td>
                    <td className="px-6 py-4">
                      <div>{parties.primary}</div>
                      <div className="text-muted">
                        {parties.secondary}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div>{doc.aircraftType ?? "—"}</div>
                      <div className="text-muted">
                        {[doc.msn, doc.registration].filter(Boolean).join(" · ") ||
                          "—"}
                        {doc.aircraftCount != null
                          ? ` · ${doc.aircraftCount} aircraft`
                          : ""}
                      </div>
                    </td>
                    <td className="px-6 py-4">{doc.governingLaw ?? "—"}</td>
                    <td className="px-6 py-4">
                      {formatRent(doc.monthlyRent, doc.currency)}
                    </td>
                    <td className="px-6 py-4">
                      <span className={statusBadgeClass(doc.status)}>
                        {doc.status}
                      </span>
                    </td>
                    {onDelete && (
                      <td className="px-6 py-4">
                        <button
                          type="button"
                          onClick={() => handleDelete(doc)}
                          disabled={deletingId === doc.id}
                          className="text-sm font-medium text-red-600 hover:text-red-700 disabled:opacity-50"
                        >
                          {deletingId === doc.id ? "Deleting…" : "Delete"}
                        </button>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
