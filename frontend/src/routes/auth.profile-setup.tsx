import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useState } from "react";
import { toast } from "sonner";
import { Loader2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { authService } from "@/services/api/auth";
import { useAuthStore } from "@/store/auth";
import { dashboardPathForRole } from "@/lib/roles";
import { CollegeCombobox } from "@/components/candidate/CollegeCombobox";
import { SkillsMultiSelect, type SelectedSkill } from "@/components/candidate/SkillsMultiSelect";
import { RolesMultiSelect } from "@/components/candidate/RolesMultiSelect";

const currentYear = new Date().getFullYear();

const DEGREES = ["B.Tech", "B.E.", "BCA", "B.Sc", "M.Tech", "M.E.", "MCA", "MBA", "Other"];

const schema = z.object({
  firstName: z.string().trim().min(1, "Enter your first name").max(40),
  lastName: z.string().trim().min(1, "Enter your surname").max(40),
  headline: z.string().trim().max(120).optional(),
  location: z.string().trim().max(80).optional(),
  bio: z.string().trim().max(400).optional(),
  degree: z.string().optional(),
  branch: z.string().trim().max(80).optional(),
  domain: z.enum(["tech", "non-tech"]).optional(),
  graduationYear: z
    .union([z.literal(""), z.coerce.number().int().min(currentYear - 10).max(currentYear + 10)])
    .optional(),
});
type FormValues = z.infer<typeof schema>;

export const Route = createFileRoute("/auth/profile-setup")({
  component: ProfileSetupPage,
});

function ProfileSetupPage() {
  const navigate = useNavigate();
  const session = useAuthStore((s) => s.session);
  const updateUser = useAuthStore((s) => s.updateUser);
  const isCandidate = (session?.user.role ?? "candidate") === "candidate";
  const [submitting, setSubmitting] = useState(false);

  // Kept outside react-hook-form, same pattern as the company-signup tag input —
  // both resolve to a single value/list, not a set of independent field errors.
  const [collegeName, setCollegeName] = useState(session?.user.collegeName ?? "");
  const [skills, setSkills] = useState<SelectedSkill[]>(
    (session?.user.skills ?? []).map((name) => ({ name, isCustom: false })),
  );
  const [interestedRoles, setInterestedRoles] = useState<string[]>(session?.user.interestedRoles ?? []);

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      firstName: session?.user.firstName ?? session?.user.name?.split(" ")[0] ?? "",
      lastName: session?.user.lastName ?? session?.user.name?.split(" ").slice(1).join(" ") ?? "",
      headline: "",
      location: "",
      bio: "",
      degree: undefined,
      branch: "",
      domain: undefined,
      graduationYear: session?.user.graduationYear ?? "",
    },
  });

  const onSubmit = async (values: FormValues) => {
    if (isCandidate && (!collegeName || skills.length === 0)) {
      toast.error("College and at least one skill are required.");
      return;
    }

    setSubmitting(true);
    try {
      const name = `${values.firstName} ${values.lastName}`.trim();
      // NOTE: degree / branch / domain / per-skill is_custom flag are captured
      // above for review but intentionally NOT sent yet — they need the
      // normalized candidate_colleges / skills / candidate_skills tables
      // (incremental_migration_candidate_onboarding_v2.sql), which hasn't been
      // approved or run yet. Only fields with existing backend/DB support go out.
      const updated = await authService.updateProfile({
        name,
        firstName: values.firstName,
        lastName: values.lastName,
        onboarded: true,
        ...(isCandidate && {
          collegeName,
          skills: skills.map((s) => s.name),
          interestedRoles,
          graduationYear: values.graduationYear === "" ? undefined : values.graduationYear,
        }),
      });
      updateUser(updated);
      toast.success(`All set, ${values.firstName}!`);
      navigate({ to: dashboardPathForRole(session?.user.role ?? "candidate") });
    } catch {
      toast.error("Could not save profile");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div>
      <h1 className="font-display text-3xl font-bold">Complete your profile</h1>
      <p className="mt-2 text-sm text-muted-foreground">A few details to personalize your experience.</p>

      <div className="mt-6 flex items-center gap-4 rounded-xl border border-dashed border-border p-4">
        <div className="grid h-16 w-16 place-items-center rounded-full bg-gradient-brand text-lg font-semibold text-primary-foreground">
          {session?.user.name?.[0]?.toUpperCase() ?? "U"}
        </div>
        <div className="flex-1">
          <div className="text-sm font-medium">Profile photo</div>
          <div className="text-xs text-muted-foreground">PNG or JPG · up to 2MB</div>
        </div>
        <Button type="button" size="sm" variant="outline">
          <Upload className="mr-2 h-4 w-4" /> Upload
        </Button>
      </div>

      <form onSubmit={form.handleSubmit(onSubmit)} className="mt-6 space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="firstName">First name</Label>
            <Input id="firstName" placeholder="Alex" {...form.register("firstName")} />
            {form.formState.errors.firstName && (
              <p className="text-xs text-destructive">{form.formState.errors.firstName.message}</p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="lastName">Surname</Label>
            <Input id="lastName" placeholder="Kumar" {...form.register("lastName")} />
            {form.formState.errors.lastName && (
              <p className="text-xs text-destructive">{form.formState.errors.lastName.message}</p>
            )}
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="headline">Headline</Label>
            <Input id="headline" placeholder="Frontend Engineer" {...form.register("headline")} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="location">Location</Label>
            <Input id="location" placeholder="Bengaluru, India" {...form.register("location")} />
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="bio">Short bio</Label>
          <Textarea id="bio" rows={4} placeholder="A line about you..." {...form.register("bio")} />
        </div>

        {isCandidate && (
          <>
            <div className="flex items-center gap-3 pt-2">
              <div className="h-px flex-1 bg-border/60" />
              <span className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
                Candidate details
              </span>
              <div className="h-px flex-1 bg-border/60" />
            </div>

            <div className="space-y-2">
              <Label>
                College <span className="text-destructive">*</span>
              </Label>
              <CollegeCombobox value={collegeName} onChange={setCollegeName} />
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-2">
                <Label htmlFor="degree">Degree</Label>
                <Select onValueChange={(v) => form.setValue("degree", v)}>
                  <SelectTrigger id="degree">
                    <SelectValue placeholder="Select degree" />
                  </SelectTrigger>
                  <SelectContent>
                    {DEGREES.map((d) => (
                      <SelectItem key={d} value={d}>
                        {d}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="branch">Branch</Label>
                <Input id="branch" placeholder="Computer Science" {...form.register("branch")} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="graduationYear">Graduation year</Label>
                <Input id="graduationYear" type="number" placeholder="2027" {...form.register("graduationYear")} />
                {form.formState.errors.graduationYear && (
                  <p className="text-xs text-destructive">Enter a valid year</p>
                )}
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="domain">Domain</Label>
              <Select onValueChange={(v) => form.setValue("domain", v as "tech" | "non-tech")}>
                <SelectTrigger id="domain">
                  <SelectValue placeholder="Tech or non-tech?" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="tech">Tech</SelectItem>
                  <SelectItem value="non-tech">Non-tech</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>Role(s) you're interested in</Label>
              <RolesMultiSelect value={interestedRoles} onChange={setInterestedRoles} />
            </div>

            <div className="space-y-1.5">
              <Label>
                Skills <span className="text-destructive">*</span>
              </Label>
              <SkillsMultiSelect value={skills} onChange={setSkills} />
            </div>
          </>
        )}

        <Button
          type="submit"
          disabled={submitting}
          className="w-full bg-gradient-brand text-primary-foreground shadow-soft"
        >
          {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Continue to dashboard
        </Button>
      </form>
    </div>
  );
}
