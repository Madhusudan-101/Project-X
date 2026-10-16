import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Bell, Loader2, Send, UserX } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { companyAiInterviewService } from "@/services/api/company/aiInterviews";
import type { InterviewTemplate, InviteRow } from "@/types/company/aiInterview";
import { DECISION_LABEL, INVITE_STATUS_LABEL, describeInviteResult, parseEmails } from "./rubric";

const EXPIRY_DAYS = [3, 7, 14, 30];

const statusVariant = (s: InviteRow["status"]) =>
  s === "completed" ? "default" : s === "invited" || s === "started" ? "secondary" : "outline";

export function InvitesPanel({ template }: { template: InterviewTemplate }) {
  const qc = useQueryClient();
  const key = ["company-ai-interviews", template.id, "invites"];
  const { data, isLoading } = useQuery<InviteRow[]>({
    queryKey: key,
    queryFn: () => companyAiInterviewService.listInvites(template.id),
  });
  const [text, setText] = useState("");
  const [days, setDays] = useState(7);
  const parsed = parseEmails(text);
  const active = template.status === "active";

  const refresh = () => {
    qc.invalidateQueries({ queryKey: key });
    qc.invalidateQueries({ queryKey: ["company-ai-interviews"] });
  };
  const onError = (e: unknown) =>
    toast.error(e instanceof Error ? e.message : "Something went wrong.");

  const send = useMutation({
    mutationFn: () =>
      companyAiInterviewService.invite(template.id, {
        emails: parsed.valid,
        expires_in_days: days,
      }),
    onSuccess: (r) => {
      toast.success(describeInviteResult(r));
      if (r.invalid.length) toast.warning(`Skipped invalid: ${r.invalid.join(", ")}`);
      setText("");
      refresh();
    },
    onError,
  });
  const resend = useMutation({
    mutationFn: (id: string) => companyAiInterviewService.resend(template.id, id),
    onSuccess: (r) => {
      toast[r.email === "sent" ? "success" : "info"](
        r.email === "sent" ? "Reminder sent." : "Email isn't set up, so nothing was sent.",
      );
      refresh();
    },
    onError,
  });
  const revoke = useMutation({
    mutationFn: (id: string) => companyAiInterviewService.revoke(template.id, id),
    onSuccess: () => {
      toast.success("Invitation withdrawn.");
      refresh();
    },
    onError,
  });

  const rows = data ?? [];
  return (
    <div className="space-y-5">
      <section className="space-y-3 rounded-lg border p-4" aria-labelledby="invite-h">
        <h3 id="invite-h" className="text-sm font-semibold">
          Invite candidates
        </h3>
        {!active && (
          <p className="rounded-md bg-muted/60 p-3 text-sm text-muted-foreground">
            Activate this interview before inviting candidates.
          </p>
        )}
        <div className="space-y-1.5">
          <Label htmlFor="invite-emails">Email addresses</Label>
          <Textarea
            id="invite-emails"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Paste addresses separated by commas, spaces or new lines"
            rows={3}
            disabled={!active}
          />
          <p className="text-xs text-muted-foreground" aria-live="polite">
            {parsed.valid.length} valid address{parsed.valid.length === 1 ? "" : "es"}
            {parsed.invalid.length > 0 && (
              <span className="text-destructive"> · not valid: {parsed.invalid.join(", ")}</span>
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="invite-days">Valid for</Label>
            <select
              id="invite-days"
              className="h-10 rounded-md border bg-card px-3 text-sm"
              value={days}
              onChange={(e) => setDays(Number(e.target.value))}
              disabled={!active}
            >
              {EXPIRY_DAYS.map((d) => (
                <option key={d} value={d}>
                  {d} days
                </option>
              ))}
            </select>
          </div>
          <Button
            disabled={!active || parsed.valid.length === 0 || send.isPending}
            onClick={() => send.mutate()}
            className="bg-gradient-brand text-primary-foreground"
          >
            {send.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Send className="mr-2 h-4 w-4" />
            )}
            Send invitations
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Each candidate can take the interview once. They sign in with the invited email to see it.
        </p>
      </section>

      {isLoading ? (
        <Skeleton className="h-40 w-full" />
      ) : rows.length === 0 ? (
        <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          No one has been invited yet.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Candidate</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Expires</TableHead>
                <TableHead>Email</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>
                    <div className="font-medium">{r.name ?? r.email}</div>
                    {r.name && <div className="text-xs text-muted-foreground">{r.email}</div>}
                    {!r.has_account && (
                      <div className="text-xs text-muted-foreground">No account yet</div>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant={statusVariant(r.status)}>{INVITE_STATUS_LABEL[r.status]}</Badge>
                    {r.decision && (
                      <Badge variant="outline" className="ml-1.5">
                        {DECISION_LABEL[r.decision]}
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                    {new Date(r.expires_at).toLocaleDateString()}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {r.email_status === "sent"
                      ? "Sent"
                      : r.email_status === "failed"
                        ? "Failed"
                        : "Not sent"}
                  </TableCell>
                  <TableCell className="text-right">
                    {r.status === "invited" && (
                      <div className="flex justify-end gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={resend.isPending}
                          onClick={() => resend.mutate(r.id)}
                          aria-label={`Send a reminder to ${r.email}`}
                        >
                          <Bell className="mr-1.5 h-4 w-4" /> Remind
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={revoke.isPending}
                          onClick={() => revoke.mutate(r.id)}
                          aria-label={`Withdraw the invitation for ${r.email}`}
                        >
                          <UserX className="mr-1.5 h-4 w-4" /> Withdraw
                        </Button>
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
