import Papa from "papaparse";

// Sample COD remittance reports for the demo store (D-77). Invented: AWBs, orders and amounts
// match the mock Business Central store company's November COD invoices (PSI-W1031–W1036).

export type CodSample = { id: string; title: string; shows: string; fileName: string; text: () => string };

const parcel = (awb: string, order: string, collected: number) => [awb, order, collected.toFixed(2), "5.00", "0.25", (collected - 5.25).toFixed(2)];

function aramex(): string {
  const rows = [
    parcel("4410031001", "000000131", 430),
    parcel("4410031002", "000000132", 229),
    parcel("4410031003", "000000133", 370), // invoice is 380: collected 10.00 short
    parcel("4410031004", "000000134", 315), // never invoiced in the ERP
    parcel("4410031005", "000000135", 295), // invoice already paid
    parcel("4410031006", "000000136", 159),
  ].map((r) => [...r, "ARX-RMT-2026-11-07", "07/11/2026", "AED"]);
  const total = rows.reduce((a, r) => a + Number(r[5]), 0);
  rows.push(["Total", "", "", "", "", total.toFixed(2), "", "", ""]);
  return Papa.unparse({ fields: ["AWB", "Shipper Reference", "COD Amount", "COD Charges", "VAT", "Net Payable", "Remittance No", "Remittance Date", "Currency"], data: rows });
}

function smsa(): string {
  return Papa.unparse({
    fields: ["Tracking No", "Order No", "Collected Amount", "Service Fee", "Net Amount", "Batch", "Payment Date"],
    data: [
      ["4410031006", "000000136", "159.00", "5.00", "153.75", "SMSA-2026-11-08", "2026-11-08"], // the same parcel as in Aramex's batch
      ["SM77010042", "000000137", "189.00", "5.00", "183.75", "SMSA-2026-11-08", "2026-11-08"], // no invoice: on account
    ],
  });
}

export const COD_SAMPLES: CodSample[] = [
  {
    id: "aramex-2026-11-07",
    title: "Aramex · remittance ARX-RMT-2026-11-07",
    shows: "Six parcels: three paid in full, one 10.00 short, one never invoiced, one whose invoice is already paid.",
    fileName: "aramex-cod-remittance-2026-11-07.csv",
    text: aramex,
  },
  {
    id: "smsa-2026-11-08",
    title: "SMSA · batch SMSA-2026-11-08",
    shows: "Another layout, VAT worked out from the net; one parcel already remitted by Aramex.",
    fileName: "smsa-cod-2026-11-08.csv",
    text: smsa,
  },
];

export const codSample = (id: string) => COD_SAMPLES.find((s) => s.id === id);
