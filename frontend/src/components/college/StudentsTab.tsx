import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { toast } from "sonner";
import { useListAnimation } from "@/hooks/use-list-animation";
import {
  ArrowUpDown,
  Download,
  Loader2,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Trash2,
  Upload,
  UserRoundPlus,
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
import { Checkbox } from "@/components/ui/checkbox";
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
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { CsvUploadError, downloadCsvBlob, studentsService } from "@/services/api/college/college";
import type { CsvUploadInvalidRow, PlacementStatus, Student } from "@/types/college/college";

const PAGE_SIZE = 10;

type SortField = "name" | "branch" | "employability_score" | "placement_status";
type SortDir = "asc" | "desc";

const PLACEMENT_LABELS: Record<PlacementStatus, string> = {
  not_placed: "Not placed",
  placed: "Placed",
  offer_declined: "Offer declined",
};

// Mirrors the backend's StudentIn/StudentUpdateIn graduationYear bounds
// (schemas.py) — kept in sync manually since there's no shared config.
const MIN_GRADUATION_YEAR = 1950;
const MAX_GRADUATION_YEAR = new Date().getFullYear() + 10;
const GRADUATION_YEAR_HINT = `Must be between ${MIN_GRADUATION_YEAR} and ${MAX_GRADUATION_YEAR}`;

function isValidGraduationYear(value: string): boolean {
  if (value === "") return false;
  const n = Number(value);
  return Number.isInteger(n) && n >= MIN_GRADUATION_YEAR && n <= MAX_GRADUATION_YEAR;
}

export function StudentsTab() {
  const [tableRef] = useListAnimation<HTMLTableSectionElement>();
  const [students, setStudents] = useState<Student[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Real backend filters (query params supported by GET /api/students/)
  const [branch, setBranch] = useState("");
  const [graduationYear, setGraduationYear] = useState("");
  const [minimumScore, setMinimumScore] = useState("");

  // Client-side only — the backend has no `search`, placement-status, or sort param
  const [search, setSearch] = useState("");
  const [placementFilter, setPlacementFilter] = useState<PlacementStatus | "">("");
  const [sortField, setSortField] = useState<SortField>("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [page, setPage] = useState(1);
  const [exporting, setExporting] = useState(false);
  const [detailFor, setDetailFor] = useState<Student | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkTarget, setBulkTarget] = useState<PlacementStatus | null>(null);
  const [bulkUpdating, setBulkUpdating] = useState(false);

  const fetchStudents = () => {
    setLoading(true);
    setError(null);
    studentsService
      .list({
        branch: branch || undefined,
        graduationYear: graduationYear ? Number(graduationYear) : undefined,
        minimumScore: minimumScore ? Number(minimumScore) : undefined,
      })
      .then((rows) => setStudents(rows))
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : "Failed to load students"),
      )
      .finally(() => setLoading(false));
  };

  useEffect(fetchStudents, [branch, graduationYear, minimumScore]);

  useEffect(() => {
    setPage(1);
    // The visible result set just changed — clear selection so a bulk
    // action can never silently apply to rows that are no longer shown.
    setSelectedIds(new Set());
  }, [search, branch, graduationYear, minimumScore, placementFilter]);

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectPage = (rows: Student[]) => {
    setSelectedIds((prev) => {
      const allSelected = rows.length > 0 && rows.every((s) => prev.has(s.id));
      const next = new Set(prev);
      for (const s of rows) {
        if (allSelected) next.delete(s.id);
        else next.add(s.id);
      }
      return next;
    });
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      const blob = await studentsService.exportCsv({
        branch: branch || undefined,
        graduationYear: graduationYear ? Number(graduationYear) : undefined,
        minimumScore: minimumScore ? Number(minimumScore) : undefined,
        placementStatus: placementFilter || undefined,
      });
      downloadCsvBlob(blob, "students.csv");
      const filtersActive = Boolean(branch || graduationYear || minimumScore || placementFilter);
      toast.success(filtersActive ? "Filtered roster CSV downloaded" : "Roster CSV downloaded");
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to export students";
      toast.error(message);
    } finally {
      setExporting(false);
    }
  };

  const handleBulkApply = async () => {
    if (!bulkTarget || selectedIds.size === 0) return;
    setBulkUpdating(true);
    try {
      const result = await studentsService.bulkUpdatePlacementStatus(
        Array.from(selectedIds),
        bulkTarget,
      );
      toast.success(result.message);
      setBulkTarget(null);
      setSelectedIds(new Set());
      fetchStudents();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to update placement status";
      toast.error(message);
    } finally {
      setBulkUpdating(false);
    }
  };

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    let rows = students;
    if (needle) {
      rows = rows.filter(
        (s) =>
          s.name.toLowerCase().includes(needle) ||
          s.email.toLowerCase().includes(needle) ||
          s.branch.toLowerCase().includes(needle),
      );
    }
    if (placementFilter) {
      rows = rows.filter((s) => s.placement_status === placementFilter);
    }

    const dir = sortDir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      switch (sortField) {
        case "employability_score":
          return (a.employability_score - b.employability_score) * dir;
        case "placement_status":
          return a.placement_status.localeCompare(b.placement_status) * dir;
        case "branch":
          return a.branch.localeCompare(b.branch) * dir;
        default:
          return a.name.localeCompare(b.name) * dir;
      }
    });
  }, [students, search, placementFilter, sortField, sortDir]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageStart = filtered.length === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const pageEnd = Math.min(page * PAGE_SIZE, filtered.length);
  const pageRows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="font-display text-2xl font-semibold md:text-3xl">Students</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {loading
              ? "Loading roster…"
              : `${filtered.length} student${filtered.length === 1 ? "" : "s"}`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <UploadCsvDialog onUploaded={fetchStudents} />
          <AddStudentDialog onAdded={fetchStudents} />
          <Button
            variant="outline"
            onClick={handleExport}
            disabled={exporting || (!loading && students.length === 0)}
            title="Exports the branch, graduation year, minimum score, and placement status filters below. The name/email/branch search box isn't applied to exports."
          >
            <Download className="mr-2 h-4 w-4" /> {exporting ? "Exporting…" : "Export CSV"}
          </Button>
        </div>
      </div>

      <Card className="p-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="relative sm:col-span-2 lg:col-span-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search name, email, or branch…"
              className="pl-9"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <Input
            placeholder="Branch (e.g. CSE)"
            value={branch}
            onChange={(e) => setBranch(e.target.value)}
          />
          <Input
            placeholder="Graduation year"
            type="number"
            value={graduationYear}
            onChange={(e) => setGraduationYear(e.target.value)}
          />
          <Input
            placeholder="Minimum score"
            type="number"
            value={minimumScore}
            onChange={(e) => setMinimumScore(e.target.value)}
          />
          <Select
            value={placementFilter || "all"}
            onValueChange={(v) => setPlacementFilter(v === "all" ? "" : (v as PlacementStatus))}
          >
            <SelectTrigger>
              <SelectValue placeholder="Placement status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All placement statuses</SelectItem>
              <SelectItem value="not_placed">Not placed</SelectItem>
              <SelectItem value="placed">Placed</SelectItem>
              <SelectItem value="offer_declined">Offer declined</SelectItem>
            </SelectContent>
          </Select>
          <div className="flex items-center gap-2">
            <Select value={sortField} onValueChange={(v) => setSortField(v as SortField)}>
              <SelectTrigger>
                <SelectValue placeholder="Sort by" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="name">Sort: Name</SelectItem>
                <SelectItem value="branch">Sort: Branch</SelectItem>
                <SelectItem value="employability_score">Sort: Employability score</SelectItem>
                <SelectItem value="placement_status">Sort: Placement status</SelectItem>
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

      {selectedIds.size > 0 && (
        <Card className="flex flex-wrap items-center gap-3 border-primary/30 bg-primary/5 p-3">
          <span className="text-sm font-medium">
            {selectedIds.size} student{selectedIds.size === 1 ? "" : "s"} selected
          </span>
          <Select
            value=""
            onValueChange={(v) => setBulkTarget(v as PlacementStatus)}
          >
            <SelectTrigger className="w-56">
              <SelectValue placeholder="Set placement status to…" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="not_placed">Not placed</SelectItem>
              <SelectItem value="placed">Placed</SelectItem>
              <SelectItem value="offer_declined">Offer declined</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="ghost" size="sm" onClick={() => setSelectedIds(new Set())}>
            Clear selection
          </Button>
        </Card>
      )}

      {error && (
        <Card className="border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          {error}
        </Card>
      )}

      <Card className="overflow-hidden">
        {loading ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : pageRows.length === 0 ? (
          <div className="grid h-48 place-items-center p-6 text-center text-sm text-muted-foreground">
            {students.length === 0
              ? "No students yet — upload a CSV to build the roster."
              : "No students match your filters."}
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">
                  <Checkbox
                    checked={pageRows.length > 0 && pageRows.every((s) => selectedIds.has(s.id))}
                    onCheckedChange={() => toggleSelectPage(pageRows)}
                    aria-label="Select all students on this page"
                  />
                </TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Branch</TableHead>
                <TableHead>Grad. year</TableHead>
                <TableHead>Employability</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Placement</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody ref={tableRef}>
              {pageRows.map((s) => (
                <TableRow
                  key={s.id}
                  className="cursor-pointer"
                  onClick={() => setDetailFor(s)}
                >
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <Checkbox
                      checked={selectedIds.has(s.id)}
                      onCheckedChange={() => toggleSelect(s.id)}
                      aria-label={`Select ${s.name}`}
                    />
                  </TableCell>
                  <TableCell className="font-medium">{s.name}</TableCell>
                  <TableCell className="text-muted-foreground">{s.email}</TableCell>
                  <TableCell>{s.branch}</TableCell>
                  <TableCell>{s.graduation_year}</TableCell>
                  <TableCell>{Number(s.employability_score).toFixed(1)}</TableCell>
                  <TableCell>
                    <VerificationBadge status={s.verification_status} />
                  </TableCell>
                  <TableCell>
                    <PlacementBadge status={s.placement_status} />
                  </TableCell>
                  <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                    <RowActions student={s} onChanged={fetchStudents} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      {!loading && filtered.length > 0 && (
        <p className="text-center text-xs text-muted-foreground">
          Showing {pageStart}–{pageEnd} of {filtered.length} student
          {filtered.length === 1 ? "" : "s"}
        </p>
      )}

      {totalPages > 1 && (
        <Pagination>
          <PaginationContent>
            <PaginationItem>
              <PaginationPrevious
                onClick={(e) => {
                  e.preventDefault();
                  setPage((p) => Math.max(1, p - 1));
                }}
                className={page === 1 ? "pointer-events-none opacity-50" : "cursor-pointer"}
              />
            </PaginationItem>
            {Array.from({ length: totalPages }).map((_, i) => (
              <PaginationItem key={i}>
                <PaginationLink
                  isActive={page === i + 1}
                  className="cursor-pointer"
                  onClick={(e) => {
                    e.preventDefault();
                    setPage(i + 1);
                  }}
                >
                  {i + 1}
                </PaginationLink>
              </PaginationItem>
            ))}
            <PaginationItem>
              <PaginationNext
                onClick={(e) => {
                  e.preventDefault();
                  setPage((p) => Math.min(totalPages, p + 1));
                }}
                className={
                  page === totalPages ? "pointer-events-none opacity-50" : "cursor-pointer"
                }
              />
            </PaginationItem>
          </PaginationContent>
        </Pagination>
      )}

      <StudentDetailDialog student={detailFor} onClose={() => setDetailFor(null)} />

      <AlertDialog open={!!bulkTarget} onOpenChange={(v) => !bulkUpdating && !v && setBulkTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Update placement status?</AlertDialogTitle>
            <AlertDialogDescription>
              {bulkTarget &&
                `${selectedIds.size} student${selectedIds.size === 1 ? "" : "s"} will be marked "${PLACEMENT_LABELS[bulkTarget]}". This can be changed again later.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={bulkUpdating}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                handleBulkApply();
              }}
              disabled={bulkUpdating}
              className="bg-gradient-brand text-primary-foreground"
            >
              {bulkUpdating ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Updating…
                </>
              ) : (
                "Confirm"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function VerificationBadge({ status }: { status: Student["verification_status"] }) {
  const cls =
    status === "verified"
      ? "border-success/30 bg-success/10 text-success"
      : status === "rejected"
        ? "border-destructive/30 bg-destructive/10 text-destructive"
        : "border-border text-muted-foreground";
  return (
    <Badge variant="outline" className={cls}>
      {status}
    </Badge>
  );
}

function PlacementBadge({ status }: { status: PlacementStatus }) {
  const cls =
    status === "placed"
      ? "border-success/30 bg-success/10 text-success"
      : status === "offer_declined"
        ? "border-destructive/30 bg-destructive/10 text-destructive"
        : "border-border text-muted-foreground";
  return (
    <Badge variant="outline" className={cls}>
      {PLACEMENT_LABELS[status]}
    </Badge>
  );
}

function StudentDetailDialog({
  student,
  onClose,
}: {
  student: Student | null;
  onClose: () => void;
}) {
  return (
    <Dialog open={!!student} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{student?.name}</DialogTitle>
          <DialogDescription>{student?.email}</DialogDescription>
        </DialogHeader>
        {student && (
          <div className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
            <DetailField label="Branch" value={student.branch} />
            <DetailField label="Graduation year" value={String(student.graduation_year)} />
            <DetailField
              label="Verification status"
              value={<VerificationBadge status={student.verification_status} />}
            />
            <DetailField
              label="Placement status"
              value={<PlacementBadge status={student.placement_status} />}
            />
            <DetailField
              label="Employability score"
              value={Number(student.employability_score).toFixed(1)}
            />
            <DetailField label="Resume score" value={Number(student.resume_score).toFixed(1)} />
            <DetailField label="GitHub score" value={Number(student.github_score).toFixed(1)} />
            <DetailField label="LeetCode score" value={Number(student.leetcode_score).toFixed(1)} />
            <DetailField
              label="Interview score"
              value={Number(student.interview_score).toFixed(1)}
            />
            <DetailField
              label="Assessment score"
              value={Number(student.assessment_score).toFixed(1)}
            />
            {student.created_at && (
              <DetailField
                label="Added on"
                value={new Date(student.created_at).toLocaleDateString()}
              />
            )}
            {student.updated_at && (
              <DetailField
                label="Last updated"
                value={new Date(student.updated_at).toLocaleDateString()}
              />
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function DetailField({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-0.5 font-medium">{value}</div>
    </div>
  );
}

function RowActions({ student, onChanged }: { student: Student; onChanged: () => void }) {
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
      <EditStudentDialog
        student={student}
        open={editOpen}
        onOpenChange={setEditOpen}
        onUpdated={onChanged}
      />
      <DeleteStudentDialog
        student={student}
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        onDeleted={onChanged}
      />
    </>
  );
}

function DeleteStudentDialog({
  student,
  open,
  onOpenChange,
  onDeleted,
}: {
  student: Student;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDeleted: () => void;
}) {
  const [deleting, setDeleting] = useState(false);

  const handleDelete = async () => {
    setDeleting(true);
    try {
      const result = await studentsService.remove(student.id);
      toast.success(result.message);
      onOpenChange(false);
      onDeleted();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to delete student";
      toast.error(message);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={(next) => !deleting && onOpenChange(next)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete this student?</AlertDialogTitle>
          <AlertDialogDescription>
            {`"${student.name}" will be permanently removed from the roster. This action cannot be undone.`}
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
              "Delete student"
            )}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function EditStudentDialog({
  student,
  open,
  onOpenChange,
  onUpdated,
}: {
  student: Student;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUpdated: () => void;
}) {
  const [name, setName] = useState(student.name);
  const [email, setEmail] = useState(student.email);
  const [branch, setBranch] = useState(student.branch);
  const [graduationYear, setGraduationYear] = useState(String(student.graduation_year));
  const [placementStatus, setPlacementStatus] = useState<PlacementStatus>(student.placement_status);
  const [submitting, setSubmitting] = useState(false);
  const [confirmPlacementChange, setConfirmPlacementChange] = useState(false);

  // Re-sync the form to this row's current values each time the dialog opens
  // (guards against stale edits from a previously opened row).
  useEffect(() => {
    if (open) {
      setName(student.name);
      setEmail(student.email);
      setBranch(student.branch);
      setGraduationYear(String(student.graduation_year));
      setPlacementStatus(student.placement_status);
    }
  }, [open, student]);

  const isValid =
    name.trim() !== "" &&
    EMAIL_RE.test(email.trim()) &&
    branch.trim() !== "" &&
    isValidGraduationYear(graduationYear);

  const doSave = async () => {
    setSubmitting(true);
    try {
      const result = await studentsService.update(student.id, {
        name: name.trim(),
        email: email.trim(),
        branch: branch.trim(),
        graduationYear: Number(graduationYear),
        placementStatus,
      });
      toast.success(result.message);
      setConfirmPlacementChange(false);
      onOpenChange(false);
      onUpdated();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to update student";
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleSaveClick = () => {
    if (!isValid) return;
    if (placementStatus !== student.placement_status) {
      setConfirmPlacementChange(true);
      return;
    }
    doSave();
  };

  return (
    <>
      <Dialog open={open} onOpenChange={(next) => !submitting && onOpenChange(next)}>
        <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit student</DialogTitle>
          <DialogDescription>Update this student's roster details.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="edit-name">Full name</Label>
            <Input
              id="edit-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={submitting}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="edit-email">Email</Label>
            <Input
              id="edit-email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={submitting}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="edit-branch">Branch</Label>
              <Input
                id="edit-branch"
                value={branch}
                onChange={(e) => setBranch(e.target.value)}
                disabled={submitting}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="edit-grad">Graduation year</Label>
              <Input
                id="edit-grad"
                type="number"
                value={graduationYear}
                onChange={(e) => setGraduationYear(e.target.value)}
                disabled={submitting}
              />
              <p
                className={`text-xs ${graduationYear !== "" && !isValidGraduationYear(graduationYear) ? "text-destructive" : "text-muted-foreground"}`}
              >
                {GRADUATION_YEAR_HINT}
              </p>
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label>Placement status</Label>
            <Select
              value={placementStatus}
              onValueChange={(v) => setPlacementStatus(v as PlacementStatus)}
            >
              <SelectTrigger disabled={submitting}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="not_placed">Not placed</SelectItem>
                <SelectItem value="placed">Placed</SelectItem>
                <SelectItem value="offer_declined">Offer declined</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button
            onClick={handleSaveClick}
            disabled={!isValid || submitting}
            className="bg-gradient-brand text-primary-foreground"
          >
            {submitting ? "Saving…" : "Save changes"}
          </Button>
        </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={confirmPlacementChange}
        onOpenChange={(v) => !submitting && setConfirmPlacementChange(v)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Change placement status?</AlertDialogTitle>
            <AlertDialogDescription>
              {`${student.name}'s placement status will change from "${PLACEMENT_LABELS[student.placement_status]}" to "${PLACEMENT_LABELS[placementStatus]}".`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={submitting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                doSave();
              }}
              disabled={submitting}
              className="bg-gradient-brand text-primary-foreground"
            >
              {submitting ? "Saving…" : "Confirm"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function AddStudentDialog({ onAdded }: { onAdded: () => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [branch, setBranch] = useState("");
  const [graduationYear, setGraduationYear] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const isValid =
    name.trim() !== "" &&
    EMAIL_RE.test(email.trim()) &&
    branch.trim() !== "" &&
    isValidGraduationYear(graduationYear);

  const resetForm = () => {
    setName("");
    setEmail("");
    setBranch("");
    setGraduationYear("");
  };

  const handleAdd = async () => {
    if (!isValid) return;
    setSubmitting(true);
    try {
      const result = await studentsService.create({
        name: name.trim(),
        email: email.trim(),
        branch: branch.trim(),
        graduationYear: Number(graduationYear),
      });
      toast.success(result.message);
      setOpen(false);
      resetForm();
      onAdded();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to add student";
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <UserRoundPlus className="mr-2 h-4 w-4" /> Add student
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add student</DialogTitle>
          <DialogDescription>Add a single student to the roster.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="add-name">Full name</Label>
            <Input
              id="add-name"
              placeholder="e.g. Jane Doe"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={submitting}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="add-email">Email</Label>
            <Input
              id="add-email"
              placeholder="jane@college.edu"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={submitting}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="add-branch">Branch</Label>
              <Input
                id="add-branch"
                placeholder="e.g. CSE"
                value={branch}
                onChange={(e) => setBranch(e.target.value)}
                disabled={submitting}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="add-grad">Graduation year</Label>
              <Input
                id="add-grad"
                type="number"
                placeholder="e.g. 2027"
                value={graduationYear}
                onChange={(e) => setGraduationYear(e.target.value)}
                disabled={submitting}
              />
              <p
                className={`text-xs ${graduationYear !== "" && !isValidGraduationYear(graduationYear) ? "text-destructive" : "text-muted-foreground"}`}
              >
                {GRADUATION_YEAR_HINT}
              </p>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button
            onClick={handleAdd}
            disabled={!isValid || submitting}
            className="bg-gradient-brand text-primary-foreground"
          >
            <Plus className="mr-2 h-4 w-4" /> {submitting ? "Adding…" : "Add student"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function UploadCsvDialog({ onUploaded }: { onUploaded: () => void }) {
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [invalidRows, setInvalidRows] = useState<CsvUploadInvalidRow[] | null>(null);

  const handleUpload = async () => {
    if (!file) return;
    setUploading(true);
    setInvalidRows(null);
    try {
      const result = await studentsService.uploadCsv(file);
      toast.success(result.message, {
        description: `${result.addedStudents} student${result.addedStudents === 1 ? "" : "s"} added/updated.`,
      });
      setOpen(false);
      setFile(null);
      onUploaded();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "CSV upload failed";
      toast.error(message);
      if (err instanceof CsvUploadError && err.invalidRows) {
        setInvalidRows(err.invalidRows);
      }
    } finally {
      setUploading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <Upload className="mr-2 h-4 w-4" /> Upload CSV
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Upload student roster</DialogTitle>
          <DialogDescription>
            CSV must include name, email, branch, graduationYear columns (optional score columns and
            verificationStatus). Existing students are matched and updated by email.
          </DialogDescription>
        </DialogHeader>
        <Input type="file" accept=".csv" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        {invalidRows && invalidRows.length > 0 && (
          <div className="max-h-40 overflow-auto rounded-md border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
            <div className="mb-1 font-medium">Some rows were rejected:</div>
            {invalidRows.map((r) => (
              <div key={r.line}>
                Line {r.line}: missing {r.missing.join(", ")}
              </div>
            ))}
          </div>
        )}
        <DialogFooter>
          <Button
            onClick={handleUpload}
            disabled={!file || uploading}
            className="bg-gradient-brand text-primary-foreground"
          >
            {uploading ? "Uploading…" : "Upload"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
