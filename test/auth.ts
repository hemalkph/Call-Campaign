import { vi } from "vitest";
import { auth } from "@/auth";

/** Makes the next requireUser() see this user's session (null = signed out). */
export const signedInAs = (u: { id: string; tokenVersion: number } | null) =>
  vi.mocked(auth).mockResolvedValue((u ? { user: { id: u.id }, tv: u.tokenVersion, expires: "" } : null) as never);
