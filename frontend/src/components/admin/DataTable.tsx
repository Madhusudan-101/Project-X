import type { ReactNode } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { SortDir } from "@/types/admin/admin";
import { fmtInt } from "./format";
import { EmptyBlock, ErrorBlock } from "./StateViews";

export interface Column<T> {
  key: string;
  header: string;
  /** Server-side sort key; omit for a non-sortable column. */
  sortKey?: string;
  /** Text column: first click sorts A→Z. */
  text?: boolean;
  align?: "right";
  className?: string;
  /** Column has no visible title (e.g. a row-action link); the header stays for screen readers. */
  hideHeader?: boolean;
  cell: (row: T) => ReactNode;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[] | undefined;
  rowKey: (row: T) => string;
  loading: boolean;
  /** Refetching with previous rows still shown (paging / sorting). */
  fetching?: boolean;
  error: unknown;
  onRetry: () => void;
  sort: string;
  dir: SortDir;
  onSort: (key: string, text: boolean) => void;
  page: number;
  pageSize: number;
  total: number;
  onPage: (page: number) => void;
  empty: { title: string; hint?: string };
  /** Name for screen readers. */
  label: string;
}

/** Server-side table: the parent owns search/sort/page and passes one page of
 * rows. Handles loading, error and empty states so every admin table does. */
export function DataTable<T>(p: DataTableProps<T>) {
  const totalPages = Math.max(1, Math.ceil(p.total / p.pageSize));
  const from = p.total === 0 ? 0 : (p.page - 1) * p.pageSize + 1;
  const to = Math.min(p.total, p.page * p.pageSize);

  if (p.error && !p.rows) return <ErrorBlock error={p.error} onRetry={p.onRetry} />;

  return (
    <div>
      <div
        className={`overflow-x-auto rounded-md border border-border transition-opacity ${p.fetching ? "opacity-60" : ""}`}
      >
        <Table aria-label={p.label}>
          <TableHeader>
            <TableRow>
              {p.columns.map((c) => {
                const active = c.sortKey === p.sort;
                return (
                  <TableHead
                    key={c.key}
                    aria-sort={active ? (p.dir === "asc" ? "ascending" : "descending") : undefined}
                    className={`whitespace-nowrap ${c.align === "right" ? "text-right" : ""} ${c.className ?? ""}`}
                  >
                    {c.sortKey ? (
                      <button
                        type="button"
                        onClick={() => p.onSort(c.sortKey!, !!c.text)}
                        className={`inline-flex items-center gap-1 hover:text-foreground ${c.align === "right" ? "flex-row-reverse" : ""} ${active ? "text-foreground" : ""}`}
                      >
                        {c.header}
                        {active ? (
                          p.dir === "asc" ? (
                            <ArrowUp className="h-3 w-3" />
                          ) : (
                            <ArrowDown className="h-3 w-3" />
                          )
                        ) : (
                          <ArrowUpDown className="h-3 w-3 opacity-40" />
                        )}
                      </button>
                    ) : c.hideHeader ? (
                      <span className="sr-only">{c.header}</span>
                    ) : (
                      c.header
                    )}
                  </TableHead>
                );
              })}
            </TableRow>
          </TableHeader>
          <TableBody>
            {p.loading && !p.rows
              ? Array.from({ length: 6 }).map((_, i) => (
                  <TableRow key={i}>
                    {p.columns.map((c) => (
                      <TableCell key={c.key}>
                        <Skeleton className="h-4 w-full max-w-28" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              : p.rows?.map((row) => (
                  <TableRow key={p.rowKey(row)}>
                    {p.columns.map((c) => (
                      <TableCell
                        key={c.key}
                        className={`${c.align === "right" ? "text-right tabular-nums" : ""} ${c.className ?? ""}`}
                      >
                        {c.cell(row)}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
          </TableBody>
        </Table>
        {!p.loading && p.rows?.length === 0 && (
          <div className="p-4">
            <EmptyBlock title={p.empty.title} hint={p.empty.hint} />
          </div>
        )}
      </div>

      {!!p.error && !!p.rows && (
        <p role="alert" className="mt-2 text-xs text-destructive">
          Couldn't refresh — showing the last loaded data.
        </p>
      )}

      {p.total > 0 && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>
            Showing {fmtInt(from)}–{fmtInt(to)} of {fmtInt(p.total)}
          </span>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={p.page <= 1}
              onClick={() => p.onPage(p.page - 1)}
              aria-label="Previous page"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span>
              Page {p.page} of {totalPages}
            </span>
            <Button
              size="sm"
              variant="outline"
              disabled={p.page >= totalPages}
              onClick={() => p.onPage(p.page + 1)}
              aria-label="Next page"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
