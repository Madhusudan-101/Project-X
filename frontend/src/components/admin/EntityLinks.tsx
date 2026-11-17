import { Link } from "@tanstack/react-router";
import { usePortalTo } from "@/hooks/admin/use-admin-portal";

const linkClass = "font-medium hover:text-primary hover:underline";

export function CollegeLink({ id, name }: { id: string; name: string }) {
  const to = usePortalTo();
  return (
    <Link to={to("/admin/colleges/$collegeId")} params={{ collegeId: id }} className={linkClass}>
      {name}
    </Link>
  );
}

export function CompanyLink({ id, name }: { id: string; name: string }) {
  const to = usePortalTo();
  return (
    <Link to={to("/admin/companies/$companyId")} params={{ companyId: id }} className={linkClass}>
      {name}
    </Link>
  );
}
