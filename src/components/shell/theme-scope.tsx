"use client";

import { useLayoutEffect } from "react";
import { InlineScript } from "@/components/inline-script";
import { applyAppTheme, clearAppTheme, THEME_SCRIPT } from "@/lib/theme";

// The user's theme applies inside the app only (D-51). On a full page load the inline script sets
// it before first paint; on a client navigation into the app the layout effect does, also before
// paint. Leaving the app (to the landing page, log in, onboarding…) puts the page back to light.
export function ThemeScope() {
  useLayoutEffect(() => {
    applyAppTheme();
    return clearAppTheme;
  }, []);
  return <InlineScript html={THEME_SCRIPT} />;
}
