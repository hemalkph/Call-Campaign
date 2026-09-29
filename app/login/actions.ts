"use server";

import { AuthError, type CredentialsSignin } from "next-auth";
import { signIn, signOut } from "@/auth";
import { loginSchema } from "@/lib/schemas";

export async function login(input: unknown): Promise<{ error: string }> {
  const parsed = loginSchema.safeParse(input);
  if (!parsed.success) return { error: "Enter your email and password." };
  try {
    await signIn("credentials", { ...parsed.data, redirectTo: "/" });
  } catch (e) {
    if (e instanceof AuthError) {
      return (e as CredentialsSignin).code === "rate_limited"
        ? { error: "Too many attempts. Wait 15 minutes and try again." }
        : { error: "Wrong email or password, or the account is deactivated." };
    }
    throw e; // includes the success redirect
  }
  return { error: "Sign-in failed." };
}

export async function logout() {
  await signOut({ redirectTo: "/login" });
}
