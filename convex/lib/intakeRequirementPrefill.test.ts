import { expect,test } from "vitest";
import { mergeRequirementCoverageSuggestions } from "../../lib/intake-requirement-prefill";
import { newCoverage } from "../../lib/insurance-intake-details";
// Domain invariants identified before implementation: unknown suppressing real
// lines, late results replacing user limits, and explicit deselections reappearing.
test("requirements add missing coverage even when another coverage is already selected",()=>{
 const current=[newCoverage("general_liability")];const suggestions=[newCoverage("commercial_auto"),newCoverage("workers_compensation")];
 expect(mergeRequirementCoverageSuggestions(current,suggestions).map(row=>row.coverage)).toEqual(["general_liability","commercial_auto","workers_compensation"]);
 expect(current).toHaveLength(1);
});
test("real requirements replace only the unknown placeholder and do not erase it for an empty result",()=>{
 const current=[newCoverage("unknown")];expect(mergeRequirementCoverageSuggestions(current,[newCoverage("general_liability")]).map(row=>row.coverage)).toEqual(["general_liability"]);
 expect(mergeRequirementCoverageSuggestions(current,[])).toEqual(current);
});
test("manual limits, notes, scope and explicit coverage deselections survive late extraction",()=>{
 const line={...newCoverage("general_liability"),limits:{each_occurrence:"2000000"},additionalCoverages:"User note"};
 const suggested={...newCoverage("general_liability"),limits:{each_occurrence:"1000000",aggregate:"2000000"},additionalCoverages:"Document note"};
 const result=mergeRequirementCoverageSuggestions([line],[suggested,newCoverage("commercial_auto")],["commercial_auto"]);
 expect(result).toHaveLength(1);expect(result[0].limits).toEqual({each_occurrence:"2000000",aggregate:"2000000"});expect(result[0].additionalCoverages).toBe("User note");expect(line.limits).toEqual({each_occurrence:"2000000"});
});
