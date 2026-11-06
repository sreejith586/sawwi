// Access levels for team members. Pure data, safe to import from client components.

export const ACCESS = [
  { value: "admin", label: "Admin", hint: "Manage members, templates and every reconciliation" },
  { value: "editor", label: "Editor", hint: "Upload files, answer questions and run reconciliations" },
  { value: "viewer", label: "Viewer", hint: "View reports and download Excel" },
] as const;
export type Access = (typeof ACCESS)[number]["value"];

export const isAccess = (v: unknown): v is Access => ACCESS.some((a) => a.value === v);
