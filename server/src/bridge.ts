import { WebSocketServer, WebSocket } from "ws";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import type { BridgeRequest, BridgeResponse } from "./types.js";

interface PendingRequest {
  resolve: (resp: BridgeResponse) => void;
  reject: (err: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}

export class Bridge {
  private wss: WebSocketServer;
  private conn: WebSocket | null = null;
  private pending = new Map<string, PendingRequest>();
  private counter = 0;

  constructor() {
    this.wss = new WebSocketServer({ noServer: true });
  }

  handleUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer): void {
    this.wss.handleUpgrade(request, socket, head, (ws) => {
      this.handleConnection(ws);
    });
  }

  private handleConnection(ws: WebSocket): void {
    // Replace existing connection (same behavior as Go version)
    if (this.conn) {
      this.conn.close();
    }
    this.conn = ws;

    ws.on("message", (data) => {
      try {
        const resp: BridgeResponse = JSON.parse(data.toString());
        const pending = this.pending.get(resp.requestId);
        if (pending) {
          clearTimeout(pending.timeout);
          this.pending.delete(resp.requestId);
          pending.resolve(resp);
        }
      } catch {
        console.error("Invalid response from plugin");
      }
    });

    ws.on("close", () => {
      if (this.conn === ws) {
        this.conn = null;
      }
    });

    ws.on("error", (err) => {
      console.error("WebSocket error:", err.message);
      if (this.conn === ws) {
        this.conn = null;
      }
    });
  }

  send(requestType: string, nodeIds?: string[]): Promise<BridgeResponse> {
    return this.sendWithParams(requestType, nodeIds);
  }

  sendWithParams(
    requestType: string,
    nodeIds?: string[],
    params?: Record<string, unknown>
  ): Promise<BridgeResponse> {
    return new Promise((resolve, reject) => {
      if (!this.conn || this.conn.readyState !== WebSocket.OPEN) {
        reject(new Error("Plugin not connected"));
        return;
      }

      const requestId = this.nextId();
      const request: BridgeRequest = {
        type: requestType,
        requestId,
      };
      if (nodeIds && nodeIds.length > 0) {
        request.nodeIds = nodeIds;
      }
      if (params && Object.keys(params).length > 0) {
        request.params = params;
      }

      const timeout = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error("Request timed out"));
      }, 30_000);

      this.pending.set(requestId, { resolve, reject, timeout });

      this.conn.send(JSON.stringify(request), (err) => {
        if (err) {
          clearTimeout(timeout);
          this.pending.delete(requestId);
          reject(err);
        }
      });
    });
  }

  private nextId(): string {
    this.counter++;
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, "0");
    const mm = String(now.getMinutes()).padStart(2, "0");
    const ss = String(now.getSeconds()).padStart(2, "0");
    return `req-${hh}${mm}${ss}-${this.counter}`;
  }

  close(): void {
    // Reject all pending requests
    for (const [id, { reject, timeout }] of this.pending) {
      clearTimeout(timeout);
      reject(new Error("Bridge closed"));
    }
    this.pending.clear();

    if (this.conn) {
      this.conn.close();
      this.conn = null;
    }
    this.wss.close();
  }
}
