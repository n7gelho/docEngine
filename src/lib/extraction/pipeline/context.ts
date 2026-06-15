import {
  buildChatProviderChain,
  type ChatProviderId,
} from "@/lib/ai/config";

export const HEURISTIC_MODEL = "heuristic-v3";

export type ModelTracker = {
  primary: string | null;
};

export function trackModel(tracker: ModelTracker, model: string): string {
  if (model && model !== HEURISTIC_MODEL && !tracker.primary) {
    tracker.primary = model;
  }
  return model;
}

export function adoptHeuristicModel(tracker: ModelTracker): string {
  tracker.primary = HEURISTIC_MODEL;
  return HEURISTIC_MODEL;
}

/**
 * Pins the first working chat provider for the document run so quota-exceeded
 * external APIs are not re-tried on every section pass.
 */
export type ExtractionPipelineContext = {
  pinnedProvider: ChatProviderId | null;
  failedProviders: Set<ChatProviderId>;
  model: ModelTracker;
};

export function createExtractionContext(): ExtractionPipelineContext {
  return {
    pinnedProvider: null,
    failedProviders: new Set(),
    model: { primary: null },
  };
}

export function getProvidersToTry(ctx: ExtractionPipelineContext): ChatProviderId[] {
  const chain = buildChatProviderChain();
  if (ctx.pinnedProvider) return [ctx.pinnedProvider];
  return chain.filter((p) => !ctx.failedProviders.has(p));
}

export function pinProvider(
  ctx: ExtractionPipelineContext,
  provider: ChatProviderId
): void {
  ctx.pinnedProvider = provider;
}

export function markProviderFailed(
  ctx: ExtractionPipelineContext,
  provider: ChatProviderId
): void {
  ctx.failedProviders.add(provider);
  if (ctx.pinnedProvider === provider) {
    ctx.pinnedProvider = null;
  }
}
