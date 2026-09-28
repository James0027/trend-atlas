import { beforeEach, describe, expect, it, vi } from "vitest";

const fake = vi.hoisted(() => ({
  exchange: vi.fn(), create: vi.fn(), set: vi.fn(),
}));
vi.mock("@supabase/ssr", () => ({ createServerClient: fake.create }));
vi.mock("next/headers", () => ({ cookies: async () => ({ getAll: () => [{name:"verifier",value:"test-only"}], set: fake.set }) }));
import { GET } from "../app/auth/callback/route";

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://test.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "public-test-key");
  fake.exchange.mockReset().mockResolvedValue({error:null});
  fake.create.mockReset().mockReturnValue({auth:{exchangeCodeForSession:fake.exchange}});
  fake.set.mockReset();
});

describe("OAuth callback", () => {
  it("exchanges the code with the public key and browser cookies", async () => {
    const response = await GET(new Request("https://atlas.example/auth/callback?code=one-use-code&next=https://evil.example"));
    expect(fake.exchange).toHaveBeenCalledWith("one-use-code");
    expect(fake.create.mock.calls[0].slice(0,2)).toEqual(["https://test.supabase.co","public-test-key"]);
    const options = fake.create.mock.calls[0][2];
    expect(options.cookies.getAll()).toEqual([{name:"verifier",value:"test-only"}]);
    options.cookies.setAll([{name:"session",value:"not-real",options:{secure:true}}]);
    expect(fake.set).toHaveBeenCalledWith("session","not-real",{secure:true});
    expect(response.headers.get("location")).toBe("https://atlas.example/account");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
  it("does not exchange absent or oversized codes", async () => {
    for (const suffix of ["", `?code=${"x".repeat(4097)}`]) {
      const response = await GET(new Request(`https://atlas.example/auth/callback${suffix}`));
      expect(response.headers.get("location")).toBe("https://atlas.example/account?error=oauth");
    }
    expect(fake.create).not.toHaveBeenCalled();
  });
  it("returns a fixed safe failure route when the exchange fails", async () => {
    fake.exchange.mockResolvedValue({error:{message:"provider-secret-sensitive"}});
    const response = await GET(new Request("https://atlas.example/auth/callback?code=test&next=//evil.example", {headers:{"x-forwarded-host":"evil.example"}}));
    expect(response.headers.get("location")).toBe("https://atlas.example/account?error=oauth");
    expect(await response.text()).not.toContain("provider-secret-sensitive");
  });
  it("handles unavailable configuration and transport errors without leaking details", async () => {
    fake.exchange.mockRejectedValue(new Error("private-diagnostic"));
    expect((await GET(new Request("https://atlas.example/auth/callback?code=test"))).headers.get("location")).toBe("https://atlas.example/account?error=oauth");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    fake.create.mockClear();
    await GET(new Request("https://atlas.example/auth/callback?code=test"));
    expect(fake.create).not.toHaveBeenCalled();
  });
});
