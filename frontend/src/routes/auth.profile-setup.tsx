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
import { authService } from "@/services/api/auth";
import { useAuthStore } from "@/store/auth";
import { dashboardPathForRole } from "@/lib/roles";

const schema = z.object({
  firstName: z.string().trim().min(1, "Enter your first name").max(40),
  lastName: z.string().trim().min(1, "Enter your surname").max(40),
  headline: z.string().trim().max(120).optional(),
  location: z.string().trim().max(80).optional(),
  bio: z.string().trim().max(400).optional(),
});
type FormValues = z.infer<typeof schema>;

export const Route = createFileRoute("/auth/profile-setup")({
  component: ProfileSetupPage,
});

function ProfileSetupPage() {
  const navigate = useNavigate();
  const session = useAuthStore((s) => s.session);
  const updateUser = useAuthStore((s) => s.updateUser);
  const [submitting, setSubmitting] = useState(false);

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      firstName: session?.user.firstName ?? session?.user.name?.split(" ")[0] ?? "",
      lastName: session?.user.lastName ?? session?.user.name?.split(" ").slice(1).join(" ") ?? "",
      headline: "",
      location: "",
      bio: "",
    },
  });

  const onSubmit = async (values: FormValues) => {
    setSubmitting(true);
    try {
      const name = `${values.firstName} ${values.lastName}`.trim();
      const updated = await authService.updateProfile({
        name,
        firstName: values.firstName,
        lastName: values.lastName,
        onboarded: true,
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
