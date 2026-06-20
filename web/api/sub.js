const BASE_URL = "https://raw.githubusercontent.com/huima5602-collab/v2finder-/main/dist/subscribe";
const ALLOWED_TYPES = new Set(["txt", "yaml"]);
const CODE_RE = /^[a-z0-9_-]{2,20}$/i;

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");

  const code = String(req.query.code || "").toLowerCase();
  const type = String(req.query.type || "txt").toLowerCase();

  if (!CODE_RE.test(code)) {
    return res.status(400).send("Invalid country code");
  }

  if (!ALLOWED_TYPES.has(type)) {
    return res.status(400).send("Invalid subscription type");
  }

  const upstreamUrl = `${BASE_URL}/${code}.${type}`;

  try {
    const upstream = await fetch(`${upstreamUrl}?t=${Date.now()}`, {
      headers: {
        "User-Agent": "v2finder-vercel-proxy",
        "Accept": "text/plain,*/*",
        "Cache-Control": "no-cache",
      },
      cache: "no-store",
    });

    if (!upstream.ok) {
      return res.status(upstream.status).send(`Failed to fetch upstream subscription: ${upstream.status}`);
    }

    const text = await upstream.text();
    res.setHeader("Content-Type", type === "yaml" ? "application/x-yaml; charset=utf-8" : "text/plain; charset=utf-8");
    return res.status(200).send(text);
  } catch (error) {
    return res.status(500).send(`Subscription proxy error: ${error instanceof Error ? error.message : String(error)}`);
  }
};
