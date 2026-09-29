"use client";

import { ChevronLeft, ChevronRight, MessageCircle, Search } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { StageBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { type TemplateOption, WhatsAppPicker } from "@/components/whatsapp-picker";
import type { ActiveCampaign, ListParams } from "@/lib/contacts-query";
import { fmtDateTime, fmtDay } from "@/lib/time";
import { cn } from "@/lib/utils";
import type { Stage } from "@/lib/vocab";
import { setWhatsappSent } from "./actions";

type Row = { id: string; name: string; phone: string; stage: Stage; lastWhatsappAt: string | null };

type Props = {
  me: { name: string };
  campaigns: { id: string; name: string }[];
  campaign: ActiveCampaign;
  params: ListParams;
  rows: Row[];
  total: number;
  pageSize: number;
  templates: TemplateOption[];
};

export function WhatsAppList({ me, campaigns, campaign, params, rows, total, pageSize, templates }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  const [picking, setPicking] = useState<Row>();
  const [sentAt, setSentAt] = useState<Record<string, string | null>>({}); // optimistic overrides
  const [q, setQ] = useState(params.q ?? "");

  function go(patch: Record<string, string | undefined>) {
    const sp = new URLSearchParams();
    const next = { campaign: params.campaign, q: params.q, notMessaged: params.notMessaged, page: undefined as string | undefined, ...patch };
    for (const [k, v] of Object.entries(next)) if (v && v !== "1") sp.set(k, v);
    startTransition(() => router.replace(`${pathname}?${sp}`, { scroll: false }));
  }

  useEffect(() => {
    if (q === (params.q ?? "")) return;
    const t = setTimeout(() => go({ q: q || undefined }), 350);
    return () => clearTimeout(t);
  });

  async function toggle(row: Row, sent: boolean) {
    const previous = sentAt[row.id] !== undefined ? sentAt[row.id] : row.lastWhatsappAt;
    setSentAt((s) => ({ ...s, [row.id]: sent ? new Date().toISOString() : null }));
    try {
      const res = await setWhatsappSent({ contactId: row.id, sent });
      if (!res.ok) throw new Error(res.error);
      setSentAt((s) => ({ ...s, [row.id]: res.lastWhatsappAt }));
    } catch (e) {
      setSentAt((s) => ({ ...s, [row.id]: previous })); // roll back
      toast.error(e instanceof Error && e.message !== "Failed to fetch" ? e.message : "Couldn't save — check your connection.");
    }
  }

  const pages = Math.max(1, Math.ceil(total / pageSize));
  const vars = (r: Row) => ({
    name: r.name,
    class: campaign.classLabel,
    fee: campaign.fee,
    start_date: fmtDay(campaign.startDate),
    link: campaign.link,
    caller: me.name,
  });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {campaigns.length > 1 && (
          <Select value={campaign.id} onValueChange={(v) => go({ campaign: v, q: undefined })}>
            <SelectTrigger className="w-full sm:w-56" aria-label="Campaign">
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
        )}
        <div className="relative min-w-0 flex-1 basis-48">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input type="search" aria-label="Search name or phone" placeholder="Search name or phone" className="pl-8" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="flex items-center gap-2">
          <Checkbox id="not-messaged" checked={!!params.notMessaged} onCheckedChange={(v) => go({ notMessaged: v ? "yes" : undefined })} />
          <Label htmlFor="not-messaged">Not yet messaged</Label>
        </div>
      </div>

      {!templates.length && <p className="text-sm text-muted-foreground">No message templates yet — ask the owner to add some.</p>}

      <ul className={cn("divide-y rounded-lg border transition-opacity", pending && "opacity-60")} aria-busy={pending}>
        {rows.map((r) => {
          const last = sentAt[r.id] !== undefined ? sentAt[r.id] : r.lastWhatsappAt;
          return (
            <li key={r.id} className="flex flex-wrap items-center gap-3 p-3">
              <div className="min-w-0 flex-1 basis-48">
                <p className="font-medium">{r.name}</p>
                <p className="text-sm text-muted-foreground tabular-nums">
                  {r.phone} · {last ? `Messaged ${fmtDateTime(last)}` : "Not messaged"}
                </p>
              </div>
              <StageBadge stage={r.stage} />
              <Button variant="outline" onClick={() => setPicking(r)}>
                <MessageCircle aria-hidden /> Open WhatsApp
              </Button>
              <div className="flex items-center gap-2">
                <Checkbox id={`sent-${r.id}`} checked={!!last} onCheckedChange={(v) => toggle(r, !!v)} />
                <Label htmlFor={`sent-${r.id}`}>Sent</Label>
              </div>
            </li>
          );
        })}
        {!rows.length && <li className="p-8 text-center text-sm text-muted-foreground">No contacts here.</li>}
      </ul>

      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>{total} contacts</span>
        <div className="flex items-center gap-1">
          <Button variant="outline" size="icon" disabled={params.page <= 1} onClick={() => go({ page: String(params.page - 1) })}>
            <ChevronLeft aria-hidden />
            <span className="sr-only">Previous page</span>
          </Button>
          <span className="px-2">
            Page {params.page} of {pages}
          </span>
          <Button variant="outline" size="icon" disabled={params.page >= pages} onClick={() => go({ page: String(params.page + 1) })}>
            <ChevronRight aria-hidden />
            <span className="sr-only">Next page</span>
          </Button>
        </div>
      </div>

      {picking && (
        <WhatsAppPicker
          key={picking.id}
          contactId={picking.id}
          phone={picking.phone}
          templates={templates}
          vars={vars(picking)}
          open
          onOpenChange={(o) => !o && setPicking(undefined)}
          onSent={(at) => setSentAt((s) => ({ ...s, [picking.id]: at }))}
        />
      )}
    </div>
  );
}
