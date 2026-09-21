import { createFileRoute } from "@tanstack/react-router";
import { CollegesPage } from "@/components/admin/CollegesPage";

export const Route = createFileRoute("/admin/colleges/")({
  component: CollegesPage,
});
