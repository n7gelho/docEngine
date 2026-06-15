/**
 * Public extraction pipeline entry points.
 * Import from here when wiring new features (API routes, batch jobs, tests).
 */
export {
  classifyDocumentHeuristic,
  classifyDocumentForIngestion,
  classifyFromFilename,
  buildClassificationText,
} from "@/lib/extraction/classify-document";
export { classifyDocumentWithLlm } from "@/lib/extraction/classify-document-llm";
export {
  ExtractionTraceCollector,
  parseExtractionTrace,
  traceToMetadataField,
  TRACE_PREVIEW_CHARS,
} from "@/lib/extraction/extraction-trace";
export type {
  ExtractionTrace,
  ExtractionTraceStep,
  LocationSource,
} from "@/lib/extraction/extraction-trace";
export {
  parseTableOfContents,
  mapTocEntriesToSections,
} from "@/lib/extraction/toc-parser";
export { extractLoiMetadata, SCHEMA_VERSION } from "@/lib/extraction/extract-metadata";
export { extractOlaMetadata } from "@/lib/extraction/extract-ola";
export { buildExtractionText, describeExtractionSelection } from "@/lib/extraction/extraction-text";
export { mapExtractionToDocumentFields } from "@/lib/extraction/map-extraction-fields";
export {
  getOlaSectionTexts,
  getTocMappedSections,
  findSectionAnchors,
  buildOlaCorePagesText,
} from "@/lib/extraction/ola-section-windows";
export { validateFieldsAgainstSource } from "@/lib/extraction/validate-extraction";
export type { ExtractionCoverage } from "@/lib/extraction/extraction-coverage";
export {
  parseExtractionCoverage,
  formatCoverageSummary,
} from "@/lib/extraction/extraction-coverage";
export { createExtractionContext } from "@/lib/extraction/pipeline/context";
export type {
  ExtractionHint,
  ExtractionOutcome,
  ExtractionResult,
  LoiExtractionResult,
  OlaExtractionResult,
} from "@/lib/extraction/types";
