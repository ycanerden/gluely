---- MODULE LearnLoop ----
\* Explanation model of the learn loop.
\* A reply gets one label. A learning card carries counts and shared words,
\* never the prospect's own text. A person approves a play update.
\* Unsubscribe suppresses and does not become a card.
\* Transcripts, the commons pull request, and the minimum sample are left out.

VARIABLES label, card, proposal, suppressed
vars == <<label, card, proposal, suppressed>>

TypeOK ==
  /\ label \in {"none", "positive", "not_now", "unsubscribe"}
  /\ card \in {"none", "counts", "raw"}
  /\ proposal \in {"none", "proposed", "approved"}
  /\ suppressed \in BOOLEAN

Init ==
  /\ label = "none"
  /\ card = "none"
  /\ proposal = "none"
  /\ suppressed = FALSE

LabelPositive ==
  /\ label = "none"
  /\ label' = "positive"
  /\ UNCHANGED <<card, proposal, suppressed>>

LabelNotNow ==
  /\ label = "none"
  /\ label' = "not_now"
  /\ UNCHANGED <<card, proposal, suppressed>>

LabelUnsubscribe ==
  /\ label = "none"
  /\ label' = "unsubscribe"
  /\ suppressed' = TRUE
  /\ UNCHANGED <<card, proposal>>

DraftCard ==
  /\ label = "positive"
  /\ card = "none"
  /\ card' = "counts"
  /\ UNCHANGED <<label, proposal, suppressed>>

ProposeUpdate ==
  /\ card = "counts"
  /\ proposal = "none"
  /\ proposal' = "proposed"
  /\ UNCHANGED <<label, card, suppressed>>

Approve ==
  /\ proposal = "proposed"
  /\ proposal' = "approved"
  /\ UNCHANGED <<label, card, suppressed>>

Done ==
  /\ \/ label \in {"not_now", "unsubscribe"}
     \/ proposal = "approved"
  /\ UNCHANGED vars

Next ==
  \/ LabelPositive \/ LabelNotNow \/ LabelUnsubscribe
  \/ DraftCard \/ ProposeUpdate \/ Approve
  \/ Done

Spec == Init /\ [][Next]_vars

CardHasNoProspectText == card # "raw"

OnlyPositiveFeedsACard == card = "counts" => label = "positive"

HumanApprovesPlayUpdate ==
  proposal = "approved" => card = "counts" /\ label = "positive"

UnsubscribeSuppresses ==
  label = "unsubscribe" => suppressed /\ card = "none" /\ proposal = "none"

====
