// The @tesseract.js-data packages ship no types: each exports where its language files are.
declare module "@tesseract.js-data/eng" {
  const data: { code: string; gzip: boolean; langPath: string };
  export default data;
  export const langPath: string;
}
declare module "@tesseract.js-data/ara" {
  const data: { code: string; gzip: boolean; langPath: string };
  export default data;
  export const langPath: string;
}
