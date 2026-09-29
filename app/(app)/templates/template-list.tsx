"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import type { z } from "zod";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { TemplateOption } from "@/components/whatsapp-picker";
import { fillTemplate, TEMPLATE_PLACEHOLDERS } from "@/lib/calling";
import { templateSchema } from "@/lib/schemas";
import { deleteTemplate, saveTemplate } from "./actions";

const SAMPLE = {
  name: "Kamal Perera",
  class: "2027 A/L Theory",
  fee: "Rs. 2,500 / month",
  start_date: "1 Oct 2026",
  link: "https://example.lk/join",
  caller: "Nimali",
};
const NETWORK = "Couldn't reach the server. Nothing was saved — try again.";
const lang = (l: "si" | "en") => (l === "si" ? "සිංහල" : "English");

export function TemplateList({ templates }: { templates: TemplateOption[] }) {
  if (!templates.length)
    return (
      <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
        No templates yet. Add one in Sinhala and one in English.
      </p>
    );
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {templates.map((t) => (
        <Card key={t.id}>
          <CardHeader>
            <CardTitle>{t.name}</CardTitle>
            <CardAction>
              <Badge variant="outline">{lang(t.language)}</Badge>
            </CardAction>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="rounded-md bg-muted p-3 text-sm whitespace-pre-line">{fillTemplate(t.body, SAMPLE)}</p>
            <div className="flex gap-2">
              <TemplateDialog
                template={t}
                trigger={
                  <Button variant="outline" size="sm">
                    <Pencil aria-hidden /> Edit
                  </Button>
                }
              />
              <DeleteTemplate template={t} />
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function DeleteTemplate({ template }: { template: TemplateOption }) {
  async function remove() {
    try {
      const res = await deleteTemplate(template.id);
      if (!res.ok) return void toast.error(res.error);
      toast.success("Template deleted");
    } catch {
      toast.error(NETWORK);
    }
  }
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="ghost" size="sm">
          <Trash2 aria-hidden /> Delete
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete “{template.name}”?</AlertDialogTitle>
          <AlertDialogDescription>Callers won&apos;t see it any more. Messages already logged keep its name.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={remove}>
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

type FormIn = z.input<typeof templateSchema>;

export function TemplateDialog({ template, trigger }: { template?: TemplateOption; trigger?: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const form = useForm<FormIn>({
    resolver: zodResolver(templateSchema),
    defaultValues: template ?? { name: "", language: "si", body: "" },
  });
  const { errors, isSubmitting } = form.formState;
  const body = useWatch({ control: form.control, name: "body" }) ?? "";

  async function onSubmit(values: FormIn) {
    try {
      const res = await saveTemplate(values);
      if (!res.ok) return void toast.error(res.error); // the form keeps what was typed
      toast.success(template ? "Template saved" : "Template added");
      setOpen(false);
      if (!template) form.reset();
    } catch {
      toast.error(NETWORK);
    }
  }

  function insert(p: string) {
    const el = document.getElementById("t-body") as HTMLTextAreaElement | null;
    const at = el?.selectionStart ?? body.length;
    form.setValue("body", body.slice(0, at) + `{${p}}` + body.slice(el?.selectionEnd ?? at), { shouldDirty: true });
    el?.focus();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button>
            <Plus aria-hidden /> New template
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{template ? "Edit template" : "New template"}</DialogTitle>
          <DialogDescription>Placeholders are filled in for each contact.</DialogDescription>
        </DialogHeader>
        <form onSubmit={form.handleSubmit(onSubmit)} noValidate>
          <FieldGroup>
            <div className="grid grid-cols-[1fr_9rem] gap-4">
              <Field data-invalid={!!errors.name}>
                <FieldLabel htmlFor="t-name">Name</FieldLabel>
                <Input id="t-name" placeholder="e.g. Class details" aria-invalid={!!errors.name} {...form.register("name")} />
                <FieldError errors={[errors.name]} />
              </Field>
              <Field>
                <FieldLabel htmlFor="t-lang">Language</FieldLabel>
                <Controller
                  control={form.control}
                  name="language"
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger id="t-lang" className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="si">සිංහල</SelectItem>
                        <SelectItem value="en">English</SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                />
              </Field>
            </div>
            <Field data-invalid={!!errors.body}>
              <FieldLabel htmlFor="t-body">Message</FieldLabel>
              <Textarea id="t-body" rows={6} aria-invalid={!!errors.body} {...form.register("body")} />
              <div className="flex flex-wrap gap-1" aria-label="Insert a placeholder">
                {TEMPLATE_PLACEHOLDERS.map((p) => (
                  <Button key={p} type="button" variant="secondary" size="xs" onClick={() => insert(p)}>
                    {`{${p}}`}
                  </Button>
                ))}
              </div>
              <FieldError errors={[errors.body]} />
            </Field>
            <Field>
              <FieldLabel>Preview</FieldLabel>
              <p className="min-h-16 rounded-md bg-muted p-3 text-sm whitespace-pre-line" aria-live="polite">
                {body ? fillTemplate(body, SAMPLE) : <span className="text-muted-foreground">Start typing…</span>}
              </p>
              <FieldDescription>Sample values; {"{fee}"}, {"{link}"} and {"{start_date}"} come from the campaign.</FieldDescription>
            </Field>
            <DialogFooter>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? "Saving…" : "Save template"}
              </Button>
            </DialogFooter>
          </FieldGroup>
        </form>
      </DialogContent>
    </Dialog>
  );
}
