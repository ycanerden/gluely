type Person = {
  who: string;
  log: Record<string, string>;
  picture: string;
  crm: string;
};

const whoLabel: Record<string, string> = {
  none: "No one on file",
  id: "Internal id minted",
  url: "LinkedIn URL on the spine",
};

const ledgerLabel = (log: Record<string, string>) => {
  const n = Object.keys(log).length;
  if (n === 0) return "Nothing logged yet";
  if (n === 1) return "A signal is kept";
  if (n === 2) return "Sales-ready mark appended";
  return "Stage change appended";
};

const viewLabel: Record<string, string> = {
  blank: "No view yet",
  shown: "Person 360 shows this person",
};

const crmLabel: Record<string, string> = {
  out: "Not in the CRM",
  whitelist: "Sales-ready fields only",
  stage: "Stage mirrored from the CRM",
};

const steps: Record<string, string> = {
  Mint: "a LinkedIn URL arrives and an internal id is minted",
  Link: "that URL is linked onto the id",
  LogSignal: "a signal is appended",
  AppendReady: "a sales-ready mark is appended",
  Refresh: "Person 360 is filled in from the ledger",
  Push: "sales-ready fields go to the CRM",
  Mirror: "a stage change comes back and goes on the ledger",
  Done: "the picture is complete",
};

export const title = "Person 360 is a view over an append-only ledger";

export const state = (v: Person) => ({
  Identity: whoLabel[v.who],
  Ledger: ledgerLabel(v.log),
  View: viewLabel[v.picture],
  CRM: crmLabel[v.crm],
});

export const step = (action: string) => {
  const label = steps[action];
  if (!label) throw new Error(`no reader label for ${action}`);
  return label;
};

export const group = (v: Person) => {
  if (v.crm === "whitelist" || v.crm === "stage") return "CRM boundary";
  if (v.picture === "shown") return "Person 360";
  if (Object.keys(v.log).length > 0) return "Ledger";
  return "Identity";
};

export const colors = {
  Identity: "blue",
  Ledger: "teal",
  "Person 360": "yellow",
  "CRM boundary": "orange",
};
