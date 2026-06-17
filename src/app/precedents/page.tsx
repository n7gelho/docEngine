import { PrecedentChatbot } from "@/components/PrecedentChatbot";

export default function PrecedentsPage() {
  return (
    <div className="space-y-8">
      <section>
        <h1 className="text-3xl font-bold tracking-tight">Contract precedent finder</h1>
        <p className="mt-2 max-w-3xl text-muted">
          Describe your new lease proforma — or upload it — and find the three most
          similar contracts already in your library.
        </p>
      </section>

      <PrecedentChatbot />
    </div>
  );
}
