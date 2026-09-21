import type { ComponentProps } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { adminService } from "@/services/api/admin/admin";

const schema = z.object({
  college_name: z.string().trim().min(1, "Enter the college name").max(120),
  city: z.string().trim().max(80).optional(),
  state: z.string().trim().max(80).optional(),
  first_name: z.string().trim().min(1, "Enter a first name").max(60),
  last_name: z.string().trim().min(1, "Enter a last name").max(60),
  email: z.string().trim().email("Enter a valid email").max(255),
});
type FormValues = z.infer<typeof schema>;

const EMPTY: FormValues = { college_name: "", city: "", state: "", first_name: "", last_name: "", email: "" };

/** Provision a College account. Public College signup is closed; this is how a
 * college gets access: the backend creates the account, links it to the
 * college (an existing directory entry with the same name, or a new one) and
 * emails the contact a set-password link. */
export function AddCollegeDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const queryClient = useQueryClient();
  const form = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: EMPTY });

  const create = useMutation({
    mutationFn: (v: FormValues) =>
      adminService.colleges.provision({
        email: v.email,
        first_name: v.first_name,
        last_name: v.last_name,
        college_name: v.college_name,
        city: v.city || undefined,
        state: v.state || undefined,
      }),
    onSuccess: (res, v) => {
      const replaced = res.replaced_legacy_account
        ? " An older unlinked College account for this email was replaced; its old password no longer works."
        : "";
      if (res.invite_sent) toast.success(`College account created. A set-password email was sent to ${v.email}.${replaced}`);
      else toast.warning(`Account created, but the set-password email could not be sent. Ask them to use “Forgot password” on the College sign-in page.${replaced}`);
      queryClient.invalidateQueries({ queryKey: ["admin"] });
      form.reset(EMPTY);
      onOpenChange(false);
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Could not create the account"),
  });

  const field = (name: keyof FormValues, label: string, props: ComponentProps<typeof Input> = {}) => (
    <div className="space-y-1.5">
      <Label htmlFor={`college-${name}`}>{label}</Label>
      <Input id={`college-${name}`} {...form.register(name)} {...props} />
      {form.formState.errors[name] && <p className="text-xs text-destructive">{form.formState.errors[name]?.message}</p>}
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={(o) => !create.isPending && onOpenChange(o)}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Add a college</DialogTitle>
          <DialogDescription>
            Creates a College account for the placement contact and links it to the college. They get an email to set their password.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={form.handleSubmit((v) => create.mutate(v))} className="space-y-4">
          {field("college_name", "College name", { placeholder: "e.g. LNMIIT Jaipur" })}
          <div className="grid gap-4 sm:grid-cols-2">
            {field("city", "City (optional)")}
            {field("state", "State (optional)")}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {field("first_name", "Contact first name")}
            {field("last_name", "Contact last name")}
          </div>
          {field("email", "Contact email", { type: "email", placeholder: "tpo@college.edu" })}
          <DialogFooter>
            <Button type="button" variant="ghost" disabled={create.isPending} onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={create.isPending} className="bg-gradient-brand text-primary-foreground">
              {create.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Create account
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
