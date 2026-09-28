import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { authenticatedClient } from "@/lib/supabase/request";
import { GET, POST } from "@/app/api/admin/route";

const mocks = vi.hoisted(() => ({
  isAdmin: vi.fn(), serviceDatabase: vi.fn(), consumeBudget: vi.fn(), runCollection: vi.fn(),
  from: vi.fn(), select: vi.fn(), order: vi.fn(), limit: vi.fn(),
  signals: [] as AbortSignal[],
}));
vi.mock("@/lib/supabase/request", () => ({ authenticatedClient: vi.fn() }));
vi.mock("@/lib/database", () => ({ serviceDatabase: mocks.serviceDatabase }));
vi.mock("@/lib/collector", async importOriginal => ({
  ...await importOriginal<typeof import("../lib/collector")>(), runCollection: mocks.runCollection,
}));

const SERVER_SECRET = "synthetic-service-key-must-not-leave-server";
const RAW_BACKEND_ERROR = `database connection details: ${SERVER_SECRET}`;
const NOW = Date.parse("2026-09-27T12:00:00Z");
function boundedQuery(result: unknown, delay = 0, failure?: Error) {
  let signal: AbortSignal | undefined;
  const query = {
    abortSignal(value: AbortSignal) { signal = value; mocks.signals.push(value); return query; },
    then(resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) {
      return new Promise((finish, fail) => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        const cleanup = () => { if (timer) clearTimeout(timer); signal?.removeEventListener("abort", abort); };
        const abort = () => { cleanup(); fail(signal?.reason); };
        if (signal?.aborted) { abort(); return; }
        signal?.addEventListener("abort", abort, { once: true });
        const complete = () => { cleanup(); if (failure) fail(failure); else finish(result); };
        if (delay) timer = setTimeout(complete, delay);
        else void Promise.resolve().then(complete);
      }).then(resolve, reject);
    },
  };
  return query;
}
const authenticated = () => ({
  client: { rpc: mocks.isAdmin }, user: { id: "50000000-0000-4000-8000-000000000001", user_metadata: { is_admin: true } },
}) as unknown as NonNullable<Awaited<ReturnType<typeof authenticatedClient>>>;
const request = (method: "GET" | "POST") => new Request("https://trend-atlas.example/api/admin?is_admin=true", {
  method, headers: { Authorization: "Bearer synthetic-admin-test-token" },
  ...(method === "POST" ? { body: JSON.stringify({ is_admin: true, role: "admin" }) } : {}),
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  vi.resetAllMocks();
  mocks.signals.length = 0;
  vi.mocked(authenticatedClient).mockResolvedValue(authenticated());
  mocks.isAdmin.mockReturnValue(boundedQuery({ data: true, error: null }));
  mocks.consumeBudget.mockReturnValue(boundedQuery({ data: true, error: null }));
  mocks.runCollection.mockResolvedValue({ state: "ok", attempted: 2, saved: 2 });
  mocks.limit.mockReturnValue(boundedQuery({ data: [{ id: "run", status: "succeeded" }], error: null }));
  mocks.order.mockReturnValue({ limit: mocks.limit });
  mocks.select.mockImplementation((columns: string) => columns.includes("summary")
    ? { order: mocks.order }
    : boundedQuery({ data: [{ source_id: "hackernews", next_attempt: Date.now(), updated_at: new Date().toISOString() }], error: null }));
  mocks.from.mockReturnValue({ select: mocks.select });
  mocks.serviceDatabase.mockReturnValue({ rpc: mocks.consumeBudget, from: mocks.from });
});
afterEach(() => { vi.useRealTimers(); });

