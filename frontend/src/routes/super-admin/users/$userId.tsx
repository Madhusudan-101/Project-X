import { createFileRoute } from "@tanstack/react-router";
import { UserDetailPage } from "@/components/admin/UserDetailPage";

export const Route = createFileRoute("/super-admin/users/$userId")({
  component: UserRoute,
});

function UserRoute() {
  const { userId } = Route.useParams();
  return <UserDetailPage userId={userId} />;
}
