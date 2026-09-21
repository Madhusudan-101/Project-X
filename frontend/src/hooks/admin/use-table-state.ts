import { useState } from "react";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import type { SortDir } from "@/types/admin/admin";

export const ADMIN_PAGE_SIZE = 15;

/** Search / sort / page state for a server-side admin table.
 *
 * `resetKey` is anything else that should send the table back to page 1 (the
 * date range, a filter dropdown). The page is tied to the scope it was chosen
 * in, so a filter change never fires a request for a stale page number. */
export function useTableState(defaults: { sort: string; dir: SortDir }, resetKey: unknown = "") {
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search.trim(), 300);
  const [sort, setSort] = useState(defaults.sort);
  const [dir, setDir] = useState<SortDir>(defaults.dir);

  const scope = JSON.stringify([debouncedSearch, sort, dir, resetKey]);
  const [pageState, setPageState] = useState({ scope, page: 1 });
  const page = pageState.scope === scope ? pageState.page : 1;

  return {
    search,
    setSearch,
    debouncedSearch,
    sort,
    dir,
    page,
    setPage: (p: number) => setPageState({ scope, page: p }),
    /** Click a column header: same column flips direction, a new one starts descending
     * (biggest first) unless it is a text column, which starts A→Z. */
    toggleSort: (key: string, textColumn = false) => {
      if (key === sort) setDir(dir === "asc" ? "desc" : "asc");
      else {
        setSort(key);
        setDir(textColumn ? "asc" : "desc");
      }
    },
    params: { page, page_size: ADMIN_PAGE_SIZE, search: debouncedSearch || undefined, sort, dir },
  };
}