describe("admin authorization", () => {
  it.each([GET, POST])("returns 401 to unauthenticated requests", async handler => {
    vi.mocked(authenticatedClient).mockResolvedValue(null);
    const response = await handler(request(handler === GET ? "GET" : "POST"));
    expect(response.status).toBe(401);
    expect(mocks.isAdmin).not.toHaveBeenCalled();
    expect(mocks.serviceDatabase).not.toHaveBeenCalled();
    expect(mocks.runCollection).not.toHaveBeenCalled();
  });

  it.each([false, null, 1, "true", { is_admin: true }])("rejects nonliteral admin result %j despite forged client flags", async data => {
    mocks.isAdmin.mockReturnValue(boundedQuery({ data, error: null }));
    const response = await POST(request("POST"));
    expect(response.status).toBe(403);
    expect(mocks.isAdmin).toHaveBeenCalledExactlyOnceWith("is_admin");
    expect(mocks.serviceDatabase).not.toHaveBeenCalled();
    expect(mocks.runCollection).not.toHaveBeenCalled();
  });

  it("returns safe 503 when the admin RPC fails even with true data", async () => {
    mocks.isAdmin.mockReturnValue(boundedQuery({ data: true, error: { message: RAW_BACKEND_ERROR } }));
    const response = await GET(request("GET"));
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain(SERVER_SECRET);
    expect(mocks.serviceDatabase).not.toHaveBeenCalled();
  });

  it("returns safe 503 when admin verification transport rejects", async () => {
    mocks.isAdmin.mockReturnValue(boundedQuery(null, 0, new Error(RAW_BACKEND_ERROR)));
    const response = await POST(request("POST"));
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain(SERVER_SECRET);
    expect(mocks.runCollection).not.toHaveBeenCalled();
  });
});

describe("admin collection rate limit", () => {
  it("collects only after verified admin status and a server budget reservation", async () => {
    const response = await POST(request("POST"));
    expect(response.status).toBe(200);
    expect(mocks.isAdmin).toHaveBeenCalledWith("is_admin");
    expect(mocks.consumeBudget).toHaveBeenCalledWith("consume_api_budget", {
      p_bucket: expect.stringMatching(/^admin-refresh-\d+$/), p_limit: 1, p_expires: expect.any(Number),
    });
    expect(mocks.isAdmin.mock.invocationCallOrder[0]).toBeLessThan(mocks.consumeBudget.mock.invocationCallOrder[0]);
    expect(mocks.consumeBudget.mock.invocationCallOrder[0]).toBeLessThan(mocks.runCollection.mock.invocationCallOrder[0]);
    expect(mocks.runCollection).toHaveBeenCalledExactlyOnceWith("manual", NOW + 55_000);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.text()).not.toContain(SERVER_SECRET);
  });

  it.each([{ data: false, error: null }, { data: null, error: { message: RAW_BACKEND_ERROR } }])("returns 429 when budget is unavailable", async result => {
    mocks.consumeBudget.mockReturnValue(boundedQuery(result));
    const response = await POST(request("POST"));
    expect(response.status).toBe(429);
    expect(mocks.runCollection).not.toHaveBeenCalled();
    expect(await response.text()).not.toContain(SERVER_SECRET);
  });

  it("returns safe 503 when budget transport rejects", async () => {
    mocks.consumeBudget.mockReturnValue(boundedQuery(null, 0, new Error(RAW_BACKEND_ERROR)));
    const response = await POST(request("POST"));
    expect(response.status).toBe(503);
    expect(mocks.runCollection).not.toHaveBeenCalled();
    expect(await response.text()).not.toContain(SERVER_SECRET);
  });

  it("returns safe 503 for collection failures", async () => {
    mocks.runCollection.mockRejectedValue(new Error(RAW_BACKEND_ERROR));
    const response = await POST(request("POST"));
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain(SERVER_SECRET);
  });

  it("returns 503 without trying collection if the server is unconfigured", async () => {
    mocks.serviceDatabase.mockReturnValue(null);
    expect((await POST(request("POST"))).status).toBe(503);
    expect(mocks.consumeBudget).not.toHaveBeenCalled();
    expect(mocks.runCollection).not.toHaveBeenCalled();
  });
});

