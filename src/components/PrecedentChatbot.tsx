"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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

type TargetDocumentType = "LOI" | "OLA";

type ChatStep =
  | "pick-doc-type"
  | "pick-input"
  | "wizard"
  | "upload"
  | "review"
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
  const [messages, setMessages] = useState<ChatMessage[]>([
    assistantText(
      "I'll help you find the three most similar lease contracts in your library. First, which document are you preparing?"
    ),
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
      assistantText("How would you like to provide your proforma parameters?")
    );
    setStep("pick-input");
  }

  function startManualFlow() {
    if (!targetDocumentType) return;
    setStep("wizard");
    setQuestionIndex(0);
    setBrief({});
    setExtraReviewKeys([]);
    setError(null);
    setInputValue("");
    appendMessage(
      assistantText(
        "Enter any details you have — leave a field blank to skip it."
      )
    );
  }

  function startUploadFlow() {
    if (!targetDocumentType) return;
    setStep("upload");
    setExtraReviewKeys([]);
    setError(null);
    appendMessage(
      assistantText("Upload your proforma file (PDF or DOCX).")
    );
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

  async function handleSearch() {
    if (!targetDocumentType) {
      setError("Select LOI or OLA before searching.");
      return;
    }
    if (filledCount === 0) {
      setError("Provide at least one parameter before searching.");
      return;
    }

    const isResearch = step === "done";
    const docLabelPlural = targetDocumentType === "LOI" ? "LOIs" : "OLAs";

    setLoading(true);
    setError(null);
    setStep("searching");
    setMessages((msgs) => {
      let next = withoutSearchOutputMessages(msgs);
      if (activeReviewMessageId) {
        next = next.map((msg) =>
          msg.id === activeReviewMessageId && msg.kind === "parameters"
            ? { ...msg, brief }
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
    setMessages([
      assistantText(
        "I'll help you find the three most similar lease contracts in your library. First, which document are you preparing?"
      ),
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
          <p className="text-xs text-muted">Extracted with {message.extractModel}</p>
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
            onClick={handleSearch}
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

  function renderResultsCard(message: Extract<ChatMessage, { kind: "results" }>) {
    return (
      <div className="space-y-3">
        <p className="text-sm font-medium text-slate-800">
          Top {message.targetDocumentType} matches
        </p>
        <ul className="space-y-3">
          {message.results.map((result, index) => {
            const parties = formatParties(result);
            return (
              <li
                key={result.documentId}
                className="rounded-lg border border-border bg-slate-50/80 p-3"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
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
                  <div className="flex flex-wrap gap-1.5">
                    {result.dealType && (
                      <span className={dealTypeBadgeClass(result.dealType)}>
                        {result.dealType}
                      </span>
                    )}
                    <span className="badge bg-emerald-100 text-emerald-800">
                      {result.matchedParameters}/{result.comparedParameters} matched
                    </span>
                    <span className="badge bg-slate-100 text-slate-700">
                      {formatPercent(result.matchScore)}
                    </span>
                  </div>
                </div>
                <p className="mt-2 text-xs text-muted">
                  {[result.documentType, parties.primary, result.aircraftType]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
                <p className="mt-1 text-xs text-muted">
                  {result.leaseType && `Type: ${result.leaseType}`}
                  {result.term && ` · Term: ${result.term}`}
                  {result.monthlyRent != null &&
                    ` · Rent: ${formatRent(result.monthlyRent, result.currency)}`}
                </p>
                <ul className="mt-2 space-y-0.5 text-xs">
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
      </div>
    );
  }

  function renderMessage(message: ChatMessage) {
    const isUser = message.role === "user";

    if (message.kind === "parameters") {
      return (
        <div key={message.id} className="max-w-[95%] rounded-xl bg-white px-4 py-3 text-sm text-slate-800 shadow-sm">
          {renderParametersCard(message)}
        </div>
      );
    }

    if (message.kind === "results") {
      return (
        <div key={message.id} className="max-w-[95%] rounded-xl bg-white px-4 py-3 text-sm text-slate-800 shadow-sm">
          {renderResultsCard(message)}
        </div>
      );
    }

    return (
      <div
        key={message.id}
        className={`max-w-[85%] rounded-xl px-4 py-3 text-sm ${
          isUser
            ? "ml-auto bg-primary text-white"
            : "bg-white text-slate-800 shadow-sm"
        }`}
      >
        {message.text}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl">
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

      <section className="card flex min-h-[640px] flex-col">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">Precedent finder</h2>
          <button type="button" className="btn-secondary" onClick={resetChat}>
            Start over
          </button>
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto rounded-lg border border-border bg-slate-50/80 p-4">
          {messages.map(renderMessage)}

          {step === "pick-doc-type" && (
            <div className="max-w-[95%] rounded-xl bg-white px-4 py-3 shadow-sm">
              <p className="mb-3 text-sm text-slate-700">Select document type</p>
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
            <div className="max-w-[95%] rounded-xl bg-white px-4 py-3 shadow-sm">
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

          {step === "wizard" && currentKey && (
            <form
              onSubmit={handleAnswerSubmit}
              className="max-w-[95%] space-y-3 rounded-xl bg-white px-4 py-3 shadow-sm"
            >
              <div>
                <p className="font-medium text-slate-800">
                  {DEAL_PARAMETER_LABELS[currentKey]}
                </p>
                <p className="mt-1 text-sm text-muted">
                  {DEAL_PARAMETER_CHAT_PROMPTS[currentKey]}
                </p>
              </div>
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
            <div className="max-w-[95%] rounded-xl bg-white px-4 py-3 shadow-sm">
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
