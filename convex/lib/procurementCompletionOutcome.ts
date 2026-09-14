import dayjs from "dayjs";
import customParseFormat from "dayjs/plugin/customParseFormat";
import { v, type Infer } from "convex/values";
import { z } from "zod";

dayjs.extend(customParseFormat);

export const completionOutcomeValidator = v.object({
  kind: v.literal("placed_elsewhere"),
  provider: v.optional(v.string()),
  purchaseDate: v.optional(v.string()),
});
export type CompletionOutcome = Infer<typeof completionOutcomeValidator>;
export const completionOutcomeSchema = z.object({
  kind: z.literal("placed_elsewhere"),
  provider: z.string().trim().min(1).max(200).optional(),
  purchaseDate: z
    .string()
    .refine(
      (value) =>
        /^\d{4}-\d{2}-\d{2}$/.test(value) &&
        dayjs(value, "YYYY-MM-DD", true).isValid(),
      "Purchase date must be a valid YYYY-MM-DD date",
    )
    .optional(),
});

export function normalizeCompletionOutcome(value: unknown): CompletionOutcome {
  return completionOutcomeSchema.parse(value);
}
