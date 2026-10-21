import type { CoverageId,CoverageRequest } from "./insurance-intake-details";
/** Merge grounded requirements once per source without replacing applicant choices. */
export function mergeRequirementCoverageSuggestions(current:CoverageRequest[],suggestions:CoverageRequest[],declined:readonly CoverageId[]=[]):CoverageRequest[]{
 const usable=suggestions.filter(row=>row.coverage!=="unknown" && !declined.includes(row.coverage));
 const coverages=current.filter(row=>row.coverage!=="unknown" || !usable.length).map(row=>({...row,limits:{...row.limits}}));
 for(const suggestion of usable){
  const existing=coverages.find(row=>row.coverage===suggestion.coverage);
  if(existing){for(const[key,value]of Object.entries(suggestion.limits))if(!existing.limits[key]?.trim())existing.limits[key]=value;
   if(!existing.additionalCoverages?.trim() && suggestion.additionalCoverages?.trim())existing.additionalCoverages=suggestion.additionalCoverages;
  }else coverages.push({...suggestion,limits:{...suggestion.limits}});
 }
 return coverages;
}
