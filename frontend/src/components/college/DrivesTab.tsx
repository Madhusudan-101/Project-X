import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useListAnimation } from "@/hooks/use-list-animation";
import {
  ArrowUpDown,
  CalendarCheck,
  Loader2,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Trash2,
  Users,
} from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
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
import { drivesService } from "@/services/api/college/college";
import type { Drive, DriveStatus, Student } from "@/types/college/college";

type DriveSortField = "date" | "companyName" | "status";
type SortDir = "asc" | "desc";

function driveBranches(eligibility: Drive["eligibility"]): string[] {
  return Array.isArray(eligibility.branch)
    ? eligibility.branch
    : eligibility.branch
      ? [eligibility.branch]
      : [];
}

export function DrivesTab() {
  const [tableRef] = useListAnimation<HTMLTableSectionElement>();
  const [drives, setDrives] = useState<Drive[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [eligibleFor, setEligibleFor] = useState<Drive | null>(null);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<DriveStatus | "">("");
  const [branchFilter, setBranchFilter] = useState("");
  const [sortField, setSortField] = useState<DriveSortField>("date");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

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

  const filteredDrives = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const branchNeedle = branchFilter.trim().toLowerCase();
    let rows = drives;
    if (needle) {
      rows = rows.filter(
        (d) =>
          d.companyName.toLowerCase().includes(needle) || d.role.toLowerCase().includes(needle),
      );
    }
    if (statusFilter) {
      rows = rows.filter((d) => d.status === statusFilter);
    }
    if (branchNeedle) {
      rows = rows.filter((d) =>
        driveBranches(d.eligibility).some((b) => b.toLowerCase().includes(branchNeedle)),
      );
    }

    const dir = sortDir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      switch (sortField) {
        case "companyName":
          return a.companyName.localeCompare(b.companyName) * dir;
        case "status":
          return a.status.localeCompare(b.status) * dir;
        default:
          return (new Date(a.date).getTime() - new Date(b.date).getTime()) * dir;
      }
    });
  }, [drives, search, statusFilter, branchFilter, sortField, sortDir]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="font-display text-2xl font-semibold md:text-3xl">Campus drives</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {loading
              ? "Loading drives…"
              : `${filteredDrives.length} drive${filteredDrives.length === 1 ? "" : "s"}`}
          </p>
        </div>
        <CreateDriveDialog onCreated={fetchDrives} />
      </div>

      <Card className="p-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="relative sm:col-span-2 lg:col-span-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search company or role…"
              className="pl-9"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <Select
            value={statusFilter || "all"}
            onValueChange={(v) => setStatusFilter(v === "all" ? "" : (v as DriveStatus))}
          >
            <SelectTrigger>
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="Active">Active</SelectItem>
              <SelectItem value="Draft">Draft</SelectItem>
              <SelectItem value="Closed">Closed</SelectItem>
            </SelectContent>
          </Select>
          <Input
            placeholder="Eligible branch (e.g. CSE)"
            value={branchFilter}
            onChange={(e) => setBranchFilter(e.target.value)}
          />
          <div className="flex items-center gap-2">
            <Select value={sortField} onValueChange={(v) => setSortField(v as DriveSortField)}>
              <SelectTrigger>
                <SelectValue placeholder="Sort by" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="date">Sort: Date</SelectItem>
                <SelectItem value="companyName">Sort: Company name</SelectItem>
                <SelectItem value="status">Sort: Status</SelectItem>
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              size="icon"
              className="shrink-0"
              onClick={() => setSortDir((d) => (d === "asc" ? "desc" : "asc"))}
              aria-label={sortDir === "asc" ? "Sorting ascending" : "Sorting descending"}
              title={sortDir === "asc" ? "Ascending" : "Descending"}
            >
              <ArrowUpDown className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </Card>

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
        ) : filteredDrives.length === 0 ? (
          <div className="grid h-48 place-items-center p-6 text-center text-sm text-muted-foreground">
            {drives.length === 0
              ? "No drives scheduled yet — create one to get started."
              : "No drives match your filters."}
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
            <TableBody ref={tableRef}>
              {filteredDrives.map((d) => (
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
                        <Users className="mr-1.5 h-4 w-4" /> Details
                      </Button>
                      <RowActions drive={d} onChanged={fetchDrives} />
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

function RowActions({ drive, onChanged }: { drive: Drive; onChanged: () => void }) {
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon">
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            onSelect={(e) => {
              e.preventDefault();
              setEditOpen(true);
            }}
          >
            <Pencil className="mr-2 h-4 w-4" /> Edit
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={(e) => {
              e.preventDefault();
              setDeleteOpen(true);
            }}
            className="text-destructive"
          >
            <Trash2 className="mr-2 h-4 w-4" /> Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <EditDriveDialog
        drive={drive}
        open={editOpen}
        onOpenChange={setEditOpen}
        onUpdated={onChanged}
      />
      <DeleteDriveDialog
        drive={drive}
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        onDeleted={onChanged}
      />
    </>
  );
}

function DeleteDriveDialog({
  drive,
  open,
  onOpenChange,
  onDeleted,
}: {
  drive: Drive;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDeleted: () => void;
}) {
  const [deleting, setDeleting] = useState(false);

  const handleDelete = async () => {
    setDeleting(true);
    try {
      const result = await drivesService.remove(drive.id);
      toast.success(result.message);
      onOpenChange(false);
      onDeleted();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to delete drive";
      toast.error(message);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={(next) => !deleting && onOpenChange(next)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete this drive?</AlertDialogTitle>
          <AlertDialogDescription>
            {`"${drive.companyName} — ${drive.role}" will be permanently deleted. This action cannot be undone.`}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault();
              handleDelete();
            }}
            disabled={deleting}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {deleting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Deleting…
              </>
            ) : (
              "Delete drive"
            )}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function EditDriveDialog({
  drive,
  open,
  onOpenChange,
  onUpdated,
}: {
  drive: Drive;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUpdated: () => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [companyName, setCompanyName] = useState(drive.companyName);
  const [role, setRole] = useState(drive.role);
  const [date, setDate] = useState(drive.date);
  const [status, setStatus] = useState<DriveStatus>(drive.status);
  const [branch, setBranch] = useState(
    Array.isArray(drive.eligibility.branch)
      ? drive.eligibility.branch.join(", ")
      : (drive.eligibility.branch ?? ""),
  );
  const [graduationYear, setGraduationYear] = useState(
    drive.eligibility.graduationYear ? String(drive.eligibility.graduationYear) : "",
  );
  const [minimumScore, setMinimumScore] = useState(
    drive.eligibility.minimumScore ? String(drive.eligibility.minimumScore) : "",
  );

  // Re-sync the form to this row's current values each time the dialog opens
  // (guards against stale edits from a previously opened row).
  useEffect(() => {
    if (open) {
      setCompanyName(drive.companyName);
      setRole(drive.role);
      setDate(drive.date);
      setStatus(drive.status);
      setBranch(
        Array.isArray(drive.eligibility.branch)
          ? drive.eligibility.branch.join(", ")
          : (drive.eligibility.branch ?? ""),
      );
      setGraduationYear(
        drive.eligibility.graduationYear ? String(drive.eligibility.graduationYear) : "",
      );
      setMinimumScore(drive.eligibility.minimumScore ? String(drive.eligibility.minimumScore) : "");
    }
  }, [open, drive]);

  const handleSave = async () => {
    if (!companyName || !role || !date) {
      toast.error("Company, role, and date are required");
      return;
    }
    setSubmitting(true);
    try {
      await drivesService.update(drive.id, {
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
      toast.success("Campus drive updated");
      onOpenChange(false);
      onUpdated();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to update drive");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !submitting && onOpenChange(next)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit campus drive</DialogTitle>
          <DialogDescription>
            Update details or eligibility — students are re-matched automatically.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="edit-drive-company">Company</Label>
              <Input
                id="edit-drive-company"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                disabled={submitting}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="edit-drive-role">Role</Label>
              <Input
                id="edit-drive-role"
                value={role}
                onChange={(e) => setRole(e.target.value)}
                disabled={submitting}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="edit-drive-date">Drive date</Label>
              <Input
                id="edit-drive-date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                disabled={submitting}
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
            <Label htmlFor="edit-drive-branch">Eligible branches (comma-separated, optional)</Label>
            <Input
              id="edit-drive-branch"
              value={branch}
              onChange={(e) => setBranch(e.target.value)}
              disabled={submitting}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="edit-drive-grad">Graduation year (optional)</Label>
              <Input
                id="edit-drive-grad"
                type="number"
                value={graduationYear}
                onChange={(e) => setGraduationYear(e.target.value)}
                disabled={submitting}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="edit-drive-score">Minimum score (optional)</Label>
              <Input
                id="edit-drive-score"
                type="number"
                value={minimumScore}
                onChange={(e) => setMinimumScore(e.target.value)}
                disabled={submitting}
              />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button
            onClick={handleSave}
            disabled={submitting}
            className="bg-gradient-brand text-primary-foreground"
          >
            {submitting ? "Saving…" : "Save changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
                placeholder="Enter the company's name"
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="drive-role">Role</Label>
              <Input
                id="drive-role"
                value={role}
                onChange={(e) => setRole(e.target.value)}
                placeholder="e.g. SDE-1"
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
              placeholder="e.g. CSE, IT"
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
                placeholder="e.g. 2027"
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="drive-score">Minimum score (optional)</Label>
              <Input
                id="drive-score"
                type="number"
                value={minimumScore}
                onChange={(e) => setMinimumScore(e.target.value)}
                placeholder="e.g. 70"
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
  const [studentsTableRef] = useListAnimation<HTMLTableSectionElement>();
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
          <DialogTitle>{drive?.companyName}</DialogTitle>
          <DialogDescription>{drive?.role}</DialogDescription>
        </DialogHeader>
        {drive && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-md border border-border bg-surface/60 p-3 text-sm">
            <span className="text-muted-foreground">
              Date: <span className="font-medium text-foreground">{new Date(drive.date).toLocaleDateString()}</span>
            </span>
            <span className="text-muted-foreground">
              Status: <StatusBadge status={drive.status} />
            </span>
            <span className="text-muted-foreground">
              Eligibility: <EligibilitySummary eligibility={drive.eligibility} />
            </span>
          </div>
        )}
        <h3 className="text-sm font-medium">Eligible students</h3>
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
              <TableBody ref={studentsTableRef}>
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
