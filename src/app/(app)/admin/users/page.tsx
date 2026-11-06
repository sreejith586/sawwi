import type { Metadata } from "next";
import { Suspense } from "react";
import { requireSuperadminPage } from "@/lib/saas/admin";
import { userRows } from "@/lib/saas/admin-rows";
import { listUsersForAdmin } from "@/lib/saas/store";
import { UsersTable } from "./users-table";

export const metadata: Metadata = { title: "Users · Admin" };

async function Users() {
  await requireSuperadminPage();
  return <UsersTable rows={userRows(listUsersForAdmin())} />;
}

export default function AdminUsersPage() {
  return (
    <Suspense fallback={<p className="text-muted">Loading users…</p>}>
      <Users />
    </Suspense>
  );
}
