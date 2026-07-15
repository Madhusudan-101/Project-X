import { useEffect, useState } from "react";
import { toast } from "sonner";
import { CalendarCheck, MoreHorizontal, Pencil, Plus, Trash2, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PendingEndpointNotice } from "@/components/college/PendingEndpointNotice";
import { drivesService } from "@/services/api/college";
import type { Drive, DriveStatus, Student } from "@/types/college";

export function DrivesTab() {
  const [drives, setDrives] = useState<Drive[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [eligibleFor, setEligibleFor] = useState<Drive | null>(null);

  const fetchDrives = () => {
    setLoading(true);
    setError(null);
    drivesService
      .list()
      .then(setDrives)
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : "Failed to load drives"),
      )
      .finally(() => setLoading(false));
  };

  useEffect(fetchDrives, []);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="font-display text-2xl font-semibold md:text-3xl">Campus drives</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {loading
              ? "Loading drives…"
              : `${drives.length} drive${drives.length === 1 ? "" : "s"}`}
          </p>
        </div>
        <CreateDriveDialog onCreated={fetchDrives} />
      </div>

      {error && (
        <Card className="border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          {error}
        </Card>
      )}

      <Card className="overflow-hidden">
        {loading ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : drives.length === 0 ? (
          <div className="grid h-48 place-items-center p-6 text-center text-sm text-muted-foreground">
            No drives scheduled yet — create one to get started.
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Company</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Eligibility</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {drives.map((d) => (
                <TableRow key={d.id}>
                  <TableCell className="font-medium">{d.companyName}</TableCell>
                  <TableCell>{d.role}</TableCell>
                  <TableCell>{new Date(d.date).toLocaleDateString()}</TableCell>
                  <TableCell className="max-w-[220px]">
                    <EligibilitySummary eligibility={d.eligibility} />
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={d.status} />
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button variant="ghost" size="sm" onClick={() => setEligibleFor(d)}>
                        <Users className="mr-1.5 h-4 w-4" /> Eligible
                      </Button>
                      <RowActions />
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      <EligibleStudentsDialog drive={eligibleFor} onClose={() => setEligibleFor(null)} />
    </div>
  );
}

function EligibilitySummary({ eligibility }: { eligibility: Drive["eligibility"] }) {
  const branches = Array.isArray(eligibility.branch)
    ? eligibility.branch
    : eligibility.branch
      ? [eligibility.branch]
      : [];
  const parts: string[] = [];
  if (branches.length) parts.push(branches.join(", "));
  if (eligibility.graduationYear) parts.push(`Class of ${eligibility.graduationYear}`);
  if (eligibility.minimumScore) parts.push(`Score ≥ ${eligibility.minimumScore}`);
  if (parts.length === 0)
    return <span className="text-xs text-muted-foreground">No restrictions</span>;
  return <span className="text-xs text-muted-foreground">{parts.join(" · ")}</span>;
}

function StatusBadge({ status }: { status: DriveStatus }) {
  const cls =
    status === "Active"
      ? "border-success/30 bg-success/10 text-success"
      : status === "Closed"
        ? "border-border text-muted-foreground"
        : "border-secondary/30 bg-secondary/10 text-secondary";
  return (
    <Badge variant="outline" className={cls}>
      {status}
    </Badge>
  );
}

function RowActions() {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon">
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <PendingEndpointNotice reason="Editing a drive needs a PUT/PATCH /api/drives/{id} endpoint, which doesn't exist yet.">
          <DropdownMenuItem disabled onSelect={(e) => e.preventDefault()}>
            <Pencil className="mr-2 h-4 w-4" /> Edit
          </DropdownMenuItem>
        </PendingEndpointNotice>
        <PendingEndpointNotice reason="Deleting a drive needs a DELETE /api/drives/{id} endpoint, which doesn't exist yet.">
          <DropdownMenuItem
            disabled
            onSelect={(e) => e.preventDefault()}
            className="text-destructive"
          >
            <Trash2 className="mr-2 h-4 w-4" /> Delete
          </DropdownMenuItem>
        </PendingEndpointNotice>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function CreateDriveDialog({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [companyName, setCompanyName] = useState("");
  const [role, setRole] = useState("");
  const [date, setDate] = useState("");
  const [status, setStatus] = useState<DriveStatus>("Active");
  const [branch, setBranch] = useState("");
  const [graduationYear, setGraduationYear] = useState("");
  const [minimumScore, setMinimumScore] = useState("");

  const reset = () => {
    setCompanyName("");
    setRole("");
    setDate("");
    setStatus("Active");
    setBranch("");
    setGraduationYear("");
    setMinimumScore("");
  };

  const handleSubmit = async () => {
    if (!companyName || !role || !date) {
      toast.error("Company, role, and date are required");
      return;
    }
    setSubmitting(true);
    try {
      await drivesService.create({
        companyName,
        role,
        date,
        status,
        eligibility: {
          branch: branch
            ? branch
                .split(",")
                .map((b) => b.trim())
                .filter(Boolean)
            : undefined,
          graduationYear: graduationYear ? Number(graduationYear) : undefined,
          minimumScore: minimumScore ? Number(minimumScore) : undefined,
        },
      });
      toast.success("Campus drive created");
      setOpen(false);
      reset();
      onCreated();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to create drive");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="bg-gradient-brand text-primary-foreground">
          <CalendarCheck className="mr-2 h-4 w-4" /> Create drive
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create campus drive</DialogTitle>
          <DialogDescription>
            Set eligibility to automatically match students from your roster.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="drive-company">Company</Label>
              <Input
                id="drive-company"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                placeholder="Acme Corp"
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="drive-role">Role</Label>
              <Input
                id="drive-role"
                value={role}
                onChange={(e) => setRole(e.target.value)}
                placeholder="SDE-1"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="drive-date">Drive date</Label>
              <Input
                id="drive-date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label>Status</Label>
              <Select value={status} onValueChange={(v) => setStatus(v as DriveStatus)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Active">Active</SelectItem>
                  <SelectItem value="Draft">Draft</SelectItem>
                  <SelectItem value="Closed">Closed</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="drive-branch">Eligible branches (comma-separated, optional)</Label>
            <Input
              id="drive-branch"
              value={branch}
              onChange={(e) => setBranch(e.target.value)}
              placeholder="CSE, IT"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="drive-grad">Graduation year (optional)</Label>
              <Input
                id="drive-grad"
                type="number"
                value={graduationYear}
                onChange={(e) => setGraduationYear(e.target.value)}
                placeholder="2027"
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="drive-score">Minimum score (optional)</Label>
              <Input
                id="drive-score"
                type="number"
                value={minimumScore}
                onChange={(e) => setMinimumScore(e.target.value)}
                placeholder="70"
              />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button
            onClick={handleSubmit}
            disabled={submitting}
            className="bg-gradient-brand text-primary-foreground"
          >
            <Plus className="mr-2 h-4 w-4" /> {submitting ? "Creating…" : "Create drive"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EligibleStudentsDialog({ drive, onClose }: { drive: Drive | null; onClose: () => void }) {
  const [students, setStudents] = useState<Student[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!drive) {
      setStudents(null);
      return;
    }
    setLoading(true);
    setError(null);
    drivesService
      .eligibleStudents(drive.id)
      .then((res) => setStudents(res.eligibleStudents))
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : "Failed to load eligible students"),
      )
      .finally(() => setLoading(false));
  }, [drive]);

  return (
    <Dialog open={!!drive} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Eligible students — {drive?.companyName}</DialogTitle>
          <DialogDescription>{drive?.role}</DialogDescription>
        </DialogHeader>
        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-9 w-full" />
            ))}
          </div>
        ) : error ? (
          <div className="text-sm text-destructive">{error}</div>
        ) : students && students.length > 0 ? (
          <div className="max-h-96 overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Branch</TableHead>
                  <TableHead>Score</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {students.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell className="font-medium">{s.name}</TableCell>
                    <TableCell className="text-muted-foreground">{s.email}</TableCell>
                    <TableCell>{s.branch}</TableCell>
                    <TableCell>{Number(s.employability_score).toFixed(1)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : (
          <div className="grid h-32 place-items-center text-sm text-muted-foreground">
            No students currently match this drive's eligibility criteria.
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
