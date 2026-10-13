import { notFound } from "next/navigation";
import { CatalogAcceptanceEntry } from "../../../src/frontend/pages/bank-activities/CatalogAcceptanceEntry";
export default function Page() {
  if (process.env.NODE_ENV === "production") notFound();
  return <CatalogAcceptanceEntry />;
}
