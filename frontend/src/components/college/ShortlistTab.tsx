import { useState } from "react";
import { toast } from "sonner";
import { Download, ListFilter } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
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
import { downloadCsvBlob, shortlistService } from "@/services/api/college";
import type { ShortlistFilters, Student, VerificationStatus } from "@/types/college";

export function ShortlistTab() {
  const [branch, setBranch] = useState("");
  const [graduationYear, setGraduationYear] = useState("");
  const [minimumScore, setMinimumScore] = useState("");
  const [verificationStatus, setVerificationStatus] = useState<VerificationStatus | "any">("any");

  const [results, setResults] = useState<Student[] | null>(null);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const currentFilters = (): ShortlistFilters => ({
    branch: branch || undefined,
    graduationYear: graduationYear ? Number(graduationYear) : undefined,
    minimumScore: minimumScore ? Number(minimumScore) : undefined,
    verificationStatus: verificationStatus === "any" ? undefined : verificationStatus,
  });

  const handleGenerate = () => {
    setLoading(true);
    setError(null);
    shortlistService
      .filter(currentFilters())
      .then((res) => {
        setResults(res.students);
        setTotal(res.total);
      })
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : "Failed to generate shortlist"),
      )
      .finally(() => setLoading(false));
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      const blob = await shortlistService.exportCsv(currentFilters());
      downloadCsvBlob(blob, "shortlisted_students.csv");
      toast.success("Shortlist CSV downloaded");
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Export failed");
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-semibold md:text-3xl">Shortlist</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Filter your roster and export a shortlist CSV for a recruiter or drive.
        </p>
      </div>

      <Card className="p-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <div className="grid gap-1.5">
            <Label htmlFor="sl-branch">Branch</Label>
            <Input
              id="sl-branch"
              value={branch}
              onChange={(e) => setBranch(e.target.value)}
              placeholder="CSE"
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="sl-grad">Graduation year</Label>
            <Input
              id="sl-grad"
              type="number"
              value={graduationYear}
              onChange={(e) => setGraduationYear(e.target.value)}
              placeholder="2027"
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="sl-score">Minimum score</Label>
            <Input
              id="sl-score"
              type="number"
              value={minimumScore}
              onChange={(e) => setMinimumScore(e.target.value)}
              placeholder="70"
            />
          </div>
          <div className="grid gap-1.5">
            <Label>Verification status</Label>
            <Select
              value={verificationStatus}
              onValueChange={(v) => setVerificationStatus(v as VerificationStatus | "any")}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="any">Any</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="verified">Verified</SelectItem>
                <SelectItem value="rejected">Rejected</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-end gap-2">
            <Button
              onClick={handleGenerate}
              disabled={loading}
              className="w-full bg-gradient-brand text-primary-foreground"
            >
              <ListFilter className="mr-2 h-4 w-4" /> {loading ? "Filtering…" : "Generate"}
            </Button>
          </div>
        </div>
      </Card>

      {error && (
        <Card className="border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          {error}
        </Card>
      )}

      {results !== null && (
        <Card className="overflow-hidden">
          <div className="flex items-center justify-between border-b border-border p-4">
            <div className="text-sm">
              <span className="font-medium">{total}</span>{" "}
              <span className="text-muted-foreground">student{total === 1 ? "" : "s"} match</span>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={handleExport}
              disabled={exporting || total === 0}
            >
              <Download className="mr-2 h-4 w-4" /> {exporting ? "Exporting…" : "Export CSV"}
            </Button>
          </div>
          {loading ? (
            <div className="space-y-2 p-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : results.length === 0 ? (
            <div className="grid h-32 place-items-center text-sm text-muted-foreground">
              No students match these filters.
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
                </TableRow>
              </TableHeader>
              <TableBody>
                {results.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell className="font-medium">{s.name}</TableCell>
                    <TableCell className="text-muted-foreground">{s.email}</TableCell>
                    <TableCell>{s.branch}</TableCell>
                    <TableCell>{s.graduation_year}</TableCell>
                    <TableCell>{Number(s.employability_score).toFixed(1)}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{s.verification_status}</Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Card>
      )}
    </div>
  );
}
