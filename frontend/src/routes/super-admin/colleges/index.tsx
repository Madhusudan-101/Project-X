import { createFileRoute } from "@tanstack/react-router";
import { CollegesPage } from "@/components/admin/CollegesPage";

export const Route = createFileRoute("/super-admin/colleges/")({
  component: CollegesPage,
});
