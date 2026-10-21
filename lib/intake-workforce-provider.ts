export type WorkforceProvider = {version:"workforce-provider-v1";name:string;website:string;legacy?:string};
export function parseWorkforceProvider(value:string): WorkforceProvider | undefined {
  try { const row=JSON.parse(value);
    if(row?.version!=="workforce-provider-v1" || typeof row.name!=="string" || row.name.length>200 || typeof row.website!=="string" || row.website.length>500 || (row.legacy!==undefined && (typeof row.legacy!=="string" || row.legacy.length>1000))) return;
    return {version:"workforce-provider-v1",name:row.name,website:row.website,...(row.legacy?{legacy:row.legacy}:{})};
  } catch { return; }
}
export function isWorkforceProviderSource(source?:string) {return source?.endsWith(" · wc.safety.leasing_details") || source?.endsWith(" · wc.safety.staffing_controls");}
export function workforceProviderComplete(value:string) {
  const row=parseWorkforceProvider(value);
  if(!row?.website.trim()) return true;
  try {const url=new URL(/^https?:\/\//i.test(row.website)?row.website:`https://${row.website}`);return ["https:","http:"].includes(url.protocol) && url.hostname.includes(".") && !url.username && !url.password;}catch{return false;}
}
export function formatWorkforceProvider(value:string) {
  const row=parseWorkforceProvider(value);if(!row)return value;
  return [row.name&&`Provider: ${row.name}`,row.website&&`Website: ${row.website}`,row.legacy&&`Previous answer: ${row.legacy}`].filter(Boolean).join("\n");
}
