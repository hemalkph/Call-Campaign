"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";
import type { z } from "zod";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { newPasswordSchema } from "@/lib/schemas";
import { changePassword } from "./actions";

type Values = z.input<typeof newPasswordSchema>;

export function PasswordForm() {
  const [error, setError] = useState<string>();
  const form = useForm<Values>({
    resolver: zodResolver(newPasswordSchema),
    defaultValues: { current: "", password: "", confirm: "" },
  });
  const { errors, isSubmitting } = form.formState;

  async function onSubmit(values: Values) {
    setError(undefined);
    try {
      const res = await changePassword(values); // redirects on success
      setError(res?.error);
    } catch {
      setError("Couldn't reach the server. Check your connection and try again.");
    }
  }

  const fields = [
    { name: "current", label: "Current password", autoComplete: "current-password" },
    { name: "password", label: "New password", autoComplete: "new-password", hint: "At least 10 characters." },
    { name: "confirm", label: "Repeat new password", autoComplete: "new-password" },
  ] as const;

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} noValidate>
      <FieldGroup>
        {fields.map((f) => (
          <Field key={f.name} data-invalid={!!errors[f.name]}>
            <FieldLabel htmlFor={f.name}>{f.label}</FieldLabel>
            <Input id={f.name} type="password" autoComplete={f.autoComplete} aria-invalid={!!errors[f.name]} {...form.register(f.name)} />
            {"hint" in f && <FieldDescription>{f.hint}</FieldDescription>}
            <FieldError errors={[errors[f.name]]} />
          </Field>
        ))}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <Button type="submit" size="lg" disabled={isSubmitting}>
          {isSubmitting ? "Saving…" : "Save password"}
        </Button>
      </FieldGroup>
    </form>
  );
}
