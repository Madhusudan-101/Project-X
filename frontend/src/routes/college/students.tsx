import { createFileRoute } from "@tanstack/react-router";
import { StudentsTab } from "@/components/college/StudentsTab";

export const Route = createFileRoute("/college/students")({
  component: StudentsPage,
});

function StudentsPage() {
  return <StudentsTab />;
}
