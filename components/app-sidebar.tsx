"use client";

import {
  AlarmClock,
  CalendarCheck,
  Columns3,
  Contact,
  History,
  LayoutDashboard,
  Megaphone,
  MessageCircle,
  MessageSquareText,
  Phone,
  Users,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { isActive, NavMain, type NavGroup } from "@/components/nav-main";
import { NavUser } from "@/components/nav-user";
import { Breadcrumb, BreadcrumbItem, BreadcrumbList, BreadcrumbPage } from "@/components/ui/breadcrumb";
import { Separator } from "@/components/ui/separator";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import type { CurrentUser } from "@/lib/session";

const NAV: Record<CurrentUser["role"], NavGroup[]> = {
  owner: [
    {
      label: "Overview",
      items: [
        { href: "/dashboard", title: "Dashboard", icon: LayoutDashboard },
        { href: "/pipeline", title: "Pipeline", icon: Columns3 },
      ],
    },
    {
      label: "Campaign work",
      items: [
        { href: "/campaigns", title: "Campaigns", icon: Megaphone },
        { href: "/contacts", title: "Contacts", icon: Contact },
        { href: "/callbacks", title: "Callbacks", icon: AlarmClock },
        { href: "/templates", title: "Templates", icon: MessageSquareText },
      ],
    },
    {
      label: "Admin",
      items: [
        { href: "/users", title: "Users", icon: Users },
        { href: "/audit", title: "Audit log", icon: History },
      ],
    },
  ],
  caller: [
    {
      label: "My work",
      items: [
        { href: "/today", title: "Today", icon: CalendarCheck },
        { href: "/calling", title: "Calling", icon: Phone },
        { href: "/whatsapp", title: "WhatsApp", icon: MessageCircle },
        { href: "/callbacks", title: "Callbacks", icon: AlarmClock },
        { href: "/contacts", title: "My contacts", icon: Contact },
      ],
    },
  ],
};

export function AppSidebar({ user }: { user: CurrentUser }) {
  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild tooltip="Call Campaign">
              <Link href="/">
                <Image src="/logo.png" alt="" width={32} height={32} className="size-8 shrink-0 rounded-lg" priority />
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-semibold">Call Campaign</span>
                  <span className="truncate text-xs text-muted-foreground">Pasindu Athukorala ICT</span>
                </div>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <NavMain groups={NAV[user.role]} />
      </SidebarContent>
      <SidebarFooter>
        <NavUser user={user} />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}

/** Top bar: sidebar toggle + where you are. */
export function AppHeader({ role }: { role: CurrentUser["role"] }) {
  const pathname = usePathname();
  const title = NAV[role].flatMap((g) => g.items).find((i) => isActive(pathname, i.href))?.title;
  return (
    <header className="sticky top-0 z-10 flex h-14 shrink-0 items-center gap-2 border-b bg-background/95 backdrop-blur md:h-12">
      <div className="flex items-center gap-2 px-4">
        <SidebarTrigger className="-ml-1" />
        <Separator orientation="vertical" className="mr-2 data-vertical:h-4 data-vertical:self-auto" />
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbPage>{title ?? "Call Campaign"}</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      </div>
    </header>
  );
}
