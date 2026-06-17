import { loadEnvLocal } from "./load-env";

loadEnvLocal();

import { eq } from "drizzle-orm";
import { db } from "../src/lib/db";
import { documents, type Document } from "../src/lib/db/schema";
import {
  buildDealParameters,
  dealParametersCoverageToMetadataField,
  dealParametersToMetadataField,
  parseMonthlyRentAmount,
} from "../src/lib/extraction/deal-parameters";
import type { DealType, DocumentType } from "../src/lib/db/schema";

function backfillMetadata(doc: Document) {
  const metadata = { ...(doc.metadata ?? {}) };

  const { parameters, coverage } = buildDealParameters({
    dealType: (doc.dealType ?? "LEASE") as DealType,
    documentType: (doc.documentType ?? "OTHER") as DocumentType,
    metadata,
    lessor: doc.lessor,
    lessee: doc.lessee,
    seller: doc.seller,
    buyer: doc.buyer,
    aircraftType: doc.aircraftType,
    term: doc.term,
    leaseType: doc.leaseType,
    monthlyRent: doc.monthlyRent,
    currency: doc.currency,
    aircraftCount: doc.aircraftCount,
    securityDeposit: doc.securityDeposit,
    expectedDelivery: doc.expectedDelivery,
  });

  metadata._deal_parameters = dealParametersToMetadataField(parameters);
  metadata._deal_parameters_coverage =
    dealParametersCoverageToMetadataField(coverage);

  const counterparty =
    doc.dealType === "LEASE"
      ? doc.lessee
      : doc.dealType === "PURCHASE"
        ? doc.buyer
        : doc.counterparty;

  const monthlyRentRaw =
    metadata.monthly_rent?.value != null
      ? String(metadata.monthly_rent.value)
      : null;
  const monthlyRent =
    doc.monthlyRent ??
    parseMonthlyRentAmount(monthlyRentRaw, doc.currency);

  return {
    metadata,
    counterparty: counterparty ?? doc.counterparty,
    leaseType:
      doc.leaseType ??
      (parameters.transaction_type?.value != null
        ? String(parameters.transaction_type.value)
        : null),
    aircraftCount:
      doc.aircraftCount ??
      (parameters.aircraft_count?.value != null
        ? Number(parameters.aircraft_count.value)
        : null),
    monthlyRent,
    securityDeposit:
      doc.securityDeposit ??
      (parameters.security_deposit?.value != null
        ? String(parameters.security_deposit.value)
        : null),
    expectedDelivery:
      doc.expectedDelivery ??
      (parameters.expected_delivery?.value != null
        ? String(parameters.expected_delivery.value)
        : null),
    coverage,
  };
}

async function main() {
  const rows = await db
    .select()
    .from(documents)
    .where(eq(documents.status, "ready"));

  let updated = 0;
  for (const doc of rows) {
    const result = backfillMetadata(doc);
    await db
      .update(documents)
      .set({
        metadata: result.metadata,
        counterparty: result.counterparty,
        leaseType: result.leaseType,
        aircraftCount: result.aircraftCount,
        monthlyRent: result.monthlyRent,
        securityDeposit: result.securityDeposit,
        expectedDelivery: result.expectedDelivery,
        updatedAt: new Date(),
      })
      .where(eq(documents.id, doc.id));

    console.log(
      `${doc.filename}: deal parameters ${result.coverage.filled}/${result.coverage.total}`
    );
    updated++;
  }

  console.log(`\nBackfilled ${updated} document(s).`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
