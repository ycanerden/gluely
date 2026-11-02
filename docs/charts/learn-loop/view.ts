type Learn = {
  label: string;
  card: string;
  proposal: string;
  suppressed: boolean;
};

const steps: Record<string, string> = {
  LabelPositive: "the reply is labeled positive",
  LabelNotNow: "the reply is labeled not now",
  LabelUnsubscribe: "the reply is labeled unsubscribe",
  DraftCard: "an anonymised card is drafted",
  ProposeUpdate: "the card proposes a play update",
  Approve: "a person approves the play update",
  Done: "the lesson is settled",
};

export const title = "A reply can teach the play, without the prospect's words";

export const state = (v: Learn) => {
  if (v.card === "raw") return "Card holds the prospect's words";
  if (v.proposal === "approved") return "A person approved the play update";
  if (v.proposal === "proposed") return "A play update is proposed";
  if (v.card === "counts") return "Card holds counts and shared words only";
  if (v.label === "positive") return "Reply labeled positive";
  if (v.label === "not_now") return "Reply labeled not now, no card";
  if (v.label === "unsubscribe") return "Unsubscribe suppressed, no card";
  return "A reply is waiting";
};

export const step = (action: string) => {
  const label = steps[action];
  if (!label) throw new Error(`no reader label for ${action}`);
  return label;
};

export const group = (v: Learn) => {
  if (v.proposal === "approved") return "Approved";
  if (v.card === "counts" || v.card === "raw" || v.proposal === "proposed") return "Lesson";
  if (v.label === "unsubscribe" || v.label === "not_now") return "No card";
  return "Reply";
};

export const colors = {
  Reply: "yellow",
  "No card": "orange",
  Lesson: "teal",
  Approved: "blue",
};
