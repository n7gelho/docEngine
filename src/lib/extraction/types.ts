import { z } from "zod";
import type {
  DealType,
  DocumentMetadataJson,
  DocumentType,
} from "@/lib/db/schema";
import type { ExtractionCoverage } from "@/lib/extraction/extraction-coverage";
import { fieldValueSchema } from "@/lib/extraction/normalize-extraction";

export const loiExtractionSchema = z.object({
  dealType: z.enum(["PURCHASE", "LEASE"]),
  documentType: z.literal("LOI"),
  fields: z.record(fieldValueSchema),
});

export const olaExtractionSchema = z.object({
  dealType: z.enum(["PURCHASE", "LEASE"]),
  documentType: z.literal("OLA"),
  sections: z.record(z.record(fieldValueSchema)),
});

export type LoiExtractionResult = z.infer<typeof loiExtractionSchema>;
export type OlaExtractionResult = z.infer<typeof olaExtractionSchema>;

export type ExtractionResult =
  | LoiExtractionResult
  | OlaExtractionResult
  | {
      dealType: DealType;
      documentType: DocumentType;
      fields: DocumentMetadataJson;
    };

export type ExtractionHint = {
  dealType?: DealType;
  documentType?: DocumentType;
};

export type ExtractionOutcome = {
  result: ExtractionResult;
  model: string;
  coverage: ExtractionCoverage;
};
