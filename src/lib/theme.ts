// Shared by the server layout (inline script) and the client toggle.
// Not in a "use client" file: a server import from one would get a client reference, not the string.

export const THEME_STORAGE_KEY = "sawwi-theme";

/**
 * Runs in <head> before first paint (see layout.tsx). Applies the saved theme, or the
 * system setting when nothing is saved, and keeps following the system until the user
 * picks one. Kept tiny and dependency-free because it's inlined into every page.
 */
export const THEME_SCRIPT = `(function(){try{var k="${THEME_STORAGE_KEY}",d=document.documentElement,m=matchMedia("(prefers-color-scheme: dark)");function a(){var s=localStorage.getItem(k);d.dataset.theme=s==="light"||s==="dark"?s:m.matches?"dark":"light"}a();m.addEventListener("change",a)}catch(e){}})()`;
