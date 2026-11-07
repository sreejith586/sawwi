// Shared by the app layout (inline script) and the client theme code.
// Not in a "use client" file: a server import from one would get a client reference, not the string.
//
// Theme rules (D-51):
// - Light is the default. Nothing saved means light, not "follow the system".
// - The theme switch lives in the app only (Settings and the account menu). Pages without the
//   sidebar (landing, public pages, log in, checkout, onboarding) are always light.
// - So the theme only applies inside the app: the app layout marks <html data-theme-scope="app">,
//   and nothing sets data-theme outside it. CSS keys on data-theme, so no attribute = light.

export const THEME_STORAGE_KEY = "sawwi-theme";

export type ThemePreference = "light" | "system" | "dark";

/**
 * Runs inline at the top of the app layout, before the app paints. Marks the app scope, then sets:
 * - data-theme-pref: what the user picked (light / dark / system; nothing saved = light)
 * - data-theme: what is actually shown (light / dark), which the CSS keys on.
 * While the pick is "system" it follows OS changes live, and a pick made in another tab is applied
 * here too; both listeners are added once per page load and do nothing outside the app scope.
 * Kept tiny and dependency-free because it's inlined. applyAppTheme() below is the same logic.
 */
export const THEME_SCRIPT = `(function(){try{var k="${THEME_STORAGE_KEY}",d=document.documentElement,m=matchMedia("(prefers-color-scheme: dark)");function r(){if(d.dataset.themeScope!=="app")return;d.dataset.theme=d.dataset.themePref==="system"?(m.matches?"dark":"light"):d.dataset.themePref}function a(){var s=null;try{s=localStorage.getItem(k)}catch(e){}d.dataset.themePref=s==="dark"||s==="system"?s:"light";r()}d.dataset.themeScope="app";if(!window.__sawwiTheme){window.__sawwiTheme=1;m.addEventListener("change",function(){if(d.dataset.themePref==="system")r()});addEventListener("storage",function(e){if(e.key===k)a()})}a()}catch(e){}})()`;

function readPreference(): ThemePreference {
  let saved: string | null = null;
  try {
    saved = localStorage.getItem(THEME_STORAGE_KEY);
  } catch {
    // Blocked storage: fall back to the default.
  }
  return saved === "dark" || saved === "system" ? saved : "light";
}

function shown(pref: ThemePreference): "light" | "dark" {
  return pref === "system" ? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light") : pref;
}

/** Client side, on entering the app (e.g. a client navigation from a public page): apply the saved pick. */
export function applyAppTheme() {
  const root = document.documentElement;
  const pref = readPreference();
  root.dataset.themeScope = "app";
  root.dataset.themePref = pref;
  root.dataset.theme = shown(pref);
}

/** Client side, on leaving the app: back to light, the look of every page without the sidebar. */
export function clearAppTheme() {
  const root = document.documentElement;
  delete root.dataset.themeScope;
  delete root.dataset.theme;
}

/** Client side: save the pick (light = the default, so forget it) and apply it right away. */
export function setThemePreference(pref: ThemePreference) {
  try {
    if (pref === "light") localStorage.removeItem(THEME_STORAGE_KEY);
    else localStorage.setItem(THEME_STORAGE_KEY, pref);
  } catch {
    // Private mode or blocked storage: the switch still works for this page view.
  }
  const root = document.documentElement;
  root.dataset.themePref = pref;
  if (root.dataset.themeScope === "app") root.dataset.theme = shown(pref);
}
