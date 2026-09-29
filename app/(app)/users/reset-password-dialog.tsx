"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Copy, Eye, EyeOff, KeyRound, Sparkles } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import type { z } from "zod";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { tempPassword } from "@/lib/generate-password";
import { resetPasswordSchema } from "@/lib/schemas";
import { resetPassword } from "./actions";

type Values = z.input<typeof resetPasswordSchema>;
const label = "text-xs font-semibold tracking-wider uppercase";

async function copy(text: string, message: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(message);
  } catch {
    toast.error("Couldn't copy — select the password and copy it yourself.");
  }
}

export function ResetPasswordDialog({ user }: { user: { id: string; name: string; active: boolean } }) {
  const [open, setOpen] = useState(false);
  const [show, setShow] = useState(false);
  const form = useForm<Values>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: { userId: user.id, password: "", confirm: "" },
  });
  const { errors, isSubmitting } = form.formState;

  function generate() {
    const pw = tempPassword();
    form.setValue("password", pw, { shouldValidate: true });
    form.setValue("confirm", pw, { shouldValidate: true });
    setShow(true);
    copy(pw, "Generated password copied to clipboard");
  }

  async function onSubmit(values: Values) {
    try {
      const res = await resetPassword(values);
      if (!res.ok) return void toast.error(res.error); // the dialog keeps what was typed
      toast.success(`Password reset. ${user.name} has been signed out everywhere.`);
      setOpen(false);
    } catch {
      toast.error("Couldn't reach the server. The password wasn't changed — try again.");
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) {
          form.reset(); // never leave a password sitting in a closed dialog
          setShow(false);
        }
      }}
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <DialogTrigger asChild>
            <Button variant="ghost" size="icon" disabled={!user.active}>
              <KeyRound aria-hidden />
              <span className="sr-only">Reset password for {user.name}</span>
            </Button>
          </DialogTrigger>
        </TooltipTrigger>
        <TooltipContent>Reset password</TooltipContent>
      </Tooltip>

      <DialogContent className="sm:max-w-md">
        <DialogHeader className="gap-3">
          <div className="flex items-center gap-3">
            <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <KeyRound className="size-5" aria-hidden />
            </span>
            <DialogTitle className="text-lg">Reset password</DialogTitle>
          </div>
          <DialogDescription>
            Set a new password for <strong className="font-semibold text-foreground">{user.name}</strong>. They&apos;ll use it
            on their next sign-in, then choose their own.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={form.handleSubmit(onSubmit)} noValidate>
          <FieldGroup>
            <Field data-invalid={!!errors.password}>
              <div className="flex items-center justify-between">
                <FieldLabel htmlFor="rp-password" className={label}>
                  New password
                </FieldLabel>
                <Button type="button" variant="ghost" size="sm" className="-my-1 text-primary hover:text-primary" onClick={generate}>
                  <Sparkles aria-hidden /> Generate
                </Button>
              </div>
              <div className="relative">
                <Input
                  id="rp-password"
                  type={show ? "text" : "password"}
                  autoComplete="new-password"
                  spellCheck={false}
                  aria-invalid={!!errors.password}
                  className="h-11 pr-20 font-mono"
                  {...form.register("password")}
                />
                <div className="absolute inset-y-0 right-1 flex items-center">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="text-muted-foreground"
                    aria-label={show ? "Hide password" : "Show password"}
                    aria-pressed={show}
                    onClick={() => setShow((s) => !s)}
                  >
                    {show ? <EyeOff aria-hidden /> : <Eye aria-hidden />}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="text-muted-foreground"
                    aria-label="Copy password"
                    onClick={() => {
                      const pw = form.getValues("password");
                      if (pw) copy(pw, "Password copied to clipboard");
                    }}
                  >
                    <Copy aria-hidden />
                  </Button>
                </div>
              </div>
              <FieldError errors={[errors.password]} />
            </Field>
            <Field data-invalid={!!errors.confirm}>
              <FieldLabel htmlFor="rp-confirm" className={label}>
                Confirm password
              </FieldLabel>
              <Input
                id="rp-confirm"
                type={show ? "text" : "password"}
                autoComplete="new-password"
                spellCheck={false}
                aria-invalid={!!errors.confirm}
                className="h-11 font-mono"
                {...form.register("confirm")}
              />
              <FieldError errors={[errors.confirm]} />
            </Field>
            <div className="grid grid-cols-2 gap-3 pt-1">
              <DialogClose asChild>
                <Button type="button" variant="outline" size="lg" className="h-11">
                  Cancel
                </Button>
              </DialogClose>
              <Button type="submit" size="lg" className="h-11" disabled={isSubmitting}>
                {isSubmitting ? "Resetting…" : "Reset password"}
              </Button>
            </div>
          </FieldGroup>
        </form>
      </DialogContent>
    </Dialog>
  );
}
