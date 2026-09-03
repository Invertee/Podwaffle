import type { RequestListener, ServerResponse } from "node:http";

function isBrowserControllerPath(pathname: string): boolean {
  return (
    pathname === "/api/v1/snapshot" ||
    pathname === "/api/v1/playback/commands" ||
    pathname.startsWith("/api/v1/playback/commands/")
  );
}

function addVaryOrigin(response: ServerResponse): void {
  const current = response.getHeader("Vary");
  const values = (Array.isArray(current) ? current : String(current ?? "").split(","))
    .map((value) => String(value).trim())
    .filter(Boolean);
  if (!values.some((value) => value.toLowerCase() === "origin")) {
    values.push("Origin");
  }
  response.setHeader("Vary", values.join(", "));
}

export function withBrowserControllerCors(
  handler: RequestListener,
): RequestListener {
  return (request, response) => {
    const origin = String(request.headers.origin ?? "").trim();
    const pathname = new URL(
      request.url ?? "/",
      "http://podwaffle.local",
    ).pathname.replace(/\/+$/, "") || "/";

    if (!origin || !isBrowserControllerPath(pathname)) {
      handler(request, response);
      return;
    }

    response.setHeader("Access-Control-Allow-Origin", origin);
    response.setHeader(
      "Access-Control-Allow-Headers",
      "Authorization, Content-Type",
    );
    response.setHeader(
      "Access-Control-Allow-Methods",
      "GET, POST, OPTIONS",
    );
    response.setHeader("Access-Control-Max-Age", "86400");
    response.setHeader("Access-Control-Expose-Headers", "x-request-id");
    addVaryOrigin(response);

    if (
      request.headers["access-control-request-private-network"] === "true"
    ) {
      response.setHeader("Access-Control-Allow-Private-Network", "true");
    }

    if (request.method === "OPTIONS") {
      response.writeHead(204);
      response.end();
      return;
    }

    handler(request, response);
  };
}
