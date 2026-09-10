import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();
const internalApi = internal as any;

crons.cron(
  "monitor vendor compliance",
  "0 14 * * *",
  internal.actions.vendorComplianceMonitor.run,
  {},
);

crons.cron(
  "monitor own insurance compliance",
  "15 14 * * *",
  internal.actions.ownComplianceMonitor.run,
  {},
);

crons.interval(
  "sweep stale policy extractions",
  { minutes: 5 },
  internal.actions.policyExtraction.sweepStale,
  {},
);

crons.interval(
  "reconcile Slack installation and channel health",
  { minutes: 15 },
  internalApi.actions.slackReconciliation.runDue,
  {},
);

crons.interval(
  "retry response rating signals",
  { minutes: 10 },
  internalApi.actions.agentResponseFeedback.retryPending,
  {},
);

crons.cron(
  "sweep extraction traces",
  "30 3 * * *",
  internal.extractionTraces.sweepExpired,
  {},
);

crons.cron(
  "sweep model routing events",
  "45 3 * * *",
  internal.modelRoutingEvents.sweepExpired,
  {},
);

crons.cron(
  "sweep requirement extraction runs",
  "50 3 * * *",
  internalApi.requirementExtractionRuns.sweepExpired,
  {},
);

crons.cron(
  "sweep procurement packet links",
  "15 4 * * *",
  internalApi.procurementPacket.sweepExpired,
  {},
);

export default crons;
