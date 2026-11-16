import { lookup, Resolver } from "node:dns/promises";
import { isIP } from "node:net";

async function publicDnsLookup(host: string) {
  const resolver = new Resolver();
  resolver.setServers(["8.8.8.8"]);
  const addresses = await resolver.resolve4(host);
  if (!addresses.length) throw new Error(`Public DNS returned no address for ${host}`);
  return addresses.map((address) => ({ address }));
}

export const publicDnsBrowserArgs = [
  "--enable-features=DnsOverHttps",
  "--dns-over-https-mode=secure",
  "--dns-over-https-templates=https://dns.google/dns-query",
  "--host-resolver-rules=MAP dns.google 8.8.8.8",
];
export function isPrivateIp(ip: string): boolean {
  const s = ip.toLowerCase().replace(/^\[|\]$/g, "");
  if (s.includes(":")) {
    const mapped = s.match(/^(?:::ffff:|0:0:0:0:0:ffff:)(.+)$/);
    if (mapped) {
      const tail = mapped[1];
      if (tail.includes(".")) return isPrivateIp(tail);
      const parts = tail.split(":").map((v) => parseInt(v, 16));
      if (parts.length === 2)
        return isPrivateIp(
          [parts[0] >> 8, parts[0] & 255, parts[1] >> 8, parts[1] & 255].join(
            ".",
          ),
        );
      return true;
    }
    return (
      s === "::" ||
      s === "::1" ||
      s.startsWith("fc") ||
      s.startsWith("fd") ||
      /^fe[89ab]/.test(s) ||
      s.startsWith("ff")
    );
  }
  const p = s.split(".").map(Number);
  return (
    p[0] === 0 ||
    p[0] === 10 ||
    p[0] === 127 ||
    p[0] >= 224 ||
    (p[0] === 169 && p[1] === 254) ||
    (p[0] === 172 && p[1] >= 16 && p[1] <= 31) ||
    (p[0] === 192 && p[1] === 168) ||
    (p[0] === 100 && p[1] >= 64 && p[1] <= 127)
  );
}
const checked = new Map<string, Promise<void>>();
export async function publicUrl(input: string): Promise<URL> {
  const u = new URL(input);
  if (!["http:", "https:"].includes(u.protocol) || u.username || u.password)
    throw new Error(
      "Only public HTTP(S) URLs without credentials are supported.",
    );
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local")
  )
    throw new Error("Private destination rejected.");
  if (!checked.has(host))
    checked.set(
      host,
      (async () => {
        const addresses = isIP(host)
          ? [{ address: host }]
          : await lookup(host, { all: true }).catch(() => publicDnsLookup(host));
        if (!addresses.length || addresses.some((a) => isPrivateIp(a.address)))
          throw new Error("Private destination rejected.");
      })(),
    );
  await checked.get(host);
  return u;
}
export async function safeFetch(
  input: string,
  headers: Record<string, string> = {},
): Promise<Response> {
  let url = input;
  for (let i = 0; i < 6; i++) {
    await publicUrl(url);
    const res = await fetch(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(30000),
      headers: {
        "User-Agent": "Site2Shop/0.1 public asset importer",
        ...headers,
      },
    });
    if ([301, 302, 303, 307, 308].includes(res.status)) {
      const loc = res.headers.get("location");
      if (!loc) throw new Error("Redirect has no location");
      url = new URL(loc, url).href;
      continue;
    }
    return res;
  }
  throw new Error("Too many redirects");
}
