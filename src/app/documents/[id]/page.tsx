"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { ExtractionTracePanel } from "@/components/ExtractionTracePanel";
import { ProfileMetadataGrid, flattenMetadataForTable } from "@/components/ProfileMetadataGrid";
import { parseExtractionTrace } from "@/lib/extraction/extraction-trace";
import {
  dealTypeBadgeClass,
  formatParties,
  statusBadgeClass,
  type DocumentDealRelations,
  type DocumentSummary,
  type LinkedDocumentSummary,
  type MetadataField,
  type SearchHit,
} from "@/lib/types";

type DocumentDetail = DocumentSummary & {
  errorMessage?: string | null;
  profileId?: string | null;
  leaseType?: string | null;
  effectiveDate?: string | null;
  expiryDate?: string | null;
  governingLaw?: string | null;
  extractionModel?: string | null;
  schemaVersion?: string | null;
  textPreview?: string | null;
  hasFullText?: boolean;
  metadata?: Record<string, MetadataField>;
  deal?: DocumentDealRelations;
};

export default function DocumentDetailPage() {
  const params = useParams<{ id: string }>();
  const [document, setDocument] = useState<DocumentDetail | null>(null);
  const [similar, setSimilar] = useState<SearchHit[]>([]);
  const [loading, setLoading] = useState(true);
  const [similarLoading, setSimilarLoading] = useState(false);
  const [linkActionLoading, setLinkActionLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadDocument = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/documents/${params.id}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Failed to load");
      setDocument(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load document");
    } finally {
      setLoading(false);
    }
  }, [params.id]);

  const loadSimilar = useCallback(async () => {
    setSimilarLoading(true);
    try {
      const response = await fetch(`/api/documents/${params.id}/similar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ limit: 8 }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Similarity search failed");
      setSimilar(data.results ?? []);
    } catch (err) {
      console.error(err);
      setSimilar([]);
    } finally {
      setSimilarLoading(false);
    }
  }, [params.id]);

  useEffect(() => {
    loadDocument();
  }, [loadDocument]);

  useEffect(() => {
    if (document?.status === "ready") {
      loadSimilar();
    }
  }, [document?.status, loadSimilar]);

  async function handleReprocess() {
    await fetch(`/api/documents/${params.id}/reprocess`, { method: "POST" });
    await loadDocument();
  }

  async function handleLinkDocument(targetDocumentId: string) {
    setLinkActionLoading(true);
    try {
      const response = await fetch(`/api/documents/${params.id}/related`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetDocumentId }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Failed to link documents");
      await loadDocument();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to link documents");
    } finally {
      setLinkActionLoading(false);
    }
  }

  async function handleUnlink() {
    setLinkActionLoading(true);
    try {
      const response = await fetch(`/api/documents/${params.id}/related`, {
        method: "DELETE",
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Failed to unlink document");
      await loadDocument();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to unlink document");
    } finally {
      setLinkActionLoading(false);
    }
  }

  if (loading) {
    return <p className="text-muted">Loading document…</p>;
  }

  if (error || !document) {
    return (
      <div className="card">
        <p className="text-red-600">{error ?? "Document not found"}</p>
        <Link href="/documents" className="btn-secondary mt-4 inline-flex">
          Back to documents
        </Link>
      </div>
    );
  }

  const columnValues = {
    governingLaw: document.governingLaw,
    jurisdiction: document.jurisdiction,
    term: document.term,
    indicativeValue: document.indicativeValue,
    lessor: document.lessor,
    lessee: document.lessee,
    seller: document.seller,
    buyer: document.buyer,
    aircraftType: document.aircraftType,
    msn: document.msn,
  };
  const metadataEntries = flattenMetadataForTable(
    document.metadata,
    document.dealType ?? null,
    document.documentType ?? null,
    columnValues
  );
  const extractionTrace = parseExtractionTrace(document.metadata ?? null);
  const deal = document.deal;
  const linkedCounterpart =
    document.documentType === "LOI"
      ? deal?.linkedOla
      : document.documentType === "OLA"
        ? deal?.linkedLoi
        : null;

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link href="/documents" className="text-sm text-primary hover:underline">
            ← Back to documents
          </Link>
          <h1 className="mt-2 text-3xl font-bold">{document.filename}</h1>
          <div className="mt-2 flex flex-wrap gap-2">
            <span className={statusBadgeClass(document.status)}>
              {document.status}
            </span>
            {document.dealType && (
              <span className={dealTypeBadgeClass(document.dealType)}>
                {document.dealType}
              </span>
            )}
            {document.documentType && (
              <span className="badge bg-sky-100 text-sky-800">
                {document.documentType}
              </span>
            )}
            {document.profileId && (
              <span className="badge bg-slate-100 text-slate-700">
                {document.profileId}
              </span>
            )}
          </div>
        </div>
        <button
          type="button"
          onClick={handleReprocess}
          className="btn-secondary"
        >
          Reprocess
        </button>
      </div>

      {document.errorMessage && (
        <div className="card border-red-200 bg-red-50 text-red-700">
          {document.errorMessage}
        </div>
      )}

      {(document.documentType === "LOI" || document.documentType === "OLA") && (
        <DealLinksSection
          documentType={document.documentType}
          dealType={document.dealType}
          deal={deal}
          linkedCounterpart={linkedCounterpart ?? null}
          loading={linkActionLoading}
          onLink={handleLinkDocument}
          onUnlink={handleUnlink}
        />
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="card lg:col-span-2">
          <h2 className="mb-4 text-lg font-semibold">Extracted metadata</h2>
          <ProfileMetadataGrid
            dealType={document.dealType}
            documentType={document.documentType}
            metadata={document.metadata}
            columnValues={columnValues}
          />
        </div>

        <div className="card">
          <h2 className="mb-4 text-lg font-semibold">Extraction details</h2>
          <dl className="grid gap-3 text-sm">
            <Field label="Model" value={document.extractionModel} />
            <Field label="Schema version" value={document.schemaVersion} />
            <Field
              label="Updated"
              value={new Date(document.updatedAt).toLocaleString()}
            />
          </dl>
        </div>
      </div>

      <ExtractionTracePanel trace={extractionTrace} />

      {metadataEntries.length > 0 && (
        <div className="card overflow-hidden p-0">
          <div className="border-b border-border px-6 py-4">
            <h2 className="text-lg font-semibold">All extracted fields</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase text-muted">
                <tr>
                  <th className="px-6 py-3">Field</th>
                  <th className="px-6 py-3">Value</th>
                  <th className="px-6 py-3">Confidence</th>
                  <th className="px-6 py-3">Source</th>
                </tr>
              </thead>
              <tbody>
                {metadataEntries.map(({ key, label, field }) => (
                  <tr key={key} className="border-t border-border">
                    <td className="px-6 py-3 font-medium">{label}</td>
                    <td className="px-6 py-3">
                      {String(field.value ?? "—")}
                      {field.indicative && (
                        <span className="ml-2 badge bg-amber-100 text-amber-800">
                          indicative
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-3">
                      {field.confidence !== undefined
                        ? `${Math.round(field.confidence * 100)}%`
                        : "—"}
                    </td>
                    <td className="px-6 py-3 text-muted">
                      {field.source?.section ?? field.source?.snippet?.slice(0, 80) ?? "—"}
                      {field.source?.page ? ` (p.${field.source.page})` : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {document.textPreview && (
        <div className="card">
          <h2 className="mb-4 text-lg font-semibold">Text preview</h2>
          <pre className="max-h-96 overflow-auto whitespace-pre-wrap text-xs text-slate-700">
            {document.textPreview}
          </pre>
        </div>
      )}

      <div className="card">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Similar documents</h2>
          <button
            type="button"
            onClick={loadSimilar}
            className="btn-secondary"
            disabled={similarLoading || document.status !== "ready"}
          >
            Refresh
          </button>
        </div>
        {document.status !== "ready" ? (
          <p className="text-sm text-muted">
            Similarity search is available once processing completes.
          </p>
        ) : similarLoading ? (
          <p className="text-sm text-muted">Finding similar documents…</p>
        ) : similar.length === 0 ? (
          <p className="text-sm text-muted">No similar documents found yet.</p>
        ) : (
          <ul className="space-y-3">
            {similar.map((hit) => (
              <li
                key={hit.documentId}
                className="rounded-lg border border-border p-4 hover:bg-slate-50"
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <Link
                      href={`/documents/${hit.documentId}`}
                      className="font-medium text-primary hover:underline"
                    >
                      {hit.filename}
                    </Link>
                    <p className="mt-1 text-sm text-muted">
                      {[hit.documentType, hit.lessor, hit.lessee]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                    {hit.snippet && (
                      <p className="mt-2 text-sm text-slate-700">{hit.snippet}</p>
                    )}
                  </div>
                  <span className="text-xs font-medium text-muted">
                    {(hit.score * 100).toFixed(1)}% match
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <dt className="label">{label}</dt>
      <dd>{value ?? "—"}</dd>
    </div>
  );
}

function DealLinksSection({
  documentType,
  dealType,
  deal,
  linkedCounterpart,
  loading,
  onLink,
  onUnlink,
}: {
  documentType: string;
  dealType?: string | null;
  deal?: DocumentDealRelations;
  linkedCounterpart: LinkedDocumentSummary | null;
  loading: boolean;
  onLink: (targetDocumentId: string) => void;
  onUnlink: () => void;
}) {
  const counterpartLabel = documentType === "LOI" ? "OLA" : "LOI";
  const dealLabel = dealType === "PURCHASE" ? "purchase" : "lease";

  return (
    <div className="card">
      <div className="mb-4 flex items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold">Linked {counterpartLabel}</h2>
          <p className="text-sm text-muted">
            Connect this {dealLabel} {documentType} to its corresponding{" "}
            {counterpartLabel} when both documents are in the library.
          </p>
        </div>
        {linkedCounterpart && (
          <button
            type="button"
            onClick={onUnlink}
            disabled={loading}
            className="btn-secondary"
          >
            Unlink
          </button>
        )}
      </div>

      {linkedCounterpart ? (
        <LinkedDocumentCard doc={linkedCounterpart} />
      ) : (
        <p className="text-sm text-muted">
          No linked {counterpartLabel} yet.
          {deal?.suggestions.length
            ? " Suggested matches are shown below."
            : " Upload the matching document or reprocess to attempt auto-linking."}
        </p>
      )}

      {!linkedCounterpart && (deal?.suggestions.length ?? 0) > 0 && (
        <div className="mt-4 space-y-3">
          <h3 className="text-sm font-medium">Suggested matches</h3>
          {deal?.suggestions.map((suggestion) => (
            <div
              key={suggestion.id}
              className="flex flex-wrap items-start justify-between gap-4 rounded-lg border border-border p-4"
            >
              <LinkedDocumentCard doc={suggestion} />
              <div className="flex flex-col items-end gap-2">
                <span className="text-xs font-medium text-muted">
                  {(suggestion.matchScore * 100).toFixed(0)}% match
                </span>
                <button
                  type="button"
                  onClick={() => onLink(suggestion.id)}
                  disabled={loading}
                  className="btn-primary"
                >
                  Link
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function LinkedDocumentCard({ doc }: { doc: LinkedDocumentSummary }) {
  const parties = formatParties(doc);
  return (
    <div>
      <Link
        href={`/documents/${doc.id}`}
        className="font-medium text-primary hover:underline"
      >
        {doc.filename}
      </Link>
      <p className="mt-1 text-sm text-muted">
        {[
          doc.dealType,
          doc.documentType,
          parties.primary,
          parties.secondary,
          doc.msn,
          doc.registration,
        ]
          .filter(Boolean)
          .join(" · ")}
      </p>
      {doc.linkConfidence !== null && doc.linkSource !== "suggested" && (
        <p className="mt-1 text-xs text-muted">
          Linked {doc.linkSource} · {(doc.linkConfidence * 100).toFixed(0)}% confidence
        </p>
      )}
    </div>
  );
}
