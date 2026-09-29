"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Copy, UserCheck, UserPlus, UserX } from "lucide-react";
import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import type { z } from "zod";
import {
  AlertDialog,
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
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { createUserSchema, type Role } from "@/lib/schemas";
import { createUser, setUserActive } from "./actions";
import { ResetPasswordDialog } from "./reset-password-dialog";

type Row = { id: string; name: string; email: string; phone: string; role: Role; active: boolean; mustChangePassword: boolean };

const NETWORK_ERROR = "Couldn't reach the server. Nothing was changed — try again.";

export function UsersTable({ users, currentUserId }: { users: Row[]; currentUserId: string }) {
  if (!users.length) return <p className="text-sm text-muted-foreground">No users yet.</p>;
  return (
    <div className="rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead className="hidden md:table-cell">Email</TableHead>
            <TableHead className="hidden sm:table-cell">Role</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">
              <span className="sr-only">Actions</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {users.map((u) => (
            <TableRow key={u.id} className={u.active ? undefined : "text-muted-foreground"}>
              <TableCell className="max-w-40 whitespace-normal">
                <div className="font-medium">{u.name}</div>
                <div className="text-xs break-all text-muted-foreground md:hidden">{u.email}</div>
              </TableCell>
              <TableCell className="hidden md:table-cell">{u.email}</TableCell>
              <TableCell className="hidden capitalize sm:table-cell">{u.role}</TableCell>
              <TableCell>
                {u.active ? (
                  <Badge variant="secondary">{u.mustChangePassword ? "Awaiting first sign-in" : "Active"}</Badge>
                ) : (
                  <Badge variant="outline">Deactivated</Badge>
                )}
              </TableCell>
              <TableCell className="text-right whitespace-nowrap">
                {u.id !== currentUserId && (
                  <>
                    <ResetPasswordDialog user={u} />
                    <ActiveButton user={u} />
                  </>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function IconButton({ label, children, ...props }: React.ComponentProps<typeof Button> & { label: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon" {...props}>
          {children}
          <span className="sr-only">{label}</span>
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

function TempPassword({ name, password }: { name: string; password: string }) {
  return (
    <div className="space-y-3">
      <p className="text-sm">
        Give this temporary password to <strong>{name}</strong>. It is shown only once; they must change it when they
        first sign in.
      </p>
      <div className="flex items-center gap-2">
        <code className="flex-1 rounded-md bg-muted px-3 py-2 font-mono text-base">{password}</code>
        <IconButton
          label="Copy password"
          variant="outline"
          onClick={() => navigator.clipboard.writeText(password).then(() => toast.success("Copied"))}
        >
          <Copy aria-hidden />
        </IconButton>
      </div>
    </div>
  );
}

function ActiveButton({ user }: { user: Row }) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);

  async function apply(active: boolean) {
    setPending(true);
    try {
      const res = await setUserActive({ userId: user.id, active });
      if (!res.ok) return toast.error(res.error);
      toast.success(active ? `${user.name} can sign in again` : `${user.name} deactivated`);
      setOpen(false);
    } catch {
      toast.error(NETWORK_ERROR);
    } finally {
      setPending(false);
    }
  }

  if (!user.active)
    return (
      <IconButton label={`Reactivate ${user.name}`} onClick={() => apply(true)} disabled={pending}>
        <UserCheck aria-hidden />
      </IconButton>
    );

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <AlertDialogTrigger asChild>
            <Button variant="ghost" size="icon">
              <UserX aria-hidden />
              <span className="sr-only">Deactivate {user.name}</span>
            </Button>
          </AlertDialogTrigger>
        </TooltipTrigger>
        <TooltipContent>Deactivate</TooltipContent>
      </Tooltip>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Deactivate {user.name}?</AlertDialogTitle>
          <AlertDialogDescription>
            They are signed out immediately and can&apos;t sign in until reactivated. Their history is kept.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <Button variant="destructive" onClick={() => apply(false)} disabled={pending}>
            {pending ? "Deactivating…" : "Deactivate"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

type CreateInput = z.input<typeof createUserSchema>;

export function CreateUserDialog() {
  const [created, setCreated] = useState<{ name: string; password: string }>();
  const form = useForm<CreateInput, unknown, z.output<typeof createUserSchema>>({
    resolver: zodResolver(createUserSchema),
    defaultValues: { name: "", email: "", phone: "", role: "caller" },
  });
  const { errors, isSubmitting } = form.formState;

  async function onSubmit(values: z.output<typeof createUserSchema>) {
    try {
      const res = await createUser(values);
      if (!res.ok) return void toast.error(res.error); // form keeps what was typed
      setCreated({ name: values.name, password: res.tempPassword });
      form.reset();
    } catch {
      toast.error(NETWORK_ERROR);
    }
  }

  return (
    <Dialog onOpenChange={(open) => !open && setCreated(undefined)}>
      <DialogTrigger asChild>
        <Button>
          <UserPlus aria-hidden /> Add user
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{created ? "User created" : "Add user"}</DialogTitle>
          <DialogDescription>
            {created ? "Share the password privately, e.g. in person or by phone." : "A temporary password is generated for them."}
          </DialogDescription>
        </DialogHeader>
        {created ? (
          <>
            <TempPassword name={created.name} password={created.password} />
            <DialogFooter>
              <DialogClose asChild>
                <Button>Done</Button>
              </DialogClose>
            </DialogFooter>
          </>
        ) : (
          <form onSubmit={form.handleSubmit(onSubmit)} noValidate>
            <FieldGroup>
              <Field data-invalid={!!errors.name}>
                <FieldLabel htmlFor="name">Name</FieldLabel>
                <Input id="name" autoComplete="off" aria-invalid={!!errors.name} {...form.register("name")} />
                <FieldError errors={[errors.name]} />
              </Field>
              <Field data-invalid={!!errors.email}>
                <FieldLabel htmlFor="email">Email</FieldLabel>
                <Input id="email" type="email" autoComplete="off" aria-invalid={!!errors.email} {...form.register("email")} />
                <FieldError errors={[errors.email]} />
              </Field>
              <Field data-invalid={!!errors.phone}>
                <FieldLabel htmlFor="phone">Phone (optional)</FieldLabel>
                <Input id="phone" type="tel" inputMode="tel" placeholder="07X XXX XXXX" aria-invalid={!!errors.phone} {...form.register("phone")} />
                <FieldError errors={[errors.phone]} />
              </Field>
              <Field>
                <FieldLabel htmlFor="role">Role</FieldLabel>
                <Controller
                  control={form.control}
                  name="role"
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger id="role" className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="caller">Caller / WhatsApp admin</SelectItem>
                        <SelectItem value="owner">Owner (full access)</SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                />
              </Field>
              <DialogFooter>
                <DialogClose asChild>
                  <Button type="button" variant="outline">
                    Cancel
                  </Button>
                </DialogClose>
                <Button type="submit" disabled={isSubmitting}>
                  {isSubmitting ? "Creating…" : "Create user"}
                </Button>
              </DialogFooter>
            </FieldGroup>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
