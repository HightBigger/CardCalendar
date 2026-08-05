export function GET(): Response { return new Response(JSON.stringify({ status: "ok" }), { headers: { "content-type": "application/json" } }); }

