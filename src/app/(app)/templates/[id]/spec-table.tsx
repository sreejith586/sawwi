"use client";

import { Pill } from "@/components/data-table";
import { QueryTable, type QueryColumn } from "@/components/query-table";
import { SPEC_SEARCH, type SpecRow } from "@/lib/tables/rows";

const columns: QueryColumn<SpecRow>[] = [
  { key: "file", header: "File" },
  { key: "field", header: "Column", render: (r) => <span className="font-medium">{r.field}</span> },
  { key: "type", header: "Type" },
  { key: "required", header: "Required", render: (r) => (r.required === "Required" ? <Pill tone="info">Required</Pill> : <span className="text-muted">Optional</span>) },
];

export function SpecTable({ templateId, rows }: { templateId: string; rows: SpecRow[] }) {
  return (
    <QueryTable
      rows={rows}
      columns={columns}
      searchFields={[...SPEC_SEARCH]}
      searchPlaceholder="Search columns"
      filters={[
        { key: "file", label: "File", allLabel: "All files" },
        { key: "type", label: "Type", allLabel: "All types" },
        { key: "required", label: "Required", allLabel: "Required + optional" },
      ]}
      exportHref={(params) => `/api/templates/${templateId}/spec${params ? `?${params}` : ""}`}
      pageSize={50}
      dense
    />
  );
}
