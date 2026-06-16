import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const dist = path.join(root, "dist");
const manifestPath = path.join(dist, "manifest.json");

if (!fs.existsSync(manifestPath)) {
  throw new Error("dist/manifest.json does not exist. Run npm run update first.");
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
if (!Array.isArray(manifest.countries)) {
  throw new Error("manifest.countries must be an array.");
}

for (const country of manifest.countries) {
  const code = country.code.toLowerCase();
  const txtPath = path.join(dist, "subscribe", `${code}.txt`);
  const yamlPath = path.join(dist, "subscribe", `${code}.yaml`);
  if (!fs.existsSync(txtPath)) throw new Error(`${txtPath} is missing.`);
  if (!fs.existsSync(yamlPath)) throw new Error(`${yamlPath} is missing.`);

  const lines = fs.readFileSync(txtPath, "utf8").split(/\r?\n/).filter(Boolean);
  for (const line of lines) {
    if (!/^(vmess|vless|trojan|ss):\/\//i.test(line)) {
      throw new Error(`Invalid node line in ${txtPath}: ${line.slice(0, 80)}`);
    }
  }

  const yamlText = fs.readFileSync(yamlPath, "utf8");
  if (!yamlText.includes("proxies:") || !yamlText.includes("proxy-groups:") || !yamlText.includes("rules:")) {
    throw new Error(`${yamlPath} does not look like a Clash YAML file.`);
  }
}

console.log(`Output check passed: ${manifest.countries.length} countries, ${manifest.totalNodes} nodes.`);
