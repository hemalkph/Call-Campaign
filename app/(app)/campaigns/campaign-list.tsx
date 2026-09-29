"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Copy, Pencil, Plus, Users } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import type { z } from "zod";
import { CampaignStatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { campaignSchema } from "@/lib/schemas";
import { fmtDay } from "@/lib/time";
import { CAMPAIGN_STATUS_META, CAMPAIGN_STATUSES, type CampaignStatus } from "@/lib/vocab";
import { duplicateCampaign, saveCampaign } from "./actions";

type Caller = { id: string; name: string };
type CampaignRow = {
  id: string;
  name: string;
  classLabel: string;
  startDate: string;
  endDate: string;
  status: CampaignStatus;
  dailyCallTarget: number;
  enrollmentTarget: number;
  script: string;
  fee: string;
  link: string;
  callers: { userId: string; dailyCallTarget?: number }[];
  contacts: number;
  enrolled: number;
};

const NETWORK_ERROR = "Couldn't reach the server. Nothing was saved — try again.";

export function CampaignList({ campaigns, callers }: { campaigns: CampaignRow[]; callers: Caller[] }) {
  const router = useRouter();

  async function duplicate(c: CampaignRow) {
    try {
      const res = await duplicateCampaign(c.id);
      if (!res.ok) return void toast.error(res.error);
      toast.success(`Created “Copy of ${c.name}” as a draft`);
      router.refresh();
    } catch {
      toast.error(NETWORK_ERROR);
    }
  }

  if (!campaigns.length)
    return (
      <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
        No campaigns yet. Create one to start adding contacts.
      </p>
    );

  return (
    <div className="grid gap-4 md:grid-cols-2">
      {campaigns.map((c) => (
        <Card key={c.id}>
          <CardHeader>
            <CardTitle>
              <Link href={`/contacts?campaign=${c.id}`} className="hover:underline">
                {c.name}
              </Link>
            </CardTitle>
            <CardDescription>
              {c.classLabel} · {fmtDay(c.startDate)} – {fmtDay(c.endDate)}
            </CardDescription>
            <CardAction>
              <CampaignStatusBadge status={c.status} />
            </CardAction>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <dl className="grid grid-cols-3 gap-2">
              <div>
                <dt className="text-muted-foreground">Contacts</dt>
                <dd className="font-medium">{c.contacts}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Enrolled</dt>
                <dd className="font-medium">
                  {c.enrolled} / {c.enrollmentTarget}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Callers</dt>
                <dd className="font-medium">{c.callers.length}</dd>
              </div>
            </dl>
            <div className="flex flex-wrap gap-2">
              <Button asChild variant="outline" size="sm">
                <Link href={`/contacts?campaign=${c.id}`}>
                  <Users aria-hidden /> Contacts
                </Link>
              </Button>
              <CampaignSheet
                callers={callers}
                campaign={c}
                trigger={
                  <Button variant="outline" size="sm">
                    <Pencil aria-hidden /> Edit
                  </Button>
                }
              />
              <Button variant="ghost" size="sm" onClick={() => duplicate(c)}>
                <Copy aria-hidden /> Duplicate
              </Button>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

type FormIn = z.input<typeof campaignSchema>;
type FormOut = z.output<typeof campaignSchema>;

export function CampaignSheet({ callers, campaign, trigger }: { callers: Caller[]; campaign?: CampaignRow; trigger?: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Colombo" });
  const form = useForm<FormIn, unknown, FormOut>({
    resolver: zodResolver(campaignSchema),
    defaultValues: campaign
      ? {
          id: campaign.id,
          name: campaign.name,
          classLabel: campaign.classLabel,
          startDate: campaign.startDate,
          endDate: campaign.endDate,
          status: campaign.status,
          dailyCallTarget: campaign.dailyCallTarget,
          enrollmentTarget: campaign.enrollmentTarget,
          script: campaign.script,
          fee: campaign.fee,
          link: campaign.link,
          callers: campaign.callers,
        }
      : {
          name: "",
          classLabel: "",
          startDate: today,
          endDate: today,
          status: "draft",
          dailyCallTarget: 60,
          enrollmentTarget: 0,
          script: "",
          fee: "",
          link: "",
          callers: [],
        },
  });
  const { errors, isSubmitting } = form.formState;
  const selected = (useWatch({ control: form.control, name: "callers" }) ?? []) as { userId: string; dailyCallTarget?: number }[];
  // Callers on the campaign who have since been deactivated still show, so they can be removed.
  const callerOptions = [
    ...callers,
    ...selected.filter((s) => !callers.some((c) => c.id === s.userId)).map((s) => ({ id: s.userId, name: "Deactivated caller" })),
  ];

  function setCallers(next: typeof selected) {
    form.setValue("callers", next, { shouldDirty: true });
  }

  async function onSubmit(values: FormOut) {
    try {
      const res = await saveCampaign(values);
      if (!res.ok) return void toast.error(res.error); // the form keeps what was typed
      toast.success(campaign ? "Campaign saved" : "Campaign created");
      setOpen(false);
      if (!campaign) form.reset();
    } catch {
      toast.error(NETWORK_ERROR);
    }
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        {trigger ?? (
          <Button>
            <Plus aria-hidden /> New campaign
          </Button>
        )}
      </SheetTrigger>
      <SheetContent className="overflow-y-auto data-[side=right]:w-full data-[side=right]:sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>{campaign ? "Edit campaign" : "New campaign"}</SheetTitle>
          <SheetDescription>Targets and callers can be changed at any time.</SheetDescription>
        </SheetHeader>
        <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="px-4">
          <FieldGroup>
            <Field data-invalid={!!errors.name}>
              <FieldLabel htmlFor="c-name">Name</FieldLabel>
              <Input id="c-name" placeholder="e.g. 2027 A/L intake — October" aria-invalid={!!errors.name} {...form.register("name")} />
              <FieldError errors={[errors.name]} />
            </Field>
            <Field data-invalid={!!errors.classLabel}>
              <FieldLabel htmlFor="c-class">Class / intake</FieldLabel>
              <Input id="c-class" placeholder="e.g. 2027 A/L Theory" aria-invalid={!!errors.classLabel} {...form.register("classLabel")} />
              <FieldError errors={[errors.classLabel]} />
            </Field>
            <div className="grid grid-cols-2 gap-4">
              <Field data-invalid={!!errors.startDate}>
                <FieldLabel htmlFor="c-start">Starts</FieldLabel>
                <Input id="c-start" type="date" {...form.register("startDate")} />
                <FieldError errors={[errors.startDate]} />
              </Field>
              <Field data-invalid={!!errors.endDate}>
                <FieldLabel htmlFor="c-end">Ends</FieldLabel>
                <Input id="c-end" type="date" aria-invalid={!!errors.endDate} {...form.register("endDate")} />
                <FieldError errors={[errors.endDate]} />
              </Field>
            </div>
            <Field>
              <FieldLabel htmlFor="c-status">Status</FieldLabel>
              <Controller
                control={form.control}
                name="status"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger id="c-status" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CAMPAIGN_STATUSES.map((s) => (
                        <SelectItem key={s} value={s}>
                          {CAMPAIGN_STATUS_META[s].label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
              <FieldDescription>Callers only see active campaigns in calling mode.</FieldDescription>
            </Field>
            <div className="grid grid-cols-2 gap-4">
              <Field data-invalid={!!errors.dailyCallTarget}>
                <FieldLabel htmlFor="c-daily">Calls per caller per day</FieldLabel>
                <Input id="c-daily" type="number" min={0} inputMode="numeric" {...form.register("dailyCallTarget", { valueAsNumber: true })} />
                <FieldError errors={[errors.dailyCallTarget]} />
              </Field>
              <Field data-invalid={!!errors.enrollmentTarget}>
                <FieldLabel htmlFor="c-enrol">Enrollment target</FieldLabel>
                <Input id="c-enrol" type="number" min={0} inputMode="numeric" {...form.register("enrollmentTarget", { valueAsNumber: true })} />
                <FieldError errors={[errors.enrollmentTarget]} />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Field data-invalid={!!errors.fee}>
                <FieldLabel htmlFor="c-fee">Fee</FieldLabel>
                <Input id="c-fee" placeholder="e.g. Rs. 2,500 / month" {...form.register("fee")} />
                <FieldError errors={[errors.fee]} />
              </Field>
              <Field data-invalid={!!errors.link}>
                <FieldLabel htmlFor="c-link">Link</FieldLabel>
                <Input id="c-link" type="url" inputMode="url" placeholder="https://…" aria-invalid={!!errors.link} {...form.register("link")} />
                <FieldError errors={[errors.link]} />
              </Field>
            </div>
            <FieldDescription className="-mt-4">Used in WhatsApp templates as {"{fee}"} and {"{link}"}.</FieldDescription>
            <FieldSet>
              <FieldLegend variant="label">Callers</FieldLegend>
              <FieldDescription>Leave a caller&apos;s target blank to use the campaign target.</FieldDescription>
              {callerOptions.length === 0 && <p className="text-sm text-muted-foreground">Add callers on the Users page first.</p>}
              <ul className="divide-y rounded-md border">
                {callerOptions.map((c) => {
                  const entry = selected.find((s) => s.userId === c.id);
                  return (
                    <li key={c.id} className="flex items-center gap-3 px-3 py-2">
                      <Checkbox
                        id={`caller-${c.id}`}
                        checked={!!entry}
                        onCheckedChange={(on) =>
                          setCallers(on ? [...selected, { userId: c.id }] : selected.filter((s) => s.userId !== c.id))
                        }
                      />
                      <label htmlFor={`caller-${c.id}`} className="flex-1 text-sm">
                        {c.name}
                      </label>
                      <Input
                        type="number"
                        min={0}
                        inputMode="numeric"
                        aria-label={`Daily target for ${c.name}`}
                        placeholder="Default"
                        className="w-24"
                        disabled={!entry}
                        value={entry?.dailyCallTarget ?? ""}
                        onChange={(e) =>
                          setCallers(
                            selected.map((s) =>
                              s.userId === c.id
                                ? { ...s, dailyCallTarget: e.target.value === "" ? undefined : e.target.valueAsNumber }
                                : s,
                            ),
                          )
                        }
                      />
                    </li>
                  );
                })}
              </ul>
            </FieldSet>
            <Field>
              <FieldLabel htmlFor="c-script">Call script</FieldLabel>
              <Textarea id="c-script" rows={8} placeholder="What callers should say…" {...form.register("script")} />
              <FieldDescription>Shown to callers in calling mode.</FieldDescription>
            </Field>
          </FieldGroup>
          <SheetFooter className="px-0">
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Saving…" : campaign ? "Save campaign" : "Create campaign"}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
