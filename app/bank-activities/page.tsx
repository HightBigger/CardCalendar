import { notFound } from "next/navigation";
import { CatalogFrame } from "../../src/frontend/pages/bank-activities/CatalogFrame";
import { BankActivitiesPage } from "../../src/frontend/pages/bank-activities/BankActivitiesPage";
import { workbenchGates } from "../../src/frontend/app/feature-gates";
export default function Page() {
  if (process.env.FEATURE_CATALOG_READ !== "true") notFound();
  return (
    <CatalogFrame manage={false} gates={workbenchGates()}>
      <BankActivitiesPage />
    </CatalogFrame>
  );
}
