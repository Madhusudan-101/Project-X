import { createFileRoute } from "@tanstack/react-router";
import { PeerSafetyPage } from "@/components/admin/PeerSafetyPage";

export const Route = createFileRoute("/admin/peer-safety")({
  component: PeerSafetyPage,
});
