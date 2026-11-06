// Sidebar collapse state. Same pattern as the theme (lib/theme.ts): an inline <head> script
// sets <html data-sidebar> before first paint, and CSS (the `collapsed:` variant in
// globals.css) does the rest, so the panel never jumps on load.

export const SIDEBAR_STORAGE_KEY = "sawwi-sidebar";

export const SIDEBAR_SCRIPT = `(function(){try{if(localStorage.getItem("${SIDEBAR_STORAGE_KEY}")==="collapsed")document.documentElement.dataset.sidebar="collapsed"}catch(e){}})()`;

export function toggleSidebar() {
  const root = document.documentElement;
  const collapsed = root.dataset.sidebar !== "collapsed";
  if (collapsed) root.dataset.sidebar = "collapsed";
  else delete root.dataset.sidebar;
  try {
    if (collapsed) localStorage.setItem(SIDEBAR_STORAGE_KEY, "collapsed");
    else localStorage.removeItem(SIDEBAR_STORAGE_KEY);
  } catch {
    // Blocked storage: the toggle still works until the next reload.
  }
}
