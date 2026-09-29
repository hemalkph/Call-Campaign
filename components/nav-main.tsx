"use client";

import type { LucideIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";

export type NavGroup = { label: string; items: { href: string; title: string; icon: LucideIcon }[] };

export const isActive = (pathname: string, href: string) => pathname === href || pathname.startsWith(href + "/");

export function NavMain({ groups }: { groups: NavGroup[] }) {
  const pathname = usePathname();
  const { setOpenMobile } = useSidebar();
  return groups.map((group) => (
    <SidebarGroup key={group.label}>
      <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
      <SidebarMenu>
        {group.items.map(({ href, title, icon: Icon }) => {
          const active = isActive(pathname, href);
          return (
            <SidebarMenuItem key={href}>
              <SidebarMenuButton asChild isActive={active} tooltip={title}>
                <Link href={href} aria-current={active ? "page" : undefined} onClick={() => setOpenMobile(false)}>
                  <Icon aria-hidden />
                  <span>{title}</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          );
        })}
      </SidebarMenu>
    </SidebarGroup>
  ));
}
