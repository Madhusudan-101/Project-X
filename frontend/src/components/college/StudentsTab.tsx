import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Download,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Trash2,
  Upload,
  UserRoundPlus,
} from "lucide-react";
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
import { PendingEndpointNotice } from "@/components/college/PendingEndpointNotice";
import { CsvUploadError, studentsService } from "@/services/api/college";
import type { CsvUploadInvalidRow, Student } from "@/types/college";

const PAGE_SIZE = 10;

export function StudentsTab() {
  const [students, setStudents] = useState<Student[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Real backend filters (query params supported by GET /api/students/)
  const [branch, setBranch] = useState("");
  const [graduationYear, setGraduationYear] = useState("");
  const [minimumScore, setMinimumScore] = useState("");

  // Client-side only — the backend has no `search` param
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

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

  useEffect(() => setPage(1), [search, branch, graduationYear, minimumScore]);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return students;
    return students.filter(
      (s) => s.name.toLowerCase().includes(needle) || s.email.toLowerCase().includes(needle),
    );
  }, [students, search]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
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
          <AddStudentDialog />
          <PendingEndpointNotice reason="Exporting the full roster needs a GET /api/students/export endpoint, which doesn't exist yet. Use the Shortlist tab to export a filtered CSV instead.">
            <Button variant="outline" disabled>
              <Download className="mr-2 h-4 w-4" /> Export CSV
            </Button>
          </PendingEndpointNotice>
        </div>
      </div>

      <Card className="p-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="relative sm:col-span-2 lg:col-span-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search name or email…"
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
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Branch</TableHead>
                <TableHead>Grad. year</TableHead>
                <TableHead>Employability</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pageRows.map((s) => (
                <TableRow key={s.id}>
                  <TableCell className="font-medium">{s.name}</TableCell>
                  <TableCell className="text-muted-foreground">{s.email}</TableCell>
                  <TableCell>{s.branch}</TableCell>
                  <TableCell>{s.graduation_year}</TableCell>
                  <TableCell>{Number(s.employability_score).toFixed(1)}</TableCell>
                  <TableCell>
                    <VerificationBadge status={s.verification_status} />
                  </TableCell>
                  <TableCell className="text-right">
                    <RowActions />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

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

function RowActions() {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon">
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <PendingEndpointNotice reason="Editing a student needs a PUT/PATCH /api/students/{id} endpoint, which doesn't exist yet.">
          <DropdownMenuItem disabled onSelect={(e) => e.preventDefault()}>
            <Pencil className="mr-2 h-4 w-4" /> Edit
          </DropdownMenuItem>
        </PendingEndpointNotice>
        <PendingEndpointNotice reason="Deleting a student needs a DELETE /api/students/{id} endpoint, which doesn't exist yet.">
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

function AddStudentDialog() {
  const [open, setOpen] = useState(false);
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
          <DialogDescription>
            Adding a single student needs a POST /api/students/ endpoint, which doesn't exist on the
            backend yet. The form below is ready to wire up as soon as it ships.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="add-name">Full name</Label>
            <Input id="add-name" placeholder="Jane Doe" disabled />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="add-email">Email</Label>
            <Input id="add-email" placeholder="jane@college.edu" disabled />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="add-branch">Branch</Label>
              <Input id="add-branch" placeholder="CSE" disabled />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="add-grad">Graduation year</Label>
              <Input id="add-grad" type="number" placeholder="2027" disabled />
            </div>
          </div>
        </div>
        <DialogFooter>
          <PendingEndpointNotice reason="POST /api/students/ doesn't exist on the backend yet.">
            <Button disabled className="bg-gradient-brand text-primary-foreground">
              <Plus className="mr-2 h-4 w-4" /> Add student
            </Button>
          </PendingEndpointNotice>
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
