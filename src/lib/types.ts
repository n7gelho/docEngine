export type DocumentSummary = {
  id: string;
  filename: string;
  mimeType: string;
  status: string;
  documentType: string | null;
  dealType: string | null;
  profileId: string | null;
  counterparty: string | null;
  lessor: string | null;
  lessee: string | null;
  seller: string | null;
  buyer: string | null;
  aircraftCount: number | null;
  aircraftType: string | null;
  msn: string | null;
  registration: string | null;
  jurisdiction: string | null;
  term: string | null;
  indicativeValue: string | null;
  leaseType: string | null;
  effectiveDate: string | null;
  expiryDate: string | null;
  monthlyRent: number | null;
  currency: string | null;
  governingLaw: string | null;
  createdAt: string;
  updatedAt: string;
};

export type SearchHit = {
  documentId: string;
  filename: string;
  documentType: string | null;
  dealType: string | null;
  lessor: string | null;
  lessee: string | null;
  seller: string | null;
  buyer: string | null;
  score: number;
  snippet: string;
  heading: string | null;
  pageStart: number | null;
};

export type LinkedDocumentSummary = {
  id: string;
  filename: string;
  documentType: string | null;
  dealType: string | null;
  lessor: string | null;
  lessee: string | null;
  seller: string | null;
  buyer: string | null;
  msn: string | null;
  registration: string | null;
  effectiveDate: string | null;
  linkConfidence: number | null;
  linkSource: string;
};

export type DocumentDealRelations = {
  dealId: string | null;
  linkedLoi: LinkedDocumentSummary | null;
  linkedOla: LinkedDocumentSummary | null;
  suggestions: Array<LinkedDocumentSummary & { matchScore: number }>;
};

export type MetadataField = {
  value?: unknown;
  confidence?: number;
  rawLabel?: string;
  indicative?: boolean;
  source?: { page?: number; section?: string; snippet?: string };
};

export function statusBadgeClass(status: string) {
  switch (status) {
    case "ready":
      return "badge-ready";
    case "processing":
      return "badge-processing";
    case "failed":
      return "badge-failed";
    default:
      return "badge-pending";
  }
}

export function formatRent(rent: number | null, currency: string | null) {
  if (rent === null) return "—";
  const formatted = new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 0,
  }).format(rent);
  return currency ? `${currency} ${formatted}` : formatted;
}

export function formatParties(doc: {
  dealType?: string | null;
  lessor?: string | null;
  lessee?: string | null;
  seller?: string | null;
  buyer?: string | null;
}): { primary: string; secondary: string; primaryLabel: string; secondaryLabel: string } {
  if (doc.dealType === "PURCHASE") {
    return {
      primaryLabel: "Seller",
      secondaryLabel: "Buyer",
      primary: doc.seller ?? "—",
      secondary: doc.buyer ?? "—",
    };
  }
  return {
    primaryLabel: "Lessor",
    secondaryLabel: "Lessee",
    primary: doc.lessor ?? "—",
    secondary: doc.lessee ?? "—",
  };
}

export function dealTypeBadgeClass(dealType: string | null | undefined) {
  if (dealType === "PURCHASE") return "badge bg-violet-100 text-violet-800";
  if (dealType === "LEASE") return "badge bg-emerald-100 text-emerald-800";
  return "badge bg-slate-100 text-slate-700";
}
