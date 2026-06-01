import http from "node:http";
import https from "node:https";
import fs from "node:fs";
import type { Duplex } from "node:stream";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerTools } from "./tools.js";
import type { Node } from "./node.js";
import { Bridge } from "./bridge.js";
import { validateRpc } from "./schema.js";
import { executeSaveScreenshots } from "./tools.js";
import type { ExportFormat } from "./tools.js";
import type { RPCRequest, RPCResponse } from "./types.js";
import { VERSION } from "./version.js";

/**
 * Leader owns the WebSocket bridge to Figma and exposes HTTP/HTTPS endpoints for followers.
 * Endpoints:
 *   /ws       — WebSocket upgrade for the Figma plugin
 *   /ping     — Health check
 *   /rpc      — JSON RPC for follower tool calls
 *   /sse      — Server-Sent Events MCP endpoint
 *   /messages — MCP message posting endpoint
 */
export class Leader {
  private bridge: Bridge;
  private server: http.Server | https.Server | null = null;
  private sseTransports = new Map<string, SSEServerTransport>();

  constructor(
    private port: number,
    private node: Node
  ) {
    this.bridge = new Bridge();
  }

  getBridge(): Bridge {
    return this.bridge;
  }

  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      const useHttps = process.env.HTTPS === "true" || !!process.env.SSL_KEY_FILE || !!process.env.SSL_KEY_PATH || !!process.env.SSL_KEY;
      let serverOptions: https.ServerOptions | null = null;

      if (useHttps) {
        try {
          const keyPath = process.env.SSL_KEY_FILE || process.env.SSL_KEY_PATH;
          const certPath = process.env.SSL_CERT_FILE || process.env.SSL_CERT_PATH;
          const key = keyPath ? fs.readFileSync(keyPath) : process.env.SSL_KEY;
          const cert = certPath ? fs.readFileSync(certPath) : process.env.SSL_CERT;

          if (!key || !cert) {
            reject(new Error("HTTPS is enabled but certificate paths (SSL_KEY_FILE/SSL_KEY_PATH, SSL_CERT_FILE/SSL_CERT_PATH) or certificate contents (SSL_KEY, SSL_CERT) are not configured."));
            return;
          }
          serverOptions = { key, cert };
        } catch (err) {
          reject(new Error(`Failed to read SSL certificates: ${err instanceof Error ? err.message : String(err)}`));
          return;
        }
      }

      const requestHandler = (req: http.IncomingMessage, res: http.ServerResponse) => {
        const parsedUrl = new URL(req.url || "", `http://${req.headers.host || "localhost"}`);

        // CORS headers
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
        res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

        if (req.method === "OPTIONS") {
          res.writeHead(204);
          res.end();
          return;
        }

        if (parsedUrl.pathname === "/ping" && req.method === "GET") {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ status: "ok", version: VERSION }));
          return;
        }

        if (parsedUrl.pathname === "/rpc" && req.method === "POST") {
          this.handleRPC(req, res);
          return;
        }

        if (parsedUrl.pathname === "/sse" && req.method === "GET") {
          this.handleSSE(req, res).catch((err) => {
            console.error("SSE connection error:", err);
            if (!res.headersSent) {
              res.writeHead(500, { "Content-Type": "text/plain" });
              res.end(String(err));
            }
          });
          return;
        }

        if (parsedUrl.pathname === "/messages" && req.method === "POST") {
          this.handleMessages(req, res, parsedUrl).catch((err) => {
            console.error("SSE message routing error:", err);
            if (!res.headersSent) {
              res.writeHead(500, { "Content-Type": "text/plain" });
              res.end(String(err));
            }
          });
          return;
        }

        res.writeHead(404);
        res.end("Not found");
      };

      const server = serverOptions
        ? https.createServer(serverOptions, requestHandler)
        : http.createServer(requestHandler);

      server.on(
        "upgrade",
        (req: http.IncomingMessage, socket: Duplex, head: Buffer) => {
          if (req.url === "/ws") {
            this.bridge.handleUpgrade(req, socket, head);
          } else {
            socket.destroy();
          }
        }
      );

      // Fail fast if port is already in use
      server.once("error", (err: NodeJS.ErrnoException) => {
        reject(
          err.code === "EADDRINUSE"
            ? new Error(`Port ${this.port} already in use`)
            : err
        );
      });

      server.listen(this.port, () => {
        this.server = server;
        console.error(`Leader listening on :${this.port} (${useHttps ? "HTTPS" : "HTTP"})`);
        resolve();
      });
    });
  }

  private handleRPC(req: http.IncomingMessage, res: http.ServerResponse): void {
    let body = "";
    req.on("data", (chunk: Buffer) => {
      body += chunk.toString();
    });
    req.on("end", async () => {
      try {
        const rpcReq: RPCRequest = JSON.parse(body);

        const validationError = validateRpc(
          rpcReq.tool,
          rpcReq.nodeIds,
          rpcReq.params
        );
        if (validationError) {
          this.sendJSON(res, 400, { error: validationError });
          return;
        }

        // Currently the tool that is not forwarded to the plugin is save_screenshots
        // If more are added we need to refactor to a better abstraction.
        if (rpcReq.tool === "save_screenshots") {
          const params = rpcReq.params ?? {};
          const result = await executeSaveScreenshots(
            this.bridge,
            params.items as Parameters<typeof executeSaveScreenshots>[1],
            params.format as ExportFormat | undefined,
            params.scale as number | undefined
          );
          this.sendJSON(res, 200, { data: result });
          return;
        }

        const resp = await this.bridge.sendWithParams(
          rpcReq.tool,
          rpcReq.nodeIds,
          rpcReq.params
        );

        this.sendJSON(
          res,
          200,
          resp.error ? { error: resp.error } : { data: resp.data }
        );
      } catch (err) {
        this.sendJSON(res, 200, {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    });
  }

  private sendJSON(
    res: http.ServerResponse,
    status: number,
    body: RPCResponse
  ): void {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(body));
  }

  private async handleSSE(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const transport = new SSEServerTransport("/messages", res);
    const sessionId = transport.sessionId;
    this.sseTransports.set(sessionId, transport);

    res.on("close", () => {
      this.sseTransports.delete(sessionId);
    });

    const mcpServer = new McpServer({
      name: "figma-mcp-free",
      version: VERSION,
    });
    registerTools(mcpServer, this.node);

    await mcpServer.connect(transport);
  }

  private async handleMessages(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    url: URL
  ): Promise<void> {
    const sessionId = url.searchParams.get("sessionId");
    if (!sessionId) {
      res.writeHead(400, { "Content-Type": "text/plain" });
      res.end("Missing sessionId parameter");
      return;
    }

    const transport = this.sseTransports.get(sessionId);
    if (!transport) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Session not found or expired");
      return;
    }

    try {
      await transport.handlePostMessage(req, res);
    } catch (err) {
      res.writeHead(500, { "Content-Type": "text/plain" });
      res.end(err instanceof Error ? err.message : String(err));
    }
  }

  stop(): void {
    this.bridge.close();
    for (const transport of this.sseTransports.values()) {
      try {
        transport.close();
      } catch {}
    }
    this.sseTransports.clear();

    if (this.server) {
      this.server.close();
      this.server = null;
    }
  }
}
