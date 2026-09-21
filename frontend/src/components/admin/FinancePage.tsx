import { useQuery } from "@tanstack/react-query";
import { Info } from "lucide-react";
import { Card } from "@/components/ui/card";
import { adminQueryOptions } from "@/hooks/admin/query";
import { useAdminRange } from "@/hooks/admin/use-admin-range";
import { adminService } from "@/services/api/admin/admin";
import type { FinanceSummary } from "@/types/admin/admin";
import { PageHeader } from "./controls";
import { fmtInr, fmtPct } from "./format";
import { KpiCard, KpiGroup } from "./KpiCard";
import { ErrorBlock } from "./StateViews";

type MetricKey = keyof FinanceSummary["metrics"];

const MONEY: { key: MetricKey; label: string; definition: string }[] = [
  { key: "revenue", label: "Revenue", definition: "Total revenue in the selected period." },
  { key: "monthly_revenue", label: "Monthly revenue", definition: "Revenue in the current month." },
  { key: "annual_revenue", label: "Annual revenue", definition: "Revenue in the current year." },
  { key: "revenue_per_college", label: "Revenue per college", definition: "Revenue ÷ paying colleges." },
  { key: "revenue_per_company", label: "Revenue per company", definition: "Revenue ÷ paying companies." },
  { key: "expenditure", label: "Expenditure", definition: "Total expenses in the selected period." },
  { key: "net_revenue", label: "Net revenue", definition: "Revenue − expenditure." },
];

/** Renders whatever the finance endpoint reports: while `available` is false
 * every metric is null → N/A. Wiring real data changes only the backend. */
export function FinancePage() {
  const { range } = useAdminRange();
  const q = useQuery({ queryKey: ["admin", "finance", range], queryFn: () => adminService.finance(range), ...adminQueryOptions });
  const m = q.data?.metrics;
  const currency = q.data?.currency;

  return (
    <>
      <PageHeader title="Financial overview" description="Revenue, expenditure and growth for the platform." />

      {q.isError ? (
        <ErrorBlock error={q.error} onRetry={() => q.refetch()} />
      ) : (
        <>
          {q.data && !q.data.available && (
            <Card className="flex gap-3 border-primary/30 bg-primary/5 p-4 text-sm">
              <Info className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
              <div>
                <p className="font-medium">Financial data isn&apos;t available yet</p>
                <p className="mt-1 text-muted-foreground">{q.data.message}</p>
                <p className="mt-2 text-xs text-muted-foreground">
                  To enable this page, the database needs a payments or invoices ledger (amount, currency, date, and the college or company it belongs to) and an expense ledger. Once those exist, only the backend calculation changes; this page will fill in automatically.
                </p>
              </div>
            </Card>
          )}

          <KpiGroup title="Revenue & expenditure">
            {MONEY.map((k) => (
              <KpiCard
                key={k.key}
                label={k.label}
                loading={q.isLoading}
                value={m?.[k.key] == null ? null : fmtInr(m[k.key])}
                definition={m?.[k.key] == null ? `${k.definition} N/A: no financial data source.` : k.definition}
                sub={currency && m?.[k.key] != null ? currency : undefined}
              />
            ))}
            <KpiCard
              label="Growth"
              loading={q.isLoading}
              value={m?.growth_rate == null ? null : fmtPct(m.growth_rate)}
              definition="Change in revenue versus the previous period. N/A: no financial data source."
            />
          </KpiGroup>
        </>
      )}
    </>
  );
}
