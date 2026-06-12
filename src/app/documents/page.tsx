"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { DocumentList } from "@/components/DocumentList";
import {
  MetadataFilters,
  emptyFilters,
  filtersToQuery,
  type FilterState,
} from "@/components/MetadataFilters";
import type { DocumentSummary } from "@/lib/types";

const PAGE_SIZE = 20;

export default function DocumentsPage() {
  const [filters, setFilters] = useState<FilterState>(emptyFilters);
  const [appliedQuery, setAppliedQuery] = useState("");
  const [page, setPage] = useState(0);
  const [documents, setDocuments] = useState<DocumentSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  const loadDocuments = useCallback(
    async (
      queryString: string,
      pageIndex: number,
      options: { silent?: boolean } = {}
    ) => {
      if (!options.silent) setLoading(true);
      try {
        const params = new URLSearchParams(queryString);
        params.set("limit", String(PAGE_SIZE));
        params.set("offset", String(pageIndex * PAGE_SIZE));

        const response = await fetch(`/api/documents?${params.toString()}`);
        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.error ?? "Failed to load documents");
        }
        setDocuments(data.documents ?? []);
        setTotal(data.total ?? 0);
      } catch (error) {
        console.error(error);
        if (!options.silent) {
          setDocuments([]);
          setTotal(0);
        }
      } finally {
        if (!options.silent) setLoading(false);
      }
    },
    []
  );

  const inProgressIds = documents
    .filter((d) => d.status === "pending" || d.status === "processing")
    .map((d) => d.id);

  useEffect(() => {
    loadDocuments(appliedQuery, page);
  }, [appliedQuery, page, loadDocuments]);

  useEffect(() => {
    if (inProgressIds.length === 0) return;

    const interval = setInterval(async () => {
      try {
        const params = new URLSearchParams();
        params.set("limit", String(inProgressIds.length));
        for (const id of inProgressIds) {
          params.append("ids", id);
        }
        const response = await fetch(`/api/documents?${params.toString()}`);
        const data = await response.json();
        if (!response.ok) return;

        const updates = new Map<string, DocumentSummary>(
          (data.documents ?? []).map((d: DocumentSummary) => [d.id, d])
        );
        setDocuments((prev) =>
          prev.map((doc) => updates.get(doc.id) ?? doc)
        );
      } catch {
        /* ignore polling errors */
      }
    }, 5000);

    return () => clearInterval(interval);
  }, [inProgressIds.join(",")]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const showingFrom = total === 0 ? 0 : page * PAGE_SIZE + 1;
  const showingTo = Math.min((page + 1) * PAGE_SIZE, total);

  async function handleDeleteDocument(documentId: string) {
    const response = await fetch(`/api/documents/${documentId}`, {
      method: "DELETE",
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error ?? "Failed to delete document");
    }
    await loadDocuments(appliedQuery, page, { silent: true });
  }

  return (
    <div className="space-y-8">
      <section>
        <h1 className="text-3xl font-bold tracking-tight">Document library</h1>
        <p className="mt-2 max-w-3xl text-muted">
          Browse, filter, and manage ingested LOIs and OLAs for purchase and
          lease deals.
        </p>
      </section>

      <MetadataFilters
        filters={filters}
        onChange={setFilters}
        onApply={() => {
          setPage(0);
          setAppliedQuery(filtersToQuery(filters));
        }}
        onReset={() => {
          setFilters(emptyFilters);
          setPage(0);
          setAppliedQuery("");
        }}
      />

      <DocumentList
        documents={documents}
        total={total}
        loading={loading}
        onDelete={handleDeleteDocument}
        pagination={{
          page,
          totalPages,
          showingFrom,
          showingTo,
          onPageChange: setPage,
        }}
      />
    </div>
  );
}
