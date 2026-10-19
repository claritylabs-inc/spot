import { describe, expect, it } from "vitest";
import { buildIntakeSlackContext, splitIntakeSlackMessage } from "./intakeSlackContext";
import { detailsFromAnswers } from "../../lib/insurance-intake-details";
import { formatSlackAnswerText } from "./slackBlocks";

describe("intake Slack applicant facts and state", () => {
  it("includes actual contact and answer values, with every coverage's limits", () => {
    const details = detailsFromAnswers({});
    details.coverages = [
      {coverage:"general_liability",limits:{each_occurrence:"I'm not sure",aggregate:"I'm not sure"}},
      {coverage:"property",limits:{building:"",contents:"",business_income:""}},
    ];
    details.coverageIndex = 1;
    const context = buildIntakeSlackContext({intakeStep:7,intakeDetails:details,intakeAnswers:{name:"Applicant",phone:"+16479217007",email:"applicant@example.com",trigger:"Shopping for renewal",effectiveDate:"2026-10-23",requestDetails:"Renewal notes"}});
    const rendered = formatSlackAnswerText(context);
    for (const text of ["Applicant","+16479217007","applicant@example.com","Shopping for renewal","2026-10-23","Renewal notes","Each occurrence limit: I'm not sure","Building limit: Not provided","Commercial Property (2 of 2)","Draft — not submitted"])
      expect(rendered).toContain(text);
  });
  it("uses authoritative structured values and safely renders literal applicant text", () => {
    const details = detailsFromAnswers({});
    details.coverages = [{coverage:"cyber",limits:{each_incident:"1000000",aggregate:"2000000"}}];
    const rendered = formatSlackAnswerText(buildIntakeSlackContext({intakeDetails:details,intakeAnswers:{limits:"stale limits",coverage:"stale coverage",requestDetails:"<@U123> *literal* [label](https://example.com)",fein:"submitted-tax-value"}}));
    expect(rendered).toContain("1000000");
    expect(rendered).toContain("submitted-tax-value");
    expect(rendered).not.toContain("stale limits");
    expect(rendered).not.toContain("stale coverage");
    expect(rendered).not.toContain("<@U123>");
    expect(rendered).not.toContain("<https://example.com|label>");
    expect(rendered).toContain("*literal*");
  });
  it("includes notes, skipped questions and explicit status without backend capabilities", () => {
    const record = {intakeStep:5,intakeRevision:4,intakeSkippedSteps:[5],intakeAnswers:{requestDetails:"Saved notes"},inboxToken:"private-inbox",verificationClaimHash:"private-hash"};
    const context = buildIntakeSlackContext(record);
    expect(context).toContain("Saved notes");
    expect(context).toContain("Skipped questions:");
    expect(context).toContain("Revision: 4");
    expect(context).not.toContain("private-");
    expect(buildIntakeSlackContext({intakeSubmittedAt:1})).toContain("Submitted");
  });
  it("preserves every character across Slack-sized chunks", () => {
    const value = "x".repeat(45000) + "\nend";
    const chunks = splitIntakeSlackMessage(value);
    expect(chunks.join("")).toBe(value);
    expect(chunks.every(chunk=>chunk.length<=12000)).toBe(true);
  });
});
