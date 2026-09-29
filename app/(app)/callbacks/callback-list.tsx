"use client";

import { Check, PhoneCall } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { callbackChips, fmtDateTime, fromLocalInput, toLocalInput } from "@/lib/time";
import { cn } from "@/lib/utils";
import { cancelCallback, completeCallback, rescheduleCallback } from "./actions";

type Item = {
  id: string;
  contactId: string;
  campaignId: string;
  contactName: string;
  phone: string;
  campaignName: string;
  callerName?: string;
  dueAt: string;
  note: string;
  status: "pending" | "done" | "cancelled";
  reason: string;
};

const NETWORK = "Couldn't reach the server. Nothing was changed — try again.";

async function run(action: () => Promise<{ ok: true } | { ok: false; error: string }>, success: string) {
  try {
    const res = await action();
    if (!res.ok) return toast.error(res.error), false;
    toast.success(success);
    return true;
  } catch {
    toast.error(NETWORK);
    return false;
  }
}

export function CallbackList({ tab, items }: { tab: string; items: Item[] }) {
  if (!items.length)
    return <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">Nothing here.</p>;
  return (
    <ul className="divide-y rounded-lg border">
      {items.map((cb) => (
        <li key={cb.id} className="flex flex-wrap items-center gap-3 p-3">
          <div className="min-w-0 flex-1 basis-56">
            <p className="font-medium">{cb.contactName}</p>
            <p className={cn("text-sm", tab === "overdue" ? "font-medium text-destructive" : "text-muted-foreground")}>
              {fmtDateTime(cb.dueAt)}
              {cb.callerName && ` · ${cb.callerName}`}
              {cb.campaignName && ` · ${cb.campaignName}`}
            </p>
            {cb.note && <p className="text-sm">“{cb.note}”</p>}
            {cb.status !== "pending" && (
              <Badge variant={cb.status === "done" ? "secondary" : "outline"} className="mt-1">
                {cb.status === "done" ? "Done" : `Cancelled${cb.reason ? `: ${cb.reason}` : ""}`}
              </Badge>
            )}
          </div>
          {cb.status === "pending" && (
            <div className="flex flex-wrap gap-2">
              <Button asChild size="sm">
                <Link href={`/calling?campaign=${cb.campaignId}&contact=${cb.contactId}`}>
                  <PhoneCall aria-hidden /> Call now
                </Link>
              </Button>
              <Reschedule item={cb} />
              <Button variant="outline" size="sm" onClick={() => run(() => completeCallback(cb.id), "Marked done")}>
                <Check aria-hidden /> Done
              </Button>
              <Cancel item={cb} />
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

function Reschedule({ item }: { item: Item }) {
  const [open, setOpen] = useState(false);
  const [at, setAt] = useState(toLocalInput(item.dueAt));
  const [pending, setPending] = useState(false);

  async function save() {
    const due = fromLocalInput(at);
    if (!due) return void toast.error("Pick a date and time.");
    setPending(true);
    if (await run(() => rescheduleCallback({ id: item.id, dueAt: due.toISOString() }), "Callback moved")) setOpen(false);
    setPending(false);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          Reschedule
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reschedule {item.contactName}</DialogTitle>
          <DialogDescription>Sri Lanka time.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap gap-2">
          {callbackChips().map((c) => (
            <Button key={c.label} variant="secondary" size="sm" onClick={() => setAt(toLocalInput(c.at))}>
              {c.label}
            </Button>
          ))}
        </div>
        <Field>
          <FieldLabel htmlFor={`rs-${item.id}`}>Date and time</FieldLabel>
          <Input id={`rs-${item.id}`} type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} />
        </Field>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Cancel</Button>
          </DialogClose>
          <Button onClick={save} disabled={pending}>
            {pending ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Cancel({ item }: { item: Item }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);

  async function save() {
    setPending(true);
    if (await run(() => cancelCallback({ id: item.id, reason }), "Callback cancelled")) setOpen(false);
    setPending(false);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm">
          Cancel callback
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Cancel the callback to {item.contactName}?</DialogTitle>
          <DialogDescription>The contact stays in your list; only this callback is cancelled.</DialogDescription>
        </DialogHeader>
        <Field>
          <FieldLabel htmlFor={`cc-${item.id}`}>Reason</FieldLabel>
          <Input id={`cc-${item.id}`} value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Already joined" />
        </Field>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Keep it</Button>
          </DialogClose>
          <Button variant="destructive" onClick={save} disabled={pending || !reason.trim()}>
            {pending ? "Cancelling…" : "Cancel callback"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
