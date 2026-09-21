import { Link } from "@tanstack/react-router";

const linkClass = "font-medium hover:text-primary hover:underline";

export function CollegeLink({ id, name }: { id: string; name: string }) {
  return (
    <Link to="/admin/colleges/$collegeId" params={{ collegeId: id }} className={linkClass}>
      {name}
    </Link>
  );
}

export function CompanyLink({ id, name }: { id: string; name: string }) {
  return (
    <Link to="/admin/companies/$companyId" params={{ companyId: id }} className={linkClass}>
      {name}
    </Link>
  );
}
