import { createFileRoute } from "@tanstack/react-router";
import { CollegeHub } from "@/components/college/CollegeHub";

export const Route = createFileRoute("/college/")({
  component: CollegeHub,
});
