import type { ConnectorId } from "./coverage";

// The public reconciliation pages (D-47): one per system or payment flow people search for.
// Copy says only what Sawwi does today. Connectors are built and tested against simulated
// accounts; live checks with real accounts are still to come (docs/PROGRESS.md), so pages say what
// the connector reads and always offer the upload path too. No reviews, ratings or logos.

export type Faq = { q: string; a: string };

export type Solution = {
  slug: string;
  /** Short name for links and breadcrumbs. */
  name: string;
  /** <title>, under ~60 characters with the " · Sawwi" suffix. */
  title: string;
  /** Meta description, under ~160 characters. */
  description: string;
  h1: string;
  lede: string;
  /** How the data gets into Sawwi. */
  dataIn: { heading: string; connector?: ConnectorId; paragraphs: string[] };
  /** Catalogue templates this page is about, most relevant first. */
  templates: string[];
  faqs: Faq[];
  related: string[];
};

const UPLOAD_ANY = "Sawwi reads CSV, Excel and PDF files. It maps the columns for you, asks a one-click question when something is ambiguous, and remembers the layout, so next month's export asks nothing.";

export const SOLUTIONS: Solution[] = [
  {
    slug: "magento-2",
    name: "Magento 2",
    title: "Magento 2 reconciliation: orders, payments, refunds",
    description: "Reconcile Magento 2 and Adobe Commerce orders against gateway, COD and BNPL settlements, credit memos against returns, and shipments against courier bills.",
    h1: "Magento 2 reconciliation",
    lede: "Match your Magento 2 or Adobe Commerce orders against what your payment gateway, courier and BNPL provider actually paid you, and check every credit memo against a returned item.",
    dataIn: {
      heading: "Connect Magento 2, or upload the exports",
      connector: "magento",
      paragraphs: [
        "Sawwi's Magento 2 connector reads seven reports through the Magento REST API with an integration token: orders, invoices, credit memos (totals), credit memo lines (refunded items), shipment tracking numbers with weights, stock per SKU and source (Multi-Source Inventory), and product prices with special prices and their dates. It only reads; Sawwi never writes to your store.",
        "Run Magento with Microsoft Dynamics 365 Business Central? Sawwi checks that every Magento invoice and refund was posted in Business Central once, with the same total, VAT and customer, and that Magento's stock and prices match Business Central's inventory and unit prices, reading both sides through their connectors.",
        "The connector is new. If it doesn't suit your setup yet, export the same data from the Magento admin and upload it. Magento 1 stores work through uploads of the order grid and credit memo exports.",
      ],
    },
    templates: ["web-orders-vs-gateway", "web-erp-invoices", "web-erp-credit-memos", "web-erp-stock", "web-erp-prices", "web-cod-remittance", "web-bnpl", "web-refunds-vs-returns", "web-courier-freight", "bank-payouts"],
    faqs: [
      { q: "Which Magento versions does Sawwi work with?", a: "The connector works with Magento 2 and Adobe Commerce through the REST API. On Magento 2.4.4 and later, the store must allow integration tokens to be used as bearer tokens. Magento 1 stores can upload their order and credit memo exports instead." },
      { q: "Does Sawwi change anything in my Magento store?", a: "No. The connector only reads orders, invoices, credit memos, shipments, stock and prices, with a token you create for Sawwi and can revoke at any time. The token is stored encrypted." },
      { q: "Which payment gateways can I reconcile Magento orders against?", a: "Any gateway whose settlement or transaction report you can download, for example Checkout.com, Tap, PayTabs, Telr or Stripe. Sawwi matches each order to its captures, refunds and chargebacks by the order reference." },
      { q: "Does AI decide which orders match?", a: "No. Matching is done by a deterministic engine on order references, amounts and dates, with tolerances you can see. AI is only used to help read column headers." },
    ],
    related: ["shopify", "payment-gateway", "cash-on-delivery", "bnpl"],
  },
  {
    slug: "dynamics-365-business-central",
    name: "Business Central",
    title: "Dynamics 365 Business Central reconciliation",
    description: "Reconcile Dynamics 365 Business Central sales invoices, credit memos, shipments and purchase documents: cash application, order-to-cash and three-way PO match.",
    h1: "Microsoft Dynamics 365 Business Central reconciliation",
    lede: "Pull sales and purchase documents from Business Central and reconcile them against customer payments, deliveries, marketplace settlements and supplier invoices, without copying data between spreadsheets.",
    dataIn: {
      heading: "Connect Business Central, or upload the exports",
      connector: "business-central",
      paragraphs: [
        "Sawwi's Business Central connector signs in with a Microsoft Entra app registration (client credentials) and reads eleven reports through the Business Central API v2.0: sales invoices, sales invoice lines, sales credit memos, open sales order lines, sales shipment lines, open purchase order lines, purchase receipt lines, purchase invoice lines, posted sales invoices and credit memos for web orders (those carrying a store order number in External Document No.), and items with their inventory and unit price. It only reads.",
        "It works with Business Central online. The reports come in with fixed column names, so they map onto the templates without questions. The connector is new; you can always export the same lists to Excel and upload them instead.",
      ],
    },
    templates: ["b2b-cash-application", "b2b-order-delivery-invoice", "p2p-three-way-match", "web-erp-invoices", "web-erp-credit-memos", "web-erp-stock", "web-erp-prices", "b2b-returns-vs-credit-notes", "b2b-price-compliance", "mkt-settlement-vs-sales", "mkt-b2b-payment-release", "b2b-customer-statement", "p2p-supplier-statement"],
    faqs: [
      { q: "What does Sawwi need to connect to Business Central?", a: "Your IT admin registers an app in Microsoft Entra, gives it a client secret, and enables it in Business Central with a read-only permission set. You then enter the tenant, environment, client ID and secret in Sawwi. The secret is stored encrypted." },
      { q: "Does it work with Business Central on-premises?", a: "The connector uses the Business Central online API. For on-premises installations, export the same lists to Excel and upload them." },
      { q: "Can Sawwi read customer and vendor ledger entries?", a: "Not through the connector: Business Central's standard API v2.0 doesn't expose them. For customer and supplier statement reconciliations, export the ledger from Business Central and upload it." },
      { q: "Can Sawwi check that our web store's orders reach Business Central?", a: "Yes, for Magento 2. Sawwi compares Magento's invoices and credit memos with the posted sales invoices and credit memos that carry the Magento order number in External Document No., and flags documents that never synced, were posted twice, or whose totals, VAT or customers differ. It also compares Magento's sellable stock and prices per SKU with Business Central's inventory and unit prices. Price list lines aren't in Business Central's standard API, so special prices are checked on the Magento side only." },
      { q: "Is this a replacement for bank reconciliation in Business Central?", a: "No. Sawwi focuses on the reconciliations around your sales and purchases: payments against invoices, orders against deliveries and invoices, POs against receipts and supplier bills, and marketplace payouts against sales." },
    ],
    related: ["bank", "amazon-settlement", "magento-2"],
  },
  {
    slug: "shopify",
    name: "Shopify",
    title: "Shopify reconciliation: orders vs payouts",
    description: "Reconcile Shopify orders against payment gateway settlements, COD courier remittances, Tabby and Tamara payouts and your bank statement.",
    h1: "Shopify reconciliation",
    lede: "Check that every paid Shopify order was settled by your gateway, every cash-on-delivery order was remitted by the courier, and every BNPL order was paid out, in full.",
    dataIn: {
      heading: "Connect Shopify, or upload the orders export",
      connector: "shopify",
      paragraphs: [
        "Sawwi's Shopify connector reads your orders through the Shopify Admin API with an access token from a custom app: status, gateway, totals and refunds, one row per order. It only reads.",
        "The connector is new. The orders CSV from the Shopify admin works just as well, and so do refund exports for the refunds-vs-returns check.",
      ],
    },
    templates: ["web-orders-vs-gateway", "web-cod-remittance", "web-bnpl", "web-refunds-vs-returns", "bank-payouts"],
    faqs: [
      { q: "Can I reconcile Shopify Payments payouts?", a: "Yes, as a gateway report: download the payout transactions from Shopify and use them in the orders vs payment gateway reconciliation, then match payouts to your bank statement." },
      { q: "What about cash on delivery orders?", a: "COD orders are reconciled against the courier's delivery status report and COD remittance statement, for example from Aramex or SMSA, so you can see delivered orders that were never remitted or were remitted short." },
      { q: "Do I need a Shopify app from the app store?", a: "No. The connector uses an access token from a custom app you create in your Shopify admin with read access to orders. Or skip it and upload the orders CSV." },
    ],
    related: ["magento-2", "payment-gateway", "cash-on-delivery", "bnpl"],
  },
  {
    slug: "amazon-settlement",
    name: "Amazon settlements",
    title: "Amazon.ae and Amazon.sa settlement reconciliation",
    description: "Reconcile Amazon.ae and Amazon.sa settlements against your sales: unsettled and short-paid orders, fees vs rate card, FBA stock, claims and VAT.",
    h1: "Amazon settlement reconciliation for Amazon.ae and Amazon.sa",
    lede: "Find the orders Amazon never settled, the ones settled short or twice, commission charged above your rate card, and the claims that were never reimbursed.",
    dataIn: {
      heading: "Upload the Amazon reports you already download",
      paragraphs: [
        "Download the settlement report (flat file) from Seller Central, plus your sales register from your ERP or the marketplace order report. For the deeper checks, add the inventory ledger, reimbursements, customer returns, Amazon Ads invoices or the VAT invoices for selling fees.",
        `${UPLOAD_ANY} There is no Amazon API connector yet.`,
      ],
    },
    templates: ["mkt-settlement-vs-sales", "mkt-fee-rate-card", "mkt-returns-vs-invoiced", "mkt-fulfilment-inventory", "mkt-claims-vs-reimbursements", "mkt-ads-deductions", "mkt-vat", "mkt-b2b-payment-release", "bank-payouts"],
    faqs: [
      { q: "Which Amazon report do I need?", a: "Start with the settlement report (flat file) from Seller Central for the period, and your sales invoices or the order report. Sawwi matches them by order ID and flags orders that weren't settled, were settled short, or were settled twice." },
      { q: "Can Sawwi check Amazon's fees?", a: "Yes. Upload your fee rate card as Excel and Sawwi flags commission charged above the rate for that category, and fee types that aren't on your rate card. Fulfilment-fee slab checks are listed in the report for review; they aren't calculated automatically yet." },
      { q: "Does it cover FBA inventory and reimbursements?", a: "Yes. The fulfilment-centre inventory reconciliation flags shipments Amazon received short of what you sent, and lists lost, damaged and reimbursed units for review. The claims reconciliation tracks every claim you raised: unpaid, partly paid, or close to the filing deadline." },
      { q: "Does it work for Amazon.sa as well as Amazon.ae?", a: "Yes. Sawwi handles AED and SAR and the 5% and 15% VAT rates." },
    ],
    related: ["noon-settlement", "bank", "dynamics-365-business-central"],
  },
  {
    slug: "noon-settlement",
    name: "Noon settlements",
    title: "Noon settlement reconciliation for sellers",
    description: "Reconcile your Noon statement of account against sales invoices: unsettled and short-paid orders, fees vs rate card, FBN stock, returns, ads and VAT.",
    h1: "Noon settlement reconciliation",
    lede: "Check every Noon statement against your own sales: what was settled, what was paid short or twice, which fees were charged, and whether the stock you sent to Noon's fulfilment centres arrived in full.",
    dataIn: {
      heading: "Upload the Noon reports you already download",
      paragraphs: [
        "Download the statement of account from the Noon seller portal, plus your sales register or Noon's order report. For deeper checks add the returns report, the FBN stock movement report, the claims statement, Noon Ads billing or the fee tax invoices.",
        `${UPLOAD_ANY} There is no Noon API connector.`,
      ],
    },
    templates: ["mkt-settlement-vs-sales", "mkt-fee-rate-card", "mkt-returns-vs-invoiced", "mkt-fulfilment-inventory", "mkt-claims-vs-reimbursements", "mkt-ads-deductions", "mkt-vat", "bank-payouts"],
    faqs: [
      { q: "Which Noon report do I need?", a: "The statement of account for the period and your sales invoices or Noon's order report. Sawwi matches them by order ID and lists what wasn't settled, what was settled short, and what was settled twice." },
      { q: "Can I check FBN stock?", a: "Yes. The fulfilment-centre inventory reconciliation uses the FBN stock movement report to flag shipments Noon received short of what you sent, and lists lost, damaged and reimbursed units for review." },
      { q: "Does it handle returns?", a: "Yes. Returns are matched to the original invoice line, so you can see returns with no matching sale, more deducted than was invoiced, more units returned than sold, and refunds for items you never got back." },
    ],
    related: ["amazon-settlement", "bank", "cash-on-delivery"],
  },
  {
    slug: "bank",
    name: "Bank reconciliation",
    title: "Bank reconciliation for e-commerce payouts",
    description: "Match marketplace, gateway, BNPL and courier payouts to your bank statement, apply receipts to invoices and track post-dated cheques. CSV, Excel or PDF.",
    h1: "Bank reconciliation for marketplace, gateway and COD payouts",
    lede: "Every payout you expect, from marketplaces, payment gateways, BNPL providers and couriers, matched to a credit on your bank statement, with FX differences and missing payouts called out.",
    dataIn: {
      heading: "Upload your bank statement as CSV, Excel or PDF",
      paragraphs: [
        "Download the statement from online banking as CSV or Excel, or upload the PDF. Sawwi reads PDF statements from their text layer, or with OCR on the server for scanned pages, and checks the opening and closing balances before matching. Password-protected PDFs need to be unlocked first.",
        "There is no live bank feed yet: statements are uploaded. " + UPLOAD_ANY,
      ],
    },
    templates: ["bank-payouts", "b2b-cash-application", "b2b-pdc-clearing"],
    faqs: [
      { q: "Can I upload a PDF bank statement?", a: "Yes. Sawwi reads the statement table from the PDF, including multi-page tables and wrapped descriptions, and checks the running balance before it matches anything. Scanned statements are read with OCR on Sawwi's server; nothing is sent to an outside service." },
      { q: "Does Sawwi connect to my bank?", a: "Not yet. Statements are uploaded. A bank feed through a licensed open-banking provider is planned, not built." },
      { q: "Can it track post-dated cheques?", a: "Yes. The PDC reconciliation follows each cheque from your register to the bank: due but not deposited, bounced, or cleared for a different amount." },
    ],
    related: ["payment-gateway", "cash-on-delivery", "bnpl", "dynamics-365-business-central"],
  },
  {
    slug: "payment-gateway",
    name: "Payment gateways",
    title: "Payment gateway reconciliation: orders vs settlements",
    description: "Reconcile webstore orders against Checkout.com, Tap, PayTabs, Telr or Stripe settlements: unsettled orders, mismatches, chargebacks, payouts to bank.",
    h1: "Payment gateway reconciliation",
    lede: "Match each paid order to its gateway capture, find orders that were never settled and captures with no order, list chargebacks, and match the payout batches to your bank.",
    dataIn: {
      heading: "Upload the gateway's settlement report",
      paragraphs: [
        "Download the transaction-level settlement or payout report from your gateway, for example Checkout.com, Tap, PayTabs, Telr or Stripe, and your orders from Shopify, Magento, WooCommerce or your ERP. Shopify and Magento 2 orders can also come straight from their connectors.",
        UPLOAD_ANY,
      ],
    },
    templates: ["web-orders-vs-gateway", "bank-payouts"],
    faqs: [
      { q: "Which gateways are supported?", a: "Any gateway that gives you a transaction or settlement report as CSV, Excel or PDF. Sawwi maps the columns: order reference, transaction type, gross amount, fee and net amount." },
      { q: "Does Sawwi check gateway fees?", a: "The report separates gross, fees and net for every transaction. Comparing the effective fee rate against your contracted rate is listed in the report for review; it isn't calculated automatically yet." },
      { q: "How are cash and BNPL orders treated?", a: "Orders paid by cash on delivery, Tabby, Tamara or other instalments are left out of the gateway check, and reconciled in their own templates against the courier and BNPL reports." },
    ],
    related: ["bank", "shopify", "magento-2", "bnpl"],
  },
  {
    slug: "cash-on-delivery",
    name: "Cash on delivery",
    title: "COD reconciliation: deliveries vs courier remittance",
    description: "Reconcile cash-on-delivery orders against courier status and COD remittances from Aramex, SMSA or iMile, and courier freight invoices against shipments.",
    h1: "Cash on delivery (COD) reconciliation",
    lede: "Make sure every COD order the courier delivered was remitted to you, in full and on time, and that their freight invoice only charges for shipments you sent, at your rates.",
    dataIn: {
      heading: "Upload the courier's reports",
      paragraphs: [
        "You need your orders (from Shopify, Magento, WooCommerce or your ERP), the courier's shipment status report and its COD remittance statement, for example from Aramex, SMSA or iMile. For freight, add the courier's invoice detail and your contract rate sheet.",
        "Shopify and Magento 2 orders, and Magento 2 shipments, can come from their connectors. " + UPLOAD_ANY,
      ],
    },
    templates: ["web-cod-remittance", "web-courier-freight", "bank-payouts"],
    faqs: [
      { q: "What does the COD reconciliation catch?", a: "Orders the courier delivered but hasn't remitted after the agreed cycle, cash collected short of the COD amount, and orders returned or cancelled in your store that the courier marked as delivered. COD fees above your contract are listed for review." },
      { q: "Which couriers?", a: "Any courier whose reports you can download. Sawwi maps the columns, so Aramex, SMSA, iMile and local couriers all work the same way." },
      { q: "Can it check courier invoices?", a: "Yes. The freight reconciliation checks the courier's invoice against your shipments: charges for unknown or duplicate airway bills and weight differences. Comparing each charge to your contracted rate is listed for review, not calculated yet." },
    ],
    related: ["bank", "shopify", "magento-2", "noon-settlement"],
  },
  {
    slug: "bnpl",
    name: "BNPL (Tabby, Tamara)",
    title: "BNPL reconciliation: Tabby and Tamara settlements",
    description: "Reconcile Tabby and Tamara settlement reports against your orders: shipped orders with no capture, refund differences, and payouts to your bank.",
    h1: "BNPL reconciliation for Tabby and Tamara",
    lede: "Check that every order paid with buy-now-pay-later was captured by the provider, that refunds match on both sides, and that each payout batch reached your bank.",
    dataIn: {
      heading: "Upload the BNPL settlement report",
      paragraphs: [
        "Download the settlement or payout report from Tabby or Tamara, and your orders from Shopify, Magento, WooCommerce or your ERP. Shopify and Magento 2 orders can come from their connectors.",
        UPLOAD_ANY,
      ],
    },
    templates: ["web-bnpl", "bank-payouts"],
    faqs: [
      { q: "Does Sawwi connect to Tabby or Tamara?", a: "Not directly. Download the settlement report from the provider's merchant dashboard and upload it." },
      { q: "What does the BNPL reconciliation check?", a: "Orders you shipped that have no BNPL capture (so you won't be paid for them), and refunds that differ between your store and the provider. The provider's fee against your contracted rate is listed for review, not calculated yet." },
    ],
    related: ["payment-gateway", "bank", "shopify", "magento-2"],
  },
];

export const solutionBySlug = (slug: string) => SOLUTIONS.find((s) => s.slug === slug);
