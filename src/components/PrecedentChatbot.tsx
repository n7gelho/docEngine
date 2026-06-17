"use client";

import Link from "next/link";
import { useCallback, useMemo, useRef, useState } from "react";
import type { DealParameterKey } from "@/lib/extraction/deal-parameters";
import { DEAL_PARAMETER_KEYS } from "@/lib/extraction/deal-parameters";
import {
  DEAL_PARAMETER_CHAT_PROMPTS,
  DEAL_PARAMETER_LABELS,
  getFilledBriefKeys,
  type ProformaBrief,
} from "@/lib/retrieval/proforma-brief";
import {
  dealTypeBadgeClass,
  formatParties,
  formatRent,
} from "@/lib/types";

type ChatMessage = {
  id: string;
  role: "assistant" | "user";
  text: string;
};

type PrecedentResult = {
  documentId: string;
  filename: string;
  documentType: string | null;
  dealType: string | null;
  lessor: string | null;
  lessee: string | null;
  seller: string | null;
  buyer: string | null;
  aircraftType: string | null;
  term: string | null;
  leaseType: string | null;
  monthlyRent: number | null;
  currency: string | null;
  matchScore: number;
  matchedParameters: number;
  comparedParameters: number;
  parameterMatches: Array<{
    key: string;
    label: string;
    briefValue: string;
    documentValue: string | null;
    score: number;
    matched: boolean;
  }>;
};

type FlowMode = "choose" | "chat" | "upload" | "review" | "results";

type TargetDocumentType = "LOI" | "OLA";

function nextMessageId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function formatPercent(score: number): string {
  return `${Math.round(score * 100)}%`;
}

