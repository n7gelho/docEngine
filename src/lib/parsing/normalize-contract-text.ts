/**
 * PDF text extraction often glues field labels to values (e.g. "LessorAeroCap").
 * Insert spacing and normalize common lease/LOI patterns before extraction.
 */
export function normalizeContractText(text: string): string {
  // PostgreSQL TEXT cannot store NUL (0x00); common in PDF extraction.
  let normalized = text.replace(/\u0000/g, "").replace(/\r\n/g, "\n");

  const labelFixes: [RegExp, string][] = [
    [/Lessor(?=[A-Z])/g, "Lessor "],
    [/Lessee(?=[A-Z])/g, "Lessee "],
    [/Aircraft Model(?=[A-Z])/g, "Aircraft Model "],
    [/Registration Mark(?=[0-9A-Z])/gi, "Registration Mark "],
    [/Basic Monthly Rent(?=[A-Z$0-9])/gi, "Basic Monthly Rent "],
    [/Lease Term(?=[A-Z0-9])/gi, "Lease Term "],
    [/Target Delivery Date(?=[A-Z0-9])/gi, "Target Delivery Date "],
    [/Delivery Location(?=[A-Z])/gi, "Delivery Location "],
    [/Security Deposit(?=[A-Z$0-9])/gi, "Security Deposit "],
    [/Manufacturer Serial Number(?=\s*\(?MSN)/gi, "Manufacturer Serial Number "],
  ];

  for (const [pattern, replacement] of labelFixes) {
    normalized = normalized.replace(pattern, replacement);
  }

  normalized = normalized.replace(
    /MSN\s+(\d+)/gi,
    (_match, msn: string) => `MSN ${msn.trim()}`
  );

  return normalized.replace(/\n{3,}/g, "\n\n").trim();
}
