import { notFound } from "next/navigation";
import { readDiagram } from "@/lib/store/diagrams";
import { Editor } from "../editor";

export const dynamic = "force-dynamic";

export default async function EditorPage(props: PageProps<"/editor/[slug]">) {
  const { slug } = await props.params;
  const diagram = await readDiagram(slug);
  if (!diagram) notFound();

  return <Editor slug={diagram.slug} name={diagram.name} initial={diagram.model} />;
}
