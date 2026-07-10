import type { UserRole } from "@/types";

export const dashboardPathForRole = (role: UserRole): string => {
  switch (role) {
    case "candidate":
      return "/candidate";
    case "company":
      return "/company";
    case "college":
      return "/college";
    case "admin":
      return "/admin";
  }
};
