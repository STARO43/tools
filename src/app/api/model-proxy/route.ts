/**
 * Same-origin релей для файлов моделей: используется как фолбэк, когда
 * прямой кросс-доменный fetch к HuggingFace недоступен (сеть/CORS).
 * Разрешён только белый список URL — публичные веса ppu-paddle-ocr-models.
 */

const ALLOWED_PREFIX = "https://huggingface.co/snowfluke/ppu-paddle-ocr-models/";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const target = searchParams.get("url");

  if (!target || !target.startsWith(ALLOWED_PREFIX)) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }

  try {
    const upstream = await fetch(target, { cache: "no-store" });
    const headers = new Headers();
    const len = upstream.headers.get("content-length");
    if (len) headers.set("Content-Length", len);
    headers.set("Content-Type", upstream.headers.get("content-type") ?? "application/octet-stream");
    headers.set("Cache-Control", "public, max-age=3600");
    return new Response(upstream.body, { status: upstream.status, headers });
  } catch {
    return Response.json({ error: "upstream-failed" }, { status: 502 });
  }
}
