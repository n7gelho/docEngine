/**
 * Public extraction pipeline entry points.
 * Import from here when wiring new features (API routes, batch jobs, tests).
 */
export {
  classifyDocumentHeuristic,
  classifyDocumentForIngestion,
  buildClassificationText,
} from "@/lib/extraction/classify-document";
export { extractLoiMetadata, SCHEMA_VERSION } from "@/lib/extraction/extract-metadata";
export { extractOlaMetadata } from "@/lib/extraction/extract-ola";
export { buildExtractionText, describeExtractionSelection } from "@/lib/extraction/extraction-text";
export { mapExtractionToDocumentFields } from "@/lib/extraction/map-extraction-fields";
export {
  getOlaSectionTexts,
  findSectionAnchors,
  buildOlaCorePagesText,
} from "@/lib/extraction/ola-section-windows";
export type { ExtractionCoverage } from "@/lib/extraction/extraction-coverage";
export type {
  ExtractionHint,
  ExtractionOutcome,
  ExtractionResult,
  LoiExtractionResult,
  OlaExtractionResult,
} from "@/lib/extraction/types";
