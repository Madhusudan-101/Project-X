import { Badge } from "@/components/ui/badge";
import type { RoleStatus } from "@/types/role";

interface RoleStatusBadgeProps {
  status: RoleStatus;
  className?: string;
}

const STATUS_STYLES: Record<RoleStatus, string> = {
  draft: "border-border text-muted-foreground",
  published: "border-success/30 bg-success/10 text-success",
  archived: "border-warning/30 bg-warning/10 text-warning-foreground",
};

const STATUS_LABELS: Record<RoleStatus, string> = {
  draft: "Draft",
  published: "Published",
  archived: "Archived",
};

export function RoleStatusBadge({ status, className }: RoleStatusBadgeProps) {
  return (
    <Badge variant="outline" className={`${STATUS_STYLES[status]} ${className ?? ""}`}>
      {STATUS_LABELS[status]}
    </Badge>
  );
}
