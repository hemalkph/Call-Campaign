import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getCurrentUser } from "@/lib/session";
import { PasswordForm } from "./password-form";

export const metadata = { title: "Change password" };

export default async function ChangePasswordPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return (
    <main className="flex min-h-svh items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-xl">{user.mustChangePassword ? "Choose your password" : "Change password"}</CardTitle>
          <CardDescription>
            {user.mustChangePassword
              ? "You signed in with a temporary password. Choose your own before continuing."
              : "Other devices will be signed out."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <PasswordForm />
          {!user.mustChangePassword && (
            <Link href="/" className="block text-center text-sm text-muted-foreground underline-offset-4 hover:underline">
              Back
            </Link>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
