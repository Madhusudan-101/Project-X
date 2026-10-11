import { createFileRoute } from "@tanstack/react-router";
import { StudentsTab } from "@/components/college/StudentsTab";
import { demoPageTitle } from "@/lib/demo/college/mode";

// Demo Mode page — the same component as the real portal; its data comes from the demo
// service layer because the URL is under /demo/college (see services/api/college/college.ts).
export const Route = createFileRoute("/demo/college/students")({
  // Each page gets its own title so tabs, history and screen readers can tell them apart.
  head: () => ({ meta: [{ title: demoPageTitle("Students") }] }),
  component: StudentsTab,
});
