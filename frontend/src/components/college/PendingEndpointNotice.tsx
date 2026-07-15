import type { ReactNode } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/**
 * Wraps a disabled button/control that maps to a backend endpoint which
 * doesn't exist yet (e.g. edit/delete student, edit/delete drive, roster
 * CSV export). Keeps the UI fully built so wiring it up later is a one-line
 * change once the route ships, while making it obvious to the user why the
 * action can't be completed today.
 */
export function PendingEndpointNotice({
  children,
  reason = "This action needs a backend endpoint that hasn't been built yet.",
}: {
  children: ReactNode;
  reason?: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex" tabIndex={0}>
          {children}
        </span>
      </TooltipTrigger>
      <TooltipContent>{reason}</TooltipContent>
    </Tooltip>
  );
}
