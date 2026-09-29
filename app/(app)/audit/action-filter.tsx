"use client";

import { useRouter } from "next/navigation";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const ALL = "all";

export function ActionFilter({ actions, value }: { actions: { value: string; label: string }[]; value?: string }) {
  const router = useRouter();
  return (
    <Select value={value ?? ALL} onValueChange={(v) => router.push(v === ALL ? "/audit" : `/audit?action=${encodeURIComponent(v)}`)}>
      <SelectTrigger className="w-full sm:w-56" aria-label="Filter by action">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>All actions</SelectItem>
        {actions.map((a) => (
          <SelectItem key={a.value} value={a.value}>
            {a.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
