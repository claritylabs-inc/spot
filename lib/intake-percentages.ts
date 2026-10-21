import catalog from "../docs/procurement/acord-intake/question-catalog.json";

const percentageSources=new Set(catalog.questions.filter(question=>question.answerType==="percentage").map(question=>question.id));
export function isIntakePercentageQuestion(question:{source?:string}) {
  return percentageSources.has(question.source?.split(" · ").at(-1)??"");
}
