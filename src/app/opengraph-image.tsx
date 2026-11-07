import { ImageResponse } from "next/og";

// The link preview for every page (D-47): the logo and what Sawwi does, in the app's palette.
export const alt = "Sawwi: reconciliation for GCC e-commerce sellers";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", background: "#fafafa", padding: 72, color: "#18181b" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          {/* The logo mark (D-48): two sheets, the front one ticked, on the dark tile. */}
          <svg width="64" height="64" viewBox="0 0 64 64">
            <rect width="64" height="64" rx="15" fill="#18181b" />
            <rect x="11" y="13" width="26" height="32" rx="6" fill="#1f5346" />
            <rect x="27" y="19" width="26" height="32" rx="6" fill="#0e7c66" />
            <path d="M33 35L38.5 40.5L48 30" fill="none" stroke="#ffffff" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <div style={{ display: "flex", fontSize: 40, fontWeight: 600, letterSpacing: -1 }}>
            sawwi<span style={{ color: "#0e7c66" }}>app</span>
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div style={{ fontSize: 68, fontWeight: 600, lineHeight: 1.1, letterSpacing: -1.5 }}>Know where every dirham of your sales went.</div>
          <div style={{ fontSize: 30, color: "#71717a", lineHeight: 1.35 }}>
            Reconcile marketplace settlements, webstore orders, gateway, COD and BNPL payouts, ERP invoices and bank statements.
          </div>
        </div>
        <div style={{ display: "flex", gap: 10, fontSize: 22, color: "#71717a" }}>
          {["Magento 2", "Shopify", "Business Central", "Amazon", "Noon", "Tabby", "Tamara"].map((c) => (
            <div key={c} style={{ display: "flex", alignItems: "center", flexShrink: 0, whiteSpace: "nowrap", height: 52, lineHeight: 1, border: "2px solid #e4e4e7", borderRadius: 999, padding: "0 22px", background: "#ffffff" }}>
              {c}
            </div>
          ))}
        </div>
      </div>
    ),
    size,
  );
}
