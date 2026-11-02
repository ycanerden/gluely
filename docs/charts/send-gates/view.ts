type Gates = {
  gate: string;
  touch: string;
  attr: string;
  approved: boolean;
};

const steps: Record<string, string> = {
  Engage: "a like or a visit arrives",
  Exclude: "an exclusion rule hits",
  Suppress: "a suppression hash hits",
  Clear: "exclusion and suppression pass",
  Approve: "a person approves the draft",
  Send: "the touch goes out with play, variant, and context",
  Done: "nothing further is sent",
};

export const title = "Gates before a send";

export const state = (v: Gates) => {
  if (v.gate === "excluded") return "Excluded, no send";
  if (v.gate === "suppressed") return "Suppressed, no send";
  if (v.gate === "engaged") return "Engaged, still not consent";
  if (v.gate === "checking") return "At the gates";
  if (v.touch === "none") return "Exclusion and suppression passed";
  if (v.touch === "approved") return "Draft approved by a person";
  if (v.attr === "play, variant, context") return "Sent with play, variant, and context";
  return "Sent without attribution";
};

export const step = (action: string) => {
  const label = steps[action];
  if (!label) throw new Error(`no reader label for ${action}`);
  return label;
};

export const group = (v: Gates) => {
  if (v.gate === "excluded" || v.gate === "suppressed") return "Stopped";
  if (v.touch === "sent") return "Sent";
  if (v.gate === "clear") return "Cleared";
  return "Before a send";
};

export const colors = {
  "Before a send": "yellow",
  Stopped: "orange",
  Cleared: "teal",
  Sent: "blue",
};
