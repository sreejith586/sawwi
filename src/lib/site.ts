// Public address of the app. APP_URL overrides it (e.g. a staging host); used for metadata
// (link previews) and for URLs Stripe sends customers back to.
export const DEFAULT_APP_URL = "https://sawwi.hypermaxsolutions.com";

export const appUrl = () => (process.env.APP_URL || DEFAULT_APP_URL).replace(/\/$/, "");
