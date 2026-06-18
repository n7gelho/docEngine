"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DealParameterKey } from "@/lib/extraction/deal-parameters";
import { DEAL_PARAMETER_KEYS } from "@/lib/extraction/deal-parameters";
import {
  DEAL_PARAMETER_LABELS,
  getFilledBriefKeys,
  getProformaGoverningLaw,
  type ProformaBrief,
} from "@/lib/retrieval/proforma-brief";
import { formatPrecedentDealSummary } from "@/lib/retrieval/precedent-summary";
import { computeSuitabilityScore } from "@/lib/retrieval/template-fitness";
import {
  dealTypeBadgeClass,
} from "@/lib/types";

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
  governingLaw: string | null;
  processedAt: string;
  matchScore: number;
  suitabilityScore: number;
  precedentScore: number;
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

type TargetDocumentType = "LOI" | "OLA";

type ChatStep =
  | "pick-doc-type"
  | "pick-input"
  | "wizard"
  | "upload"
  | "review"
  | "governing-law"
  | "searching"
  | "done";

type ChatMessage =
  | { id: string; role: "assistant" | "user"; kind: "text"; text: string }
  | {
      id: string;
      role: "assistant";
      kind: "parameters";
      brief: ProformaBrief;
      targetDocumentType: TargetDocumentType;
      extractModel: string | null;
    }
  | {
      id: string;
      role: "assistant";
      kind: "results";
      results: PrecedentResult[];
      targetDocumentType: TargetDocumentType;
    };

function nextMessageId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function formatPercent(score: number): string {
  return `${Math.round(score * 100)}%`;
}

function formatProcessedDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function recencyAgeYears(processedAt: string): number | null {
  const date = new Date(processedAt);
  if (Number.isNaN(date.getTime())) return null;
  return Math.max(0, new Date().getFullYear() - date.getFullYear());
}

function recencyAgeLabel(years: number | null): string {
  if (years === null) return "—";
  if (years <= 1) return "≤ 1 year old";
  if (years <= 3) return "≤ 3 years old";
  if (years <= 5) return "≤ 5 years old";
  if (years <= 8) return "≤ 8 years old";
  return "older than 8 years";
}

