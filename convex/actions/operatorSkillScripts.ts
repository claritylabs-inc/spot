"use node";

import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { assertSkillScriptsRunnable } from "../lib/operatorSkillScriptRunner";

/** Refuses `run_skill_script` before its approval card when cl-router cannot run scripts. */
export const assertRunnableInternal = internalAction({
  args: {},
  returns: v.null(),
  handler: async () => {
    await assertSkillScriptsRunnable();
    return null;
  },
});
