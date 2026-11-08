// The demo store's sample supplier invoices (D-60): what each one is and shows. The PDFs are drawn
// by fixtures/samples.ts and kept as base64 in samples-data.ts. Suppliers, TRNs and numbers are
// invented, and match the mock Business Central's trading company (vendors V0001–V0003).
import { SAMPLE_PDFS } from "./samples-data";

export type SampleLine = { code?: string; description: string; qty: number; price: number };
export type SampleLayout = "classic" | "code-first";

export type SampleSpec = {
  id: string;
  title: string;
  /** What the sample shows in the demo. */
  shows: string;
  supplier: string;
  address: string;
  trn: string;
  number: string;
  /** As printed, dd/mm/yyyy. */
  date: string;
  due?: string;
  po?: string;
  layout: SampleLayout;
  lines: SampleLine[];
  scan?: boolean;
};

export const SAMPLE_SPECS: SampleSpec[] = [
  {
    id: "coolbreeze-cas-55188",
    title: "Coolbreeze Air Systems · CAS-55188",
    shows: "Vendor found by TRN, the AC unit by its SKU; the delivery charge needs a G/L account.",
    supplier: "Coolbreeze Air Systems Co.",
    address: "Warehouse 7, Al Quoz Industrial 3, Dubai, UAE",
    trn: "100234567800003",
    number: "CAS-55188",
    date: "28/10/2026",
    due: "27/11/2026",
    po: "PO-7004",
    layout: "classic",
    lines: [
      { code: "AC-18K", description: "Split AC 18,000 BTU", qty: 10, price: 1200 },
      { description: "Delivery charges", qty: 1, price: 250 },
    ],
  },
  {
    id: "gulf-lighting-gls-2342",
    title: "Gulf Lighting Supplies · GLS-2342",
    shows: "The supplier's own item codes: the LED panel matches by name, the fan needs picking once and is remembered.",
    supplier: "Gulf Lighting Supplies L.L.C.",
    address: "Shop 14, Naif Road, Deira, Dubai, UAE",
    trn: "100345678900003",
    number: "GLS-2342",
    date: "02/11/2026",
    due: "02/12/2026",
    layout: "code-first",
    lines: [
      { code: "GL-LED40", description: "LED panel 40 W", qty: 200, price: 22 },
      { code: "GL-FAN12", description: "Ceiling fan 1200mm", qty: 40, price: 160 },
    ],
  },
  {
    id: "gulf-lighting-gls-2307",
    title: "Gulf Lighting Supplies · GLS-2307",
    shows: "Already in Business Central as PI-9003: Sawwi refuses to push it twice.",
    supplier: "Gulf Lighting Supplies L.L.C.",
    address: "Shop 14, Naif Road, Deira, Dubai, UAE",
    trn: "100345678900003",
    number: "GLS-2307",
    date: "27/10/2026",
    due: "26/11/2026",
    layout: "code-first",
    lines: [{ code: "GL-LED40", description: "LED panel 40 W", qty: 50, price: 22 }],
  },
  {
    id: "al-noor-anp-0419-scan",
    title: "Al Noor Packaging (scan) · ANP-0419",
    shows: "A scanned invoice read by OCR; the vendor matches by name, with no TRN on file in Business Central.",
    supplier: "Al Noor Packaging Materials Trading LLC",
    address: "Plot 22, Industrial Area 13, Sharjah, UAE",
    trn: "100456789000003",
    number: "ANP-0419",
    date: "30/10/2026",
    layout: "classic",
    lines: [
      { description: "Shipping carton 60x40x40", qty: 500, price: 4.5 },
      { description: "Packing tape 48 mm", qty: 120, price: 6.25 },
    ],
    scan: true,
  },
];

export const sampleSpec = (id: string) => SAMPLE_SPECS.find((s) => s.id === id);

/** The sample's PDF bytes, or undefined for an unknown id. */
export function samplePdfBytes(id: string): Uint8Array | undefined {
  const b64 = SAMPLE_PDFS[id];
  return b64 && sampleSpec(id) ? new Uint8Array(Buffer.from(b64, "base64")) : undefined;
}
