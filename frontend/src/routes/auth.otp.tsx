import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { ArrowLeft, Loader2 } from "lucide-react";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { Button } from "@/components/ui/button";
import { authService } from "@/services/api/auth";
import type { UserRole } from "@/types";

const searchSchema = z.object({
  role: z.enum(["candidate", "company", "college", "admin"]).optional(),
  email: z.string().email().optional(),
});

export const Route = createFileRoute("/auth/otp")({
  validateSearch: (s) => searchSchema.parse(s),
  component: OtpPage,
});

function OtpPage() {
  const navigate = useNavigate();
  const { role, email } = Route.useSearch();
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const verify = async () => {
    if (code.length !== 6) {
      toast.error("Enter the 6-digit code");
      return;
    }
    setSubmitting(true);
    try {
      const res = await authService.verifyOtp(email ?? "", code);
      toast.success("Verified");
      navigate({ to: "/auth/reset-password", search: { role, token: res.token } });
    } catch {
      toast.error("Invalid code");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div>
      <Link
        to="/auth/login"
        search={{ role }}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-primary"
      >
        <ArrowLeft className="h-4 w-4" /> Back
      </Link>
      <h1 className="mt-4 font-display text-3xl font-bold">Verify your email</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Enter the 6-digit code sent to <span className="font-medium text-foreground">{email ?? "your email"}</span>.
      </p>

      <div className="mt-8 flex justify-center">
        <InputOTP maxLength={6} value={code} onChange={setCode}>
          <InputOTPGroup>
            {Array.from({ length: 6 }).map((_, i) => (
              <InputOTPSlot key={i} index={i} />
            ))}
          </InputOTPGroup>
        </InputOTP>
      </div>

      <Button
        onClick={verify}
        disabled={submitting}
        className="mt-8 w-full bg-gradient-brand text-primary-foreground shadow-soft"
      >
        {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        Verify
      </Button>

      <p className="mt-6 text-center text-sm text-muted-foreground">
        Didn't get the code?{" "}
        <button type="button" onClick={() => toast.info("Code resent")} className="font-medium text-primary hover:underline">
          Resend
        </button>
      </p>
    </div>
  );
}
