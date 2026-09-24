import dayjs from "dayjs";
import { ApiError, SpotConfig, MeResponse } from "./types.js";
import { refreshAccessToken } from "./auth.js";
import { saveConfig } from "./config.js";

type ListResponse<T> = { data: T[]; next_cursor: string | null };

export class SpotApi {
  async askSpot(message: string, threadId?: string) {
    return this.post<{ threadId: string; response: string }>("/mcp/ask", {
      message,
      threadId,
    });
  }

  async createPolicyDraft(input: Record<string, unknown>) {
    const prompt = `Create a new policy record using this JSON payload: ${JSON.stringify(input)}. If data is missing, ask concise follow-up questions.`;
    return this.askSpot(prompt);
  }

  async generateCoi(
    policyId: string,
    holderName: string,
    holderAddress?: string,
    explicitReissue = false,
    holderEmail?: string,
    holderPhone?: string,
    holderContactName?: string,
  ) {
    return this.post<{ data: Record<string, unknown> }>(
      `/api/v1/policies/${policyId}/certificates`,
      {
        certificate_holder_name: holderName,
        certificate_holder_contact_name: holderContactName,
        certificate_holder_email: holderEmail,
        certificate_holder_phone: holderPhone,
        certificate_holder: [holderName, holderAddress]
          .filter(Boolean)
          .join("\n"),
        explicit_reissue: explicitReissue,
      },
    );
  }

  async certificateHolders(query?: string) {
    const params = query ? `?q=${encodeURIComponent(query)}` : "";
    return this.request<ListResponse<Record<string, unknown>>>(
      `/api/v1/certificate-holders${params}`,
    );
  }

  async policyVersions(policyId: string) {
    return this.request<ListResponse<Record<string, unknown>>>(
      `/api/v1/policies/${policyId}/versions`,
    );
  }

  async certificateVersions(policyId: string) {
    return this.request<ListResponse<Record<string, unknown>>>(
      `/api/v1/policies/${policyId}/certificate-versions`,
    );
  }

  async runUploadPipeline(filePath: string) {
    const prompt = `Run the policy upload pipeline for file path: ${filePath}. If direct file access is unavailable, explain required upload handoff steps.`;
    return this.askSpot(prompt);
  }
  constructor(private readonly config: SpotConfig) {}

  async me() {
    return this.request<MeResponse>("/api/v1/me");
  }

  async org() {
    return this.request<Record<string, unknown>>("/api/v1/org");
  }

  async policies(limit = 25) {
    return this.request<ListResponse<Record<string, unknown>>>(
      `/api/v1/policies?limit=${limit}`,
    );
  }

  async policy(id: string) {
    return this.request<Record<string, unknown>>(`/api/v1/policies/${id}`);
  }

  async notifications(limit = 25) {
    return this.request<ListResponse<Record<string, unknown>>>(
      `/api/v1/notifications?limit=${limit}`,
    );
  }

  private async post<T>(
    path: string,
    body: Record<string, unknown>,
  ): Promise<T> {
    await this.ensureAccessToken();

    let response = await fetch(`${this.config.baseUrl}${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.config.accessToken}`,
        "Content-Type": "application/json",
        ...(this.config.orgId ? { "X-Org-Id": this.config.orgId } : {}),
      },
      body: JSON.stringify(body),
    });

    if (response.status === 401) {
      await this.ensureAccessToken(true);
      response = await fetch(`${this.config.baseUrl}${path}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.config.accessToken}`,
          "Content-Type": "application/json",
          ...(this.config.orgId ? { "X-Org-Id": this.config.orgId } : {}),
        },
        body: JSON.stringify(body),
      });
    }

    if (!response.ok) {
      const err = (await response.json().catch(() => ({}))) as {
        error?: { code?: string; message?: string; request_id?: string };
      };
      throw new ApiError(response.status, err);
    }

    return (await response.json()) as T;
  }

  private async request<T>(path: string): Promise<T> {
    await this.ensureAccessToken();
    if (!this.config.orgId && !path.endsWith("/me"))
      throw new Error(
        "No org selected. Run: spot auth:whoami --set-org <orgId>",
      );

    let response = await fetch(`${this.config.baseUrl}${path}`, {
      headers: {
        Authorization: `Bearer ${this.config.accessToken}`,
        ...(this.config.orgId ? { "X-Org-Id": this.config.orgId } : {}),
      },
    });

    if (response.status === 401) {
      await this.ensureAccessToken(true);
      response = await fetch(`${this.config.baseUrl}${path}`, {
        headers: {
          Authorization: `Bearer ${this.config.accessToken}`,
          ...(this.config.orgId ? { "X-Org-Id": this.config.orgId } : {}),
        },
      });
    }

    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as {
        error?: { code?: string; message?: string; request_id?: string };
      };
      throw new ApiError(response.status, body);
    }

    return (await response.json()) as T;
  }

  private async ensureAccessToken(force = false): Promise<void> {
    if (!this.config.accessToken)
      throw new Error("Not authenticated. Run: spot auth:login");
    const expiresAt = this.config.expiresAt;
    if (!force && (!expiresAt || expiresAt - dayjs().valueOf() > 60_000))
      return;

    const next = await refreshAccessToken(this.config);
    Object.assign(this.config, next);
    await saveConfig(this.config);
  }
}
