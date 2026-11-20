import { lookup } from "node:dns/promises";
import type { LookupAddress } from "node:dns";
import { setTimeout as delay } from "node:timers/promises";
import { isIP, type LookupFunction } from "node:net";
import ipaddr from "ipaddr.js";
import { Agent } from "undici";

const resolveHost = (hostname: string) => lookup(hostname, { all: true });
type ResolveHost = (hostname: string) => Promise<LookupAddress[]>;

function checkAddress(address: string) {
  // Azure's platform virtual IP is special even though it looks public.
  if (!isIP(address) || address.includes("%") || address === "168.63.129.16") {
    throw new Error("目标 IP 不允许访问");
  }
  const ip = ipaddr.parse(address);
  if (
    ip.range() !== "unicast" ||
    (ip instanceof ipaddr.IPv6 && !ip.match(ipaddr.IPv6.parse("2000::"), 3))
  ) {
    throw new Error("目标 IP 不允许访问");
  }
}

export function parsePublicUrl(input: string | URL): URL {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error("目标 URL 无效");
  }
  const host = url.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (
    url.protocol !== "https:" ||
    url.port ||
    url.username ||
    url.password ||
    url.hash ||
    (!isIP(host) &&
      (!host.includes(".") ||
        /(?:^|\.)(localhost|local|internal|home\.arpa)$/.test(host)))
  ) {
    throw new Error(
      "目标 URL 必须使用公网 HTTPS 默认端口，且不得包含凭证或片段",
    );
  }
  // Node skips lookup entirely for IP literals.
  if (isIP(host)) checkAddress(host);
  return url;
}

async function publicAddresses(hostname: string, resolve: ResolveHost) {
  const entries = await resolve(hostname);
  if (!entries.length) throw new Error("目标 DNS 未返回地址");
  for (const { address, family } of entries) {
    checkAddress(address);
    if (isIP(address) !== family) throw new Error("目标 DNS 地址类型无效");
  }
  return entries;
}

// Browser navigation does its own DNS resolution; preflight before handing out the URL.
export async function validatePublicDestination(input: string | URL) {
  const url = parsePublicUrl(input);
  if (isIP(url.hostname.replace(/^\[|\]$/g, ""))) return;
  const timer = new AbortController();
  try {
    await Promise.race([
      publicAddresses(url.hostname, resolveHost),
      delay(5_000, undefined, { signal: timer.signal, ref: false }).then(() => {
        throw new Error("目标 DNS 查询超时");
      }),
    ]);
  } finally {
    timer.abort();
  }
}

function guardedLookup(resolve: ResolveHost): LookupFunction {
  return (hostname, options, callback) => {
    void publicAddresses(hostname, resolve)
      .then((entries) => {
        const family =
          options.family === "IPv4"
            ? 4
            : options.family === "IPv6"
              ? 6
              : options.family;
        const eligible = family
          ? entries.filter((entry) => entry.family === family)
          : entries;
        if (!eligible.length) throw new Error("目标 DNS 缺少所需地址类型");
        return eligible;
      })
      .then(
        (entries) => {
          // The connector dials these exact addresses without a second DNS lookup.
          const first = entries[0]!;
          if (options.all) callback(null, entries);
          else callback(null, first.address, first.family);
        },
        (error: Error) => callback(error, ""),
      );
  };
}

const redirects = new Set([301, 302, 303, 307, 308]);

function limitBody(response: Response, maxBytes: number, redirected: boolean) {
  if (!response.body) return response;
  let bytes = 0;
  const body = response.body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        bytes += chunk.byteLength;
        if (bytes > maxBytes) throw new Error("远端响应超过大小限制");
        controller.enqueue(chunk);
      },
    }),
  );
  const headers = new Headers(response.headers);
  // Fetch delivers decoded chunks; the wire length/encoding no longer apply.
  headers.delete("content-encoding");
  headers.delete("content-length");
  const result = new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
  Object.defineProperties(result, {
    url: { value: response.url },
    redirected: { value: redirected },
  });
  return result;
}

export function createPublicTransport({
  resolve = resolveHost,
  timeoutMs = 30_000,
  maxBytes = 4 * 1024 * 1024,
}: {
  resolve?: ResolveHost;
  timeoutMs?: number;
  maxBytes?: number;
} = {}) {
  const dispatcher = new Agent({
    connect: { lookup: guardedLookup(resolve), rejectUnauthorized: true },
  });
  const fetchImpl: typeof fetch = async (input, init) => {
    parsePublicUrl(
      typeof input === "string" || input instanceof URL ? input : input.url,
    );
    const request = new Request(input, init);
    if (request.headers.has("host")) throw new Error("不允许覆盖目标 Host");
    const signal = AbortSignal.any([
      request.signal,
      AbortSignal.timeout(timeoutMs),
    ]);
    let current = request;
    for (let hop = 0; ; hop++) {
      // Node 24 bundles Undici 7; @types/node describes a newer dispatcher.
      const options = {
        dispatcher,
        redirect: "manual",
        signal,
      };
      const response = await fetch(current, options as unknown as RequestInit);
      const location = response.headers.get("location");
      if (
        !location ||
        !redirects.has(response.status) ||
        request.redirect === "manual"
      ) {
        return limitBody(response, maxBytes, hop > 0);
      }
      await response.body?.cancel();
      if (
        request.redirect === "error" ||
        hop >= 3 ||
        !["GET", "HEAD"].includes(current.method) ||
        current.headers.has("authorization") ||
        current.headers.has("cookie")
      ) {
        throw new Error("远端重定向不允许跟随");
      }
      const next = parsePublicUrl(new URL(location, current.url));
      // Treat every redirected read as a fresh public request. Never forward
      // arbitrary provider headers, OAuth tokens, or execution bodies.
      current = new Request(next, { method: request.method });
    }
  };
  return { fetch: fetchImpl, close: () => dispatcher.destroy() };
}
