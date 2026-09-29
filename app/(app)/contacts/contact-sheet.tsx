"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { MessageCircle, Phone } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import type { z } from "zod";
import { StageBadge } from "@/components/status-badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { telLink, whatsAppLink } from "@/lib/phone";
import { contactFields } from "@/lib/schemas";
import { fmtDateTime } from "@/lib/time";
import { DISTRICTS, OUTCOME_LABEL, type Outcome, STAGE_META, STAGES, type Stage } from "@/lib/vocab";
import { type Activity, createContact, getContactActivity, updateContact } from "./actions";
import { Skeleton } from "@/components/ui/skeleton";

export type ContactRow = {
  id: string;
  name: string;
  phone: string;
  altPhone: string;
  school: string;
  district: string;
  gradeOrBatch: string;
  source: string;
  tags: string[];
  notes: string;
  assignedTo: string | null;
  stage: Stage;
  lastCallAt: string | null;
  lastOutcome: Outcome | null;
  nextCallbackAt: string | null;
  createdAt: string;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contact?: ContactRow; // undefined = add new
  campaignId: string;
  isOwner: boolean;
  callers: { id: string; name: string }[];
};

type FormIn = z.input<typeof contactFields>;
type FormOut = z.output<typeof contactFields>;

const UNASSIGNED = "none"; // Radix Select can't use "" as a value

