import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { SOURCES } from "@/lib/catalog";
import { emptyLibrary } from "@/lib/library";
import { authenticatedClient } from "@/lib/supabase/request";
import { GET, POST } from "@/app/api/library/route";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(), getUser: vi.fn(), from: vi.fn(), select: vi.fn(),
  eq: vi.fn(), maybeSingle: vi.fn(), rpc: vi.fn(), serviceDatabase: vi.fn(),
}));
vi.mock("@supabase/supabase-js", () => ({ createClient: mocks.createClient }));
vi.mock("@/lib/database", () => ({ serviceDatabase: mocks.serviceDatabase }));
vi.mock("@/lib/supabase/request", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase/request")>();
  return { ...actual, authenticatedClient: vi.fn(actual.authenticatedClient) };
});

const OWNER = "50000000-0000-4000-8000-000000000001";
const OTHER = "50000000-0000-4000-8000-000000000002";
const TOKEN = "verified.fixture.token.with.twenty.characters";
const SERVER_SECRET = "synthetic-service-key-must-not-leave-server";
const RAW_BACKEND_ERROR = `connection details: ${SERVER_SECRET}`;
let requestHelpers: typeof import("@/lib/supabase/request");

function request(method: "GET" | "POST", body?: unknown, authorization = `Bearer ${TOKEN}`, query = "") {
  return new Request(`https://trend-atlas.example/api/library${query}`, {
    method, headers: { Authorization: authorization, "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

beforeAll(async () => { requestHelpers = await vi.importActual("@/lib/supabase/request"); });
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://fixture.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "public-anon-key");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", SERVER_SECRET);
  vi.mocked(authenticatedClient).mockImplementation(requestHelpers.authenticatedClient);
  mocks.getUser.mockResolvedValue({ data: { user: { id: OWNER } }, error: null });
  mocks.maybeSingle.mockResolvedValue({ data: null, error: null });
  mocks.rpc.mockResolvedValue({ data: [{ data: emptyLibrary(), revision: 1 }], error: null });
  const query = { select: mocks.select, eq: mocks.eq, maybeSingle: mocks.maybeSingle };
  mocks.from.mockReturnValue(query); mocks.select.mockReturnValue(query); mocks.eq.mockReturnValue(query);
  mocks.createClient.mockReturnValue({ auth: { getUser: mocks.getUser }, from: mocks.from, rpc: mocks.rpc });
});
afterEach(() => { vi.unstubAllEnvs(); });

describe("library authentication and owner isolation", () => {
  it.each(["", "Basic credentials", "Bearer short", "Bearer invalid token with spaces"])("rejects malformed authorization: %s", async authorization => {
    const response = await GET(request("GET", undefined, authorization));
    expect(response.status).toBe(401);
    expect(mocks.createClient).not.toHaveBeenCalled();
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("rejects a token that the auth server does not validate", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: OWNER } }, error: { message: RAW_BACKEND_ERROR } });
    const response = await POST(request("POST", { data: emptyLibrary(), revision: 0 }));
    expect(response.status).toBe(401);
    expect(mocks.getUser).toHaveBeenCalledWith(TOKEN);
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(await response.text()).not.toContain(SERVER_SECRET);
  });

  it("waits for getUser and reads only its verified id despite forged query parameters", async () => {
    let finishVerification!: (value: unknown) => void;
    mocks.getUser.mockReturnValue(new Promise(resolve => { finishVerification = resolve; }));
    const pending = GET(request("GET", undefined, `Bearer ${TOKEN}`, `?user_id=${OTHER}`));
    await vi.waitFor(() => expect(mocks.getUser).toHaveBeenCalledWith(TOKEN));
    expect(mocks.from).not.toHaveBeenCalled();
    finishVerification({ data: { user: { id: OWNER } }, error: null });
    const response = await pending;
    expect(response.status).toBe(200);
    expect(mocks.from).toHaveBeenCalledWith("user_library");
    expect(mocks.eq).toHaveBeenCalledWith("user_id", OWNER);
    expect(mocks.eq).not.toHaveBeenCalledWith("user_id", OTHER);
    expect(await response.json()).toEqual({ data: emptyLibrary(), revision: 0 });
  });

  it("writes through the user's JWT and never forwards a caller supplied user id", async () => {
    const response = await POST(request("POST", {
      user_id: OTHER, revision: 0, data: { ...emptyLibrary(), user_id: OTHER },
    }));
    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("save_library", { p_data: emptyLibrary(), p_expected_revision: 0 });
    expect(mocks.createClient).toHaveBeenCalledWith("https://fixture.supabase.co", "public-anon-key", {
      global: { fetch: expect.any(Function), headers: { Authorization: `Bearer ${TOKEN}` } },
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    expect(mocks.serviceDatabase).not.toHaveBeenCalled();
    expect(await response.text()).not.toContain(SERVER_SECRET);
  });
});

describe("bounded library request body", () => {
  it.each([-1, 1.5, "1", Number.MAX_SAFE_INTEGER + 1, null])("rejects invalid revision %s before any save", async revision => {
    expect((await POST(request("POST", { data: emptyLibrary(), revision }))).status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("cancels an oversized actual stream even when content-length lies", async () => {
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(260_000));
        controller.enqueue(new Uint8Array(260_000));
      }, cancel,
    });
    const req = new Request("https://trend-atlas.example/api/library", {
      method: "POST", headers: { Authorization: `Bearer ${TOKEN}`, "Content-Length": "10" },
      body, duplex: "half",
    } as RequestInit & { duplex: "half" });
    const response = await POST(req);
    expect(response.status).toBe(400);
    expect(cancel).toHaveBeenCalledOnce();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("enforces the saved data byte limit inside the larger transport limit", async () => {
    const source = SOURCES.find(entry => entry.adapter === "hn")!;
    const now = Date.now() - 1000;
    const bookmarks = [];
    let serialized = "";
    for (let i = 0; i < 500; i++) {
      bookmarks.push({ id: `fixture-${i}`, sourceId: source.id, platform: source.platform, region: source.region,
        title: "x".repeat(500), description: "y".repeat(650), url: `https://example.com/item/${i}`,
        topics: ["ai"], rank: 1, score: 100, history: [], fetchedAt: now, firstSeen: now });
      serialized = JSON.stringify({ data: { ...emptyLibrary(), bookmarks }, revision: 0 });
      if (Buffer.byteLength(serialized) > 500_200) break;
    }
    expect(Buffer.byteLength(serialized)).toBeLessThan(510_000);
    const response = await POST(new Request("https://trend-atlas.example/api/library", {
      method: "POST", headers: { Authorization: `Bearer ${TOKEN}` }, body: serialized,
    }));
    expect(response.status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("rejects malformed JSON and invalid library entries without invoking RPC", async () => {
    const malformed = new Request("https://trend-atlas.example/api/library", {
      method: "POST", headers: { Authorization: `Bearer ${TOKEN}` }, body: '{"data":',
    });
    expect((await POST(malformed)).status).toBe(400);
    expect((await POST(request("POST", { revision: 0, data: { ...emptyLibrary(), overrides: { fixture: ["unknown"] } } }))).status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});

describe("safe library responses", () => {
  it("maps a concurrent save conflict to 409 and reveals no backend error", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "40001", message: RAW_BACKEND_ERROR } });
    const response = await POST(request("POST", { data: emptyLibrary(), revision: 3 }));
    expect(response.status).toBe(409);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.text()).not.toContain(SERVER_SECRET);
  });

  it("returns a safe 503 for a backend RPC error", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "XX000", message: RAW_BACKEND_ERROR } });
    const response = await POST(request("POST", { data: emptyLibrary(), revision: 0 }));
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain(SERVER_SECRET);
  });

  it("returns a safe 503 when save transport rejects", async () => {
    mocks.rpc.mockRejectedValue(new Error(RAW_BACKEND_ERROR));
    const response = await POST(request("POST", { data: emptyLibrary(), revision: 0 }));
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain(SERVER_SECRET);
  });

  it("returns a safe 503 when stored data cannot be parsed", async () => {
    mocks.maybeSingle.mockResolvedValue({ data: { data: { secret: SERVER_SECRET }, revision: 1 }, error: null });
    const response = await GET(request("GET"));
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain(SERVER_SECRET);
  });

  it("returns a safe 503 when read transport rejects", async () => {
    mocks.maybeSingle.mockRejectedValue(new Error(RAW_BACKEND_ERROR));
    const response = await GET(request("GET"));
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain(SERVER_SECRET);
  });

  it("returns a safe 503 for an invalid successful RPC record", async () => {
    mocks.rpc.mockResolvedValue({ data: [{ data: { secret: SERVER_SECRET }, revision: 2 }], error: null });
    const response = await POST(request("POST", { data: emptyLibrary(), revision: 1 }));
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain(SERVER_SECRET);
  });
});
