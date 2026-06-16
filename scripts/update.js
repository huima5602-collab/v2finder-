import dns from "node:dns/promises";
import { execFile } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";

const ROOT = process.cwd();
const DIST_DIR = path.join(ROOT, "dist");
const SUBSCRIBE_DIR = path.join(DIST_DIR, "subscribe");
const MAX_PER_COUNTRY = Number(process.env.MAX_PER_COUNTRY || 100);
const FETCH_TIMEOUT_MS = Number(process.env.FETCH_TIMEOUT_MS || 20000);
const TEST_TIMEOUT_MS = Number(process.env.TEST_TIMEOUT_MS || 4000);
const FETCH_CONCURRENCY = Number(process.env.FETCH_CONCURRENCY || 8);
const TEST_CONCURRENCY = Number(process.env.TEST_CONCURRENCY || 120);
const BASE_URL = (process.env.BASE_URL || "").replace(/\/$/, "");
const MAX_TEST_NODES = Number(process.env.MAX_TEST_NODES || 0);
const execFileAsync = promisify(execFile);

let sources = JSON.parse(fs.readFileSync(path.join(ROOT, "config", "sources.json"), "utf8"));
if (process.env.SOURCE_LIMIT) {
  sources = sources.slice(0, Number(process.env.SOURCE_LIMIT));
}
const countries = JSON.parse(fs.readFileSync(path.join(ROOT, "config", "countries.json"), "utf8"));
const countryByCode = new Map(countries.map((country) => [country.code, country]));
const flagToCountry = new Map(countries.map((country) => [country.flag, country.code]));

function normalizeBase64(input) {
  const compact = input.replace(/\s+/g, "");
  const padded = compact + "=".repeat((4 - (compact.length % 4)) % 4);
  return padded.replace(/-/g, "+").replace(/_/g, "/");
}

function tryDecodeBase64(input) {
  try {
    const decoded = Buffer.from(normalizeBase64(input), "base64").toString("utf8");
    if (/vmess:\/\/|vless:\/\/|trojan:\/\/|ss:\/\//.test(decoded)) {
      return decoded;
    }
  } catch {
    return null;
  }
  return null;
}

async function runLimited(items, concurrency, worker) {
  const results = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

function safeDecodeURIComponent(value = "") {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function cleanNodeLine(line) {
  return line
    .trim()
    .replace(/^\d+[\).\u3001]\s*/, "")
    .replace(/^[-*]\s*/, "")
    .replace(/&amp;/g, "&")
    .replace(/&#38;/g, "&")
    .trim();
}

function extractNodes(text) {
  const expanded = [text];
  const decoded = tryDecodeBase64(text);
  if (decoded) expanded.push(decoded);

  const nodes = [];
  const protocolPattern = /(vmess|vless|trojan|ss):\/\/[^\s"'<>]+/gi;
  for (const body of expanded) {
    for (const line of body.split(/\r?\n/)) {
      const cleaned = cleanNodeLine(line);
      for (const match of cleaned.matchAll(protocolPattern)) {
        nodes.push(match[0].replace(/,$/, ""));
      }
    }
  }
  return nodes;
}

async function fetchSource(url) {
  try {
    const body = await fetchText(url);
    const nodes = extractNodes(body);
    return { url, ok: true, nodes };
  } catch (error) {
    return { url, ok: false, nodes: [], error: error.message };
  }
}

async function fetchText(url) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "v2-subscription-publisher/0.1"
      }
    });
    clearTimeout(timeout);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.text();
  } catch (error) {
    if (process.platform !== "win32") throw error;
    const timeoutSec = Math.ceil(FETCH_TIMEOUT_MS / 1000);
    const escapedUrl = url.replace(/'/g, "''");
    const script = [
      "$ProgressPreference='SilentlyContinue'",
      "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8",
      `$response = Invoke-WebRequest -UseBasicParsing -TimeoutSec ${timeoutSec} -Headers @{'User-Agent'='v2-subscription-publisher/0.1'} -Uri '${escapedUrl}'`,
      "$response.Content"
    ].join("; ");
    const command = ["-NoProfile", "-Command", script];
    const { stdout } = await execFileAsync("powershell.exe", command, {
      timeout: FETCH_TIMEOUT_MS + 5000,
      maxBuffer: 20 * 1024 * 1024
    });
    return stdout;
  }
}

