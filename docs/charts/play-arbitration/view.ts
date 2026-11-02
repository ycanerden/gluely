type Plays = {
  job: string;
  hiring: string;
  active: string;
};

const playLabel = (play: string) => {
  if (play === "quiet") return "Not asking";
  if (play === "wants") return "Wants this person";
  if (play === "active") return "The one active play";
  return "Stepped aside";
};

const steps: Record<string, string> = {
  SignalJob: "a job-switch signal arrives",
  SignalHiring: "a hiring signal arrives",
  EnrolJob: "job-switch runs on its own",
  EnrolHiring: "hiring runs on its own",
  Arbitrate: "arbitration keeps job-switch and sets hiring aside",
  AsideHiring: "a later hiring signal is set aside",
  AsideJob: "a later job-switch signal is set aside",
  Done: "one play remains",
};

export const title = "One person, one active play";

export const state = (v: Plays) => ({
  "Job-switch": playLabel(v.job),
  Hiring: playLabel(v.hiring),
});

export const step = (action: string) => {
  const label = steps[action];
  if (!label) throw new Error(`no reader label for ${action}`);
  return label;
};

export const group = (v: Plays) => (v.active === "none" ? "Competing" : "One winner");

export const colors = {
  Competing: "yellow",
  "One winner": "teal",
};
