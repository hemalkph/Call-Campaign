import "next-auth";
import "next-auth/jwt";

declare module "next-auth" {
  interface User {
    tokenVersion?: number;
  }
  interface Session {
    tv: number;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    tv?: number;
  }
}