function parseVmess(raw) {
  try {
    const payload = raw.replace(/^vmess:\/\//i, "");
    const decoded = Buffer.from(normalizeBase64(payload), "base64").toString("utf8");
    const data = JSON.parse(decoded);
    return {
      raw,
      protocol: "vmess",
      host: data.add,
      port: Number(data.port),
      remark: data.ps || "",
      data
    };
  } catch {
    return { raw, protocol: "vmess", host: "", port: 0, remark: "", data: null };
  }
}

function parseUrlNode(raw, protocol) {
  try {
    const url = new URL(raw);
    return {
      raw,
      protocol,
      host: url.hostname,
      port: Number(url.port),
      remark: safeDecodeURIComponent(url.hash.replace(/^#/, "")),
      url
    };
  } catch {
    return { raw, protocol, host: "", port: 0, remark: "", url: null };
  }
}

function parseSs(raw) {
  const parsed = parseUrlNode(raw, "ss");
  if (parsed.host && parsed.port) return parsed;

  try {
    const withoutScheme = raw.replace(/^ss:\/\//i, "").split("#")[0].split("?")[0];
    const decoded = Buffer.from(normalizeBase64(withoutScheme), "base64").toString("utf8");
    const match = decoded.match(/^(?<method>[^:]+):(?<password>.+)@(?<host>[^:]+):(?<port>\d+)$/);
    if (!match?.groups) return parsed;
    return {
      raw,
      protocol: "ss",
      host: match.groups.host,
      port: Number(match.groups.port),
      remark: safeDecodeURIComponent(raw.split("#")[1] || ""),
      ss: match.groups
    };
  } catch {
    return parsed;
  }
}

function parseNode(raw) {
  if (/^vmess:\/\//i.test(raw)) return parseVmess(raw);
  if (/^vless:\/\//i.test(raw)) return parseUrlNode(raw, "vless");
  if (/^trojan:\/\//i.test(raw)) return parseUrlNode(raw, "trojan");
  if (/^ss:\/\//i.test(raw)) return parseSs(raw);
  return { raw, protocol: "unknown", host: "", port: 0, remark: "" };
}

function detectCountryByText(text) {
  if (!text) return null;
  for (const [flag, code] of flagToCountry.entries()) {
    if (text.includes(flag)) return code;
  }

  const normalized = text.toLocaleLowerCase();
  for (const country of countries) {
    for (const alias of country.aliases) {
      const aliasLower = alias.toLocaleLowerCase();
      const asciiAlias = /^[a-z]+$/i.test(alias);
      const pattern = asciiAlias ? new RegExp(`(^|[^a-z])${aliasLower}([^a-z]|$)`, "i") : null;
      if (pattern ? pattern.test(normalized) : normalized.includes(aliasLower)) {
        return country.code;
      }
    }
  }
  return null;
}

async function lookupCountryByHost(host) {
  if (!host) return null;
  const direct = net.isIP(host) ? host : null;
  let ip = direct;

  if (!ip) {
    try {
      const resolved = await Promise.race([
        dns.lookup(host, { family: 4 }),
        new Promise((_, reject) => setTimeout(() => reject(new Error("dns timeout")), 1500))
      ]);
      ip = resolved.address;
    } catch {
      return null;
    }
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1500);
    const response = await fetch(`http://ip-api.com/json/${ip}?fields=status,countryCode`, {
      signal: controller.signal
    });
    clearTimeout(timeout);
    if (!response.ok) return null;
    const data = await response.json();
    if (data?.status !== "success" || !data.countryCode) return null;
    return countryByCode.has(data.countryCode) ? data.countryCode : null;
  } catch {
    return null;
  }
}

function canTcpConnect(host, port) {
  if (!host || !port) return Promise.resolve(false);

  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;
    const finish = (ok) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(ok);
    };

    socket.setTimeout(TEST_TIMEOUT_MS);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
    socket.connect(port, host);
  });
}

function clashName(meta, index) {
  const country = meta.country || "XX";
  const base = meta.remark?.trim() || `${country}-${meta.protocol}-${index + 1}`;
  return base.replace(/["\\]/g, "").slice(0, 80) || `${country}-${index + 1}`;
}

function parseQueryBoolean(value) {
  return ["tls", "true", "1"].includes(String(value || "").toLowerCase());
}

function toClashProxy(meta, index) {
  const name = clashName(meta, index);
  if (meta.protocol === "vmess" && meta.data?.add && meta.data?.id) {
    const proxy = {
      name,
      type: "vmess",
      server: meta.data.add,
      port: Number(meta.data.port),
      uuid: meta.data.id,
      alterId: Number(meta.data.aid || 0),
      cipher: meta.data.scy || meta.data.security || "auto",
      udp: true
    };
    if (String(meta.data.tls || "").toLowerCase() === "tls") {
      proxy.tls = true;
      proxy.servername = meta.data.sni || meta.data.host || meta.data.add;
    }
    if (meta.data.net === "ws") {
      proxy.network = "ws";
      proxy["ws-opts"] = {
        path: meta.data.path || "/",
        headers: meta.data.host ? { Host: meta.data.host } : {}
      };
    }
    return proxy;
  }

  if ((meta.protocol === "vless" || meta.protocol === "trojan") && meta.url) {
    const params = meta.url.searchParams;
    const proxy = {
      name,
      type: meta.protocol,
      server: meta.url.hostname,
      port: Number(meta.url.port),
      udp: true
    };
    if (meta.protocol === "vless") proxy.uuid = decodeURIComponent(meta.url.username);
    if (meta.protocol === "trojan") proxy.password = decodeURIComponent(meta.url.username);
    if (parseQueryBoolean(params.get("security")) || params.get("security") === "tls") {
      proxy.tls = true;
      proxy.servername = params.get("sni") || params.get("servername") || meta.url.hostname;
    }
    const network = params.get("type");
    if (network) proxy.network = network;
    if (network === "ws") {
      proxy["ws-opts"] = {
        path: params.get("path") || "/",
        headers: params.get("host") ? { Host: params.get("host") } : {}
      };
    }
    return proxy;
  }

  if (meta.protocol === "ss") {
    let method = meta.ss?.method;
    let password = meta.ss?.password;
    if (!method || !password) {
      try {
        const userInfo = decodeURIComponent(meta.url.username || "");
        const decoded = userInfo.includes(":")
          ? userInfo
          : Buffer.from(normalizeBase64(userInfo), "base64").toString("utf8");
        const idx = decoded.indexOf(":");
        method = decoded.slice(0, idx);
        password = decoded.slice(idx + 1);
      } catch {
        return null;
      }
    }
    if (!method || !password || !meta.host || !meta.port) return null;
    return {
      name,
      type: "ss",
      server: meta.host,
      port: Number(meta.port),
      cipher: method,
      password,
      udp: true
    };
  }

  return null;
}

function quoteYaml(value) {
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value === null || value === undefined) return '""';
  return JSON.stringify(String(value));
}

function dumpYaml(value, indent = 0) {
  const space = " ".repeat(indent);
  if (Array.isArray(value)) {
    if (!value.length) return "[]\n";
    return value.map((item) => {
      if (typeof item !== "object" || item === null) {
        return `${space}- ${quoteYaml(item)}\n`;
      }
      const body = dumpYaml(item, indent + 2);
      return `${space}- ${body.trimStart()}`;
    }).join("");
  }
  if (typeof value === "object" && value !== null) {
    return Object.entries(value).map(([key, item]) => {
      if (Array.isArray(item)) {
        return `${space}${key}:\n${dumpYaml(item, indent + 2)}`;
      }
      if (typeof item === "object" && item !== null) {
        return `${space}${key}:\n${dumpYaml(item, indent + 2)}`;
      }
      return `${space}${key}: ${quoteYaml(item)}\n`;
    }).join("");
  }
  return `${space}${quoteYaml(value)}\n`;
}

function writeTextFile(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");
}

function publicUrl(relativePath) {
  const normalized = relativePath.replace(/\\/g, "/").replace(/^\//, "");
  return BASE_URL ? `${BASE_URL}/${normalized}` : `/${normalized}`;
}

async function main() {
  fs.rmSync(DIST_DIR, { recursive: true, force: true });
  fs.mkdirSync(SUBSCRIBE_DIR, { recursive: true });

  console.log(`Fetching ${sources.length} sources...`);
  const fetchResults = await runLimited(sources, FETCH_CONCURRENCY, (source) => fetchSource(source));
  const failedSources = fetchResults.filter((result) => !result.ok);
  const rawNodes = [...new Set(fetchResults.flatMap((result) => result.nodes))];
  console.log(`Extracted ${rawNodes.length} unique nodes. Failed sources: ${failedSources.length}`);

  let parsedNodes = rawNodes.map(parseNode).filter((node) => node.host && node.port);
  if (MAX_TEST_NODES > 0 && parsedNodes.length > MAX_TEST_NODES) {
    parsedNodes = parsedNodes.slice(0, MAX_TEST_NODES);
    console.log(`Limited test set to ${parsedNodes.length} nodes.`);
  }
  const testedNodes = process.env.SKIP_TCP_TEST === "1" ? parsedNodes.map((node) => ({
    ...node,
    reachable: true
  })) : await runLimited(parsedNodes, TEST_CONCURRENCY, async (node) => ({
    ...node,
    reachable: await canTcpConnect(node.host, node.port)
  }));
  const reachableNodes = testedNodes.filter((node) => node.reachable);
  console.log(`Reachable nodes: ${reachableNodes.length}`);

  const classified = new Map(countries.map((country) => [country.code, []]));
  await runLimited(reachableNodes, 50, async (node) => {
    const textCountry = detectCountryByText(node.remark);
    const country = textCountry || await lookupCountryByHost(node.host);
    if (!country || !classified.has(country)) return;
    if (classified.get(country).length >= MAX_PER_COUNTRY) return;
    classified.get(country).push({ ...node, country });
  });

  const updatedAt = new Date().toISOString();
  const manifestCountries = [];
  let totalNodes = 0;

  for (const country of countries) {
    const nodes = classified.get(country.code) || [];
    if (!nodes.length) continue;
    totalNodes += nodes.length;

    const code = country.code.toLowerCase();
    const txtRelative = `subscribe/${code}.txt`;
    const yamlRelative = `subscribe/${code}.yaml`;
    writeTextFile(path.join(DIST_DIR, txtRelative), `${nodes.map((node) => node.raw).join("\n")}\n`);

    const proxies = nodes.map((node, index) => toClashProxy(node, index)).filter(Boolean);
    const proxyNames = proxies.map((proxy) => proxy.name);
    const clashConfig = {
      "mixed-port": 7890,
      "allow-lan": false,
      mode: "rule",
      "log-level": "info",
      proxies,
      "proxy-groups": [
        {
          name: "Proxy Select",
          type: "select",
          proxies: proxyNames.length ? proxyNames : ["DIRECT"]
        }
      ],
      rules: ["MATCH,Proxy Select"]
    };
    writeTextFile(path.join(DIST_DIR, yamlRelative), dumpYaml(clashConfig));

    manifestCountries.push({
      code: country.code,
      name: country.name,
      englishName: country.englishName,
      flag: country.flag,
      nodeCount: nodes.length,
      yamlNodeCount: proxies.length,
      txtUrl: publicUrl(txtRelative),
      yamlUrl: publicUrl(yamlRelative),
      updatedAt
    });
  }

  const status = totalNodes === 0 ? "failed" : failedSources.length ? "partial" : "success";
  const manifest = {
    updatedAt,
    status,
    totalNodes,
    source: "github-actions",
    failedSourceCount: failedSources.length,
    countries: manifestCountries
  };
  if (status === "failed") {
    manifest.error = "No reachable nodes were classified into the configured countries.";
  }
  writeTextFile(path.join(DIST_DIR, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

  console.log(`Generated ${manifestCountries.length} countries and ${totalNodes} classified nodes.`);
  if (totalNodes === 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