export function ContactSheet({ open, onOpenChange, contact, campaignId, isOwner, callers }: Props) {
  const [confirm, setConfirm] = useState<FormOut>();
  const form = useForm<FormIn, unknown, FormOut>({
    resolver: zodResolver(contactFields),
    defaultValues: {
      name: contact?.name ?? "",
      phone: contact?.phone ?? "",
      altPhone: contact?.altPhone ?? "",
      school: contact?.school ?? "",
      district: contact?.district ?? "",
      gradeOrBatch: contact?.gradeOrBatch ?? "",
      source: contact?.source ?? "",
      tags: contact?.tags.join(", ") ?? "",
      notes: contact?.notes ?? "",
      assignedTo: contact ? (contact.assignedTo ?? "") : "",
      stage: contact?.stage,
    },
  });
  const { errors, isSubmitting } = form.formState;

  async function save(values: FormOut) {
    try {
      const res = contact
        ? await updateContact({ ...values, id: contact.id, ...(isOwner ? {} : { assignedTo: undefined }) })
        : await createContact({ ...values, campaignId, stage: undefined, ...(isOwner ? {} : { assignedTo: undefined }) });
      if (!res.ok) return void toast.error(res.error); // form keeps what was typed
      toast.success(contact ? "Contact saved" : "Contact added");
      const warning = "warning" in res ? (res.warning as string | undefined) : undefined;
      if (warning) toast.warning(warning);
      if (!contact) form.reset();
      onOpenChange(false);
    } catch {
      toast.error("Couldn't reach the server. Nothing was saved — try again.");
    }
  }

  function onSubmit(values: FormOut) {
    if (contact && values.stage === "enrolled" && contact.stage !== "enrolled") setConfirm(values);
    else return save(values);
  }

  const text = (name: "name" | "phone" | "altPhone" | "school" | "gradeOrBatch" | "source", label: string, extra?: React.ComponentProps<typeof Input>) => (
    <Field data-invalid={!!errors[name]}>
      <FieldLabel htmlFor={`ct-${name}`}>{label}</FieldLabel>
      <Input id={`ct-${name}`} aria-invalid={!!errors[name]} {...extra} {...form.register(name)} />
      <FieldError errors={[errors[name]]} />
    </Field>
  );

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="overflow-y-auto data-[side=right]:w-full data-[side=right]:sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>{contact ? contact.name : "Add contact"}</SheetTitle>
          <SheetDescription>
            {contact ? `Added ${fmtDateTime(contact.createdAt)}` : "Name and phone are required."}
          </SheetDescription>
        </SheetHeader>

        {contact && (
          <div className="space-y-3 px-4">
            <div className="flex gap-2">
              <Button asChild variant="outline" className="flex-1">
                <a href={telLink(contact.phone)}>
                  <Phone aria-hidden /> Call {contact.phone}
                </a>
              </Button>
              <Button asChild variant="outline" className="flex-1">
                <a href={whatsAppLink(contact.phone)} target="_blank" rel="noreferrer">
                  <MessageCircle aria-hidden /> WhatsApp
                </a>
              </Button>
            </div>
            <dl className="grid grid-cols-2 gap-3 rounded-md border p-3 text-sm">
              <div>
                <dt className="text-muted-foreground">Stage</dt>
                <dd>
                  <StageBadge stage={contact.stage} />
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Last call</dt>
                <dd>
                  {contact.lastCallAt
                    ? `${contact.lastOutcome ? OUTCOME_LABEL[contact.lastOutcome] : ""} · ${fmtDateTime(contact.lastCallAt)}`
                    : "Not called yet"}
                </dd>
              </div>
              <div className="col-span-2">
                <dt className="text-muted-foreground">Next callback</dt>
                <dd>{contact.nextCallbackAt ? fmtDateTime(contact.nextCallbackAt) : "None scheduled"}</dd>
              </div>
            </dl>
            <ActivitySection contactId={contact.id} />
          </div>
        )}

        <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="px-4">
          <FieldGroup>
            {text("name", "Name", { autoComplete: "off" })}
            <div className="grid gap-4 sm:grid-cols-2">
              {text("phone", "Phone", { type: "tel", inputMode: "tel", placeholder: "07X XXX XXXX" })}
              {text("altPhone", "Parent's phone (optional)", { type: "tel", inputMode: "tel" })}
            </div>
            {contact && (
              <Field>
                <FieldLabel htmlFor="ct-stage">Stage</FieldLabel>
                <Controller
                  control={form.control}
                  name="stage"
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger id="ct-stage" className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {STAGES.map((s) => (
                          <SelectItem key={s} value={s}>
                            {STAGE_META[s].label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
              </Field>
            )}
            {isOwner && (
              <Field>
                <FieldLabel htmlFor="ct-assigned">Assigned to</FieldLabel>
                <Controller
                  control={form.control}
                  name="assignedTo"
                  render={({ field }) => (
                    <Select value={field.value || UNASSIGNED} onValueChange={(v) => field.onChange(v === UNASSIGNED ? "" : v)}>
                      <SelectTrigger id="ct-assigned" className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={UNASSIGNED}>Unassigned</SelectItem>
                        {callers.map((c) => (
                          <SelectItem key={c.id} value={c.id}>
                            {c.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
                {!callers.length && <FieldDescription>Add callers to this campaign to assign contacts.</FieldDescription>}
              </Field>
            )}
            <div className="grid gap-4 sm:grid-cols-2">
              {text("school", "School")}
              <Field>
                <FieldLabel htmlFor="ct-district">District</FieldLabel>
                <Input id="ct-district" list="districts" {...form.register("district")} />
                <datalist id="districts">
                  {DISTRICTS.map((d) => (
                    <option key={d} value={d} />
                  ))}
                </datalist>
              </Field>
              {text("gradeOrBatch", "Grade / batch")}
              {text("source", "Source", { placeholder: "e.g. Facebook ad, Seminar" })}
            </div>
            <Field>
              <FieldLabel htmlFor="ct-tags">Tags</FieldLabel>
              <Input id="ct-tags" placeholder="Comma separated, e.g. theory, revision" {...form.register("tags")} />
            </Field>
            <Field>
              <FieldLabel htmlFor="ct-notes">Notes</FieldLabel>
              <Textarea id="ct-notes" rows={4} {...form.register("notes")} />
            </Field>
          </FieldGroup>
          <SheetFooter className="px-0">
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Saving…" : contact ? "Save changes" : "Add contact"}
            </Button>
          </SheetFooter>
        </form>

        <AlertDialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(undefined)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Mark {contact?.name} as enrolled?</AlertDialogTitle>
              <AlertDialogDescription>Only do this once their payment has been received.</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  const values = confirm!;
                  setConfirm(undefined);
                  save(values);
                }}
              >
                Yes, enrolled
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </SheetContent>
    </Sheet>
  );
}

function ActivitySection({ contactId }: { contactId: string }) {
  const [state, setState] = useState<{ activity?: Activity; error?: string }>({});

  const load = useCallback(async () => {
    try {
      const res = await getContactActivity(contactId);
      setState(res.ok ? { activity: res.activity } : { error: res.error });
    } catch {
      setState({ error: "Couldn't load the history." });
    }
  }, [contactId]);

  useEffect(() => {
    load(); // eslint-disable-line react-hooks/set-state-in-effect -- fetching on open
  }, [load]);

  if (state.error)
    return (
      <p className="flex items-center justify-between rounded-md border p-3 text-sm text-destructive">
        {state.error}
        <Button variant="outline" size="sm" onClick={() => { setState({}); load(); }}>
          Retry
        </Button>
      </p>
    );
  if (!state.activity) return <Skeleton className="h-28 w-full" aria-label="Loading history" />;

  const { calls, whatsapp, callbacks } = state.activity;
  const section = (title: string, empty: string, items: React.ReactNode[]) => (
    <div>
      <h3 className="mb-1 text-sm font-medium">{title}</h3>
      {items.length ? <ul className="space-y-1 text-sm">{items}</ul> : <p className="text-sm text-muted-foreground">{empty}</p>}
    </div>
  );
  return (
    <div className="space-y-3 rounded-md border p-3">
      {section(
        `Calls (${calls.length})`,
        "No calls logged yet.",
        calls.map((c) => (
          <li key={c.id}>
            <span className="font-medium">{OUTCOME_LABEL[c.outcome as Outcome] ?? c.outcome}</span>
            <span className="text-muted-foreground">
              {" "}· {fmtDateTime(c.at)}
              {c.caller && ` · ${c.caller}`}
              {c.durationSec ? ` · ${Math.round(c.durationSec / 60)} min` : ""}
            </span>
            {c.notes && <span className="block text-muted-foreground">“{c.notes}”</span>}
          </li>
        )),
      )}
      {section(
        "WhatsApp",
        "No messages logged.",
        whatsapp.map((w) => (
          <li key={w.id}>
            {w.template || "Message"}
            <span className="text-muted-foreground"> · {fmtDateTime(w.at)}{w.caller && ` · ${w.caller}`}</span>
          </li>
        )),
      )}
      {section(
        "Callbacks",
        "No callbacks.",
        callbacks.map((c) => (
          <li key={c.id}>
            {fmtDateTime(c.dueAt)}
            <span className="text-muted-foreground">
              {" "}· {c.status === "pending" ? "Pending" : c.status === "done" ? "Done" : `Cancelled${c.reason ? `: ${c.reason}` : ""}`}
              {c.note && ` · “${c.note}”`}
            </span>
          </li>
        )),
      )}
    </div>
  );
}
