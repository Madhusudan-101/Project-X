import { createFileRoute } from "@tanstack/react-router";
import { DrivesTab } from "@/components/college/DrivesTab";

export const Route = createFileRoute("/college/drives")({
  component: DrivesPage,
});

function DrivesPage() {
  return <DrivesTab />;
}
