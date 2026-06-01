import React, { useEffect, useMemo, useRef, useState } from "react";

type RequestType =
  | "get_document"
  | "get_selection"
  | "get_node"
  | "get_styles"
  | "get_metadata"
  | "get_design_context"
  | "get_variable_defs"
  | "get_screenshot";

type ServerRequest = {
  type: RequestType;
  requestId: string;
  nodeIds?: string[];
  params?: {
    format?: "PNG" | "SVG" | "JPG" | "PDF";
    scale?: number;
    depth?: number;
  };
};

type PluginResponse = {
  type: RequestType;
  requestId: string;
  data?: unknown;
  error?: string;
};

type PluginStatus = {
  fileName: string;
  selectionCount: number;
};
const getSafeLocalStorage = (key: string): string | null => {
  try {
    return localStorage.getItem(key);
  } catch (e) {
    console.warn("localStorage is not accessible:", e);
    return null;
  }
};

const setSafeLocalStorage = (key: string, value: string): void => {
  try {
    localStorage.setItem(key, value);
  } catch (e) {
    console.warn("localStorage is not accessible:", e);
  }
};

export default function App() {
  const [connected, setConnected] = useState(false);
  const [status, setStatus] = useState<PluginStatus>({
    fileName: "Unknown file",
    selectionCount: 0
  });
  const [useWss, setUseWss] = useState<boolean>(() => {
    return getSafeLocalStorage("figma-bridge-use-wss") === "true";
  });
  const socketRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<number | null>(null);

  const statusLabel = useMemo(
    () => (connected ? "Connected" : "Disconnected"),
    [connected]
  );

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const msg = event.data?.pluginMessage;
      if (!msg) return;

      if (msg.type === "plugin-status") {
        setStatus(msg.payload);
        return;
      }

      if (!("requestId" in msg)) {
        return;
      }

      if (!socketRef.current || socketRef.current.readyState !== WebSocket.OPEN) {
        return;
      }
      socketRef.current.send(JSON.stringify(msg));
    };

    window.addEventListener("message", handleMessage);
    return () => {
      window.removeEventListener("message", handleMessage);
    };
  }, []);

  useEffect(() => {
    const connect = () => {
      if (socketRef.current) {
        socketRef.current.close();
      }

      const wsUrl = useWss ? "wss://localhost:1994/ws" : "ws://localhost:1994/ws";
      const ws = new WebSocket(wsUrl);
      socketRef.current = ws;

      ws.onopen = () => {
        setConnected(true);
        parent.postMessage({ pluginMessage: { type: "ui-ready" } }, "*");
      };

      ws.onclose = () => {
        setConnected(false);
        if (reconnectTimer.current === null) {
          reconnectTimer.current = window.setTimeout(() => {
            reconnectTimer.current = null;
            connect();
          }, 1500);
        }
      };

      ws.onerror = () => {
        setConnected(false);
      };

      ws.onmessage = (event) => {
        const payload = JSON.parse(event.data) as ServerRequest;
        parent.postMessage({ pluginMessage: { type: "server-request", payload } }, "*");
      };
    };

    connect();

    return () => {
      if (reconnectTimer.current !== null) {
        window.clearTimeout(reconnectTimer.current);
      }
      if (socketRef.current) {
        socketRef.current.close();
      }
    };
  }, [useWss]);

  return (
    <div className="container">
      <div className="status">
        <div>WebSocket</div>
        <span
          className={`status-badge ${
            connected ? "connected" : "disconnected"
          }`}
        >
          {statusLabel}
        </span>
      </div>

      <div className="settings">
        <label className="toggle-container">
          <input
            type="checkbox"
            checked={useWss}
            onChange={(e) => {
              const checked = e.target.checked;
              setUseWss(checked);
              setSafeLocalStorage("figma-bridge-use-wss", String(checked));
            }}
          />
          <span className="toggle-label">Use Secure Connection (WSS)</span>
        </label>
      </div>

      <div className="meta">File: {status.fileName}</div>
      <div className="meta">Selection: {status.selectionCount} node(s)</div>
    </div>
  );
}
