"use client";

import { usePathname, useRouter } from "next/navigation";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

/** Switches ?campaign= on the current page. */
export function CampaignPicker({ campaigns, value }: { campaigns: { id: string; name: string }[]; value: string }) {
  const router = useRouter();
  const pathname = usePathname();
  if (campaigns.length < 2) return null;
  return (
    <Select value={value} onValueChange={(v) => router.push(`${pathname}?campaign=${v}`)}>
      <SelectTrigger className="w-full sm:w-64" aria-label="Campaign">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {campaigns.map((c) => (
          <SelectItem key={c.id} value={c.id}>
            {c.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
