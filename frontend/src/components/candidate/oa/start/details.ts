import type { OADetailsForm } from "@/types/candidate/assessment";

export type DetailsErrors = Partial<Record<keyof OADetailsForm, string>>;

/** Same rules the server enforces (see DetailsIn in the API), so the button state matches what Start accepts. */
export function validateDetails(d: OADetailsForm): DetailsErrors {
  const e: DetailsErrors = {};
  if (d.fullName.trim().length < 2) e.fullName = "Enter your full name.";
  if (!/^[0-9+()\-\s]{7,20}$/.test(d.phone.trim()))
    e.phone = "Enter a valid contact number (7 to 20 digits).";
  if (d.college.trim().length < 2) e.college = "Enter your university or college.";
  if (!d.rollNumber.trim()) e.rollNumber = "Enter your student roll number.";
  if (d.branch.trim().length < 2) e.branch = "Enter your stream or branch.";
  const year = Number(d.graduationYear);
  if (!Number.isInteger(year) || year < 2000 || year > 2100)
    e.graduationYear = "Enter a year such as 2027.";
  const cgpa = Number(d.cgpa);
  if (d.cgpa.trim() === "" || !Number.isFinite(cgpa) || cgpa < 0 || cgpa > 10)
    e.cgpa = "Enter a CGPA between 0 and 10.";
  return e;
}

export const detailsValid = (d: OADetailsForm) => Object.keys(validateDetails(d)).length === 0;
