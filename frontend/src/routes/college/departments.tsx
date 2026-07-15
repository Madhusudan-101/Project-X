import { createFileRoute } from "@tanstack/react-router";
import { DepartmentsTab } from "@/components/college/DepartmentsTab";

export const Route = createFileRoute("/college/departments")({
  component: DepartmentsPage,
});

function DepartmentsPage() {
  return <DepartmentsTab />;
}
