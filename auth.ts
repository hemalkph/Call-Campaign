import { createHash } from "node:crypto";
import NextAuth, { CredentialsSignin } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { eq } from "drizzle-orm";
import { db, users } from "@/lib/db";
import { verifyPassword } from "@/lib/password";
import { clear, hit } from "@/lib/rate-limit";
import { loginSchema } from "@/lib/schemas";

export class RateLimited extends CredentialsSignin {
  code = "rate_limited";
}

const WINDOW = 15 * 60 * 1000;
// Per-IP cap on sign-in attempts. Tests raise it: every test browser signs in from 127.0.0.1.
const IP_LIMIT = Number(process.env.LOGIN_IP_LIMIT) || 30;
// Compared against when the email is unknown, so timing doesn't reveal which emails exist.
const DUMMY_HASH = "$2b$12$/AL5yb3nkXN4yoN.IlvwjuhqLjJZ39MndZex/Gz6SWR01kwf9Bdqm";

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  session: { strategy: "jwt", maxAge: 12 * 60 * 60 }, // one working day
  pages: { signIn: "/login" },
  logger: {
    // Wrong passwords are expected; don't fill the logs with their stack traces.
    error: (e) => void (e instanceof CredentialsSignin || e.name === "CredentialsSignin" || console.error(e)),
  },
  providers: [
    Credentials({
      credentials: { email: {}, password: {} },
      async authorize(raw, request) {
        const parsed = loginSchema.safeParse({ email: raw.email, password: raw.password }); // raw also carries redirectTo etc.
        if (!parsed.success) return null;
        const { email, password } = parsed.data;

        const emailKey = "email:" + createHash("sha256").update(email).digest("hex");
        const ip = request.headers.get("x-forwarded-for")?.split(",")[0].trim() || "unknown";
        const [emailOk, ipOk] = await Promise.all([hit(emailKey, 5, WINDOW), hit("ip:" + ip, IP_LIMIT, WINDOW)]);
        if (!emailOk || !ipOk) throw new RateLimited();

        const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
        const valid = await verifyPassword(password, user?.passwordHash ?? DUMMY_HASH);
        if (!user || !valid || !user.active) return null;

        await clear(emailKey);
        return { id: user.id, name: user.name, email: user.email, tokenVersion: user.tokenVersion };
      },
    }),
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user) token.tv = user.tokenVersion;
      return token;
    },
    session({ session, token }) {
      session.user.id = token.sub!;
      session.tv = token.tv ?? -1;
      return session;
    },
  },
});
