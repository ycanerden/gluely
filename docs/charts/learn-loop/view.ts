type Learn = {
  source: string;
  draft: string;
  entry: string;
  proposal: string;
  suppressed: boolean;
};

const steps: Record<string, string> = {
  Write: "the agent writes the lesson",
  Refuse: "Gluely refuses it, so the agent writes it again",
  Keep: "the lesson goes in the log",
  Propose: "the agent proposes a rule on a branch",
  Approve: "a person approves, and the lesson is promoted",
  Drop: "a person says no, and it is dropped with a reason",
  Done: "the lesson is settled",
};

export const title = "Every reply can teach, and a person approves the rule";

export const state = (v: Learn) => {
  if (v.entry === "promoted") return "Promoted into a rule or test";
  if (v.entry === "dropped") return "Dropped, with a reason";
  if (v.proposal === "proposed") return "A rule is proposed";
  if (v.entry === "open") return "Open lesson, read by gluely recall";
  if (v.draft === "personal") return "Lesson holds personal data";
  if (v.draft === "clean") return "Lesson drafted";
  if (v.source === "unsubscribe") return "Unsubscribed and suppressed";
  return v.source === "none" ? "Waiting for a reply or an edit" : "Something to learn from";
};

export const step = (action: string, _from?: Learn, to?: Learn) => {
  if (action.startsWith("Arrive")) {
    if (to?.source === "unsubscribe") return "they unsubscribe";
    return to?.source === "human_edit" ? "a person edits a draft" : "a reply is labeled positive, not now or negative";
  }
  const label = steps[action];
  if (!label) throw new Error(`no reader label for ${action}`);
  return label;
};

export const group = (v: Learn) => {
  if (v.entry === "promoted" || v.entry === "dropped") return "Settled";
  if (v.draft === "personal") return "Refused";
  if (v.entry === "open") return "In the log";
  return "Incoming";
};

export const colors = {
  Incoming: "yellow",
  Refused: "orange",
  "In the log": "teal",
  Settled: "blue",
};
