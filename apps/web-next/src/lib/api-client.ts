"use client";

import {
  ApiError,
  type ActiveZonesResponse,
  type DashboardStatus,
  type HistoryResponse,
  type ProgramInput,
  type ProgramView,
  type RainDelayResponse,
  type RunNowResponse,
} from "./types";

/** Browser client for the app's OWN route handlers (never the executor). */
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      ...init,
      headers: { "content-type": "application/json", ...init?.headers },
      cache: "no-store",
    });
  } catch {
    throw new ApiError(0, "Network error");
  }
  if (res.status === 401) {
    window.location.href = "/sign-in";
    throw new ApiError(401, "unauthorized");
  }
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const detail =
      body && typeof body.detail === "string"
        ? body.detail
        : `Request failed (${res.status})`;
    throw new ApiError(res.status, detail);
  }
  return body as T;
}

export const api = {
  getStatus: () => request<DashboardStatus>("/api/status"),
  startZone: (id: number, minutes: number) =>
    request<ActiveZonesResponse>(`/api/zones/${id}/start`, {
      method: "POST",
      body: JSON.stringify({ minutes }),
    }),
  stopAll: () =>
    request<ActiveZonesResponse>("/api/zones/stop", { method: "POST" }),
  setRainDelay: (days: number) =>
    request<RainDelayResponse>("/api/rain-delay", {
      method: "PUT",
      body: JSON.stringify({ days }),
    }),
  updateZone: (id: number, patch: { name?: string; enabled?: boolean }) =>
    request(`/api/zones/${id}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),
  // M2 scheduling
  getPrograms: () => request<ProgramView[]>("/api/programs"),
  createProgram: (input: ProgramInput) =>
    request<ProgramView>("/api/programs", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  updateProgram: (id: number, input: ProgramInput) =>
    request<ProgramView>(`/api/programs/${id}`, {
      method: "PUT",
      body: JSON.stringify(input),
    }),
  setProgramEnabled: (id: number, enabled: boolean) =>
    request<ProgramView>(`/api/programs/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ enabled }),
    }),
  deleteProgram: (id: number) =>
    request<{ ok: boolean }>(`/api/programs/${id}`, { method: "DELETE" }),
  runProgramNow: (id: number) =>
    request<RunNowResponse>(`/api/programs/${id}/run`, { method: "POST" }),
  getHistory: (params: { page?: number; program?: number; status?: string }) => {
    const q = new URLSearchParams();
    if (params.page && params.page > 1) q.set("page", String(params.page));
    if (params.program) q.set("program", String(params.program));
    if (params.status) q.set("status", params.status);
    const qs = q.toString();
    return request<HistoryResponse>(`/api/history${qs ? `?${qs}` : ""}`);
  },
};
