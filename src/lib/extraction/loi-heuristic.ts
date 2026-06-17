import type { DealType, DocumentMetadataJson } from "@/lib/db/schema";
import type { ParsedFieldValue } from "@/lib/extraction/normalize-extraction";
import type { LoiExtractionResult } from "@/lib/extraction/types";

/** Infer aircraft type/model from common LOI phrasing and delivery tables. */
export function inferLoiAircraftType(text: string): string | null {
  const narrative = text.match(
    /\b((?:Airbus|Boeing)\s+)?([AB]\d{3}\s*[-]?\s*\d{0,3}\w*)\s+aircraft\b/i
  );
  if (narrative?.[2]) {
    return narrative[2].replace(/\s+/g, "").replace(/-/g, "");
  }

  const tableRow = text.match(/\n([AB]\d{3}\d{2,3}\w*)(?:GE|RR|CFM|PW)/i);
  if (tableRow?.[1]) {
    return tableRow[1].trim();
  }

  const labelled = text.match(
    /(?:Aircraft(?:\s+Model)?|Airframe)[:\s]+((?:Airbus|Boeing\s+)?[AB]?\d{3}[^\n,]{0,40})/i
  );
  if (labelled?.[1]) {
    return labelled[1].trim().split(/\s+/).slice(0, 2).join(" ");
  }

  return null;
}

export function fillMissingLoiAircraftField(
  fields: Record<string, ParsedFieldValue>,
  sourceText: string
): void {
  const current = fields.aircraft?.value;
  if (current !== null && current !== undefined && String(current).trim() !== "") {
    return;
  }

  const inferred = inferLoiAircraftType(sourceText);
  if (!inferred) return;

  fields.aircraft = { value: inferred, confidence: 0.65 };
}

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
    /(?:Aircraft(?:\s+Model)?|Airframe)[:\s]+((?:Airbus|Boeing\s+)?[AB]?\d{3}[^\n,]{0,50})/i
  );
  if (aircraft?.[1]) {
    fields.aircraft = { value: aircraft[1].trim(), confidence: 0.6 };
  } else {
    const inferred = inferLoiAircraftType(text);
    if (inferred) {
      fields.aircraft = { value: inferred, confidence: 0.6 };
    }
  }

  const jurisdiction = text.match(
    /(?:courts? of|jurisdiction of|exclusive jurisdiction|non-exclusive jurisdiction)\s+([^\n.]{3,80})/i
  );
  if (jurisdiction?.[1]) {
    fields.jurisdiction = {
      value: jurisdiction[1].trim(),
      confidence: 0.55,
    };
  } else {
    const jurisdictionAlt = text.match(
      /(?:Cape Town Convention|NY Law|New York Law|UK Law|English Law)/i
    );
    if (jurisdictionAlt?.[0]) {
      fields.jurisdiction = {
        value: jurisdictionAlt[0],
        confidence: 0.5,
      };
    }
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

  const aircraftCount = text.match(
    /(?:number of aircraft|aircraft count|(?:\b)(\d+)\s*\(\d+\)\s*aircraft)/i
  );
  if (aircraftCount?.[1]) {
    fields.aircraft_count = {
      value: parseInt(aircraftCount[1], 10),
      confidence: 0.55,
    };
  }

  const transactionType = text.match(
    /\b(dry lease|wet lease|operating lease|finance lease)\b/i
  );
  if (transactionType?.[1]) {
    fields.transaction_type = {
      value: transactionType[1].toLowerCase(),
      confidence: 0.6,
    };
  }

  const monthlyRent = text.match(
    /(?:Monthly Rent|Basic Rent|Rent)[:\s]*((?:USD|EUR|GBP)?\s*[\d,]+(?:\.\d+)?[^\n]{0,20})/i
  );
  if (monthlyRent?.[1]) {
    fields.monthly_rent = {
      value: monthlyRent[1].trim(),
      confidence: 0.55,
    };
  }

  const securityDeposit = text.match(
    /(?:Security Deposit)[:\s]*([^\n]{4,80})/i
  );
  if (securityDeposit?.[1]) {
    fields.security_deposit = {
      value: securityDeposit[1].trim(),
      confidence: 0.55,
    };
  }

  const maintenanceReserve = text.match(
    /(?:Maintenance Reserve)[:\s]*([^\n]{4,120})/i
  );
  if (maintenanceReserve?.[1]) {
    fields.maintenance_reserve = {
      value: maintenanceReserve[1].trim(),
      confidence: 0.5,
    };
  }

  const insurance = text.match(/(?:Insurance)[:\s]*([^\n]{4,120})/i);
  if (insurance?.[1]) {
    fields.insurance = {
      value: insurance[1].trim(),
      confidence: 0.5,
    };
  }

  const delivery = text.match(
    /(?:Expected Delivery|Target Delivery(?: Date)?|Delivery Date)[:\s]*([^\n]{4,60})/i
  );
  if (delivery?.[1]) {
    fields.expected_delivery = {
      value: delivery[1].trim(),
      confidence: 0.55,
    };
  }

  return { dealType, documentType: "LOI", fields };
}
