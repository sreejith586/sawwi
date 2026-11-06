"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  const pathname = usePathname();
  const active = pathname === href || pathname.startsWith(`${href}/`);
  return (
    <Link
      href={href}
      className={`rounded-md px-2.5 py-1.5 text-sm transition-colors ${active ? "bg-surface-muted font-medium text-foreground" : "text-muted hover:text-foreground"}`}
    >
      {children}
    </Link>
  );
}
