import bcrypt from "bcryptjs";

export { tempPassword } from "./generate-password";

export const hashPassword = (pw: string) => bcrypt.hash(pw, 12);
export const verifyPassword = (pw: string, hash: string) => bcrypt.compare(pw, hash);
