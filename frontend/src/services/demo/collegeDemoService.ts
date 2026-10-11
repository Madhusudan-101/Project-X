/**
 * Demo implementations of the College Portal services (services/api/college/college.ts).
 *
 * Same method names, parameters and return shapes as the live services, backed by the
 * visitor's sessionStorage copy of the fictional Northstar dataset. Nothing here imports
 * the HTTP `request()` helper or reads the auth store, so a demo call has no way to reach
 * the API or to carry a real session token.
 *
 * college.ts routes calls here only while the URL is under /demo/college.
 */

import { ApiClientError } from "../api/client";
import * as engine from "@/lib/demo/college/engine";
import type { DemoState } from "@/lib/demo/college/seed";
import { useCollegeDemoStore } from "@/store/demo/collegeDemo";
import type {
  CsvUploadResult,
  DashboardStats,
  Department,
  DepartmentDetail,
  DepartmentInput,
  Drive,
  DriveCreateInput,
  DriveEligibleResponse,
  PlacementStatus,
  ScoreDistribution,
  ShortlistFilters,
  ShortlistResult,
  Student,
  StudentActionResult,
  StudentBlockInput,
  StudentCreateInput,
  StudentListFilters,
  StudentOnboardResult,
} from "@/types/college/college";

// A short pause so loading states behave as they would against a real server.
const LATENCY_MS = 180;
const pause = () => new Promise<void>((resolve) => setTimeout(resolve, LATENCY_MS));

const read = () => useCollegeDemoStore.getState().data;
const mutate = <T>(fn: (draft: DemoState) => T) => useCollegeDemoStore.getState().mutate(fn);

/** Wait, run, and surface engine validation failures as the same error type the live client throws. */
async function run<T>(fn: () => T): Promise<T> {
  await pause();
  try {
    return fn();
  } catch (err) {
    // DemoCsvError keeps its row details; college.ts converts it to the live CsvUploadError.
    if (err instanceof engine.DemoCsvError) throw err;
    if (err instanceof engine.DemoApiError) throw new ApiClientError(err.message, err.status);
    throw err;
  }
}

const csvBlob = (csv: string) => new Blob([csv], { type: "text/csv;charset=utf-8" });

export const demoDashboardService = {
  stats: (): Promise<DashboardStats> => run(() => engine.dashboardStats(read())),
  scoreDistribution: (): Promise<ScoreDistribution> => run(() => engine.scoreDistribution(read())),
};

export const demoStudentsService = {
  list: (filters: StudentListFilters = {}): Promise<Student[]> =>
    run(() => engine.listStudents(read(), filters)),
  create: (payload: StudentCreateInput) =>
    run(() => mutate((d) => engine.createStudent(d, payload))),
  get: (studentId: string): Promise<Student> => run(() => engine.getStudent(read(), studentId)),
  update: (
    studentId: string,
    payload: Partial<StudentCreateInput> & { placementStatus?: PlacementStatus },
  ) => run(() => mutate((d) => engine.updateStudent(d, studentId, payload))),
  bulkUpdatePlacementStatus: (studentIds: string[], placementStatus: PlacementStatus) =>
    run(() => mutate((d) => engine.bulkUpdatePlacement(d, studentIds, placementStatus))),
  remove: (studentId: string) => run(() => mutate((d) => engine.removeStudent(d, studentId))),

  uploadCsv: async (file: File): Promise<CsvUploadResult> => {
    if (file.size > engine.MAX_DEMO_CSV_BYTES) {
      await pause();
      throw new ApiClientError("CSV too large for the demo (max 1 MB)", 413);
    }
    const text = await file.text();
    return run(() => mutate((d) => engine.uploadStudentsCsv(d, text)));
  },

  exportCsv: (
    filters: StudentListFilters & { placementStatus?: PlacementStatus } = {},
  ): Promise<Blob> => run(() => csvBlob(engine.exportStudentsCsv(read(), filters))),

  block: (studentId: string, payload: StudentBlockInput): Promise<StudentActionResult> =>
    run(() => mutate((d) => engine.blockStudent(d, studentId, payload))),
  restrict: (studentId: string, reason: string): Promise<StudentActionResult> =>
    run(() => mutate((d) => engine.restrictStudent(d, studentId, reason))),
  unblock: (studentId: string, _reason?: string): Promise<StudentActionResult> =>
    run(() => mutate((d) => engine.unblockStudent(d, studentId))),

  // No mail path exists in Demo Mode; this is a deliberate, clearly-labelled no-op.
  onboard: (studentIds?: string[]): Promise<StudentOnboardResult> =>
    run(() => engine.onboardStudents(read(), studentIds)),
};

export const demoDrivesService = {
  list: (): Promise<Drive[]> => run(() => engine.listDrives(read())),
  create: (payload: DriveCreateInput) => run(() => mutate((d) => engine.createDrive(d, payload))),
  update: (driveId: string, payload: Partial<DriveCreateInput>) =>
    run(() => mutate((d) => engine.updateDrive(d, driveId, payload))),
  remove: (driveId: string) => run(() => mutate((d) => engine.removeDrive(d, driveId))),
  eligibleStudents: (driveId: string): Promise<DriveEligibleResponse> =>
    run(() => engine.eligibleStudents(read(), driveId)),
};

export const demoShortlistService = {
  filter: (filters: ShortlistFilters): Promise<ShortlistResult> =>
    run(() => engine.shortlist(read(), filters)),
  exportCsv: (filters: ShortlistFilters): Promise<Blob> =>
    run(() => csvBlob(engine.exportShortlistCsv(read(), filters))),
};

export const demoDepartmentsService = {
  list: (): Promise<Department[]> => run(() => engine.listDepartments(read())),
  get: (departmentId: string): Promise<DepartmentDetail> =>
    run(() => engine.getDepartment(read(), departmentId)),
  create: (payload: DepartmentInput) =>
    run(() => mutate((d) => engine.createDepartment(d, payload))),
  update: (departmentId: string, payload: Partial<DepartmentInput>) =>
    run(() => mutate((d) => engine.updateDepartment(d, departmentId, payload))),
  remove: (departmentId: string) =>
    run(() => mutate((d) => engine.removeDepartment(d, departmentId))),
};
