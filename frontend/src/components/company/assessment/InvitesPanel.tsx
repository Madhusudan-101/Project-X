import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Bell, Loader2, Mail, Send, UserX } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { companyAssessmentService } from "@/services/api/company/assessment";
import type { InviteRow } from "@/types/company/assessment";

const EMAIL_LABEL = {
  sent: "Email sent",
  skipped: "No email sent",
  failed: "Email failed",
} as const;

export function InvitesPanel({ jobId, driveId }: { jobId: string; driveId: string }) {
  const qc = useQueryClient();
  const key = ["company-oa", jobId, driveId, "invites"];
  const { data, isLoading } = useQuery<InviteRow[]>({
    queryKey: key,
    queryFn: () => companyAssessmentService.listInvites(jobId, driveId),
  });
  const [picked, setPicked] = useState<Set<string>>(new Set());

  const refresh = () => {
    qc.invalidateQueries({ queryKey: key });
    qc.invalidateQueries({ queryKey: ["company-oa", jobId, driveId] });
  };
  const onError = (e: unknown) =>
    toast.error(e instanceof Error ? e.message : "Something went wrong.");

  const invite = useMutation({
    mutationFn: (body: { all?: boolean; applicationIds?: string[] }) =>
      companyAssessmentService.invite(jobId, driveId, body),
    onSuccess: (r) => {
      const mail =
        r.email.sent > 0
          ? `${r.email.sent} email${r.email.sent === 1 ? "" : "s"} sent`
          : "no emails sent (email isn't configured) — they'll see it on their dashboard";
      toast.success(`Invited ${r.invited} applicant${r.invited === 1 ? "" : "s"}; ${mail}.`);
      setPicked(new Set());
      refresh();
    },
    onError,
  });
  const resend = useMutation({
    mutationFn: (id: string) => companyAssessmentService.resend(jobId, driveId, id),
    onSuccess: (r) => {
      toast[r.email === "sent" ? "success" : "info"](
        r.email === "sent" ? "Invite resent." : "Email isn't configured — nothing was sent.",
      );
      refresh();
    },
    onError,
  });
  const revoke = useMutation({
    mutationFn: (id: string) => companyAssessmentService.revoke(jobId, driveId, id),
    onSuccess: () => {
      toast.success("Invite revoked.");
      refresh();
    },
    onError,
  });
  const remind = useMutation({
    mutationFn: () => companyAssessmentService.remind(jobId, driveId),
    onSuccess: (r) => toast.success(r.sent ? `Reminder sent to ${r.sent}.` : "No reminders sent."),
    onError,
  });

  if (isLoading) return <Skeleton className="h-40 w-full" />;
  const rows = data ?? [];
  if (rows.length === 0)
    return (
      <p className="rounded-lg border border-dashed border-border/70 p-6 text-center text-xs text-muted-foreground">
        No applicants from this college yet.
      </p>
    );

  const canPick = rows.filter((r) => !r.invited && !r.attempt);
  const toggle = (id: string) =>
    setPicked((p) => {
      const n = new Set(p);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          disabled={picked.size === 0 || invite.isPending}
          onClick={() => invite.mutate({ applicationIds: [...picked] })}
          className="bg-gradient-brand text-primary-foreground"
        >
          {invite.isPending ? (
            <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
          ) : (
            <Send className="mr-1.5 h-4 w-4" />
          )}
          Invite selected ({picked.size})
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={canPick.length === 0 || invite.isPending}
          onClick={() => invite.mutate({ all: true })}
        >
          Invite all ({canPick.length})
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={remind.isPending}
          onClick={() => remind.mutate()}
        >
          <Bell className="mr-1.5 h-4 w-4" /> Remind those who haven&apos;t started
        </Button>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-10" />
            <TableHead>Applicant</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.applicationId}>
              <TableCell>
                {!r.invited && !r.attempt && (
                  <Checkbox
                    checked={picked.has(r.applicationId)}
                    onCheckedChange={() => toggle(r.applicationId)}
                    aria-label={`Select ${r.name}`}
                  />
                )}
              </TableCell>
              <TableCell>
                <div className="text-sm font-medium">{r.name}</div>
                <div className="text-xs text-muted-foreground">{r.email}</div>
              </TableCell>
              <TableCell className="space-x-1.5">
                {r.attempt ? (
                  <Badge variant="outline" className="border-primary/30 bg-primary/10 text-primary">
                    {r.attempt === "submitted" ? "Submitted" : "In progress"}
                  </Badge>
                ) : r.invited ? (
                  <>
                    <Badge variant="outline">Invited</Badge>
                    {r.emailStatus && (
                      <span className="text-[11px] text-muted-foreground">
                        {EMAIL_LABEL[r.emailStatus]}
                      </span>
                    )}
                  </>
                ) : (
                  <span className="text-xs text-muted-foreground">Not invited</span>
                )}
              </TableCell>
              <TableCell className="space-x-1 text-right">
                {r.invited && !r.attempt && (
                  <>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 px-2 text-xs"
                      onClick={() => resend.mutate(r.applicationId)}
                    >
                      <Mail className="mr-1 h-3.5 w-3.5" /> Resend
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 px-2 text-xs text-destructive"
                      onClick={() => revoke.mutate(r.applicationId)}
                    >
                      <UserX className="mr-1 h-3.5 w-3.5" /> Revoke
                    </Button>
                  </>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
