import { LoiDraftEditor } from "@/components/LoiDraftEditor";

type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function DraftPage({ params }: PageProps) {
  const { id } = await params;
  return (
    <div className="flex h-full min-h-0 w-full flex-1 flex-col">
      <LoiDraftEditor draftId={id} />
    </div>
  );
}
