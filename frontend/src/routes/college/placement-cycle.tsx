import { createFileRoute } from "@tanstack/react-router";
import { CalendarCheck } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/college/placement-cycle")({
  component: PlacementCyclePage,
});

function PlacementCyclePage() {
  return (
    <Card className="mx-auto max-w-lg p-10 text-center">
      <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-gradient-brand text-primary-foreground shadow-glow">
        <CalendarCheck className="h-7 w-7" aria-hidden="true" />
      </div>
      <h1 className="mt-4 font-display text-xl font-bold">Placement Cycle setup</h1>
      <p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">
        Set your active placement cycle, its dates, and which departments are participating —
        this is where every campus drive you run will be scoped to.
      </p>
      <Badge variant="outline" className="mt-4 border-primary/30 bg-primary/5 text-primary">
        Coming soon
      </Badge>
    </Card>
  );
}
