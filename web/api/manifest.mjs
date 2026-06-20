const MANIFEST_URL = "https://raw.githubusercontent.com/huima5602-collab/v2finder-/main/dist/manifest.json";

function proxyUrl(countryCode, type) {
  return `/api/sub?code=${encodeURIComponent(String(countryCode || "").toLowerCase())}&type=${type}`;
}

function setNoCache(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
}

export default async function handler(req, res) {
  setNoCache(res);

  try {
    const upstream = await fetch(`${MANIFEST_URL}?t=${Date.now()}`, {
      headers: {
        "User-Agent": "v2finder-vercel-proxy",
        "Accept": "application/json,text/plain,*/*",
        "Cache-Control": "no-cache",
      },
    });

    if (!upstream.ok) {
      return res.status(upstream.status).json({
        error: "Failed to fetch upstream manifest",
        status: upstream.status,
      });
    }

    const manifest = await upstream.json();
    const countries = Array.isArray(manifest.countries)
      ? manifest.countries.map((country) => ({
          ...country,
          originalTxtUrl: country.txtUrl,
          originalYamlUrl: country.yamlUrl,
          txtUrl: proxyUrl(country.code, "txt"),
          yamlUrl: proxyUrl(country.code, "yaml"),
        }))
      : [];

    return res.status(200).json({
      ...manifest,
      countries,
      source: manifest.source ? `${manifest.source} + vercel-proxy` : "vercel-proxy",
      proxiedAt: new Date().toISOString(),
    });
  } catch (error) {
    return res.status(500).json({
      error: "Manifest proxy error",
      message: error && error.message ? error.message : String(error),
    });
  }
}
