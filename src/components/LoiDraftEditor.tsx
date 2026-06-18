"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { LoiDraftContent, LoiDraftField } from "@/lib/generation/loi-draft-types";

type DraftRecord = {
  id: string;
  title: string;
  completenessPct: number;
  status: string;
  content: LoiDraftContent;
  assemblyLog: Array<{ step: string; detail: string }>;
  precedentDocumentIds: string[];
};

function sourceBadge(source: LoiDraftField["source"]) {
  switch (source) {
    case "proforma":
      return (
        <span className="badge bg-violet-100 text-violet-800">proforma</span>
      );
    case "precedent+proforma":
      return (
        <span className="badge bg-amber-100 text-amber-900">
          precedent + proforma
        </span>
      );
    case "precedent":
      return (
        <span className="badge bg-emerald-100 text-emerald-800">precedent</span>
      );
    case "user":
      return <span className="badge bg-sky-100 text-sky-800">edited</span>;
    default:
      return <span className="badge bg-slate-100 text-slate-600">template</span>;
  }
}

export function LoiDraftEditor({ draftId }: { draftId: string }) {
  const [draft, setDraft] = useState<DraftRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingKey, setSavingKey] = useState<string | null>(null);

  const loadDraft = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/drafts/${draftId}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to load draft");
      setDraft(data.draft);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load draft");
    } finally {
      setLoading(false);
    }
  }, [draftId]);

  useEffect(() => {
    void loadDraft();
  }, [loadDraft]);

  const emptyFields = useMemo(() => {
    if (!draft) return [];
    const out: LoiDraftField[] = [];
    for (const section of draft.content.sections) {
      for (const field of section.fields) {
        if (!field.value?.trim()) out.push(field);
      }
    }
    return out;
  }, [draft]);

  async function saveField(fieldKey: string, value: string) {
    setSavingKey(fieldKey);
    try {
      const res = await fetch(`/api/drafts/${draftId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fieldKey, value }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to save");
      setDraft(data.draft);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save field");
    } finally {
      setSavingKey(null);
    }
  }

  async function saveFieldLabel(fieldKey: string, label: string) {
    setSavingKey(`${fieldKey}:label`);
    try {
      const res = await fetch(`/api/drafts/${draftId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fieldKey, label }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to save");
      setDraft(data.draft);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save heading");
    } finally {
      setSavingKey(null);
    }
  }

  async function saveHeader(
    patch: Partial<Pick<LoiDraftContent, "documentTitle" | "letterheadTitle">>
  ) {
    setSavingKey("headers");
    try {
      const res = await fetch(`/api/drafts/${draftId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to save");
      setDraft(data.draft);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save headers");
    } finally {
      setSavingKey(null);
    }
  }

  async function deleteField(fieldKey: string, label: string) {
    if (
      !window.confirm(
        `Remove "${label}" from this draft? It will not appear in export.`
      )
    ) {
      return;
    }

    setSavingKey(`delete:${fieldKey}`);
    try {
      const res = await fetch(`/api/drafts/${draftId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deleteFieldKey: fieldKey }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to delete");
      setDraft(data.draft);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete field");
    } finally {
      setSavingKey(null);
    }
  }

  async function addField() {
    setSavingKey("add-field");
    try {
      const res = await fetch(`/api/drafts/${draftId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          addField: { label: "New section", value: null },
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to add section");
      setDraft(data.draft);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add section");
    } finally {
      setSavingKey(null);
    }
  }

  const preambleField = useMemo(() => {
    if (!draft) return null;
    for (const section of draft.content.sections) {
      const field = section.fields.find((f) => f.key === "preamble");
      if (field) return field;
    }
    return null;
  }, [draft]);

  const bodyFields = useMemo(() => {
    if (!draft) return [];
    const out: LoiDraftField[] = [];
    for (const section of draft.content.sections) {
      for (const field of section.fields) {
        if (field.key === "preamble") continue;
        out.push(field);
      }
    }
    return out;
  }, [draft]);

  if (loading) {
    return <p className="text-sm text-muted">Loading draft…</p>;
  }

  if (error && !draft) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-red-600">{error}</p>
        <Link href="/precedents" className="btn-secondary">
          Back to precedent finder
        </Link>
      </div>
    );
  }

  if (!draft) return null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{draft.title}</h1>
          <p className="mt-1 text-sm text-muted">
            LOI draft · {draft.completenessPct}% complete
            {draft.precedentDocumentIds.length > 0 &&
              ` · ${draft.precedentDocumentIds.length} precedent${draft.precedentDocumentIds.length === 1 ? "" : "s"}`}
            {draft.content.templateFilename &&
              ` · template from ${draft.content.templateFilename}`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <a
            href={`/api/drafts/${draftId}/export?format=pdf`}
            className="btn-primary"
            download
          >
            Export PDF
          </a>
          <a
            href={`/api/drafts/${draftId}/export?format=docx`}
            className="btn-secondary"
            download
          >
            Export Word
          </a>
          <a
            href={`/api/drafts/${draftId}/export?format=txt`}
            className="btn-secondary"
            download
          >
            Export text
          </a>
          <Link href="/precedents" className="btn-secondary">
            New search
          </Link>
        </div>
      </div>

      <div className="h-2 overflow-hidden rounded-full bg-slate-100">
        <div
          className="h-full rounded-full bg-primary transition-all"
          style={{ width: `${draft.completenessPct}%` }}
        />
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="grid gap-6 lg:grid-cols-[1fr_280px]">
        <div className="card space-y-6">
          <p className="text-xs text-muted">
            Sections are ported from precedents and reconciled with your
            proforma. PDF and Word export use the miniAviator house layout.
            Edit document headers and section headings below — they appear in
            the exported letterhead and as bold section titles.
          </p>

          <section className="rounded-lg border border-primary/20 bg-primary/5 p-4">
            <h2 className="mb-3 text-sm font-semibold text-slate-800">
              Document headers
            </h2>
            <dl className="space-y-3">
              <div>
                <dt className="mb-1 text-xs font-medium text-muted">
                  Main title (letterhead)
                </dt>
                <dd>
                  <input
                    type="text"
                    className="input py-2"
                    defaultValue={
                      draft.content.letterheadTitle?.trim() ||
                      "LETTER OF INTENT"
                    }
                    placeholder="LETTER OF INTENT"
                    disabled={savingKey === "headers"}
                    onBlur={(e) => {
                      const next = e.target.value.trim() || "LETTER OF INTENT";
                      const prev =
                        draft.content.letterheadTitle?.trim() ||
                        "LETTER OF INTENT";
                      if (next !== prev) {
                        void saveHeader({ letterheadTitle: next });
                      }
                    }}
                  />
                </dd>
              </div>
              <div>
                <dt className="mb-1 text-xs font-medium text-muted">
                  Subtitle (below main title)
                </dt>
                <dd>
                  <input
                    type="text"
                    className="input py-2"
                    defaultValue={draft.content.documentTitle}
                    placeholder="e.g. Southern Jet Airways · Boeing 787-9"
                    disabled={savingKey === "headers"}
                    onBlur={(e) => {
                      const next = e.target.value.trim();
                      const prev = draft.content.documentTitle.trim();
                      if (next && next !== prev) {
                        void saveHeader({ documentTitle: next });
                      }
                    }}
                  />
                </dd>
              </div>
              {preambleField && (
                <div>
                  <dt className="mb-1 flex flex-wrap items-center justify-between gap-2 text-xs font-medium text-muted">
                    <span className="flex flex-wrap items-center gap-2">
                      Opening letter (preamble)
                      {sourceBadge(preambleField.source)}
                    </span>
                    <button
                      type="button"
                      className="text-[11px] font-medium text-red-600 hover:text-red-700 disabled:opacity-50"
                      disabled={savingKey === `delete:${preambleField.key}`}
                      onClick={() =>
                        void deleteField(preambleField.key, "Opening letter")
                      }
                    >
                      Remove
                    </button>
                  </dt>
                  <dd>
                    <textarea
                      className="input min-h-[8rem] resize-y py-2 font-normal"
                      defaultValue={preambleField.value ?? ""}
                      placeholder="Dear Sir/Madam, …"
                      disabled={savingKey === preambleField.key}
                      onBlur={(e) => {
                        const next = e.target.value.trim();
                        const prev = (preambleField.value ?? "").trim();
                        if (next !== prev) {
                          void saveField(preambleField.key, next);
                        }
                      }}
                    />
                  </dd>
                </div>
              )}
            </dl>
          </section>

          <div className="space-y-4">
            {bodyFields.map((field) => {
              const isEmpty = !field.value?.trim();
              const isLongSection = (field.value?.length ?? 0) > 280;
              const isDeleting = savingKey === `delete:${field.key}`;
              return (
                <div
                  key={field.key}
                  className={`rounded-lg border p-3 ${
                    isEmpty
                      ? "border-amber-200 bg-amber-50/50"
                      : "border-border bg-slate-50/50"
                  }`}
                >
                  <div className="mb-2 flex items-start justify-between gap-2">
                    <label className="block flex-1 text-xs font-medium text-muted">
                      Section heading (export)
                    </label>
                    <button
                      type="button"
                      className="shrink-0 text-[11px] font-medium text-red-600 hover:text-red-700 disabled:opacity-50"
                      disabled={isDeleting}
                      onClick={() => void deleteField(field.key, field.label)}
                    >
                      Remove
                    </button>
                  </div>
                  <input
                    type="text"
                    className="input mb-2 py-1.5 text-sm font-semibold"
                    defaultValue={field.label}
                    disabled={savingKey === `${field.key}:label`}
                    onBlur={(e) => {
                      const next = e.target.value.trim();
                      const prev = field.label.trim();
                      if (next && next !== prev) {
                        void saveFieldLabel(field.key, next);
                      }
                    }}
                  />
                  <div className="mb-1 flex flex-wrap items-center gap-2 text-xs font-medium text-muted">
                    Body text
                    {sourceBadge(field.source)}
                    {field.fieldScore != null && (
                      <span className="text-[10px] text-muted">
                        {Math.round(field.fieldScore * 100)}% match
                      </span>
                    )}
                    {field.precedentFilename && (
                      <span className="text-[10px] text-muted">
                        via {field.precedentFilename}
                      </span>
                    )}
                  </div>
                  <textarea
                    className={`input resize-y py-2 font-normal ${
                      isLongSection
                        ? "min-h-[12rem] font-mono text-xs"
                        : "min-h-[2.5rem]"
                    }`}
                    defaultValue={field.value ?? ""}
                    placeholder="Enter section text…"
                    disabled={savingKey === field.key}
                    onBlur={(e) => {
                      const next = e.target.value.trim();
                      const prev = (field.value ?? "").trim();
                      if (next !== prev) {
                        void saveField(field.key, next);
                      }
                    }}
                  />
                </div>
              );
            })}

            <button
              type="button"
              className="btn-secondary w-full"
              disabled={savingKey === "add-field"}
              onClick={() => void addField()}
            >
              {savingKey === "add-field" ? "Adding…" : "+ Add section"}
            </button>
          </div>
        </div>

        <aside className="space-y-4">
          <div className="card">
            <h3 className="mb-2 text-sm font-semibold">Empty sections</h3>
            {emptyFields.length === 0 ? (
              <p className="text-sm text-emerald-700">
                All sections filled. Export your LOI when ready.
              </p>
            ) : (
              <ul className="space-y-1 text-sm text-muted">
                {emptyFields.map((f) => (
                  <li key={f.key}>· {f.label}</li>
                ))}
              </ul>
            )}
          </div>

          {draft.assemblyLog.length > 0 && (
            <div className="card">
              <h3 className="mb-2 text-sm font-semibold">Assembly log</h3>
              <ol className="space-y-2 text-xs text-muted">
                {draft.assemblyLog.map((step, i) => (
                  <li key={i}>
                    <span className="font-medium text-slate-700">
                      {step.step}
                    </span>
                    <br />
                    {step.detail}
                  </li>
                ))}
              </ol>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