function renderPrecedentMatchDetails(
  result: PrecedentResult,
  brief: ProformaBrief
) {
  const processedDate = new Date(result.processedAt);
  const suitability = computeSuitabilityScore(
    {
      governingLaw: result.governingLaw,
      createdAt: processedDate,
    },
    brief
  );
  const proformaLaw = getProformaGoverningLaw(brief);
  const ageYears = recencyAgeYears(result.processedAt);

  return (
    <details className="group mt-2">
      <summary className="cursor-pointer list-none text-xs font-medium text-muted hover:text-foreground [&::-webkit-details-marker]:hidden">
        <span className="inline-flex items-center gap-1">
          <span
            className="inline-block transition-transform group-open:rotate-90"
            aria-hidden
          >
            ▸
          </span>
          Match details
        </span>
      </summary>
      <div className="mt-2 space-y-3 border-t border-border pt-2 text-xs">
        <div>
          <p className="font-medium text-foreground">Scores</p>
          <dl className="mt-1 grid gap-1 text-muted">
            <div className="flex justify-between gap-4">
              <dt>Parameter match</dt>
              <dd className="font-medium text-foreground">
                {formatPercent(result.matchScore)}
                {result.comparedParameters > 0 && (
                  <span className="font-normal text-muted">
                    {" "}
                    · {result.matchedParameters}/{result.comparedParameters}{" "}
                    matched
                  </span>
                )}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt>Suitability</dt>
              <dd className="font-medium text-foreground">
                {formatPercent(result.suitabilityScore)}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt>Precedent (combined)</dt>
              <dd className="font-medium text-foreground">
                {formatPercent(result.precedentScore)}
              </dd>
            </div>
          </dl>
        </div>

        <div>
          <p className="font-medium text-foreground">Suitability factors</p>
          <dl className="mt-1 space-y-2 text-muted">
            <div>
              <dt className="font-medium text-foreground/80">Governing law</dt>
              {proformaLaw ? (
                <dd className="mt-1 space-y-0.5">
                  <p>
                    <span className="text-muted">Your proforma:</span>{" "}
                    {proformaLaw}
                  </p>
                  <p>
                    <span className="text-muted">Precedent:</span>{" "}
                    {result.governingLaw?.trim() || "—"}
                  </p>
                  <p>
                    <span className="text-muted">Alignment:</span>{" "}
                    <span className="font-medium text-foreground">
                      {formatPercent(suitability.breakdown.governingLaw ?? 0)}
                    </span>
                  </p>
                </dd>
              ) : (
                <dd className="mt-1">
                  Not in your proforma — suitability uses recency only.
                </dd>
              )}
            </div>
            <div>
              <dt className="font-medium text-foreground/80">Recency</dt>
              <dd className="mt-1 space-y-0.5">
                <p>
                  <span className="text-muted">Processed:</span>{" "}
                  {formatProcessedDate(result.processedAt)}
                  {ageYears !== null && (
                    <span>
                      {" "}
                      · {recencyAgeLabel(ageYears)}
                    </span>
                  )}
                </p>
                <p>
                  <span className="text-muted">Score:</span>{" "}
                  <span className="font-medium text-foreground">
                    {formatPercent(suitability.breakdown.recency)}
                  </span>
                </p>
              </dd>
            </div>
          </dl>
        </div>

        {result.parameterMatches.length > 0 && (
          <div>
            <p className="font-medium text-foreground">Parameter comparison</p>
            <ul className="mt-1 space-y-1.5">
              {result.parameterMatches.map((match) => (
                <li
                  key={match.key}
                  className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5"
                >
                  <span className="min-w-0 text-muted">
                    <span
                      className={
                        match.matched
                          ? "text-emerald-700"
                          : "text-muted"
                      }
                      aria-hidden
                    >
                      {match.matched ? "✓" : "·"}
                    </span>{" "}
                    {match.label}
                  </span>
                  <span className="shrink-0 text-right text-foreground/90">
                    <span className="text-muted">{match.briefValue}</span>
                    {" → "}
                    {match.documentValue ?? "—"}
                    <span className="ml-1 text-muted">
                      ({formatPercent(match.score)})
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </details>
  );
}

function assistantText(text: string): ChatMessage {
  return { id: nextMessageId(), role: "assistant", kind: "text", text };
}

function userText(text: string): ChatMessage {
  return { id: nextMessageId(), role: "user", kind: "text", text };
}

function isSearchOutputMessage(message: ChatMessage): boolean {
  if (message.kind === "results") return true;
  if (message.kind !== "text" || message.role !== "assistant") return false;
  const text = message.text;
  return (
    text.startsWith("Searching for the top 3 matching") ||
    text.startsWith("No matching ") ||
    text.startsWith("Search failed:")
  );
}

function withoutSearchOutputMessages(
  messages: ChatMessage[],
  alsoExcludeId?: string
): ChatMessage[] {
  return messages.filter(
    (message) =>
      message.id !== alsoExcludeId && !isSearchOutputMessage(message)
  );
}

export function PrecedentChatbot() {
  const router = useRouter();
  const [messages, setMessages] = useState<ChatMessage[]>([
    assistantText("Which document are you preparing?"),
  ]);
  const [step, setStep] = useState<ChatStep>("pick-doc-type");
  const [brief, setBrief] = useState<ProformaBrief>({});
  const [questionIndex, setQuestionIndex] = useState(0);
  const [inputValue, setInputValue] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [extractModel, setExtractModel] = useState<string | null>(null);
  const [targetDocumentType, setTargetDocumentType] =
    useState<TargetDocumentType | null>(null);
  const [extraReviewKeys, setExtraReviewKeys] = useState<DealParameterKey[]>(
    []
  );
  const [activeReviewMessageId, setActiveReviewMessageId] = useState<
    string | null
  >(null);
  const [selectedPrecedentIds, setSelectedPrecedentIds] = useState<Set<string>>(
    new Set()
  );
  const [generating, setGenerating] = useState(false);
  const [governingLawInput, setGoverningLawInput] = useState("");

  const fileInputRef = useRef<HTMLInputElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

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

  const appendMessage = useCallback((message: ChatMessage) => {
    setMessages((prev) => [...prev, message]);
  }, []);

  function publishSearchOutcome(
    outcome: ChatMessage[],
    searchingMessageId?: string
  ) {
    setMessages((prev) => [
      ...withoutSearchOutputMessages(prev, searchingMessageId),
      ...outcome,
    ]);
  }

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, step, loading, error]);

  function selectTargetDocumentType(type: TargetDocumentType) {
    setTargetDocumentType(type);
    appendMessage(
      userText(type === "LOI" ? "Letter of Intent (LOI)" : "Operating Lease Agreement (OLA)")
    );
    appendMessage(
      assistantText("How would you like to provide your proforma?")
    );
    setStep("pick-input");
  }

  function startManualFlow() {
    if (!targetDocumentType) return;
    setStep("wizard");
    setQuestionIndex(0);
    setBrief({});
    setExtraReviewKeys([]);
    setGoverningLawInput("");
    setError(null);
    setInputValue("");
    appendMessage(assistantText("Enter any details you have."));
  }

  function startUploadFlow() {
    if (!targetDocumentType) return;
    setStep("upload");
    setExtraReviewKeys([]);
    setGoverningLawInput("");
    setError(null);
    appendMessage(assistantText("Upload your proforma file."));
    fileInputRef.current?.click();
  }

  function pushReviewMessage(nextBrief: ProformaBrief, model: string | null) {
    if (!targetDocumentType) return;
    const message: ChatMessage = {
      id: nextMessageId(),
      role: "assistant",
      kind: "parameters",
      brief: nextBrief,
      targetDocumentType,
      extractModel: model,
    };
    setActiveReviewMessageId(message.id);
    appendMessage(message);
    setStep("review");
  }

  function goToReview(nextBrief: ProformaBrief) {
    pushReviewMessage(nextBrief, extractModel);
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
    appendMessage(userText(`Uploaded ${file.name}`));

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
        assistantText(
          `Extracted ${count} parameter${count === 1 ? "" : "s"} from your file${data.model ? ` (${data.model})` : ""}.`
        )
      );
      pushReviewMessage(extractedBrief, data.model ?? null);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Extraction failed";
      setError(message);
      appendMessage(assistantText(`Couldn't read that file: ${message}`));
      setStep("pick-input");
    } finally {
      setLoading(false);
    }
  }

  function proceedToGoverningLaw() {
    appendMessage(
      assistantText("What governing law should apply?")
    );
    setGoverningLawInput(
      brief.governingLaw ? String(brief.governingLaw) : ""
    );
    setStep("governing-law");
  }

  function beginSearch(nextBrief: ProformaBrief) {
    setBrief(nextBrief);
    void handleSearch(nextBrief);
  }

  function skipGoverningLaw() {
    appendMessage(userText("Skipped governing law"));
    const nextBrief = { ...brief, governingLaw: null };
    beginSearch(nextBrief);
  }

  function submitGoverningLaw(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = governingLawInput.trim();
    if (!trimmed) {
      skipGoverningLaw();
      return;
    }
    appendMessage(userText(trimmed));
    beginSearch({ ...brief, governingLaw: trimmed });
  }

  function requestSearchFromReview() {
    proceedToGoverningLaw();
  }

  async function handleSearch(briefOverride?: ProformaBrief) {
    if (!targetDocumentType) {
      setError("Select LOI or OLA before searching.");
      return;
    }
    const searchBrief = briefOverride ?? brief;
    if (getFilledBriefKeys(searchBrief).length === 0) {
      setError("Provide at least one parameter before searching.");
      return;
    }

    const isResearch = messages.some((message) => message.kind === "results");
    const docLabelPlural = targetDocumentType === "LOI" ? "LOIs" : "OLAs";

    setLoading(true);
    setError(null);
    setStep("searching");
    setMessages((msgs) => {
      let next = withoutSearchOutputMessages(msgs);
      if (activeReviewMessageId) {
        next = next.map((msg) =>
          msg.id === activeReviewMessageId && msg.kind === "parameters"
            ? { ...msg, brief: searchBrief }
            : msg
        );
      }
      return next;
    });

    let searchingMessageId: string | undefined;
    if (!isResearch) {
      const searchingMessage = assistantText(
        `Searching for the top 3 matching ${docLabelPlural}…`
      );
      searchingMessageId = searchingMessage.id;
      appendMessage(searchingMessage);
    }

    try {
      const response = await fetch("/api/precedents/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          parameters: searchBrief,
          limit: 3,
          dealType: "LEASE",
          documentType: targetDocumentType,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error ?? "Search failed");
      }

      const searchResults: PrecedentResult[] = data.results ?? [];
      const outcome: ChatMessage[] =
        searchResults.length === 0
          ? [
              assistantText(
                `No matching ${docLabelPlural} found. Try adding more parameters or reprocessing your document library.`
              ),
            ]
          : [
              {
                id: nextMessageId(),
                role: "assistant",
                kind: "results",
                results: searchResults,
                targetDocumentType,
              },
            ];

      publishSearchOutcome(outcome, searchingMessageId);
      if (searchResults.length > 0) {
        setSelectedPrecedentIds(
          new Set([searchResults[0].documentId])
        );
      } else {
        setSelectedPrecedentIds(new Set());
      }
      setStep("done");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Search failed";
      setError(message);
      publishSearchOutcome(
        [assistantText(`Search failed: ${message}`)],
        searchingMessageId
      );
      setStep("done");
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
    setStep("pick-doc-type");
    setBrief({});
    setQuestionIndex(0);
    setInputValue("");
    setError(null);
    setExtractModel(null);
    setExtraReviewKeys([]);
    setTargetDocumentType(null);
    setActiveReviewMessageId(null);
    setSelectedPrecedentIds(new Set());
    setGenerating(false);
    setGoverningLawInput("");
    setMessages([
      assistantText("Which document are you preparing?"),
    ]);
  }

  const wizardProgress =
    step === "wizard"
      ? Math.round((questionIndex / DEAL_PARAMETER_KEYS.length) * 100)
      : 0;

  function renderParametersCard(message: Extract<ChatMessage, { kind: "parameters" }>) {
    const isActive = message.id === activeReviewMessageId;
    const keysToShow = isActive
      ? visibleReviewKeys
      : getFilledBriefKeys(message.brief);

    return (
      <div className="space-y-3">
        <div className="flex flex-wrap gap-2">
          <span className="badge bg-violet-100 text-violet-800">
            Target: {message.targetDocumentType}
          </span>
          <span className="badge bg-indigo-100 text-indigo-900">
            {getFilledBriefKeys(isActive ? brief : message.brief).length} parameters
          </span>
        </div>
        {message.extractModel && (
          <p className="text-xs text-muted">{message.extractModel}</p>
        )}
        {keysToShow.length === 0 ? (
          <p className="text-sm text-muted">No parameters yet.</p>
        ) : (
          <dl className="space-y-2 text-sm">
            {keysToShow.map((key) => {
              const value = isActive ? brief[key] : message.brief[key];
              if (isActive) {
                return (
                  <div key={key} className="flex gap-2">
                    <div className="min-w-0 flex-1">
                      <dt className="text-xs font-medium text-muted">
                        {DEAL_PARAMETER_LABELS[key]}
                      </dt>
                      <dd className="mt-1">
                        <input
                          className="input py-1.5 text-sm"
                          value={
                            value === null || value === undefined
                              ? ""
                              : String(value)
                          }
                          onChange={(e) =>
                            updateBriefField(key, e.target.value)
                          }
                          disabled={loading}
                        />
                      </dd>
                    </div>
                    <button
                      type="button"
                      className="btn-secondary mt-5 shrink-0 px-2 text-xs"
                      onClick={() => removeReviewParameter(key)}
                      disabled={loading}
                    >
                      Remove
                    </button>
                  </div>
                );
              }
              return (
                <div key={key}>
                  <dt className="text-xs font-medium text-muted">
                    {DEAL_PARAMETER_LABELS[key]}
                  </dt>
                  <dd className="mt-0.5 font-medium text-slate-800">
                    {value === null || value === undefined ? "—" : String(value)}
                  </dd>
                </div>
              );
            })}
          </dl>
        )}
        {isActive && addableReviewKeys.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <label className="text-xs text-muted" htmlFor="add-parameter">
              Add parameter
            </label>
            <select
              id="add-parameter"
              className="input max-w-xs py-1.5 text-sm"
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
        {isActive && (
          <button
            type="button"
            className="btn-primary w-full sm:w-auto"
            onClick={requestSearchFromReview}
            disabled={loading || filledCount === 0}
          >
            {step === "done" || step === "searching"
              ? `Search again (${message.targetDocumentType})`
              : `Find top 3 ${message.targetDocumentType} precedents`}
          </button>
        )}
      </div>
    );
  }

  async function handleGenerateLoi(templateOnly: boolean) {
    if (targetDocumentType !== "LOI") {
      setError("LOI generation is only available when preparing an LOI.");
      return;
    }
    if (filledCount === 0) {
      setError("Provide at least one parameter before generating.");
      return;
    }
    if (!templateOnly && selectedPrecedentIds.size === 0) {
      setError("Select at least one precedent, or use template only.");
      return;
    }

    const latestResults = [...messages]
      .reverse()
      .find(
        (m): m is Extract<ChatMessage, { kind: "results" }> =>
          m.kind === "results"
      );
    const precedentMatchScores = latestResults
      ? Object.fromEntries(
          latestResults.results.map((r) => [r.documentId, r.matchScore])
        )
      : {};

    setGenerating(true);
    setError(null);
    try {
      const response = await fetch("/api/drafts/assemble", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          parameters: brief,
          precedentDocumentIds: Array.from(selectedPrecedentIds),
          templateOnly,
          precedentMatchScores,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error ?? "Generation failed");
      }
      router.push(`/drafts/${data.draftId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Generation failed");
      setGenerating(false);
    }
  }

  function togglePrecedentSelection(documentId: string) {
    setSelectedPrecedentIds((prev) => {
      const next = new Set(prev);
      if (next.has(documentId)) next.delete(documentId);
      else next.add(documentId);
      return next;
    });
  }

  function renderResultsCard(message: Extract<ChatMessage, { kind: "results" }>) {
    const isLoi = message.targetDocumentType === "LOI";
    const selectedCount = selectedPrecedentIds.size;

    return (
      <div className="space-y-3">
        <p className="font-serif text-sm font-medium text-foreground">
          Top {message.targetDocumentType} matches
        </p>
        <ul className="space-y-3">
          {message.results.map((result, index) => {
            const selected = selectedPrecedentIds.has(result.documentId);
            const dealSummary = formatPrecedentDealSummary(result);
            return (
              <li
                key={result.documentId}
                className={`rounded-lg border p-3 ${
                  selected && isLoi
                    ? "border-primary/35 bg-[var(--primary-wash)]"
                    : "border-border bg-card"
                }`}
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="flex min-w-0 flex-1 gap-2">
                    {isLoi && (
                      <input
                        type="checkbox"
                        className="mt-1 shrink-0"
                        checked={selected}
                        disabled={generating || loading}
                        onChange={() =>
                          togglePrecedentSelection(result.documentId)
                        }
                        aria-label={`Include ${result.filename} as precedent`}
                      />
                    )}
                    <div className="min-w-0">
                    <p className="text-xs font-medium uppercase tracking-wide text-muted">
                      #{index + 1}
                      {isLoi && index === 0 && (
                        <span className="ml-2 normal-case text-primary">
                          · template donor
                        </span>
                      )}
                    </p>
                    <Link
                      href={`/documents/${result.documentId}`}
                      className="font-medium text-primary hover:underline"
                    >
                      {result.filename}
                    </Link>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {result.dealType && (
                      <span className={dealTypeBadgeClass(result.dealType)}>
                        {result.dealType}
                      </span>
                    )}
                    <span className="badge bg-primary/15 text-primary">
                      {formatPercent(result.precedentScore)} precedent
                    </span>
                  </div>
                </div>
                <p className="mt-2 text-sm leading-relaxed text-[var(--ink-soft)]">
                  {dealSummary}
                </p>
                {renderPrecedentMatchDetails(result, brief)}
              </li>
            );
          })}
        </ul>
        {isLoi && message.results.length > 0 && (
          <div className="flex flex-wrap gap-2 border-t border-border pt-3">
            <button
              type="button"
              className="btn-primary"
              disabled={generating || loading || selectedCount === 0}
              onClick={() => handleGenerateLoi(false)}
            >
              {generating
                ? "Assembling…"
                : `Generate LOI from selected (${selectedCount})`}
            </button>
            <button
              type="button"
              className="btn-secondary"
              disabled={generating || loading}
              onClick={() => handleGenerateLoi(true)}
            >
              Template only
            </button>
          </div>
        )}
      </div>
    );
  }

  function renderMessage(message: ChatMessage) {
    const isUser = message.role === "user";

    if (message.kind === "parameters") {
      return (
        <div key={message.id} className="chat-block">
          {renderParametersCard(message)}
        </div>
      );
    }

    if (message.kind === "results") {
      return (
        <div key={message.id} className="chat-block max-w-full">
          {renderResultsCard(message)}
        </div>
      );
    }

    return (
      <div
        key={message.id}
        className={
          isUser ? "chat-bubble-user" : "chat-bubble-assistant"
        }
      >
        {message.text}
      </div>
    );
  }

  return (
    <div className="mx-auto flex h-full min-h-0 w-full max-w-6xl flex-1 flex-col">
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

      <section className="chat-panel">
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-5 py-4">
          <h2 className="font-serif text-lg font-medium text-foreground">
            Assistant
          </h2>
          <button type="button" className="btn-secondary" onClick={resetChat}>
            Start over
          </button>
        </div>

        <div className="chat-scroll">
          {messages.map(renderMessage)}

          {step === "pick-doc-type" && (
            <div className="chat-block">
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="btn-primary"
                  onClick={() => selectTargetDocumentType("LOI")}
                >
                  LOI
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => selectTargetDocumentType("OLA")}
                >
                  OLA
                </button>
              </div>
            </div>
          )}

          {step === "pick-input" && (
            <div className="chat-block">
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="btn-primary"
                  onClick={startManualFlow}
                >
                  Enter parameters
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={startUploadFlow}
                >
                  Upload proforma
                </button>
              </div>
            </div>
          )}

          {step === "governing-law" && (
            <form
              onSubmit={submitGoverningLaw}
              className="chat-block space-y-3"
            >
              <p className="font-medium text-foreground">Governing law</p>
              <input
                className="input"
                value={governingLawInput}
                onChange={(event) => setGoverningLawInput(event.target.value)}
                placeholder="Leave blank to skip"
                disabled={loading}
                autoFocus
              />
              <div className="flex gap-2">
                <button type="submit" className="btn-primary" disabled={loading}>
                  Continue
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={skipGoverningLaw}
                  disabled={loading}
                >
                  Skip
                </button>
              </div>
            </form>
          )}

          {step === "wizard" && currentKey && (
            <form
              onSubmit={handleAnswerSubmit}
              className="chat-block space-y-3"
            >
              <p className="font-medium text-foreground">
                {DEAL_PARAMETER_LABELS[currentKey]}
              </p>
              <input
                className="input"
                value={inputValue}
                onChange={(event) => setInputValue(event.target.value)}
                placeholder="Leave blank to skip"
                disabled={loading}
                autoFocus
              />
              <div className="flex gap-2">
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

          {step === "upload" && !loading && (
            <div className="chat-block">
              <button
                type="button"
                className="btn-secondary"
                onClick={() => fileInputRef.current?.click()}
              >
                Choose file
              </button>
            </div>
          )}

          {loading && (
            <p className="text-sm text-muted">Working…</p>
          )}

          {error && (
            <p className="text-sm text-red-600">{error}</p>
          )}

          <div ref={chatEndRef} />
        </div>
      </section>
    </div>
  );
}
