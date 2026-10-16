import { notFound } from "next/navigation";
import { CatalogFrame } from "@/frontend/pages/bank-activities/CatalogFrame";
import { AdminCatalogPage } from "@/frontend/pages/catalog-admin/AdminCatalogPage";
import { workbenchGates } from "@/frontend/app/feature-gates";
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  if (process.env.FEATURE_CATALOG_MANAGE !== "true") notFound();
  return (
    <CatalogFrame manage={true} gates={workbenchGates()}>
      <AdminCatalogPage id={(await params).id} />
    </CatalogFrame>
  );
}
