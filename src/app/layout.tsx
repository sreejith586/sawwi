import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { InlineScript } from "@/components/inline-script";
import { CHAT_PANEL_SCRIPT } from "@/lib/chat-panel";
import { SIDEBAR_SCRIPT } from "@/lib/sidebar";
import { appUrl } from "@/lib/site";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL(appUrl()),
  title: { default: "Sawwi", template: "%s · Sawwi" },
  description: "Reconciliation for e-commerce and marketplace sellers.",
};

// Page chrome lives in the route layouts: (app)/layout.tsx (sidebar) and onboarding/layout.tsx.
export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // The inline scripts set data-sidebar / data-chat before React hydrates (the theme script is in the app layout, D-51), hence suppressHydrationWarning.
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`} suppressHydrationWarning>
      <head>
        <InlineScript html={SIDEBAR_SCRIPT} />
        <InlineScript html={CHAT_PANEL_SCRIPT} />
      </head>
      <body className="min-h-full font-sans">{children}</body>
    </html>
  );
}
