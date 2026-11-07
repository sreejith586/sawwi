// The live demo is on unless SAWWI_DEMO=off (D-32), so an operator can switch it off without a deploy of code.
export const demoEnabled = (): boolean => (process.env.SAWWI_DEMO ?? "").trim().toLowerCase() !== "off";
