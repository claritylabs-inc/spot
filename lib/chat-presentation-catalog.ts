import { defineCatalog } from "@json-render/core";
import { schema } from "@json-render/react/schema";
import { presentationPropsSchemas as props } from "./chat-presentation";

export const chatPresentationCatalog = defineCatalog(schema, {
  components: {
    Stack: {
      props: props.Stack,
      slots: ["default"],
      description: "A vertical group of relevant results.",
    },
    Section: {
      props: props.Section,
      slots: ["default"],
      description: "A titled group of related results.",
    },
    Text: {
      props: props.Text,
      description: "An explanation from the completed response.",
    },
    FactList: {
      props: props.FactList,
      description: "Verified labeled facts with evidence references.",
    },
    ComparisonTable: {
      props: props.ComparisonTable,
      description:
        "Compare evidence-backed values across policies or proposals.",
    },
    RecordList: {
      props: props.RecordList,
      description: "Browse authorized records with filtering and sorting.",
    },
    FindingsList: {
      props: props.FindingsList,
      description: "Findings with explicit missing or uncertain evidence.",
    },
    RequirementMatrix: {
      props: props.RequirementMatrix,
      description: "Requirements matched to actual evidence and findings.",
    },
    DateList: {
      props: props.DateList,
      description: "Recorded effective dates, expirations, or milestones.",
    },
    SourceReference: {
      props: props.SourceReference,
      description: "Open a specific supporting source.",
    },
    FileReference: {
      props: props.FileReference,
      description: "Open an authorized supporting file.",
    },
    ChoiceGroup: {
      props: props.ChoiceGroup,
      description: "Ask the user to choose among concrete next steps.",
    },
    RecordSelector: {
      props: props.RecordSelector,
      description: "Ask the user to select a relevant authorized record.",
    },
    ClarificationForm: {
      props: props.ClarificationForm,
      description:
        "Collect missing information for a user-submitted chat follow-up.",
    },
    ActionGroup: {
      props: props.ActionGroup,
      description: "Open a record or send a user-selected follow-up.",
    },
  },
  actions: {},
});
