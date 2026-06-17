import { PrecedentChatbot } from "@/components/PrecedentChatbot";

export default function PrecedentsPage() {
  return (
    <div className="space-y-8">
      <section>
        <h1 className="text-3xl font-bold tracking-tight">LOI precedent finder</h1>
        <p className="mt-2 max-w-3xl text-muted">
          Describe or upload your proforma, find comparable LOIs, then generate a
          full draft LOI: structure from the best template precedent, boilerplate
          ported per section, and proforma values reconciled into the text.
        </p>
      </section>

      <PrecedentChatbot />
    </div>
  );
}
