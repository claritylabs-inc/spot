import type { IntakeFollowupQuestion } from "./intake-followups";
export const workforcePolicySources = new Set([
  "wc.safety.return_to_work", "wc.safety.return_to_work_detail", "wc.safety.return_to_work_coordinator",
  "wc.safety.has_hazardous_work", "wc.safety.hazardous_work_details",
]);
export function workforcePolicyQuestion(question:IntakeFollowupQuestion) {return workforcePolicySources.has(question.source?.split(" · ").at(-1)??"");}
