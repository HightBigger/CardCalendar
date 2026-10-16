import { notFound } from "next/navigation";
import { CatalogFrame } from "@/frontend/pages/bank-activities/CatalogFrame";
import { BankActivitiesPage } from "@/frontend/pages/bank-activities/BankActivitiesPage";
import { workbenchGates } from "@/frontend/app/feature-gates";
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  if (process.env.FEATURE_CATALOG_READ !== "true") notFound();
  return (
    <CatalogFrame manage={false} gates={workbenchGates()}>
      <BankActivitiesPage id={(await params).id} />
    </CatalogFrame>
  );
}
