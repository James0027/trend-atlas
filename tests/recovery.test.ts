import { beforeEach, expect, it } from "vitest";
import { clearRecovery, hasRecovery, rememberRecovery } from "../lib/recovery";
let values: Map<string,string>;
const storage={getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>{values.set(key,value);},removeItem:(key:string)=>{values.delete(key);}};
beforeEach(()=>{values=new Map();});
it("restores the same-tab recovery form for the same user after reload",()=>{
  rememberRecovery(storage,"account-a",1000);
  expect(hasRecovery(storage,"account-a",2000)).toBe(true);
  expect(hasRecovery(storage,"account-b",2000)).toBe(false);
  expect(hasRecovery(storage,undefined,2000)).toBe(false);
});
it("expires markers and rejects malformed or unbounded state",()=>{
  rememberRecovery(storage,"account-a",1000);
  expect(hasRecovery(storage,"account-a",3_601_000)).toBe(false);
  storage.setItem("ta-password-recovery",JSON.stringify({userId:"account-a",expiresAt:Number.MAX_SAFE_INTEGER}));
  expect(hasRecovery(storage,"account-a",2000)).toBe(false);
  storage.setItem("ta-password-recovery","invalid-json");
  expect(hasRecovery(storage,"account-a",2000)).toBe(false);
});
it("clears recovery state after logout or a successful password change",()=>{
  rememberRecovery(storage,"account-a",1000); clearRecovery(storage);
  expect(hasRecovery(storage,"account-a",2000)).toBe(false);
});
