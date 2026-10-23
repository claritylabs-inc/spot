import {
  informationApplicability,
  informationFormTitle,
  neededInformationQuestions,
  orderInformationQuestions,
} from "../lib/procurement-information";
import dayjs from "dayjs";
import { intakeCurrency } from "../lib/intake-money";
import { v } from "convex/values";
import { query, mutation } from "./_generated/server";
import { attachClientRequestFile } from "./clientProcurementRequests";
import { recordImpersonatedWrite } from "./lib/operatorIdentity";
import { informationResponseValidator } from "./lib/procurementInformationSchema";
import {
  validateFollowupAnswers,
  formatIntakeFollowupAnswer,
  followupQuestionVisible,
} from "../lib/intake-followups";
import {
  MAX,
  text,
  bounded,
  operatorWrite,
  clientAccess,
  audit,
  requireInformationQuestion,
  requestFacts,
  sourceMessage,
  filesForClient,
  businessNameForRequest,
} from "./lib/procurementInformationAccess";

export const publishForm = mutation({
  args: {
    requestId: v.id("procurementRequests"),
    title: v.optional(v.string()),
    questionIds: v.optional(v.array(v.id("procurementInformationQuestions"))),
  },
  handler: async (ctx, args) => {
    const { operator, request } = await operatorWrite(ctx, args.requestId);
    const forms = await bounded(
      ctx.db
        .query("procurementInformationForms")
        .withIndex("by_requestId", (q) => q.eq("requestId", request._id))
        .take(MAX + 1),
    );
    if (forms.length >= MAX) throw new Error("Maximum 200 forms per request");
    const facts = await requestFacts(ctx, request._id);
    const requirements = await bounded(
      ctx.db
        .query("procurementInformationRequirements")
        .withIndex("by_requestId", (q) => q.eq("requestId", request._id))
        .take(MAX + 1),
    );
    const available = neededInformationQuestions(facts, requirements);
    const ids =
      args.questionIds ??
      available
        .filter(
          (q) =>
            !forms.some(
              (form) =>
                form.status === "open" &&
                form.questions.some((item) => item.questionId === q._id),
            ),
        )
        .map((q) => q._id);
    if (!ids.length || ids.length > 40 || new Set(ids).size !== ids.length)
      throw new Error("Choose 1 to 40 unanswered questions");
    const selected = new Set<string>();
    const collect = (id: string) => {
      if (selected.has(id)) return;
      const q = available.find((q) => q._id === id);
      if (!q)
        throw new Error(
          "A selected question is answered, unavailable or belongs to another request. Refresh the batch.",
        );
      selected.add(id);
      for (const condition of q.question.conditions ?? []) {
        const parent = facts.find((q) => q._id === condition.questionId);
        if (!parent?.answer || parent.answer.unsure)
          collect(condition.questionId);
      }
    };
    ids.forEach(collect);
    const needed = available.filter((q) => selected.has(q._id));
    if (!needed.length)
      throw new Error("Choose unanswered questions for this batch.");
    if (needed.length > 40)
      throw new Error(
        "This batch has more than 40 questions including prerequisites. Choose a smaller batch.",
      );
    const neededIds = new Set(needed.map((q) => String(q._id)));
    const ancestorIds = new Set<string>();
    const visitAncestors = (id: string) => {
      if (ancestorIds.has(id)) return;
      ancestorIds.add(id);
      for (const condition of facts.find((q) => q._id === id)?.question
        .conditions ?? [])
        visitAncestors(condition.questionId);
    };
    for (const q of needed)
      for (const condition of q.question.conditions ?? [])
        visitAncestors(condition.questionId);
    const prerequisites = facts
      .filter(
        (q) => !neededIds.has(q._id) && q.answerId && ancestorIds.has(q._id),
      )
      .map((q) => ({ questionId: q._id, answerId: q.answerId! }));
    const questions = needed.map((q) => ({
      questionId: q._id,
      answerIdAtPublish: q.answerId,
      question: {
        ...q.question,
        id: String(q._id),
        conditions: q.question.conditions?.filter((c) =>
          neededIds.has(c.questionId),
        ),
      },
      scope: q.scope,
    }));
    const matching = forms.find(
      (form) =>
        form.status === "open" &&
        form.questions.length === questions.length &&
        form.questions.every((item) =>
          questions.some(
            (q) =>
              q.questionId === item.questionId &&
              q.answerIdAtPublish === item.answerIdAtPublish,
          ),
        ) &&
        (form.prerequisites ?? []).every((parent) =>
          facts.some(
            (q) =>
              q._id === parent.questionId && q.answerId === parent.answerId,
          ),
        ),
    );
    if (matching) return matching._id;
    if (
      forms.some(
        (form) =>
          form.status === "open" &&
          form.questions.some((q) => neededIds.has(q.questionId)),
      )
    )
      throw new Error(
        "A selected question or its prerequisite is already in an open form. Finish or cancel that batch first.",
      );
    const createdAt = dayjs().valueOf();
    const id = await ctx.db.insert("procurementInformationForms", {
      requestId: request._id,
      title: informationFormTitle({ _id: "new", createdAt }, forms),
      questions: orderInformationQuestions(questions),
      prerequisites,
      responses: [],
      revision: 0,
      status: "open",
      createdByUserId: operator.user._id,
      createdAt,
    });
    await audit(
      ctx,
      operator.user._id,
      request,
      "Published supplementary information form",
    );
    return id;
  },
});
export const cancelForm = mutation({
  args: { formId: v.id("procurementInformationForms") },
  handler: async (ctx, { formId }) => {
    const form = await ctx.db.get(formId);
    if (!form) throw new Error("Form not found");
    const { operator, request } = await operatorWrite(ctx, form.requestId);
    if (form.status !== "open")
      throw new Error("Only open forms can be cancelled");
    await ctx.db.patch(formId, {
      status: "cancelled",
      revision: form.revision + 1,
    });
    await audit(
      ctx,
      operator.user._id,
      request,
      "Cancelled supplementary information form",
    );
  },
});
export const clientForms = query({
  args: { requestId: v.id("procurementRequests") },
  handler: async (ctx, { requestId }) => {
    await clientAccess(ctx, requestId);
    const forms = await bounded(
      ctx.db
        .query("procurementInformationForms")
        .withIndex("by_requestId", (q) => q.eq("requestId", requestId))
        .take(MAX + 1),
    );
    return forms
      .filter((f) => f.status !== "cancelled")
      .map((f) => ({
        id: f._id,
        title: informationFormTitle(f, forms),
        status: f.status,
      }));
  },
});
export const clientForm = query({
  args: { formId: v.id("procurementInformationForms") },
  handler: async (ctx, { formId }) => {
    const form = await ctx.db.get(formId);
    if (!form) throw new Error("Form not found");
    const { request } = await clientAccess(ctx, form.requestId);
    const forms = await bounded(
      ctx.db
        .query("procurementInformationForms")
        .withIndex("by_requestId", (q) => q.eq("requestId", form.requestId))
        .take(MAX + 1),
    );
    // Allowlist: provider identities, source email and operator notes never reach clients.
    return {
      id: form._id,
      requestId: form.requestId,
      title: informationFormTitle(form, forms),
      status: form.status,
      revision: form.revision,
      questions: form.questions,
      responses: form.responses,
      editDraft: form.editDraft,
      currency: intakeCurrency(
        request.intakeSubmittedApplication?.details.registrationCountry ??
          request.intakeDetails?.registrationCountry,
      ),
      businessName: await businessNameForRequest(ctx, request),
      files: await filesForClient(ctx, form.requestId),
    };
  },
});

