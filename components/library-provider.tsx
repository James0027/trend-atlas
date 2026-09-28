"use client";
import { createContext, useContext } from "react";
import { useLibraryState } from "@/hooks/use-library";
import { useAuth } from "@/components/auth-provider";
const LibraryContext = createContext<ReturnType<typeof useLibraryState> | null>(null);
export function LibraryProvider({ children }: { children: React.ReactNode }) {
  const { user, ready } = useAuth();
  // A changed identity remounts private state before its children can render it.
  return <AccountLibrary key={ready ? user?.id || "guest" : "checking"}>{children}</AccountLibrary>;
}
function AccountLibrary({ children }: { children: React.ReactNode }) {
  const library = useLibraryState();
  return <LibraryContext.Provider value={library}>{children}</LibraryContext.Provider>;
}
export function useLibrary() {
  const value = useContext(LibraryContext);
  if (!value) throw new Error("LibraryProvider is missing");
  return value;
}
