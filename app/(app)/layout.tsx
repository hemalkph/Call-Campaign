import { AppHeader, AppSidebar } from "@/components/app-sidebar";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { requireUser } from "@/lib/session";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();

  return (
    <SidebarProvider>
      <AppSidebar user={user} />
      <SidebarInset className="min-w-0">
        <AppHeader role={user.role} />
        <main className="mx-auto w-full max-w-6xl p-4 md:p-6">{children}</main>
      </SidebarInset>
    </SidebarProvider>
  );
}
