export interface BridgeRequest {
  type: string;
  requestId: string;
  nodeIds?: string[];
  params?: Record<string, unknown>;
}

export interface BridgeResponse {
  type: string;
  requestId: string;
  data?: unknown;
  error?: string;
}

export interface RPCRequest {
  tool: string;
  nodeIds?: string[];
  params?: Record<string, unknown>;
}

export interface RPCResponse {
  data?: unknown;
  error?: string;
}

export enum Role {
  Unknown = 0,
  Leader = 1,
  Follower = 2,
}
