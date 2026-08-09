import { checkReadiness } from "../../../src/shared/readiness";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const readiness = await checkReadiness();
  return new Response(JSON.stringify(readiness), {
    status: readiness.status === "ok" ? 200 : 503,
    headers: {
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8",
    },
  });
}
