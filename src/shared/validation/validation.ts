import { AppError } from "../errors";

export function assertRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AppError("VALIDATION_ERROR", "请求体必须是 JSON 对象");
  }
  return value as Record<string, unknown>;
}

export function requiredString(value: unknown, field: string, maxLength = 200): string {
  if (typeof value !== "string" || value.trim().length === 0 || value.trim().length > maxLength) {
    throw new AppError("VALIDATION_ERROR", `${field} 为必填文本，长度不能超过 ${maxLength} 个字符`, 400, [{ field }]);
  }
  return value.trim();
}

export function optionalString(value: unknown, field: string, maxLength = 200): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  return requiredString(value, field, maxLength);
}

export function last4(value: unknown): string {
  if (typeof value !== "string" || !/^\d{4}$/.test(value)) {
    throw new AppError("VALIDATION_ERROR", "last4 必须是 4 位数字", 400, [{ field: "last4" }]);
  }
  return value;
}

export function nonNegativeNumber(value: unknown, field: string): number {
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : NaN;
  if (!Number.isFinite(n) || n < 0) throw new AppError("VALIDATION_ERROR", `${field} 必须是非负数字`, 400, [{ field }]);
  return n;
}

export function nonNegativeInteger(value: unknown, field: string): number {
  const n = nonNegativeNumber(value, field);
  if (!Number.isInteger(n)) throw new AppError("VALIDATION_ERROR", `${field} 必须是非负整数`, 400, [{ field }]);
  return n;
}

