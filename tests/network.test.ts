import { afterEach, expect, it, vi } from "vitest";
import { boundedFetch } from "../lib/network";
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();vi.restoreAllMocks();});
it("preserves request options and aborts an unresponsive cloud service", async()=>{
  vi.useFakeTimers();
  vi.spyOn(AbortSignal,"timeout").mockImplementation(delay=>{
    const controller=new AbortController();
    setTimeout(()=>controller.abort(new DOMException("Timed out","TimeoutError")),delay);
    return controller.signal;
  });
  const transport=vi.fn<typeof fetch>(async(_input,init)=>new Promise((_resolve,reject)=>init?.signal?.addEventListener("abort",()=>reject(init.signal?.reason),{once:true})));
  vi.stubGlobal("fetch",transport);
  const response=boundedFetch("https://test.supabase.co",{method:"POST",headers:{Authorization:"Bearer test-only"},body:"{}"});
  const check=expect(response).rejects.toMatchObject({name:"TimeoutError"});
  expect(transport.mock.calls[0][1]).toMatchObject({method:"POST",body:"{}",headers:{Authorization:"Bearer test-only"}});
  await vi.advanceTimersByTimeAsync(10_000);
  await check;
});
it("preserves the caller's earlier cancellation",async()=>{
  const controller=new AbortController();
  const transport=vi.fn<typeof fetch>(async(_input,init)=>{
    controller.abort();
    expect(init?.signal?.aborted).toBe(true);
    throw init?.signal?.reason;
  });
  vi.stubGlobal("fetch",transport);
  await expect(boundedFetch("https://test.supabase.co",{signal:controller.signal})).rejects.toMatchObject({name:"AbortError"});
});
