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
