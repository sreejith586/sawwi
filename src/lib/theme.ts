// Shared by the server layout (inline script) and the client theme switch.
// Not in a "use client" file: a server import from one would get a client reference, not the string.

export const THEME_STORAGE_KEY = "sawwi-theme";

export type ThemePreference = "light" | "system" | "dark";

/**
 * Runs in <head> before first paint (see layout.tsx). Sets two attributes on <html>:
 * - data-theme-pref: what the user picked (light / dark / system; nothing saved = system)
 * - data-theme: what is actually shown (light / dark), which the CSS keys on.
 * While the pick is "system" it follows OS changes live, and a pick made in another tab
 * is applied here too. Kept tiny and dependency-free because it's inlined into every page.
 */
export const THEME_SCRIPT = `(function(){try{var k="${THEME_STORAGE_KEY}",d=document.documentElement,m=matchMedia("(prefers-color-scheme: dark)");function r(){d.dataset.theme=d.dataset.themePref==="system"?(m.matches?"dark":"light"):d.dataset.themePref}function a(){var s=null;try{s=localStorage.getItem(k)}catch(e){}d.dataset.themePref=s==="light"||s==="dark"?s:"system";r()}a();m.addEventListener("change",function(){if(d.dataset.themePref==="system")r()});addEventListener("storage",function(e){if(e.key===k)a()})}catch(e){}})()`;

/** Client side: save the pick (system = forget it) and apply it right away. */
export function setThemePreference(pref: ThemePreference) {
  try {
    if (pref === "system") localStorage.removeItem(THEME_STORAGE_KEY);
    else localStorage.setItem(THEME_STORAGE_KEY, pref);
  } catch {
    // Private mode or blocked storage: the switch still works for this page view.
  }
  const root = document.documentElement;
  root.dataset.themePref = pref;
  root.dataset.theme = pref === "system" ? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light") : pref;
}
