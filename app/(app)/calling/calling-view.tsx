"use client";

import { MessageCircle, Phone, PhoneOff, SkipForward } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { StageBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { type TemplateOption, WhatsAppPicker } from "@/components/whatsapp-picker";
import { OUTCOME_KEYS } from "@/lib/calling";
import type { ActiveCampaign } from "@/lib/contacts-query";
import type { ContactCard, NextReason } from "@/lib/next-contact";
import { telLink } from "@/lib/phone";
import { callbackChips, fmtDateTime, fmtDay, fromLocalInput, toLocalInput } from "@/lib/time";
import { cn } from "@/lib/utils";
import { OUTCOME_LABEL, type Outcome } from "@/lib/vocab";
import { getNextContact, logCall, undoCall } from "./actions";

type Props = {
  me: { name: string };
  campaigns: { id: string; name: string }[];
  campaign: ActiveCampaign;
  initialCard: ContactCard | null;
  callsToday: number;
  templates: TemplateOption[];
  emptyAction: React.ReactNode;
};

type Form = { outcome?: Outcome; notes: string; minutes: string; callbackAt: string; callbackNote: string };
const EMPTY: Form = { notes: "", minutes: "", callbackAt: "", callbackNote: "" };

const REASON: Record<NextReason, { label: string; className: string }> = {
  overdue_callback: { label: "Overdue callback", className: "bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-100" },
  callback_today: { label: "Callback today", className: "bg-amber-100 text-amber-900 dark:bg-amber-900 dark:text-amber-100" },
  never_called: { label: "Not called yet", className: "bg-sky-100 text-sky-900 dark:bg-sky-900 dark:text-sky-100" },
  follow_up: { label: "Follow-up", className: "bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-100" },
  chosen: { label: "Opened from list", className: "bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-100" },
};

const isTyping = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName) || !!t.closest("[role=dialog]"));

