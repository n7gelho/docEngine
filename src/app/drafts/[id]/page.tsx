import { LoiDraftEditor } from "@/components/LoiDraftEditor";

type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function DraftPage({ params }: PageProps) {
  const { id } = await params;
  return <LoiDraftEditor draftId={id} />;
}
