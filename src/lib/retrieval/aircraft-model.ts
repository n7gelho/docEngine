/** Manufacturer names stripped before comparing aircraft model codes. */
const AIRCRAFT_MANUFACTURERS = [
  "airbus",
  "atr",
  "beechcraft",
  "boeing",
  "bombardier",
  "cessna",
  "de havilland",
  "embraer",
  "gulfstream",
  "mitsubishi",
  "pilatus",
  "sukhoi",
];

const MODEL_CODE_PATTERN =
  /(?:^|[^a-z0-9])([abg]\d{3}[a-z0-9]*|e\d{2,3}[a-z0-9]*|g\d{3,4}[a-z0-9]*)/i;

/**
 * Normalize to the aircraft model token only (exact match target).
 * Strips manufacturer prefixes; B777-300ER and Boeing B777300er → b777300er.
 */
export function normalizeAircraftModelCode(value: string): string {
  let text = value.toLowerCase().trim();

  for (const manufacturer of AIRCRAFT_MANUFACTURERS) {
    text = text.replace(
      new RegExp(`\\b${manufacturer.replace(/\s+/g, "\\s+")}\\b`, "g"),
      " "
    );
  }

  const compact = text.replace(/[^a-z0-9]/g, "");
  const modelMatch = compact.match(MODEL_CODE_PATTERN);
  if (modelMatch?.[1]) {
    return modelMatch[1].toLowerCase();
  }

  const inlineMatch = text.match(
    /\b([abg]\d{3}[a-z0-9]*|e\d{2,3}[a-z0-9]*|g\d{3,4}[a-z0-9]*)\b/i
  );
  if (inlineMatch?.[1]) {
    return inlineMatch[1].toLowerCase().replace(/[^a-z0-9]/g, "");
  }

  return compact;
}
