import { redirect } from "next/navigation";
import { requireUser } from "@/lib/session";

export default async function Home() {
  const user = await requireUser();
  redirect(user.role === "owner" ? "/dashboard" : "/today");
}
