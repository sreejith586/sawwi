import type { DemoFile } from "./demo-files";

// Made-up files for the last seven templates in the demo store (D-36): statements, price lists,
// returns, post-dated cheques, bank payouts and imports. They refer to the demo Business Central
// company's documents (SI-31xx, SCM-501, GLS-2291, PO-7001…) and to the demo store's payouts
// (po_1029, TB-1014, RMT-2026-041…), so every reconciliation lines up. October 2026, AED.
// Every file plants a few exceptions. Nothing here is real.

export const FINANCE_FILES: DemoFile[] = [
  // ─── Customer ledger vs. customer statement (Al Waha Hotels, C0001) ───
  {
    id: "customer_ledger",
    label: "Customer ledger: Al Waha Hotels",
    description: "Al Waha Hotels' account in the demo company's books for October.",
    slots: ["b2b-customer-statement/our_ledger"],
    headers: ["Document number", "Date", "Type (invoice / credit / receipt)", "Debit", "Credit"],
    dateColumn: 1,
    rows: [
      ["SI-3101", "2026-10-07", "invoice", "7350.00", "0.00"],
      ["SI-3104", "2026-10-15", "invoice", "1260.00", "0.00"],
      ["RCPT-1020", "2026-10-20", "receipt", "0.00", "7350.00"],
      ["SI-3105", "2026-10-21", "invoice", "1995.00", "0.00"], // the customer hasn't booked it
    ],
  },
  {
    id: "customer_statement",
    label: "Al Waha Hotels' statement",
    description: "The supplier ledger Al Waha Hotels sent back. Planted: an invoice they booked net of VAT, an invoice they haven't booked, and a debit note we don't have.",
    slots: ["b2b-customer-statement/their_statement"],
    headers: ["Your document number", "Date", "Debit", "Credit"],
    dateColumn: 1,
    rows: [
      ["SI3101", "2026-10-08", "0.00", "7350.00"],
      ["SI-3104", "2026-10-16", "0.00", "1200.00"], // booked without VAT (1260.00)
      ["RCPT-1020", "2026-10-20", "7350.00", "0.00"],
      ["DN-0045", "2026-10-28", "150.00", "0.00"], // their deduction for a late delivery
    ],
  },

  // ─── Supplier ledger vs. supplier statement (Gulf Lighting Supplies, V0002) ───
  {
    id: "supplier_ledger",
    label: "Supplier ledger: Gulf Lighting Supplies",
    description: "Gulf Lighting Supplies' account in the demo company's books. Planted: one bill entered twice.",
    slots: ["p2p-supplier-statement/our_ledger"],
    headers: ["Supplier document no.", "Date", "Type (bill / payment / debit note)", "Debit", "Credit"],
    dateColumn: 1,
    rows: [
      ["GLS-2291", "2026-10-18", "bill", "0.00", "17325.00"],
      ["GLS-2291", "2026-10-19", "bill", "0.00", "17325.00"], // entered twice
      ["GLS-2307", "2026-10-27", "bill", "0.00", "1155.00"],
      ["PAY-V2-09", "2026-10-30", "payment", "10000.00", "0.00"],
    ],
  },
  {
    id: "supplier_statement",
    label: "Gulf Lighting Supplies' statement of account",
    description: "The supplier's statement for October. Planted: a bill we haven't booked and one at a different amount.",
    slots: ["p2p-supplier-statement/their_statement"],
    headers: ["Document no.", "Date", "Debit", "Credit"],
    dateColumn: 1,
    rows: [
      ["GLS-2291", "2026-10-18", "17325.00", "0.00"],
      ["GLS-2307", "2026-10-27", "1210.00", "0.00"], // we booked 1155.00
      ["PAY-V2-09", "2026-10-30", "0.00", "10000.00"],
      ["GLS-2315", "2026-10-31", "2310.00", "0.00"], // not in our books yet
    ],
  },

  // ─── Invoice prices vs. price list ───
  {
    id: "price_list",
    label: "Customer price list",
    description: "Agreed prices per customer and item. Planted: LED panels billed above the agreed price, an air conditioner billed below it, an expired price and an item with no agreed price.",
    slots: ["b2b-price-compliance/price_list"],
    headers: ["Customer", "SKU", "Agreed price", "Agreed discount %", "Valid from", "Valid to"],
    dateColumn: -1,
    rows: [
      ["Al Waha Hotels", "FAN-1200", "250.00", "0.00", "2026-01-01", "2026-12-31"],
      ["Al Waha Hotels", "LED-40", "38.00", "0.00", "2026-01-01", "2026-12-31"], // SI-3101 and SI-3104 billed 40.00
      ["Marina Facilities Management", "AC-18K", "1850.00", "0.00", "2026-01-01", "2026-12-31"], // billed 1800.00
      ["Marina Facilities Management", "LED-40", "40.00", "0.00", "2026-01-01", "2026-09-30"], // expired before SI-3106
      // No agreed price for Desert Rose Contracting's cable (SI-3103).
    ],
  },

  // ─── Returns vs. credit notes ───
  {
    id: "customer_returns",
    label: "Customer returns (RMA log)",
    description: "Goods customers sent back. Planted: a return with no credit note, and one credited at a different value.",
    slots: ["b2b-returns-vs-credit-notes/returns"],
    headers: ["Return / RMA no.", "Original invoice no.", "Customer", "SKU", "Quantity", "Return date", "Return value"],
    dateColumn: 5,
    rows: [
      ["RMA-0088", "SI-3103", "Desert Rose Contracting", "CBL-25", "2.00", "2026-10-16", "209.00"], // credited 199.50
      ["RMA-0091", "SI-3102", "Marina Facilities Management", "AC-18K", "1.00", "2026-10-25", "1890.00"], // no credit note yet
    ],
  },

  // ─── Post-dated cheques vs. bank ───
  {
    id: "pdc_register",
    label: "Post-dated cheque register",
    description: "Customers' post-dated cheques held by the demo company. Planted: a cheque past its date and not deposited.",
    slots: ["b2b-pdc-clearing/pdc_register"],
    headers: ["Cheque number", "Customer", "Drawee bank", "Cheque (due) date", "Amount", "Status"],
    dateColumn: -1,
    rows: [
      ["000412", "Desert Rose Contracting", "Emirates NBD", "2026-10-10", "1990.00", "Deposited"],
      ["000413", "Marina Facilities Management", "ADCB", "2026-10-20", "5000.00", "Deposited"], // bounced
      ["000414", "Al Waha Hotels", "First Abu Dhabi Bank", "2026-10-25", "1260.00", "In safe"], // due, not deposited
      ["000416", "Marina Facilities Management", "ADCB", "2026-10-28", "2100.00", "Deposited"], // bank credited 2000.00
    ],
  },
  {
    id: "bank_pdc",
    label: "Bank statement (collections account)",
    description: "The collections account where cheques are deposited. Planted: a returned cheque.",
    slots: ["b2b-pdc-clearing/bank"],
    headers: ["Value date", "Narration / description", "Reference", "Credit amount", "Debit amount", "Currency"],
    dateColumn: 0,
    rows: [
      ["2026-10-11", "CHEQUE DEPOSIT CLEARED", "CHQ 412", "1990.00", "0.00", "AED"],
      ["2026-10-21", "CHEQUE DEPOSIT CLEARED", "CHQ 413", "5000.00", "0.00", "AED"],
      ["2026-10-23", "RETURNED CHEQUE INSUFFICIENT FUNDS", "CHQ 413 RTN", "0.00", "5000.00", "AED"],
      ["2026-10-29", "CHEQUE DEPOSIT CLEARED", "CHQ 416", "2000.00", "0.00", "AED"],
      ["2026-10-31", "ACCOUNT MAINTENANCE FEE", "", "0.00", "25.00", "AED"],
    ],
  },

  // ─── Payouts vs. bank ───
  {
    id: "payouts",
    label: "Payment provider payouts",
    description: "Payouts the card gateway, Tabby and the courier sent for the demo store in October.",
    slots: ["bank-payouts/payouts"],
    headers: ["Payout / batch ID", "Provider", "Payout date", "Payout amount", "Currency"],
    dateColumn: 2,
    rows: [
      ["RMT-2026-041", "Aramex COD", "2026-10-09", "224.00", "AED"],
      ["TB-1014", "Tabby", "2026-10-14", "800.31", "AED"],
      ["po_1029", "Card gateway", "2026-10-15", "776.79", "AED"],
      ["po_1105", "Card gateway", "2026-10-19", "164.96", "AED"],
      ["RMT-2026-044", "Aramex COD", "2026-10-23", "415.00", "AED"],
      ["po_1119", "Card gateway", "2026-10-23", "34.04", "AED"], // credited 32.04
      ["po_1126", "Card gateway", "2026-10-28", "145.65", "AED"], // never reached the bank
    ],
  },
  {
    id: "bank_payouts",
    label: "Bank statement (store receipts account)",
    description: "The account the demo store's providers pay into. Planted: a payout short by 2.00, a payout missing, and a credit nobody can identify.",
    slots: ["bank-payouts/bank"],
    headers: ["Value date", "Narration / description", "Reference", "Credit amount", "Debit amount", "Currency"],
    dateColumn: 0,
    rows: [
      ["2026-10-10", "ARAMEX COD REMITTANCE", "RMT-2026-041", "224.00", "0.00", "AED"],
      ["2026-10-15", "TABBY FZ LLC SETTLEMENT", "TB-1014", "800.31", "0.00", "AED"],
      ["2026-10-16", "CARD GATEWAY PAYOUT", "PO_1029", "776.79", "0.00", "AED"],
      ["2026-10-20", "CARD GATEWAY PAYOUT", "PO_1105", "164.96", "0.00", "AED"],
      ["2026-10-24", "ARAMEX COD REMITTANCE", "RMT-2026-044", "415.00", "0.00", "AED"],
      ["2026-10-24", "CARD GATEWAY PAYOUT", "PO_1119", "32.04", "0.00", "AED"],
      ["2026-10-29", "TT FROM GULF TRADERS", "REF 99812", "3500.00", "0.00", "AED"], // nobody knows what this is
      ["2026-10-31", "BANK CHARGES", "", "0.00", "25.00", "AED"],
    ],
  },

  // ─── Import shipments vs. customs vs. freight ───
  {
    id: "import_shipments",
    label: "Import shipments",
    description: "Stock the demo company imported, with the commercial invoice value per bill of lading.",
    slots: ["p2p-import-landed-cost/shipments"],
    headers: ["BL / AWB / shipment no.", "Supplier", "PO number", "Ship date", "Commercial invoice value (local currency)"],
    dateColumn: -1,
    rows: [
      ["MSCU1234567", "Coolbreeze Air Systems Co.", "PO-7001", "2026-09-20", "21600.00"],
      ["MAEU7654321", "Ningbo Home Goods Ltd.", "PO-7003", "2026-09-28", "16000.00"], // declared at 15200.00
      ["176-55512345", "Coolbreeze Air Systems Co.", "PO-7004", "2026-10-22", "1200.00"], // no declaration, no freight bill
    ],
  },
  {
    id: "customs_declarations",
    label: "Customs declarations",
    description: "Import declarations filed for the demo company. Planted: one declared below the invoice, and one for a shipment that isn't ours.",
    slots: ["p2p-import-landed-cost/customs"],
    headers: ["Declaration no.", "BL / AWB / shipment no.", "Declaration date", "Customs (CIF) value", "Customs duty", "Import VAT"],
    dateColumn: -1,
    rows: [
      ["DXB-IMP-2026-118842", "MSCU 1234567", "2026-10-05", "21600.00", "1080.00", "1134.00"],
      ["DXB-IMP-2026-119107", "MAEU7654321", "2026-10-12", "15200.00", "760.00", "798.00"],
      ["DXB-IMP-2026-119310", "HLCU5555000", "2026-10-20", "4800.00", "240.00", "252.00"], // not one of our shipments
    ],
  },
  {
    id: "freight_bills",
    label: "Freight forwarder bills",
    description: "Freight and clearing bills for the demo company's imports. Planted: a bill entered twice, and one for a shipment that isn't ours.",
    slots: ["p2p-import-landed-cost/freight"],
    headers: ["Bill no.", "BL / AWB / shipment no.", "Forwarder / agent", "Charge type", "Bill date", "Amount (excl. VAT)"],
    dateColumn: -1,
    rows: [
      ["FWD-8812", "MSCU1234567", "Oasis Freight Forwarding", "Ocean freight", "2026-10-06", "2400.00"],
      ["FWD-8812", "MSCU1234567", "Oasis Freight Forwarding", "Ocean freight", "2026-10-06", "2400.00"], // duplicate
      ["FWD-8840", "MAEU7654321", "Oasis Freight Forwarding", "Terminal handling", "2026-10-13", "650.00"],
      ["FWD-8899", "ONEY0000001", "Oasis Freight Forwarding", "Clearing", "2026-10-21", "300.00"], // not one of our shipments
    ],
  },
];
