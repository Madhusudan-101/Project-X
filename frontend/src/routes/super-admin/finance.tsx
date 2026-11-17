import { createFileRoute } from "@tanstack/react-router";
import { FinancePage } from "@/components/admin/FinancePage";

export const Route = createFileRoute("/super-admin/finance")({
  component: FinancePage,
});
