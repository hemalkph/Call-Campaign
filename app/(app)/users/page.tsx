import { PageHeader } from "@/components/page-header";
import { User } from "@/lib/models/user";
import { requireOwner } from "@/lib/session";
import { CreateUserDialog, UsersTable } from "./users-table";

export const metadata = { title: "Users" };

export default async function UsersPage() {
  const me = await requireOwner();
  const users = await User.find({}, { passwordHash: 0 }).sort({ active: -1, role: -1, name: 1 }).lean();

  return (
    <>
      <PageHeader title="Users" description="Owners and callers who can sign in.">
        <CreateUserDialog />
      </PageHeader>
      <UsersTable
        currentUserId={me.id}
        users={users.map((u) => ({
          id: String(u._id),
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
