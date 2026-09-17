export type OutputFormat = "json" | "table";

export type SpotConfig = {
  baseUrl: string;
  clientId?: string;
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number;
  orgId?: string;
};

export type MeResponse = {
  user: {
    id: string;
    email: string;
    name?: string;
  };
  roles?: string[];
  accessible_orgs?: Array<{
    id: string;
    name: string;
    created_at?: number;
  }>;
};

type ApiErrorBody = {
  error?: {
    code?: string;
    message?: string;
    request_id?: string;
  };
};

export class ApiError extends Error {
  status: number;
  code?: string;
  requestId?: string;

  constructor(status: number, body: ApiErrorBody) {
    const message = body.error?.message ?? `API request failed with status ${status}`;
    super(message);
    this.status = status;
    this.code = body.error?.code;
    this.requestId = body.error?.request_id;
  }
}
