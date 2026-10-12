import { unpack } from "@/lib/metadata";

// Serves standard token metadata JSON from the packed `d` parameter.
export function GET(req: Request) {
  const d = new URL(req.url).searchParams.get("d");
  const m = d ? unpack(d) : null;
  if (!m) return Response.json({ error: "invalid metadata" }, { status: 400 });
  const safeImage = m.i && /^https:\/\//.test(m.i) ? m.i : undefined;
  return Response.json(
    { name: m.n, symbol: m.s, description: m.d ?? "", image: safeImage, external_url: "https://github.com/jaypacino337/Liq" },
    { headers: { "Cache-Control": "public, max-age=31536000, immutable", "Access-Control-Allow-Origin": "*" } },
  );
}
