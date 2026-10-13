import { notFound } from "next/navigation";
import { CatalogFrame } from "../../../src/frontend/pages/bank-activities/CatalogFrame";
import { AdminCatalogPage } from "../../../src/frontend/pages/catalog-admin/AdminCatalogPage";
import { workbenchGates } from "../../../src/frontend/app/feature-gates";
export default function Page() {
  if (process.env.FEATURE_CATALOG_MANAGE !== "true") notFound();
  return (
    <CatalogFrame manage={true} gates={workbenchGates()}>
      <AdminCatalogPage />
    </CatalogFrame>
  );
}
