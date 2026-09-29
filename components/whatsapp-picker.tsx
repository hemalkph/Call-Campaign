"use client";

import { MessageCircle } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { setWhatsappSent } from "@/app/(app)/whatsapp/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { fillTemplate, type TemplateVars } from "@/lib/calling";
import { whatsAppLink } from "@/lib/phone";

export type TemplateOption = { id: string; name: string; language: "si" | "en"; body: string };

type Props = {
  contactId: string;
  phone: string;
  templates: TemplateOption[];
  vars: TemplateVars;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSent?: (lastWhatsappAt: string | null) => void;
};

/** Pick a template → WhatsApp opens with the filled message → the caller confirms it was sent. */
export function WhatsAppPicker({ contactId, phone, templates, vars, open, onOpenChange, onSent }: Props) {
  const [opened, setOpened] = useState<TemplateOption | null>();
  const [saving, setSaving] = useState(false);

  function openWhatsApp(t: TemplateOption | null) {
    window.open(whatsAppLink(phone, t ? fillTemplate(t.body, vars) : undefined), "_blank", "noopener");
    setOpened(t);
  }

  async function markSent() {
    setSaving(true);
    try {
      const res = await setWhatsappSent({ contactId, templateId: opened?.id, sent: true });
      if (!res.ok) return void toast.error(res.error);
      toast.success("WhatsApp message logged");
      onSent?.(res.lastWhatsappAt);
      close();
    } catch {
      toast.error("Couldn't reach the server. The message wasn't logged — try again.");
    } finally {
      setSaving(false);
    }
  }

  function close() {
    setOpened(undefined);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? onOpenChange(true) : close())}>
      <DialogContent>
        {opened === undefined ? (
          <>
            <DialogHeader>
              <DialogTitle>Send a WhatsApp message</DialogTitle>
              <DialogDescription>Pick a message. WhatsApp opens with it filled in; you press send there.</DialogDescription>
            </DialogHeader>
            <ul className="grid max-h-[60vh] gap-2 overflow-y-auto">
              {templates.map((t) => (
                <li key={t.id}>
                  <button
                    type="button"
                    onClick={() => openWhatsApp(t)}
                    className="w-full rounded-lg border p-3 text-left hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
                  >
                    <span className="flex items-center justify-between gap-2 font-medium">
                      {t.name}
                      <Badge variant="outline">{t.language === "si" ? "සිංහල" : "English"}</Badge>
                    </span>
                    <span className="mt-1 line-clamp-3 block text-sm whitespace-pre-line text-muted-foreground">
                      {fillTemplate(t.body, vars)}
                    </span>
                  </button>
                </li>
              ))}
              <li>
                <Button variant="outline" className="w-full" onClick={() => openWhatsApp(null)}>
                  <MessageCircle aria-hidden /> Open chat without a message
                </Button>
              </li>
            </ul>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Did you send it?</DialogTitle>
              <DialogDescription>
                {opened ? `“${opened.name}”` : "The chat"} opened in WhatsApp. Log it once the message is sent.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={close}>
                Not sent
              </Button>
              <Button onClick={markSent} disabled={saving}>
                {saving ? "Saving…" : "Yes, mark as sent"}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