/** Stage revisions separately from the accepted submission and canonical answers. */
export const editForm = mutation({
  args: {
    formId: v.id("procurementInformationForms"),
    revision: v.number(),
    discard: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const form = await ctx.db.get(args.formId);
    if (!form) throw new Error("Form not found");
    const { impersonated } = await clientAccess(ctx, form.requestId, true);
    if (form.status !== "submitted" || form.revision !== args.revision)
      throw new Error("This form changed. Reload before editing.");
    if (args.discard) {
      await ctx.db.patch(form._id, {
        editDraft: undefined,
        revision: form.revision + 1,
      });
    } else if (!form.editDraft) {
      const facts = await Promise.all(
        form.questions.map((q) =>
          requireInformationQuestion(ctx, q.questionId, form.requestId),
        ),
      );
      const responses = await Promise.all(
        facts.map(async (fact) => {
          const answer = fact.answerId ? await ctx.db.get(fact.answerId) : null;
          return answer
            ? {
                questionId: fact._id,
                answer: answer.answer,
                unsure: answer.unsure,
                fileItemIds: answer.fileItemIds,
              }
            : (form.responses.find((r) => r.questionId === fact._id) ?? {
                questionId: fact._id,
                answer: "",
                unsure: false,
                fileItemIds: [],
              });
        }),
      );
      await ctx.db.patch(form._id, {
        editDraft: {
          responses,
          answerVersions: facts.map((fact) => ({
            questionId: fact._id,
            answerId: fact.answerId,
          })),
        },
        revision: form.revision + 1,
      });
    }
    if (impersonated) await recordImpersonatedWrite(ctx);
  },
});
export const saveForm = mutation({
  args: {
    formId: v.id("procurementInformationForms"),
    revision: v.number(),
    responses: v.array(informationResponseValidator),
    submit: v.boolean(),
    confirmed: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const form = await ctx.db.get(args.formId);
    if (!form) throw new Error("Form not found");
    const { user, request, impersonated } = await clientAccess(
      ctx,
      form.requestId,
      true,
    );
    if (
      (form.status !== "open" &&
        !(form.status === "submitted" && form.editDraft)) ||
      form.revision !== args.revision
    )
      throw new Error(
        "This form changed. Reload before continuing; your edits remain visible",
      );
    if (
      args.responses.length > 40 ||
      new Set(args.responses.map((r) => r.questionId)).size !==
        args.responses.length
    )
      throw new Error("Invalid answers");
    const allowedFiles = new Set(
      (await filesForClient(ctx, request._id)).map((f) => f.id),
    );
    for (const response of args.responses) {
      const item = form.questions.find(
        (q) => q.questionId === response.questionId,
      );
      if (
        !item ||
        response.fileItemIds.length > 10 ||
        new Set(response.fileItemIds).size !== response.fileItemIds.length ||
        response.fileItemIds.some((id) => !allowedFiles.has(id))
      )
        throw new Error("Invalid question or supporting file");
      if (response.unsure && response.answer.trim())
        throw new Error("Choose unsure or provide an answer");
      validateFollowupAnswers([
        {
          ...item.question,
          answer: response.unsure ? "I'm not sure" : response.answer,
        },
      ]);
      if (
        item.question.kind === "date" &&
        response.answer &&
        (!/^\d{4}-\d{2}-\d{2}$/.test(response.answer) ||
          !dayjs(response.answer).isValid() ||
          dayjs(response.answer).format("YYYY-MM-DD") !== response.answer)
      )
        throw new Error("Enter a valid calendar date");
    }
    const history = form.questions.map((q) => ({
      ...q.question,
      answer:
        args.responses.find((r) => r.questionId === q.questionId)?.answer ?? "",
    }));
    const visible = form.questions.filter((q) =>
      followupQuestionVisible(q.question, history),
    );
    const responses = args.responses.filter((r) =>
      visible.some((q) => q.questionId === r.questionId),
    );
    if (args.submit) {
      for (const prerequisite of form.prerequisites ?? []) {
        const current = await requireInformationQuestion(
          ctx,
          prerequisite.questionId,
          form.requestId,
        );
        if (current.answerId !== prerequisite.answerId)
          throw new Error(
            "A prerequisite answer changed. Ask Spot to issue an updated form; your edits remain visible.",
          );
      }
      if (!args.confirmed)
        throw new Error(
          "Confirm the accuracy of your answers before submitting",
        );
      if (
        visible.some((q) => {
          const r = responses.find((r) => r.questionId === q.questionId);
          return !r || (!r.answer.trim() && !r.unsure && !r.fileItemIds.length);
        })
      )
        throw new Error("Answer each question or choose I'm not sure");
      for (const response of responses) {
        const current = await requireInformationQuestion(
          ctx,
          response.questionId,
          form.requestId,
        );
        const published = form.questions.find(
          (q) => q.questionId === response.questionId,
        )!;
        const expectedAnswerId = form.editDraft
          ? form.editDraft.answerVersions.find(
              (item) => item.questionId === response.questionId,
            )?.answerId
          : published.answerIdAtPublish;
        if (current.answerId !== expectedAnswerId)
          throw new Error(
            form.editDraft
              ? "An answer changed while you were editing. Cancel these edits and reopen Edit answers to use the latest values."
              : "An answer changed after this form was published. Ask Spot to issue an updated form; your edits remain visible.",
          );
        const answerId = await ctx.db.insert("procurementInformationAnswers", {
          ...response,
          requestId: request._id,
          formId: form._id,
          suppliedByUserId: user._id,
          provenance: "Client supplementary form submission",
          createdAt: dayjs().valueOf(),
        });
        await ctx.db.patch(response.questionId, { answerId });
      }
    }
    await ctx.db.patch(form._id, {
      ...(form.editDraft && !args.submit
        ? { editDraft: { ...form.editDraft, responses } }
        : { responses, editDraft: undefined }),
      revision: form.revision + 1,
      ...(args.submit
        ? {
            status: "submitted" as const,
            submittedAt: dayjs().valueOf(),
            submittedByUserId: user._id,
          }
        : {}),
    });
    if (impersonated && request.clientOrgId) await recordImpersonatedWrite(ctx);
    return form.revision + 1;
  },
});
export const recordDelivery = mutation({
  args: {
    requirementId: v.id("procurementInformationRequirements"),
    answerId: v.id("procurementInformationAnswers"),
    messageId: v.id("teamEmailMessages"),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.requirementId);
    if (!row) throw new Error("Requirement not found");
    const { operator, request } = await operatorWrite(ctx, row.requestId);
    const answer = await ctx.db.get(args.answerId);
    const q = await requireInformationQuestion(
      ctx,
      row.questionId,
      row.requestId,
    );
    if (
      informationApplicability(q, await requestFacts(ctx, row.requestId)) !==
      "applies"
    )
      throw new Error("This question does not apply to the current answers");
    if (
      !answer ||
      answer.questionId !== row.questionId ||
      answer.requestId !== row.requestId ||
      answer._id !== q.answerId ||
      answer.unsure
    )
      throw new Error("Choose the current confirmed answer");
    const message = await sourceMessage(
      ctx,
      args.messageId,
      request._id,
      row.outreachId,
    );
    const outreach = await ctx.db.get(row.outreachId);
    const recipients = [...message.toAddresses, ...message.ccAddresses].map(
      (value) => value.toLowerCase(),
    );
    if (!outreach?.contactEmail)
      throw new Error(
        "Add the provider contact email before recording delivery",
      );
    if (!recipients.includes(outreach.contactEmail.toLowerCase()))
      throw new Error(
        "The provider contact must be a recipient of the sent message",
      );
    if (message.direction !== "outbound")
      throw new Error("Choose the sent provider response");
    const formattedAnswer = formatIntakeFollowupAnswer(
      { ...q.question, answer: answer.answer },
      q.scope.currency ??
        intakeCurrency(
          request.intakeSubmittedApplication?.details.registrationCountry ??
            request.intakeDetails?.registrationCountry,
        ),
    );
    // Match a complete response block, so "No" cannot match "Notes" and
    // "60000" cannot establish delivery of an answer that actually says "600000".
    const responseText = `\n${message.currentText.replace(/\r\n/g, "\n").trim()}\n`;
    const includesAnswer = (value: string) =>
      value.trim().length > 0 &&
      responseText.includes(`\n${value.replace(/\r\n/g, "\n").trim()}\n`);
    if (
      !message.currentText.includes(q.question.label) ||
      (!includesAnswer(answer.answer) && !includesAnswer(formattedAnswer)) ||
      (q.scope.period !== "current" &&
        !message.currentText
          .toLowerCase()
          .includes(q.scope.period.toLowerCase()))
    )
      throw new Error(
        "The sent message must include this question, reporting period and answer. Use Copy reply to include them together.",
      );
    for (const id of answer.fileItemIds) {
      const item = await ctx.db.get(id);
      if (
        !item ||
        item.requestId !== row.requestId ||
        !item.clientFileId ||
        !message.clientFileIds.includes(item.clientFileId)
      )
        throw new Error(
          "The sent email does not include every supporting file",
        );
    }
    const prior = await ctx.db
      .query("procurementInformationDeliveries")
      .withIndex("by_requestId", (q) => q.eq("requestId", row.requestId))
      .order("desc")
      .take(500);
    if (
      prior.some(
        (d) =>
          d.requirementId === row._id &&
          d.answerId === answer._id &&
          d.messageId === message._id,
      )
    )
      return;
    await ctx.db.insert("procurementInformationDeliveries", {
      ...args,
      requestId: row.requestId,
      recordedByUserId: operator.user._id,
      createdAt: dayjs().valueOf(),
    });
    await audit(
      ctx,
      operator.user._id,
      request,
      "Recorded provider delivery of supplementary answer",
    );
  },
});
export const uploadUrl = mutation({
  args: { formId: v.id("procurementInformationForms") },
  handler: async (ctx, { formId }) => {
    const form = await ctx.db.get(formId);
    if (
      !form ||
      (form.status !== "open" &&
        !(form.status === "submitted" && form.editDraft))
    )
      throw new Error("Editable form required");
    const { user, request } = await clientAccess(ctx, form.requestId, true);
    if (!request.clientOrgId)
      throw new Error("Company attachment required before uploading");
    const intentId = await ctx.db.insert("requestIntakeUploadIntents", {
      requestId: request._id,
      ownerUserId: user._id,
      createdAt: dayjs().valueOf(),
      expiresAt: dayjs().add(30, "minute").valueOf(),
    });
    return { url: await ctx.storage.generateUploadUrl(), intentId };
  },
});
export const attachFile = mutation({
  args: {
    formId: v.id("procurementInformationForms"),
    intentId: v.id("requestIntakeUploadIntents"),
    storageId: v.id("_storage"),
    fileName: v.string(),
  },
  handler: async (ctx, args) => {
    const form = await ctx.db.get(args.formId);
    if (
      !form ||
      (form.status !== "open" &&
        !(form.status === "submitted" && form.editDraft))
    )
      throw new Error("Editable form required");
    const { user, request, impersonated } = await clientAccess(
      ctx,
      form.requestId,
      true,
    );
    if (!request.clientOrgId) throw new Error("Company attachment required");
    const intent = await ctx.db.get(args.intentId);
    const metadata = await ctx.db.system.get(args.storageId);
    if (
      !intent ||
      intent.requestId !== request._id ||
      intent.ownerUserId !== user._id ||
      intent.expiresAt < dayjs().valueOf() ||
      intent.fileId
    )
      throw new Error("Upload authorization expired or already used");
    if (
      !metadata ||
      metadata._creationTime < intent.createdAt - 1000 ||
      metadata.size > 20 * 1024 * 1024 ||
      ![
        "application/pdf",
        "image/png",
        "image/jpeg",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ].includes(metadata.contentType ?? "")
    )
      throw new Error("Choose a PDF, PNG, JPEG or DOCX up to 20 MB");
    const existing = await filesForClient(ctx, request._id);
    if (
      existing.reduce((total, file) => total + file.size, 0) + metadata.size >
      100 * 1024 * 1024
    )
      throw new Error("Request supporting files exceed 100 MB");
    if (existing.length >= MAX) throw new Error("Request file limit reached");
    const result = await attachClientRequestFile(
      ctx,
      {
        storageId: args.storageId,
        fileName: text(args.fileName, 200),
        contentType: metadata.contentType!,
        size: metadata.size,
      },
      { ...request, clientOrgId: request.clientOrgId },
      user._id,
    );
    await ctx.db.patch(intent._id, { fileId: args.storageId });
    if (impersonated) await recordImpersonatedWrite(ctx);
    return result;
  },
});
