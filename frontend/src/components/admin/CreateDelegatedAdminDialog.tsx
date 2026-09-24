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
import { ApiClientError } from "@/services/api/client";

const schema = z.object({
  first_name: z.string().trim().min(1, "Enter a first name").max(60),
  last_name: z.string().trim().min(1, "Enter a last name").max(60),
  email: z.string().trim().email("Enter a valid email").max(255),
});
type FormValues = z.infer<typeof schema>;

const EMPTY: FormValues = { first_name: "", last_name: "", email: "" };

/** Creates a delegated Admin account with NO permissions yet — same
 * provisioning path as a College account (a set-password email, no
 * password anyone sees). Grant permissions afterwards from the admin's row. */
export function CreateDelegatedAdminDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const queryClient = useQueryClient();
  const form = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: EMPTY });

  const create = useMutation({
    mutationFn: (v: FormValues) => adminService.adminUsers.create(v),
    onSuccess: (res, v) => {
      if (res.invite_sent) toast.success(`Delegated admin created. A set-password email was sent to ${v.email}.`);
      else toast.warning("Account created, but the set-password email could not be sent. Ask them to use “Forgot password” on the Admin sign-in page.");
      toast.info("They have no permissions yet — grant some from their row before they sign in.");
      queryClient.invalidateQueries({ queryKey: ["admin", "adminUsers"] });
      form.reset(EMPTY);
      onOpenChange(false);
    },
    onError: (err) => toast.error(err instanceof ApiClientError ? err.message : "Could not create the account."),
  });

  const field = (name: keyof FormValues, label: string, props: ComponentProps<typeof Input> = {}) => (
    <div className="space-y-1.5">
      <Label htmlFor={`delegate-${name}`}>{label}</Label>
      <Input id={`delegate-${name}`} {...form.register(name)} {...props} />
      {form.formState.errors[name] && <p className="text-xs text-destructive">{form.formState.errors[name]?.message}</p>}
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={(o) => !create.isPending && onOpenChange(o)}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Add a delegated admin</DialogTitle>
          <DialogDescription>
            Creates an Admin account with no access yet. You grant it specific permissions — the exact sections and
            actions it can use — right after.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={form.handleSubmit((v) => create.mutate(v))} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            {field("first_name", "First name")}
            {field("last_name", "Last name")}
          </div>
          {field("email", "Email", { type: "email", placeholder: "name@company.com" })}
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
