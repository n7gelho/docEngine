import type { DealType, DocumentMetadataJson } from "@/lib/db/schema";
import type { LoiExtractionResult } from "@/lib/extraction/types";

export function extractLoiHeuristic(
  text: string,
  dealType: DealType
): LoiExtractionResult {
  const fields: DocumentMetadataJson = {};

  if (dealType === "LEASE") {
    const lessor = text.match(
      /(?:^|\n)\s*(?:Lessor|LESSOR)[:\s]+([\s\S]+?)(?=\n\s*(?:Lessee|LESSEE)\b)/i
    );
    const lessee = text.match(
      /(?:^|\n)\s*(?:Lessee|LESSEE)[:\s]+([\s\S]+?)(?=\n\s*(?:\d+\.|Aircraft|REGISTRATION))/i
    );
    if (lessor?.[1]) {
      fields.lessor = {
        value: lessor[1].trim().split("\n")[0].trim(),
        confidence: 0.6,
      };
    }
    if (lessee?.[1]) {
      fields.lessee = {
        value: lessee[1].trim().split("\n")[0].trim(),
        confidence: 0.6,
      };
    }
  } else {
    const seller = text.match(
      /(?:^|\n)\s*(?:Seller|SELLER)[:\s]+([\s\S]+?)(?=\n\s*(?:Buyer|BUYER)\b)/i
    );
    const buyer = text.match(
      /(?:^|\n)\s*(?:Buyer|BUYER)[:\s]+([\s\S]+?)(?=\n\s*(?:\d+\.|Aircraft|REGISTRATION|Signature))/i
    );
    if (seller?.[1]) {
      fields.seller = {
        value: seller[1].trim().split("\n")[0].trim(),
        confidence: 0.6,
      };
    }
    if (buyer?.[1]) {
      fields.buyer = {
        value: buyer[1].trim().split("\n")[0].trim(),
        confidence: 0.6,
      };
    }
  }

  const msn = text.match(/\bMSN[:\s]*([0-9]{3,6})/i);
  if (msn?.[1]) fields.msn = { value: msn[1], confidence: 0.65 };

  const aircraft = text.match(
    /(?:Aircraft|Aircraft Model)[:\s]*((?:Airbus|Boeing|A\d{3}|B\d{3})[^\n,]{0,50})/i
  );
  if (aircraft?.[1]) {
    fields.aircraft = { value: aircraft[1].trim(), confidence: 0.6 };
  }

  const jurisdiction = text.match(
    /(?:Cape Town Convention|NY Law|New York Law|UK Law|English Law)/i
  );
  if (jurisdiction?.[0]) {
    fields.jurisdiction = { value: jurisdiction[0], confidence: 0.55 };
  }

  const gov = text.match(
    /(?:laws of|governed by[^.\n]*?laws of)\s+([^\n.]{3,80})/i
  );
  if (gov?.[1]) {
    fields.governing_law = { value: gov[1].trim(), confidence: 0.55 };
  }

  const term = text.match(/(?:Term|Lease Term)[:\s]*([^\n]{4,40})/i);
  if (term?.[1]) {
    fields.term = { value: term[1].trim(), confidence: 0.55, indicative: true };
  }

  const value = text.match(
    /(?:Indicative (?:Value|Price|Rent)|Purchase Price)[:\s]*((?:USD|EUR|GBP)?\s*[\d,]+(?:\.\d+)?[^\n]{0,20})/i
  );
  if (value?.[1]) {
    fields.indicative_value = {
      value: value[1].trim(),
      confidence: 0.55,
      indicative: true,
    };
  }

  return { dealType, documentType: "LOI", fields };
}
