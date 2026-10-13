import type { CardIdentity } from "../../../../contracts/workbench";
export type BankOption = { id: string; name: string };
export type CatalogCard = CardIdentity & { bankId: string | null };
