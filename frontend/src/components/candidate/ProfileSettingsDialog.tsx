import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { CollegeCombobox } from "@/components/candidate/CollegeCombobox";
import { SkillsMultiSelect, type SelectedSkill } from "@/components/candidate/SkillsMultiSelect";
import { RolesMultiSelect } from "@/components/candidate/RolesMultiSelect";
import { BRANCH_OPTIONS } from "@/types/jobs";
import { authService } from "@/services/api/auth";
import { useAuthStore } from "@/store/auth";
import { ApiClientError } from "@/services/api/client";

interface ProfileSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const currentYear = new Date().getFullYear();

/**
 * Lets a candidate edit the profile fields that change over time — name,
 * domain, college, graduation year, interested roles, and skills. These
 * feed the student job board (domain + college filtering, skills matching),
 * so saving invalidates the board query.
 */
export function ProfileSettingsDialog({ open, onOpenChange }: ProfileSettingsDialogProps) {
  const session = useAuthStore((s) => s.session);
  const updateUser = useAuthStore((s) => s.updateUser);
  const queryClient = useQueryClient();

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [domain, setDomain] = useState<string>("");
  const [branch, setBranch] = useState<string>("");
  const [collegeName, setCollegeName] = useState("");
  const [graduationYear, setGraduationYear] = useState<string>("");
  const [roles, setRoles] = useState<string[]>([]);
  const [skills, setSkills] = useState<SelectedSkill[]>([]);
  const [saving, setSaving] = useState(false);

  // Stable identity — nationality / work authorization / gender (aggregate
  // only) / location preferences. These feed the drive-eligibility gate
  // (cgpa) and the relocation/sponsorship quick-confirm on job detail.
  const [cgpa, setCgpa] = useState<string>("");
  const [nationality, setNationality] = useState("");
  const [needsSponsorship, setNeedsSponsorship] = useState(false);
  const [sponsorshipCountry, setSponsorshipCountry] = useState("");
  const [gender, setGender] = useState<string>("");
  const [preferredLocations, setPreferredLocations] = useState("");
  const [willingToRelocate, setWillingToRelocate] = useState(false);

  useEffect(() => {
    if (!open || !session) return;
    const u = session.user;
    setFirstName(u.firstName ?? u.name?.split(" ")[0] ?? "");
    setLastName(u.lastName ?? u.name?.split(" ").slice(1).join(" ") ?? "");
    setDomain(u.domain ?? "");
    setBranch(u.branch ?? "");
    setCollegeName(u.collegeName ?? "");
    setGraduationYear(u.graduationYear ? String(u.graduationYear) : "");
    setRoles(u.interestedRoles ?? []);
    setSkills((u.skills ?? []).map((name) => ({ name, isCustom: false })));
    setCgpa(u.cgpa != null ? String(u.cgpa) : "");
    setNationality(u.nationality ?? "");
    setNeedsSponsorship(Boolean(u.needsSponsorship));
    setSponsorshipCountry(u.sponsorshipCountry ?? "");
    setGender(u.gender ?? "");
    setPreferredLocations((u.preferredLocations ?? []).join(", "));
    setWillingToRelocate(Boolean(u.willingToRelocate));
  }, [open, session]);

  const save = async () => {
    if (!firstName.trim() || !lastName.trim()) {
      toast.error("First and last name are required.");
      return;
    }
    if (!collegeName.trim() || skills.length === 0 || !domain) {
      toast.error("College, domain, and at least one skill are required.");
      return;
    }
    const yearNum = graduationYear === "" ? undefined : Number(graduationYear);
    if (
      yearNum !== undefined &&
      (!Number.isInteger(yearNum) || yearNum < currentYear - 10 || yearNum > currentYear + 10)
    ) {
      toast.error("Enter a valid graduation year.");
      return;
    }
    const cgpaNum = cgpa.trim() === "" ? null : Number(cgpa);
    if (cgpaNum !== null && (Number.isNaN(cgpaNum) || cgpaNum < 0 || cgpaNum > 10)) {
      toast.error("CGPA must be between 0 and 10.");
      return;
    }

    setSaving(true);
    try {
      const updated = await authService.updateProfile({
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        name: `${firstName.trim()} ${lastName.trim()}`.trim(),
        domain,
        branch: branch || null,
        collegeName: collegeName.trim(),
        graduationYear: yearNum,
        interestedRoles: roles,
        skills: skills.map((s) => s.name),
        cgpa: cgpaNum,
        nationality: nationality.trim() || null,
        needsSponsorship,
        sponsorshipCountry: needsSponsorship ? sponsorshipCountry.trim() || null : null,
        gender: gender || null,
        preferredLocations: preferredLocations
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
        willingToRelocate,
      });
      updateUser(updated);
      queryClient.invalidateQueries({ queryKey: ["candidate-job-board"] });
      toast.success("Profile updated.");
      onOpenChange(false);
    } catch (err) {
      toast.error(
        err instanceof ApiClientError || err instanceof Error
          ? err.message
          : "Could not save your profile.",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(n) => !saving && onOpenChange(n)}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Profile settings</DialogTitle>
          <DialogDescription>
            Keep these current — your roles, skills, and domain decide which jobs you see.
          </DialogDescription>
        </DialogHeader>

        <div className="mt-2 space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="ps-first">First name</Label>
              <Input
                id="ps-first"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ps-last">Surname</Label>
              <Input id="ps-last" value={lastName} onChange={(e) => setLastName(e.target.value)} />
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="ps-domain">Domain</Label>
              <Select value={domain || undefined} onValueChange={setDomain}>
                <SelectTrigger id="ps-domain">
                  <SelectValue placeholder="Tech or non-tech" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="tech">Tech</SelectItem>
                  <SelectItem value="non-tech">Non-tech</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ps-year">Graduation year</Label>
              <Input
                id="ps-year"
                type="number"
                placeholder="2027"
                value={graduationYear}
                onChange={(e) => setGraduationYear(e.target.value)}
              />
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="ps-branch">Branch</Label>
              <Select value={branch || undefined} onValueChange={setBranch}>
                <SelectTrigger id="ps-branch">
                  <SelectValue placeholder="Select branch" />
                </SelectTrigger>
                <SelectContent>
                  {BRANCH_OPTIONS.map((b) => (
                    <SelectItem key={b.code} value={b.code}>
                      {b.code} — {b.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground">
                Used to check eligibility for branch-restricted on-campus drives.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label>College</Label>
              <CollegeCombobox value={collegeName} onChange={setCollegeName} />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Roles you&apos;re interested in</Label>
            <RolesMultiSelect value={roles} onChange={setRoles} />
          </div>

          <div className="space-y-1.5">
            <Label>Skills</Label>
            <SkillsMultiSelect value={skills} onChange={setSkills} />
          </div>

          {/* ── Stable identity ────────────────────────────────────── */}
          <div className="space-y-4 rounded-lg border border-border/70 bg-surface/40 p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Identity &amp; preferences
            </p>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="ps-cgpa">CGPA (0–10)</Label>
                <Input
                  id="ps-cgpa"
                  type="number"
                  min={0}
                  max={10}
                  step="0.01"
                  placeholder="e.g. 8.10"
                  value={cgpa}
                  onChange={(e) => setCgpa(e.target.value)}
                />
                <p className="text-[11px] text-muted-foreground">
                  Used to check eligibility for on-campus drives.
                </p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ps-nationality">Nationality</Label>
                <Input
                  id="ps-nationality"
                  placeholder="e.g. Indian"
                  value={nationality}
                  onChange={(e) => setNationality(e.target.value)}
                />
              </div>
            </div>

            <div className="flex items-center justify-between rounded-lg border border-border/70 px-3 py-2">
              <div>
                <Label htmlFor="ps-sponsor" className="text-sm">
                  I need visa sponsorship
                </Label>
                <p className="text-[11px] text-muted-foreground">
                  For roles outside your work-authorized country.
                </p>
              </div>
              <Switch
                id="ps-sponsor"
                checked={needsSponsorship}
                onCheckedChange={setNeedsSponsorship}
              />
            </div>
            {needsSponsorship && (
              <div className="space-y-1.5">
                <Label htmlFor="ps-sponsor-country">
                  Country you&apos;re authorized to work in
                </Label>
                <Input
                  id="ps-sponsor-country"
                  placeholder="e.g. India"
                  value={sponsorshipCountry}
                  onChange={(e) => setSponsorshipCountry(e.target.value)}
                />
              </div>
            )}

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="ps-gender">Gender (optional)</Label>
                <Select value={gender || "prefer_not_to_say"} onValueChange={setGender}>
                  <SelectTrigger id="ps-gender">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="prefer_not_to_say">Prefer not to say</SelectItem>
                    <SelectItem value="woman">Woman</SelectItem>
                    <SelectItem value="man">Man</SelectItem>
                    <SelectItem value="non_binary">Non-binary</SelectItem>
                    <SelectItem value="self_describe">Prefer to self-describe</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-[11px] text-muted-foreground">
                  Optional. Used only for aggregate diversity reporting to your college — never
                  shown to individual recruiters.
                </p>
              </div>
              <div className="flex items-center justify-between rounded-lg border border-border/70 px-3 py-2">
                <div>
                  <Label htmlFor="ps-relocate" className="text-sm">
                    Willing to relocate
                  </Label>
                </div>
                <Switch
                  id="ps-relocate"
                  checked={willingToRelocate}
                  onCheckedChange={setWillingToRelocate}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="ps-locations">Preferred locations</Label>
              <Input
                id="ps-locations"
                placeholder="Bengaluru, Remote, Pune"
                value={preferredLocations}
                onChange={(e) => setPreferredLocations(e.target.value)}
              />
              <p className="text-[11px] text-muted-foreground">Comma-separated.</p>
            </div>
          </div>
        </div>

        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button
            onClick={save}
            disabled={saving}
            className="bg-gradient-brand text-primary-foreground shadow-soft"
          >
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save changes
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
