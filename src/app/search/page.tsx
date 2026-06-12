"use client";

import Link from "next/link";
import { useState } from "react";
import type { SearchHit } from "@/lib/types";

export default function SearchPage() {
  const [query, setQuery] = useState("");
  const [documentType, setDocumentType] = useState("");
  const [results, setResults] = useState<SearchHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSearch(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/search/semantic", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query,
          documentType: documentType || undefined,
          limit: 12,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error ?? "Search failed");
      }
      setResults(data.results ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Search failed");
      setResults([]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-8">
      <section>
        <h1 className="text-3xl font-bold tracking-tight">Semantic search</h1>
        <p className="mt-2 max-w-3xl text-muted">
          Search across clause text using natural language — for example
          &quot;redelivery conditions with full life limited parts&quot; or
          &quot;early termination for insolvency&quot;.
        </p>
      </section>

      <form onSubmit={handleSearch} className="card space-y-4">
        <div>
          <label className="label" htmlFor="query">
            Search query
          </label>
          <textarea
            id="query"
            className="input min-h-28"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Describe the clause or concept you're looking for…"
            required
          />
        </div>
        <div className="max-w-xs">
          <label className="label">Document type (optional)</label>
          <select
            className="input"
            value={documentType}
            onChange={(e) => setDocumentType(e.target.value)}
          >
            <option value="">Any</option>
            <option value="LOI">LOI</option>
            <option value="OLA">OLA</option>
            <option value="OTHER">Other</option>
          </select>
        </div>
        <button type="submit" disabled={loading} className="btn-primary">
          {loading ? "Searching…" : "Search"}
        </button>
      </form>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="card">
        <h2 className="mb-4 text-lg font-semibold">Results</h2>
        {results.length === 0 ? (
          <p className="text-sm text-muted">
            {loading ? "Searching…" : "No results yet."}
          </p>
        ) : (
          <ul className="space-y-4">
            {results.map((hit) => (
              <li
                key={`${hit.documentId}-${hit.snippet.slice(0, 40)}`}
                className="rounded-lg border border-border p-4"
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
                      {hit.pageStart ? ` · p.${hit.pageStart}` : ""}
                    </p>
                    {hit.heading && (
                      <p className="mt-2 text-xs font-medium uppercase text-muted">
                        {hit.heading}
                      </p>
                    )}
                    <p className="mt-2 text-sm text-slate-700">{hit.snippet}</p>
                  </div>
                  <span className="text-xs font-medium text-muted">
                    {(hit.score * 100).toFixed(1)}%
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
