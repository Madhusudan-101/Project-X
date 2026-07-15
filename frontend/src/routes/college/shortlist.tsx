import { createFileRoute } from "@tanstack/react-router";
import { ShortlistTab } from "@/components/college/ShortlistTab";

export const Route = createFileRoute("/college/shortlist")({
  component: ShortlistPage,
});

function ShortlistPage() {
  return <ShortlistTab />;
}
