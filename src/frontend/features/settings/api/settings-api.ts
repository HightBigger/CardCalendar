import type { ApiUser } from "../../../../contracts/mvp";
import { apiJson } from "../../../shared/http";
export const settingsApi = {
  save: (name: string, timezone: string) => apiJson<ApiUser>("/api/v1/me", { method: "PATCH", body: JSON.stringify({ name, timezone }) }),
  delete: () => apiJson("/api/v1/me/delete-request", { method: "POST", body: JSON.stringify({ confirmation: "DELETE" }) }),
  logout: () => apiJson("/api/v1/auth/logout", { method: "POST" }),
};
