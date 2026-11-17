import type { User, UserRole } from "@/types";

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

/** Where to send a user straight after the backend has signed them in. Pass the
 * user from that response: this picks a destination, and the destination's own
 * guard re-checks it with the backend. */
export const dashboardPathForUser = (user: Pick<User, "role" | "portal">): string =>
  user.portal === "super_admin" ? "/super-admin" : dashboardPathForRole(user.role);

/** Where a first-time (not yet onboarded) user of this role should land. */
export const onboardingPathForRole = (role: UserRole): string => {
  switch (role) {
    case "company":
      return "/auth/company-onboarding";
    case "college":
      return "/auth/college-onboarding";
    case "candidate":
    case "admin":
      return "/auth/profile-setup";
  }
};
