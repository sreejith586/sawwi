// Automation use cases for GCC e-commerce sellers (D-60): the one that's live, and the backlog
// ranked by value = documents a month × minutes saved per document × cost of a mistake.
// Ranking changes go through review, like any decision.

export type UseCase = {
  id: string;
  title: string;
  /** Document in → entry out. */
  flow: string;
  summary: string;
  /** Why it ranks where it does. */
  value: string;
  status: "live" | "coming_soon";
  href?: string;
};

export const USE_CASES: UseCase[] = [
  {
    id: "purchase-invoices",
    title: "Purchase invoices",
    flow: "Supplier invoice PDF → draft purchase invoice",
    summary: "Upload supplier invoices, including scans. Sawwi reads each one into a draft you review and approve, then download it as CSV or push it to Business Central unposted.",
    value: "Every seller buys stock. Typing invoices line by line is slow, and a wrong VAT amount or a double-entered invoice is costly.",
    status: "live",
    href: "/automation/purchase-invoices",
  },
  {
    id: "marketplace-settlements",
    title: "Marketplace settlements",
    flow: "Amazon, Noon, Namshi, Trendyol settlement → journal entry",
    summary: "Upload settlement reports and get one balanced journal per settlement: sales, refunds, fees, VAT on fees and ads on their accounts, the payout on your clearing account. Review, approve, then CSV or unposted lines in a Business Central journal.",
    value: "Every marketplace seller has them every fortnight, with dozens of fee lines each. Sawwi already reads them for reconciliation.",
    status: "live",
    href: "/automation/settlements",
  },
  {
    id: "cod-remittances",
    title: "Cash on delivery remittances",
    flow: "Courier remittance (Aramex, SMSA, J&T, Quiqup…) → cash receipts",
    summary: "Apply each COD remittance to the orders it pays, with the courier's charges booked, and flag orders delivered but never remitted.",
    value: "COD is still a large share of GCC orders, and applying remittances order by order is the slowest job in the month.",
    status: "coming_soon",
  },
  {
    id: "gateway-payouts",
    title: "Payment gateway and BNPL payouts",
    flow: "Tabby, Tamara, Checkout.com, PayTabs, Tap, Stripe payout → cash receipt + fees",
    summary: "Book each payout as cash received, with the provider's fees and the VAT on them, and the orders it settles.",
    value: "Several payouts a week from several providers, each net of fees that need their own entry.",
    status: "coming_soon",
  },
  {
    id: "supplier-credit-notes",
    title: "Supplier credit notes",
    flow: "Supplier credit note PDF → draft purchase credit memo",
    summary: "The same reading and review as purchase invoices, for returns and price adjustments, applied to the invoice they credit.",
    value: "Fewer than invoices, but almost free to add: the reader already tells credit notes apart.",
    status: "coming_soon",
  },
  {
    id: "ad-saas-bills",
    title: "Ad and software bills",
    flow: "Meta, Google, TikTok, Shopify… bills → purchase invoices with reverse-charge VAT",
    summary: "Monthly bills from foreign suppliers, coded to the right expense with reverse-charge VAT, ready to post.",
    value: "Monthly, and the reverse-charge VAT treatment is easy to get wrong.",
    status: "coming_soon",
  },
  {
    id: "payment-proposals",
    title: "Supplier payment proposals",
    flow: "Supplier statement → payment journal lines",
    summary: "From each supplier's statement, propose paying what's due, matched in the ERP and not disputed. You approve; Sawwi writes the payment journal.",
    value: "Builds on the supplier statement reconciliation; saves the weekly payment run's checking.",
    status: "coming_soon",
  },
  {
    id: "landed-cost",
    title: "Import and customs bills",
    flow: "Customs declaration, freight and clearing bills → landed cost",
    summary: "Spread duty, freight and clearing charges over the goods received, as item charges, so stock carries its real cost.",
    value: "High value per document for importers, but fewer documents and a harder allocation.",
    status: "coming_soon",
  },
  {
    id: "vendor-setup",
    title: "New suppliers from TRN certificates",
    flow: "TRN or VAT certificate → vendor card",
    summary: "Read a supplier's FTA or ZATCA certificate and set up the vendor with its legal name, TRN and address.",
    value: "Rare, but it closes the “vendor not found” gap in purchase invoice capture.",
    status: "coming_soon",
  },
];
