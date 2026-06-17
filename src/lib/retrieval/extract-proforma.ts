import { hasChatProviderAvailable } from "@/lib/ai/config";
import { createExtractionContext } from "@/lib/extraction/pipeline/context";
import { callLlmInContext } from "@/lib/extraction/pipeline/llm-call";
import { extractLoiHeuristic } from "@/lib/extraction/loi-heuristic";
import { parseJsonContent } from "@/lib/extraction/llm-json";
import {
  normalizeFieldMap,
  type ParsedFieldValue,
} from "@/lib/extraction/normalize-extraction";
import { parseDocument } from "@/lib/parsing/parse-document";
import {
  DEAL_PARAMETER_KEYS,
  type DealParameterKey,
} from "@/lib/extraction/deal-parameters";
import {
  briefFromUnknownInput,
  type ProformaBrief,
} from "@/lib/retrieval/proforma-brief";

const PROFORMA_SYSTEM_PROMPT =
  "Extract aircraft lease proforma parameters. Respond with valid JSON only. Use null for fields not stated. Do not invent values.";

function buildProformaExtractionPrompt(text: string): string {
  return `You are reading an aircraft lease proforma / term sheet / heads of terms.

Extract these commercial parameters from the document text only:
- counterparty: lessee / counterparty name
- aircraft: aircraft type or model (e.g. Boeing 777-9)
- aircraft_count: number of aircraft (integer if stated)
- transaction_type: e.g. dry lease, wet lease, operating lease
- lease_term: lease term duration
- monthly_rent: monthly rent amount with currency if stated
- security_deposit: security deposit amount or terms
- maintenance_reserve: maintenance reserve summary
- insurance: insurance requirements summary
- expected_delivery: expected or target delivery date/period

Return flat JSON with ALL keys (string, number, or null):
{
  "counterparty": null,
  "aircraft": null,
  "aircraft_count": null,
  "transaction_type": null,
  "lease_term": null,
  "monthly_rent": null,
  "security_deposit": null,
  "maintenance_reserve": null,
  "insurance": null,
  "expected_delivery": null
}

DOCUMENT TEXT:
${text}`;
}

function fieldsToBrief(
  fields: Record<string, ParsedFieldValue>
): ProformaBrief {
  const raw: Record<string, unknown> = {};

  const mapKey = (target: DealParameterKey, ...sources: string[]) => {
    for (const source of sources) {
      const value = fields[source]?.value;
      if (value !== null && value !== undefined && String(value).trim() !== "") {
        raw[target] = value;
        return;
      }
    }
  };

  mapKey("counterparty", "counterparty", "lessee", "lessee_entity");
  mapKey("aircraft", "aircraft", "aircraft_type");
  mapKey("aircraft_count", "aircraft_count");
  mapKey("transaction_type", "transaction_type", "lease_type");
  mapKey("lease_term", "lease_term", "term");
  mapKey("monthly_rent", "monthly_rent");
  mapKey("security_deposit", "security_deposit");
  mapKey("maintenance_reserve", "maintenance_reserve");
  mapKey("insurance", "insurance");
  mapKey("expected_delivery", "expected_delivery");

  return briefFromUnknownInput(raw);
}

function heuristicBriefFromText(text: string): ProformaBrief {
  const loi = extractLoiHeuristic(text, "LEASE");
  const brief = fieldsToBrief(loi.fields as Record<string, ParsedFieldValue>);
  if (!brief.lease_term && loi.fields.term?.value) {
    brief.lease_term = String(loi.fields.term.value);
  }
  return brief;
}

export async function extractProformaBriefFromBuffer(
  buffer: Buffer,
  mimeType: string
): Promise<{ brief: ProformaBrief; model: string }> {
  const parsed = await parseDocument(buffer, mimeType);
  const text = parsed.fullText.slice(0, 12000);

  if (!text.trim()) {
    return { brief: {}, model: "none" };
  }

  if (!hasChatProviderAvailable()) {
    return { brief: heuristicBriefFromText(text), model: "heuristic" };
  }

  const ctx = createExtractionContext();
  try {
    const { content, model } = await callLlmInContext(
      ctx,
      buildProformaExtractionPrompt(text),
      { systemPrompt: PROFORMA_SYSTEM_PROMPT }
    );
    const raw = parseJsonContent(content) as Record<string, unknown>;
    const fields = normalizeFieldMap(raw);
    const brief = fieldsToBrief(fields);

    for (const key of DEAL_PARAMETER_KEYS) {
      if (brief[key] === undefined && raw[key] !== null && raw[key] !== undefined) {
        brief[key] = raw[key] as string | number;
      }
    }

    return { brief, model };
  } catch {
    return { brief: heuristicBriefFromText(text), model: "heuristic" };
  }
}
