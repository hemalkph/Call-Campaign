import { PageHeader } from "@/components/page-header";
import { asc, desc } from "drizzle-orm";
import { db, users as usersTable } from "@/lib/db";
import { requireOwner } from "@/lib/session";
import { CreateUserDialog, UsersTable } from "./users-table";

export const metadata = { title: "Users" };

export default async function UsersPage() {
  const me = await requireOwner();
  const users = await db
    .select()
    .from(usersTable)
    .orderBy(desc(usersTable.active), asc(usersTable.role), asc(usersTable.name)); // active first, owners before callers

  return (
    <>
      <PageHeader title="Users" description="Owners and callers who can sign in.">
        <CreateUserDialog />
      </PageHeader>
      <UsersTable
        currentUserId={me.id}
        users={users.map((u) => ({
          id: u.id,
          name: u.name,
          email: u.email,
          phone: u.phone ?? "",
          role: u.role,
          active: u.active,
          mustChangePassword: u.mustChangePassword,
        }))}
      />
    </>
  );
}