export function CallingView({ me, campaigns, campaign, initialCard, callsToday: initialCalls, templates, emptyAction }: Props) {
  const router = useRouter();
  const [card, setCard] = useState(initialCard);
  const [form, setForm] = useState<Form>(EMPTY);
  const [callsToday, setCallsToday] = useState(initialCalls);
  const [skip, setSkip] = useState<string[]>([]);
  const [waOpen, setWaOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  // The next contact is fetched in the background, so "Save & next" is instant.
  const prefetch = useRef<{ forId: string | null; promise: Promise<ContactCard | null> } | null>(null);

  const fetchNext = useCallback(
    async (exclude: string[], contactId?: string) => {
      const res = await getNextContact({ campaignId: campaign.id, skip: exclude.slice(-500), contactId });
      if (!res.ok) throw new Error(res.error);
      return res.card;
    },
    [campaign.id],
  );

  useEffect(() => {
    if (!card) return;
    const promise = fetchNext([...skip, card.id]);
    promise.catch(() => {}); // failures surface when the caller moves on
    prefetch.current = { forId: card.id, promise };
  }, [card, skip, fetchNext]);

  async function advance(exclude: string[]) {
    const p = prefetch.current;
    return p && p.forId === card?.id ? p.promise : fetchNext(exclude);
  }

  const set = (patch: Partial<Form>) => setForm((f) => ({ ...f, ...patch }));

  async function saveAndNext() {
    if (!card || !form.outcome || saving) return;
    const needsTime = form.outcome === "callback_requested";
    const due = needsTime ? fromLocalInput(form.callbackAt) : null;
    if (needsTime && !due) return void toast.error("Pick a time for the callback.");

    const snapshot = { card, form };
    setSaving(true);
    let next: ContactCard | null;
    try {
      next = await advance([...skip, card.id]);
    } catch {
      setSaving(false);
      return void toast.error("Couldn't reach the server. Nothing was saved — try again.");
    }
    // Optimistic: show the next contact now, save in the background, roll back if it fails.
    setCard(next);
    setForm(EMPTY);
    setCallsToday((n) => n + 1);
    setSaving(false);

    const rollback = (message: string) => {
      setCard(snapshot.card);
      setForm(snapshot.form); // nothing the caller typed is lost
      setCallsToday((n) => n - 1);
      toast.error(message);
    };
    try {
      const minutes = Number(snapshot.form.minutes);
      const res = await logCall({
        contactId: snapshot.card.id,
        outcome: snapshot.form.outcome,
        notes: snapshot.form.notes,
        ...(snapshot.form.minutes && minutes >= 0 ? { durationSec: Math.round(minutes * 60) } : {}),
        ...(due ? { callbackAt: due.toISOString(), callbackNote: snapshot.form.callbackNote } : {}),
      });
      if (!res.ok) return rollback(res.error);
      toast.success(`${snapshot.card.name}: ${OUTCOME_LABEL[snapshot.form.outcome!]}`, {
        duration: 10_000,
        action: { label: "Undo", onClick: () => undo(res.callId, snapshot) },
      });
    } catch {
      rollback("Couldn't save the call — you're back on it. Check your connection and try again.");
    }
  }

  async function undo(callId: string, snapshot: { card: ContactCard; form: Form }) {
    try {
      const res = await undoCall(callId);
      if (!res.ok) return void toast.error(res.error);
      const fresh = await fetchNext([], snapshot.card.id);
      setCard(fresh ?? snapshot.card);
      setForm(snapshot.form);
      setCallsToday((n) => n - 1);
      toast.info("Call undone");
    } catch {
      toast.error("Couldn't undo — check your connection.");
    }
  }

  async function skipContact() {
    if (!card || saving) return;
    const nextSkip = [...skip, card.id];
    setSaving(true);
    try {
      const next = await advance(nextSkip);
      setSkip(nextSkip);
      setCard(next);
      setForm(EMPTY);
    } catch {
      toast.error("Couldn't load the next contact — check your connection.");
    } finally {
      setSaving(false);
    }
  }

  // Desktop shortcuts: 1–9 outcome, N save & next, C call, W WhatsApp.
  const keys = useRef({ saveAndNext, card });
  useEffect(() => {
    keys.current = { saveAndNext, card };
  });
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target) || !keys.current.card) return;
      const k = e.key.toLowerCase();
      if (/^[1-9]$/.test(k)) set({ outcome: OUTCOME_KEYS[Number(k) - 1] });
      else if (k === "n") keys.current.saveAndNext();
      else if (k === "c") window.location.href = telLink(keys.current.card.phone);
      else if (k === "w") setWaOpen(true);
      else return;
      e.preventDefault();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const target = campaign.target;
  const header = (
    <div className="mb-4 space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">Calling</h1>
        {campaigns.length > 1 && (
          <Select value={campaign.id} onValueChange={(v) => router.push(`/calling?campaign=${v}`)}>
            <SelectTrigger className="w-56" aria-label="Campaign">
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
      </div>
      <div className="flex items-center gap-3 text-sm">
        <span className="shrink-0 tabular-nums">
          Calls today <strong>{callsToday}</strong>
          {target > 0 && ` / ${target}`}
        </span>
        {target > 0 && <Progress value={Math.min(100, (callsToday / target) * 100)} aria-label="Calls today against target" />}
      </div>
    </div>
  );

  if (!card)
    return (
      <div className="mx-auto max-w-xl">
        {header}
        <div className="rounded-lg border border-dashed p-8 text-center">
          <PhoneOff className="mx-auto mb-2 size-8 text-muted-foreground" aria-hidden />
          <p className="mb-4 font-medium">Nobody left to call right now.</p>
          {emptyAction}
        </div>
      </div>
    );

  const reason = REASON[card.reason];
  const vars = {
    name: card.name,
    class: campaign.classLabel,
    fee: campaign.fee,
    start_date: fmtDay(campaign.startDate),
    link: campaign.link,
    caller: me.name,
  };

  return (
    <div className="mx-auto max-w-xl pb-28">
      {header}

      <section aria-labelledby="contact-name" className="space-y-3 rounded-xl border p-4">
        <div className="flex flex-wrap gap-2">
          <Badge className={cn("border-transparent", reason.className)}>{reason.label}</Badge>
          <StageBadge stage={card.stage} />
        </div>
        <div>
          <h2 id="contact-name" className="text-2xl font-semibold">
            {card.name}
          </h2>
          <p className="text-sm text-muted-foreground">{[card.school, card.gradeOrBatch, card.district].filter(Boolean).join(" · ")}</p>
          <p className="mt-1 text-lg tabular-nums">{card.phone}</p>
          {card.altPhone && (
            <p className="text-sm">
              Parent:{" "}
              <a className="tabular-nums underline" href={telLink(card.altPhone)}>
                {card.altPhone}
              </a>
            </p>
          )}
        </div>
        {card.nextCallbackAt && (
          <p className="rounded-md bg-amber-50 p-2 text-sm dark:bg-amber-950">
            Callback due {fmtDateTime(card.nextCallbackAt)}
            {card.callbackNote && ` — “${card.callbackNote}”`}
          </p>
        )}
        {card.notes && <p className="text-sm whitespace-pre-line">{card.notes}</p>}
        {card.recentCalls.length > 0 && (
          <ul className="space-y-1 border-t pt-2 text-sm">
            {card.recentCalls.map((c, i) => (
              <li key={i}>
                <span className="font-medium">{OUTCOME_LABEL[c.outcome]}</span>
                <span className="text-muted-foreground">
                  {" "}
                  · {fmtDateTime(c.calledAt)}
                  {c.caller && ` · ${c.caller}`}
                </span>
                {c.notes && <span className="block text-muted-foreground">“{c.notes}”</span>}
              </li>
            ))}
          </ul>
        )}
        <div className="grid grid-cols-2 gap-2 pt-1">
          <Button asChild size="lg" className="h-14 text-base">
            <a href={telLink(card.phone)}>
              <Phone aria-hidden /> Call
            </a>
          </Button>
          <Button size="lg" variant="outline" className="h-14 text-base" onClick={() => setWaOpen(true)}>
            <MessageCircle aria-hidden /> WhatsApp
          </Button>
        </div>
        {campaign.script && (
          <details className="rounded-md border p-3 text-sm">
            <summary className="cursor-pointer font-medium">Call script</summary>
            <p className="mt-2 whitespace-pre-line">{campaign.script}</p>
          </details>
        )}
      </section>

      <section aria-labelledby="outcome-heading" className="mt-4 space-y-3">
        <h2 id="outcome-heading" className="font-medium">
          How did the call go?
        </h2>
        <div className="grid grid-cols-3 gap-2" role="group" aria-label="Call outcome">
          {OUTCOME_KEYS.map((o, i) => (
            <Button
              key={o}
              type="button"
              variant={form.outcome === o ? "default" : "outline"}
              aria-pressed={form.outcome === o}
              className="h-auto min-h-12 flex-col gap-0.5 px-1 py-2 text-xs whitespace-normal sm:text-sm"
              onClick={() => set({ outcome: o })}
            >
              {OUTCOME_LABEL[o]}
              <kbd className="hidden text-[10px] md:inline">{i + 1}</kbd>
            </Button>
          ))}
        </div>

        {form.outcome === "callback_requested" && (
          <div className="space-y-2 rounded-md border p-3">
            <p className="text-sm font-medium">When should you call back?</p>
            <div className="flex flex-wrap gap-2">
              {callbackChips().map((chip) => (
                <Button key={chip.label} type="button" variant="secondary" size="sm" onClick={() => set({ callbackAt: toLocalInput(chip.at) })}>
                  {chip.label}
                </Button>
              ))}
            </div>
            <Field>
              <FieldLabel htmlFor="cb-at">Date and time (Sri Lanka)</FieldLabel>
              <Input id="cb-at" type="datetime-local" value={form.callbackAt} onChange={(e) => set({ callbackAt: e.target.value })} />
            </Field>
            <Field>
              <FieldLabel htmlFor="cb-note">Callback note (optional)</FieldLabel>
              <Input id="cb-note" value={form.callbackNote} maxLength={500} onChange={(e) => set({ callbackNote: e.target.value })} />
            </Field>
          </div>
        )}

        <div className="grid grid-cols-[1fr_7rem] gap-2">
          <Field>
            <FieldLabel htmlFor="call-notes">Notes (optional)</FieldLabel>
            <Textarea id="call-notes" rows={2} maxLength={2000} value={form.notes} onChange={(e) => set({ notes: e.target.value })} />
          </Field>
          <Field>
            <FieldLabel htmlFor="call-min">Minutes</FieldLabel>
            <Input id="call-min" type="number" inputMode="decimal" min={0} step="0.5" value={form.minutes} onChange={(e) => set({ minutes: e.target.value })} />
          </Field>
        </div>
        <p className="hidden text-xs text-muted-foreground md:block">
          Shortcuts: <kbd>1</kbd>–<kbd>9</kbd> outcome · <kbd>N</kbd> save &amp; next · <kbd>C</kbd> call · <kbd>W</kbd> WhatsApp
        </p>
      </section>

      <div className="fixed inset-x-0 bottom-0 z-20 border-t bg-background/95 p-3 backdrop-blur md:left-(--sidebar-width) md:group-has-data-[collapsible=icon]/sidebar-wrapper:left-(--sidebar-width-icon)">
        <div className="mx-auto flex max-w-xl gap-2">
          <Button variant="outline" size="lg" className="h-12" onClick={skipContact} disabled={saving}>
            <SkipForward aria-hidden /> Skip
          </Button>
          <Button size="lg" className="h-12 flex-1 text-base" onClick={saveAndNext} disabled={!form.outcome || saving}>
            {form.outcome ? `Save “${OUTCOME_LABEL[form.outcome]}” & next` : "Choose an outcome"}
          </Button>
        </div>
      </div>

      <WhatsAppPicker key={card.id} contactId={card.id} phone={card.phone} templates={templates} vars={vars} open={waOpen} onOpenChange={setWaOpen} />
    </div>
  );
}
