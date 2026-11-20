import { createServer } from "node:http";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { Readable } from "node:stream";

export async function listenFixture(
  handler: (req: Request) => Promise<Response>,
) {
  let origin: string;
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url!, origin);
      if (url.origin !== origin || req.headers.host !== url.host) {
        res.writeHead(403).end();
        return;
      }
      const body: Buffer[] = [];
      for await (const chunk of req) body.push(Buffer.from(chunk));
      const response = await handler(
        new Request(url, {
          method: req.method,
          headers: req.headers as Record<string, string>,
          body: req.method === "POST" ? Buffer.concat(body) : undefined,
        }),
      );
      res.writeHead(response.status, Object.fromEntries(response.headers));
      if (response.body) Readable.from(response.body).pipe(res);
      else res.end();
    } catch {
      res.writeHead(500).end();
    }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const fetchImpl: typeof fetch = async (input, init) => {
    const request = new Request(input, init);
    if (new URL(request.url).origin !== origin)
      throw new Error("Fixture origin mismatch");
    return fetch(request, {
      redirect: "error",
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(5_000)]),
    });
  };
  return {
    origin,
    fetch: fetchImpl,
    close: () => {
      server.closeAllConnections();
      return new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    },
  };
}