export function PrecedentChatbot() {
  const [mode, setMode] = useState<FlowMode>("choose");
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: nextMessageId(),
      role: "assistant",
      text: "Find past lease contracts that match your new deal. Choose LOI or OLA, then enter parameters or upload a proforma.",
    },
  ]);
  const [brief, setBrief] = useState<ProformaBrief>({});
  const [questionIndex, setQuestionIndex] = useState(0);
  const [inputValue, setInputValue] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<PrecedentResult[]>([]);
  const [extractModel, setExtractModel] = useState<string | null>(null);
  const [targetDocumentType, setTargetDocumentType] =
    useState<TargetDocumentType | null>(null);
  const [extraReviewKeys, setExtraReviewKeys] = useState<DealParameterKey[]>(
    []
  );
  const fileInputRef = useRef<HTMLInputElement>(null);

  const currentKey = DEAL_PARAMETER_KEYS[questionIndex] as
    | DealParameterKey
    | undefined;

  const filledKeys = useMemo(() => getFilledBriefKeys(brief), [brief]);
  const filledCount = filledKeys.length;

  const visibleReviewKeys = useMemo(() => {
    const keys = new Set<DealParameterKey>([...filledKeys, ...extraReviewKeys]);
    return DEAL_PARAMETER_KEYS.filter((key) => keys.has(key));
  }, [filledKeys, extraReviewKeys]);

  const addableReviewKeys = useMemo(
    () => DEAL_PARAMETER_KEYS.filter((key) => !visibleReviewKeys.includes(key)),
    [visibleReviewKeys]
  );

  const answeredInWizard = useMemo(
    () =>
      DEAL_PARAMETER_KEYS.slice(0, questionIndex).filter((key) =>
        filledKeys.includes(key)
      ).length,
    [questionIndex, filledKeys]
  );

  const appendMessage = useCallback((role: ChatMessage["role"], text: string) => {
    setMessages((prev) => [...prev, { id: nextMessageId(), role, text }]);
  }, []);

  function selectTargetDocumentType(type: TargetDocumentType) {
    setTargetDocumentType(type);
  }

  function startManualFlow() {
    if (!targetDocumentType) return;
    setMode("chat");
    setQuestionIndex(0);
    setBrief({});
    setExtraReviewKeys([]);
    setResults([]);
    setError(null);
    setInputValue("");
    appendMessage(
      "assistant",
      `Enter any proforma details you have — skip fields you're unsure about. I'll use whatever you provide to find matching ${targetDocumentType === "LOI" ? "LOIs" : "OLAs"}.`
    );
  }

  function startUploadFlow() {
    if (!targetDocumentType) return;
    setMode("upload");
    setExtraReviewKeys([]);
    setResults([]);
    setError(null);
    appendMessage(
      "assistant",
      "Upload your proforma (PDF or DOCX) and I'll extract the commercial parameters."
    );
    fileInputRef.current?.click();
  }

  function goToReview(nextBrief: ProformaBrief) {
    setMode("review");
    const count = getFilledBriefKeys(nextBrief).length;
    appendMessage(
      "assistant",
      count > 0
        ? `${count} parameter${count === 1 ? "" : "s"} captured — review below, then search.`
        : "No parameters captured yet. Add at least one below before searching."
    );
  }

  function handleSkip() {
    if (!currentKey) return;
    advanceQuestion(brief);
  }

  function advanceQuestion(nextBrief: ProformaBrief) {
    const nextIndex = questionIndex + 1;
    if (nextIndex >= DEAL_PARAMETER_KEYS.length) {
      goToReview(nextBrief);
      return;
    }
    setQuestionIndex(nextIndex);
    setInputValue("");
  }

  function handleAnswerSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!currentKey) return;

    const trimmed = inputValue.trim();
    if (!trimmed) {
      handleSkip();
      return;
    }

    const parsedValue =
      currentKey === "aircraft_count"
        ? Number.parseInt(trimmed.replace(/[^0-9]/g, ""), 10) || trimmed
        : trimmed;

    const nextBrief = { ...brief, [currentKey]: parsedValue };
    setBrief(nextBrief);
    advanceQuestion(nextBrief);
  }

  async function handleProformaUpload(file: File) {
    setLoading(true);
    setError(null);
    appendMessage("user", `Uploaded: ${file.name}`);

    try {
      const formData = new FormData();
      formData.append("file", file);
      const response = await fetch("/api/precedents/extract", {
        method: "POST",
        body: formData,
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error ?? "Extraction failed");
      }

      const extractedBrief = data.brief ?? {};
      setBrief(extractedBrief);
      setExtraReviewKeys([]);
      setExtractModel(data.model ?? null);
      const count = getFilledBriefKeys(extractedBrief).length;
      appendMessage(
        "assistant",
        `Extracted ${count} parameter${count === 1 ? "" : "s"} from your proforma${data.model ? ` (${data.model})` : ""}. Review below before searching.`
      );
      setMode("review");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Extraction failed";
      setError(message);
      appendMessage("assistant", `Couldn't read that file: ${message}`);
    } finally {
      setLoading(false);
    }
  }

  async function handleSearch() {
    if (!targetDocumentType) {
      setError("Select LOI or OLA before searching.");
      return;
    }
    if (filledCount === 0) {
      setError("Provide at least one parameter before searching.");
      return;
    }

    setLoading(true);
    setError(null);
    setResults([]);
    appendMessage(
      "assistant",
      `Searching for the top 3 matching ${targetDocumentType === "LOI" ? "LOIs" : "OLAs"}…`
    );

    try {
      const response = await fetch("/api/precedents/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          parameters: brief,
          limit: 3,
          dealType: "LEASE",
          documentType: targetDocumentType,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error ?? "Search failed");
      }

      setResults(data.results ?? []);
      setMode("results");
      const count = data.results?.length ?? 0;
      const docLabel = targetDocumentType === "LOI" ? "LOI" : "OLA";
      const docLabelPlural = targetDocumentType === "LOI" ? "LOIs" : "OLAs";
      appendMessage(
        "assistant",
        count > 0
          ? `Found ${count} relevant ${count === 1 ? docLabel : docLabelPlural}.`
          : `No matching ${docLabelPlural} found. Try adding more parameters or reprocessing your document library.`
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : "Search failed";
      setError(message);
      appendMessage("assistant", `Search failed: ${message}`);
    } finally {
      setLoading(false);
    }
  }

  function updateBriefField(key: DealParameterKey, value: string) {
    setBrief((prev) => ({
      ...prev,
      [key]: value.trim() === "" ? null : value,
    }));
  }

  function addReviewParameter(key: DealParameterKey) {
    setExtraReviewKeys((prev) =>
      prev.includes(key) ? prev : [...prev, key]
    );
  }

  function removeReviewParameter(key: DealParameterKey) {
    setBrief((prev) => ({ ...prev, [key]: null }));
    setExtraReviewKeys((prev) => prev.filter((k) => k !== key));
  }

  function resetChat() {
    setMode("choose");
    setBrief({});
    setQuestionIndex(0);
    setInputValue("");
    setResults([]);
    setError(null);
    setExtractModel(null);
    setExtraReviewKeys([]);
    setTargetDocumentType(null);
    setMessages([
      {
        id: nextMessageId(),
        role: "assistant",
        text: "Find past lease contracts that match your new deal. Choose LOI or OLA, then enter parameters or upload a proforma.",
      },
    ]);
  }

  const wizardProgress =
    mode === "chat"
      ? Math.round((questionIndex / DEAL_PARAMETER_KEYS.length) * 100)
      : 0;

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void handleProformaUpload(file);
          event.target.value = "";
        }}
      />

      <section className="card flex min-h-[560px] flex-col">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">Contract assistant</h2>
          <button type="button" className="btn-secondary" onClick={resetChat}>
            Start over
          </button>
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto rounded-lg border border-border bg-slate-50/80 p-4">
          {messages.map((message) => (
            <div
              key={message.id}
              className={`max-w-[92%] rounded-xl px-4 py-3 text-sm ${
                message.role === "assistant"
                  ? "bg-white text-slate-800 shadow-sm"
                  : "ml-auto bg-primary text-white"
              }`}
            >
              {message.text}
            </div>
          ))}
        </div>

        {mode === "choose" && (
          <div className="mt-4 space-y-4">
            <div>
              <p className="label mb-2">Document you want to generate</p>
              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  className={
                    targetDocumentType === "LOI" ? "btn-primary" : "btn-secondary"
                  }
                  onClick={() => selectTargetDocumentType("LOI")}
                >
                  Letter of Intent (LOI)
                </button>
                <button
                  type="button"
                  className={
                    targetDocumentType === "OLA" ? "btn-primary" : "btn-secondary"
                  }
                  onClick={() => selectTargetDocumentType("OLA")}
                >
                  Operating Lease Agreement (OLA)
                </button>
              </div>
            </div>
            <div>
              <p className="label mb-2">How to provide your proforma</p>
              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  className="btn-primary"
                  onClick={startManualFlow}
                  disabled={!targetDocumentType}
                >
                  Enter parameters
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={startUploadFlow}
                  disabled={!targetDocumentType}
                >
                  Upload proforma
                </button>
              </div>
            </div>
          </div>
        )}

        {mode === "chat" && currentKey && (
          <form onSubmit={handleAnswerSubmit} className="mt-4 space-y-3">
            <div className="space-y-1">
              <label className="label" htmlFor="chat-input">
                {DEAL_PARAMETER_LABELS[currentKey]}
              </label>
              <p className="text-sm text-muted">
                {DEAL_PARAMETER_CHAT_PROMPTS[currentKey]}
              </p>
            </div>
            <input
              id="chat-input"
              className="input"
              value={inputValue}
              onChange={(event) => setInputValue(event.target.value)}
              placeholder="Leave blank to skip"
              disabled={loading}
              autoFocus
            />
            <div className="flex gap-3">
              <button type="submit" className="btn-primary" disabled={loading}>
                {questionIndex + 1 >= DEAL_PARAMETER_KEYS.length
                  ? "Finish"
                  : "Next"}
              </button>
              <button
                type="button"
                className="btn-secondary"
                onClick={handleSkip}
                disabled={loading}
              >
                Skip
              </button>
            </div>
            <div className="space-y-1">
              <div className="h-1.5 overflow-hidden rounded-full bg-slate-200">
                <div
                  className="h-full rounded-full bg-primary transition-all"
                  style={{ width: `${wizardProgress}%` }}
                />
              </div>
              <p className="text-xs text-muted">
                {answeredInWizard} answered · step {questionIndex + 1} of{" "}
                {DEAL_PARAMETER_KEYS.length}
              </p>
            </div>
          </form>
        )}

        {mode === "upload" && !loading && (
          <div className="mt-4">
            <button
              type="button"
              className="btn-secondary"
              onClick={() => fileInputRef.current?.click()}
            >
              Choose proforma file
            </button>
          </div>
        )}

        {loading && (
          <p className="mt-4 text-sm text-muted">Working…</p>
        )}

        {error && (
          <p className="mt-4 text-sm text-red-600">{error}</p>
        )}
      </section>

      <section className="space-y-6">
        {(mode === "review" || mode === "results") && (
          <div className="card space-y-4">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-lg font-semibold">Proforma parameters</h2>
              <div className="flex flex-wrap gap-2">
                {targetDocumentType && (
                  <span className="badge bg-violet-100 text-violet-800">
                    Target: {targetDocumentType}
                  </span>
                )}
                <span className="badge bg-indigo-100 text-indigo-900">
                  {filledCount} filled
                </span>
              </div>
            </div>
            {extractModel && (
              <p className="text-xs text-muted">Extracted with: {extractModel}</p>
            )}

            {visibleReviewKeys.length === 0 ? (
              <p className="text-sm text-muted">
                No parameters yet. Add one below to start matching.
              </p>
            ) : (
              <div className="space-y-3">
                {visibleReviewKeys.map((key) => (
                  <div key={key} className="flex gap-2">
                    <div className="min-w-0 flex-1">
                      <label className="label" htmlFor={`brief-${key}`}>
                        {DEAL_PARAMETER_LABELS[key]}
                      </label>
                      <input
                        id={`brief-${key}`}
                        className="input"
                        value={
                          brief[key] === null || brief[key] === undefined
                            ? ""
                            : String(brief[key])
                        }
                        onChange={(event) =>
                          updateBriefField(key, event.target.value)
                        }
                        disabled={loading}
                      />
                    </div>
                    <button
                      type="button"
                      className="btn-secondary mt-6 shrink-0 px-2 text-xs"
                      onClick={() => removeReviewParameter(key)}
                      disabled={loading}
                      title="Remove parameter"
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            )}

            {addableReviewKeys.length > 0 && (
              <div className="flex flex-wrap items-center gap-2">
                <label className="text-sm text-muted" htmlFor="add-parameter">
                  Add parameter
                </label>
                <select
                  id="add-parameter"
                  className="input max-w-xs"
                  defaultValue=""
                  disabled={loading}
                  onChange={(event) => {
                    const key = event.target.value as DealParameterKey;
                    if (key) addReviewParameter(key);
                    event.target.value = "";
                  }}
                >
                  <option value="">Choose…</option>
                  {addableReviewKeys.map((key) => (
                    <option key={key} value={key}>
                      {DEAL_PARAMETER_LABELS[key]}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <button
              type="button"
              className="btn-primary"
              onClick={handleSearch}
              disabled={loading || filledCount === 0 || !targetDocumentType}
            >
              Find top 3 {targetDocumentType === "LOI" ? "LOI" : "OLA"} precedents
            </button>
          </div>
        )}

        {mode === "results" && (
          <div className="card space-y-4">
            <h2 className="text-lg font-semibold">
              Top {targetDocumentType} matches
            </h2>
            {results.length === 0 ? (
              <p className="text-sm text-muted">
                No {targetDocumentType === "LOI" ? "LOIs" : "OLAs"} matched your
                parameters. Try adding more parameters or reprocessing your document
                library.
              </p>
            ) : (
              <ul className="space-y-4">
                {results.map((result, index) => {
                  const parties = formatParties(result);
                  return (
                    <li
                      key={result.documentId}
                      className="rounded-xl border border-border p-4"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <p className="text-xs font-medium uppercase tracking-wide text-muted">
                            #{index + 1}
                          </p>
                          <Link
                            href={`/documents/${result.documentId}`}
                            className="font-medium text-primary hover:underline"
                          >
                            {result.filename}
                          </Link>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {result.dealType && (
                            <span className={dealTypeBadgeClass(result.dealType)}>
                              {result.dealType}
                            </span>
                          )}
                          <span className="badge bg-emerald-100 text-emerald-800">
                            {result.matchedParameters}/{result.comparedParameters}{" "}
                            matched
                          </span>
                          <span className="badge bg-slate-100 text-slate-700">
                            {formatPercent(result.matchScore)} score
                          </span>
                        </div>
                      </div>
                      <p className="mt-2 text-sm text-muted">
                        {[result.documentType, parties.primary, result.aircraftType]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                      <p className="mt-1 text-sm text-muted">
                        {result.leaseType && `Type: ${result.leaseType}`}
                        {result.term && ` · Term: ${result.term}`}
                        {result.monthlyRent != null &&
                          ` · Rent: ${formatRent(result.monthlyRent, result.currency)}`}
                      </p>
                      <ul className="mt-3 space-y-1 text-xs">
                        {result.parameterMatches.map((match) => (
                          <li
                            key={match.key}
                            className={
                              match.matched ? "text-emerald-700" : "text-slate-500"
                            }
                          >
                            {match.matched ? "✓" : "·"} {match.label}:{" "}
                            {match.documentValue ?? "—"}
                          </li>
                        ))}
                      </ul>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}

        {mode === "choose" && (
          <div className="card text-sm text-muted">
            <h3 className="mb-2 font-medium text-slate-900">How matching works</h3>
            <p>
              Choose LOI or OLA, then provide your proforma parameters. Only the
              fields you fill in are used for scoring. Aircraft type must match
              exactly; other fields use fuzzy comparison where appropriate.
            </p>
          </div>
        )}
      </section>
    </div>
  );
}
