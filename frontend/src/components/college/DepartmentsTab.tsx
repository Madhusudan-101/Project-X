import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Award,
  Building2,
  MoreHorizontal,
  Pencil,
  Plus,
  ShieldCheck,
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
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { departmentsService } from "@/services/api/college";
import type { Department, DepartmentDetail, DepartmentInput } from "@/types/college";

export function DepartmentsTab() {
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [detailFor, setDetailFor] = useState<Department | null>(null);
  const [editTarget, setEditTarget] = useState<Department | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Department | null>(null);

  const fetchDepartments = () => {
    setLoading(true);
    setError(null);
    departmentsService
      .list()
      .then(setDepartments)
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : "Failed to load departments"),
      )
      .finally(() => setLoading(false));
  };

  useEffect(fetchDepartments, []);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="font-display text-2xl font-semibold md:text-3xl">Departments</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {loading
              ? "Loading departments…"
              : `${departments.length} department${departments.length === 1 ? "" : "s"}`}
          </p>
        </div>
        <DepartmentFormDialog mode="create" onSaved={fetchDepartments} />
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
        ) : departments.length === 0 ? (
          <div className="grid h-48 place-items-center p-6 text-center text-sm text-muted-foreground">
            No departments yet — add one to start tracking department-level stats.
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Department</TableHead>
                <TableHead>Code</TableHead>
                <TableHead>HOD</TableHead>
                <TableHead>Students</TableHead>
                <TableHead>Avg. employability</TableHead>
                <TableHead>Placement rate</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {departments.map((d) => (
                <TableRow key={d.id} className="cursor-pointer" onClick={() => setDetailFor(d)}>
                  <TableCell className="font-medium">{d.name}</TableCell>
                  <TableCell className="text-muted-foreground">{d.code || "—"}</TableCell>
                  <TableCell className="text-muted-foreground">{d.hodName || "—"}</TableCell>
                  <TableCell>{d.studentCount}</TableCell>
                  <TableCell>{d.avgEmployabilityScore.toFixed(1)}</TableCell>
                  <TableCell>
                    <PlacementBadge rate={d.placementRate} />
                  </TableCell>
                  <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon">
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onSelect={() => setEditTarget(d)}>
                          <Pencil className="mr-2 h-4 w-4" /> Edit
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onSelect={() => setDeleteTarget(d)}
                          className="text-destructive"
                        >
                          <Trash2 className="mr-2 h-4 w-4" /> Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      {editTarget && (
        <DepartmentFormDialog
          mode="edit"
          department={editTarget}
          open
          onOpenChange={(v) => !v && setEditTarget(null)}
          onSaved={() => {
            setEditTarget(null);
            fetchDepartments();
          }}
        />
      )}

      <DeleteDepartmentDialog
        department={deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onDeleted={fetchDepartments}
      />

      <DepartmentDetailDialog department={detailFor} onClose={() => setDetailFor(null)} />
    </div>
  );
}

function PlacementBadge({ rate }: { rate: number }) {
  const cls =
    rate >= 60
      ? "border-success/30 bg-success/10 text-success"
      : rate > 0
        ? "border-secondary/30 bg-secondary/10 text-secondary"
        : "border-border text-muted-foreground";
  return (
    <Badge variant="outline" className={cls}>
      {rate.toFixed(1)}%
    </Badge>
  );
}

function DepartmentFormDialog({
  mode,
  department,
  open: controlledOpen,
  onOpenChange,
  onSaved,
}: {
  mode: "create" | "edit";
  department?: Department;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  onSaved: () => void;
}) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = controlledOpen ?? uncontrolledOpen;
  const setOpen = onOpenChange ?? setUncontrolledOpen;

  const [name, setName] = useState(department?.name ?? "");
  const [code, setCode] = useState(department?.code ?? "");
  const [hodName, setHodName] = useState(department?.hodName ?? "");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!name.trim()) {
      toast.error("Department name is required");
      return;
    }
    setSubmitting(true);
    try {
      const payload: DepartmentInput = {
        name: name.trim(),
        code: code.trim() || undefined,
        hodName: hodName.trim() || undefined,
      };
      if (mode === "create") {
        await departmentsService.create(payload);
        toast.success("Department created");
        setName("");
        setCode("");
        setHodName("");
      } else if (department) {
        await departmentsService.update(department.id, payload);
        toast.success("Department updated");
      }
      setOpen(false);
      onSaved();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to save department");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {mode === "create" && (
        <DialogTrigger asChild>
          <Button className="bg-gradient-brand text-primary-foreground">
            <Plus className="mr-2 h-4 w-4" /> Add department
          </Button>
        </DialogTrigger>
      )}
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{mode === "create" ? "Add department" : "Edit department"}</DialogTitle>
          <DialogDescription>
            The code is matched against student branch values (e.g. "CSE") to compute live stats —
            it uses the same branch matching as Drives and Shortlist.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="dept-name">Department name</Label>
            <Input
              id="dept-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Computer Science"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="dept-code">Branch code</Label>
              <Input
                id="dept-code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="CSE"
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="dept-hod">Head of department</Label>
              <Input
                id="dept-hod"
                value={hodName}
                onChange={(e) => setHodName(e.target.value)}
                placeholder="Dr. Sharma"
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
            {submitting ? "Saving…" : mode === "create" ? "Add department" : "Save changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DeleteDepartmentDialog({
  department,
  onClose,
  onDeleted,
}: {
  department: Department | null;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [deleting, setDeleting] = useState(false);

  const handleDelete = async () => {
    if (!department) return;
    setDeleting(true);
    try {
      await departmentsService.remove(department.id);
      toast.success("Department deleted");
      onClose();
      onDeleted();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to delete department");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <AlertDialog open={!!department} onOpenChange={(v) => !v && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {department?.name}?</AlertDialogTitle>
          <AlertDialogDescription>
            This removes the department record. Students already in your roster are not affected —
            their branch field is untouched.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleDelete}
            disabled={deleting}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {deleting ? "Deleting…" : "Delete"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function DepartmentDetailDialog({
  department,
  onClose,
}: {
  department: Department | null;
  onClose: () => void;
}) {
  const [detail, setDetail] = useState<DepartmentDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!department) {
      setDetail(null);
      return;
    }
    setLoading(true);
    setError(null);
    departmentsService
      .get(department.id)
      .then(setDetail)
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : "Failed to load department"),
      )
      .finally(() => setLoading(false));
  }, [department]);

  return (
    <Dialog open={!!department} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Building2 className="h-5 w-5 text-primary" /> {department?.name}
          </DialogTitle>
          {department?.hodName && (
            <DialogDescription>Head of department: {department.hodName}</DialogDescription>
          )}
        </DialogHeader>

        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-9 w-full" />
            ))}
          </div>
        ) : error ? (
          <div className="text-sm text-destructive">{error}</div>
        ) : detail ? (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-3">
              <StatBlock icon={Users} label="Students" value={String(detail.studentCount)} />
              <StatBlock
                icon={Award}
                label="Avg. employability"
                value={detail.avgEmployabilityScore.toFixed(1)}
              />
              <StatBlock
                icon={ShieldCheck}
                label="Placement rate"
                value={`${detail.placementRate.toFixed(1)}%`}
              />
            </div>
            {detail.students.length > 0 ? (
              <div className="max-h-64 overflow-auto rounded-md border border-border">
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
                    {detail.students.map((s) => (
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
              <div className="grid h-24 place-items-center rounded-md border border-dashed border-border text-sm text-muted-foreground">
                No students match this department's code/name yet. Set the branch code to match your
                roster's branch values (e.g. "CSE").
              </div>
            )}
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function StatBlock({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Users;
  label: string;
  value: string;
}) {
  return (
    <Card className="p-3">
      <div className="grid h-8 w-8 place-items-center rounded-lg bg-primary/10 text-primary">
        <Icon className="h-4 w-4" />
      </div>
      <div className="mt-2 font-display text-lg font-semibold">{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </Card>
  );
}
