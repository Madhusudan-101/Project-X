import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ArrowRight, CheckCircle2, Globe, Image, Loader2, SkipForward } from "lucide-react";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useAuthStore } from "@/store/auth";
import { useCompanyStore } from "@/store/company";
import { companyService } from "@/services/api/company";

// ── Validation ─────────────────────────────────────────────────────────

const schema = z.object({
  website: z
    .string()
    .trim()
    .max(255)
    .optional()
    .refine(
      (v) => !v || v.startsWith("http://") || v.startsWith("https://"),
      "Website must start with http:// or https://",
    ),
  logoUrl: z.string().trim().max(500).optional(),
});

type FormValues = z.infer<typeof schema>;

// ── Route ──────────────────────────────────────────────────────────────

export const Route = createFileRoute("/auth/company-onboarding")({
  component: CompanyOnboardingPage,
});

// ── Component ──────────────────────────────────────────────────────────

function CompanyOnboardingPage() {
  const navigate = useNavigate();
  const session = useAuthStore((s) => s.session);
  const logout = useAuthStore((s) => s.logout);
  const company = useCompanyStore((s) => s.company);
  const setCompany = useCompanyStore((s) => s.setCompany);
  const [submitting, setSubmitting] = useState(false);
  const [skipping, setSkipping] = useState(false);

  // ── Auth guard ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!session) {
      navigate({ to: "/auth/login", search: { role: "company" } as never });
      return;
    }
    if (session.user.role !== "company") {
      navigate({ to: "/portals" });
    }
  }, [session, navigate]);

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { website: "", logoUrl: "" },
  });

  // ── Skip (go straight to dashboard) ──────────────────────────────
  const handleSkip = async () => {
    setSkipping(true);
    try {
      navigate({ to: "/company" });
    } finally {
      setSkipping(false);
    }
  };

  // ── Submit (save optional fields then go to dashboard) ────────────
  const onSubmit = async (values: FormValues) => {
    const payload = {
      ...(values.website ? { website: values.website } : {}),
      ...(values.logoUrl ? { logoUrl: values.logoUrl } : {}),
    };

    if (Object.keys(payload).length === 0) {
      navigate({ to: "/company" });
      return;
    }

    setSubmitting(true);
    try {
      const updated = await companyService.updateMe(payload);
      setCompany(updated);
      toast.success("Company profile updated!");
      navigate({ to: "/company" });
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to update profile.");
    } finally {
      setSubmitting(false);
    }
  };

  if (!session) return null;

  const firstName =
    session.user.firstName ?? session.user.name?.split(" ")[0] ?? "there";

  return (
    <div>
      {/* Success header */}
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.35 }}
        className="flex items-center gap-3"
      >
        <div className="grid h-10 w-10 place-items-center rounded-full bg-success/15 text-success">
          <CheckCircle2 className="h-5 w-5" />
        </div>
        <div>
          <h1 className="font-display text-xl font-bold">
            You're in, {firstName}!
          </h1>
          <p className="text-sm text-muted-foreground">Account verified — workspace ready.</p>
        </div>
      </motion.div>

      {/* Company card */}
      {company && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.1 }}
        >
          <Card className="mt-5 border-primary/20 p-4">
            <div className="flex items-start justify-between">
              <div>
                <div className="font-display text-base font-semibold">{company.name}</div>
                <div className="mt-0.5 text-sm text-muted-foreground">
                  {company.industry} · {company.size} employees
                </div>
              </div>
              <Badge className="border-success/30 bg-success/10 text-success" variant="outline">
                Registered
              </Badge>
            </div>
            {company.hiringDomains.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {company.hiringDomains.map((d) => (
                  <Badge
                    key={d}
                    variant="outline"
                    className="border-primary/20 bg-primary/5 text-xs text-primary"
                  >
                    {d}
                  </Badge>
                ))}
              </div>
            )}
          </Card>
        </motion.div>
      )}

      {/* Optional fields */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: 0.2 }}
      >
        <p className="mt-6 text-sm font-medium text-foreground">
          Optional — add your website and logo
        </p>
        <p className="text-xs text-muted-foreground">
          You can always update these later from Settings.
        </p>

        <form onSubmit={form.handleSubmit(onSubmit)} className="mt-4 space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="website" className="flex items-center gap-1.5">
              <Globe className="h-3.5 w-3.5 text-muted-foreground" />
              Company website
            </Label>
            <Input
              id="website"
              type="url"
              placeholder="https://yourcompany.com"
              aria-invalid={!!form.formState.errors.website}
              {...form.register("website")}
            />
            {form.formState.errors.website && (
              <p role="alert" className="text-xs text-destructive">
                {form.formState.errors.website.message}
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="logoUrl" className="flex items-center gap-1.5">
              <Image className="h-3.5 w-3.5 text-muted-foreground" />
              Logo URL
            </Label>
            <Input
              id="logoUrl"
              type="url"
              placeholder="https://cdn.yourcompany.com/logo.png"
              aria-invalid={!!form.formState.errors.logoUrl}
              {...form.register("logoUrl")}
            />
            {form.formState.errors.logoUrl && (
              <p role="alert" className="text-xs text-destructive">
                {form.formState.errors.logoUrl.message}
              </p>
            )}
          </div>

          <div className="flex gap-3 pt-2">
            <Button
              type="submit"
              disabled={submitting || skipping}
              className="flex-1 bg-gradient-brand text-primary-foreground shadow-soft"
            >
              {submitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Saving…
                </>
              ) : (
                <>
                  Enter dashboard
                  <ArrowRight className="ml-2 h-4 w-4" />
                </>
              )}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={submitting || skipping}
              onClick={handleSkip}
              aria-label="Skip and go to dashboard"
            >
              {skipping ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <>
                  <SkipForward className="mr-1.5 h-4 w-4" />
                  Skip
                </>
              )}
            </Button>
          </div>
        </form>
      </motion.div>
    </div>
  );
}