describe("admin operational status", () => {
  it("returns bounded operational fields after admin verification", async () => {
    const response = await GET(request("GET"));
    expect(response.status).toBe(200);
    expect(mocks.select).toHaveBeenCalledWith("id,started_at,ended_at,status,summary");
    expect(mocks.select).toHaveBeenCalledWith("source_id,next_attempt,updated_at");
    expect(mocks.limit).toHaveBeenCalledWith(20);
    expect(mocks.consumeBudget).not.toHaveBeenCalled();
    expect(mocks.runCollection).not.toHaveBeenCalled();
    expect(await response.text()).not.toContain(SERVER_SECRET);
  });

  it("redacts backend status query errors", async () => {
    mocks.limit.mockReturnValue(boundedQuery({ data: null, error: { message: RAW_BACKEND_ERROR } }));
    const response = await GET(request("GET"));
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain(SERVER_SECRET);
  });

  it("returns safe 503 when operational status transport rejects", async () => {
    mocks.limit.mockReturnValue(boundedQuery(null, 0, new Error(RAW_BACKEND_ERROR)));
    const response = await GET(request("GET"));
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain(SERVER_SECRET);
  });
});

describe("admin whole-request budget", () => {
  it("does not wait indefinitely for slow user verification or start any privileged work", async () => {
    vi.mocked(authenticatedClient).mockImplementation(() => new Promise(() => undefined));
    const pending = POST(request("POST"));
    await vi.runAllTimersAsync();
    expect((await pending).status).toBe(503);
    expect(Date.now()).toBe(NOW + 10_000);
    expect(mocks.isAdmin).not.toHaveBeenCalled();
    expect(mocks.runCollection).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("passes the entry deadline unchanged after slow authorization and budget checks", async () => {
    vi.mocked(authenticatedClient).mockImplementation(() => new Promise(resolve => setTimeout(() => resolve(authenticated()), 6_000)));
    mocks.isAdmin.mockReturnValue(boundedQuery({ data: true, error: null }, 7_000));
    mocks.consumeBudget.mockReturnValue(boundedQuery({ data: true, error: null }, 6_000));
    const pending = POST(request("POST"));
    await vi.runAllTimersAsync();
    expect((await pending).status).toBe(200);
    expect(Date.now()).toBe(NOW + 19_000);
    expect(mocks.runCollection).toHaveBeenCalledExactlyOnceWith("manual", NOW + 55_000);
    expect(mocks.signals).toHaveLength(2);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("aborts a slow admin RPC before reserving budget or invoking collection", async () => {
    mocks.isAdmin.mockReturnValue(boundedQuery({ data: true, error: null }, 60_000));
    const pending = POST(request("POST"));
    await vi.runAllTimersAsync();
    expect((await pending).status).toBe(503);
    expect(Date.now()).toBe(NOW + 8_000);
    expect(mocks.signals[0].aborted).toBe(true);
    expect(mocks.consumeBudget).not.toHaveBeenCalled();
    expect(mocks.runCollection).not.toHaveBeenCalled();
  });
  it("aborts a slow manual quota RPC and never starts collection", async () => {
    mocks.consumeBudget.mockReturnValue(boundedQuery({ data: true, error: null }, 60_000));
    const pending = POST(request("POST"));
    await vi.runAllTimersAsync();
    expect((await pending).status).toBe(503);
    expect(Date.now()).toBe(NOW + 8_000);
    expect(mocks.signals.at(-1)?.aborted).toBe(true);
    expect(mocks.runCollection).not.toHaveBeenCalled();
  });
  it("bounds slow status queries and reports degraded collection as unavailable", async () => {
    mocks.limit.mockReturnValue(boundedQuery({ data: [], error: null }, 60_000));
    const pending = GET(request("GET"));
    await vi.runAllTimersAsync();
    expect((await pending).status).toBe(503);
    expect(Date.now()).toBe(NOW + 8_000);
    expect(mocks.signals.some(signal => signal.aborted)).toBe(true);
    mocks.runCollection.mockResolvedValue({ state: "degraded", saved: 0 });
    expect((await POST(request("POST"))).status).toBe(503);
  });
});
