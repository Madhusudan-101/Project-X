import { keepPreviousData } from "@tanstack/react-query";
import { ApiClientError } from "@/services/api/client";

/** Shared React Query options for admin data. Identical requests within a
 * minute (same page, same range) are served from cache instead of re-fetched. */
export const adminQueryOptions = {
  staleTime: 60_000,
  refetchOnWindowFocus: false,
  // One retry for transient failures; never retry auth / validation errors.
  retry: (failures: number, error: unknown) =>
    failures < 1 && !(error instanceof ApiClientError && [400, 401, 403, 404, 422, 503].includes(error.status)),
} as const;

/** For paged tables: keep showing the previous page while the next one loads. */
export const adminTableQueryOptions = { ...adminQueryOptions, placeholderData: keepPreviousData } as const;
