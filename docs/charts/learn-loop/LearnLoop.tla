---- MODULE LearnLoop ----
\* Explanation model of how Gluely learns. This matches the decision log:
\* learning/log.jsonl, gluely recall, gluely learn and gluely log promote.
\* Every reply label can teach, and so can a person changing a draft.
\* Unsubscribe also suppresses the person.
\* Gluely refuses a lesson that holds an email or a LinkedIn address.
\* A lesson changes the brain only after a person approves it.
\* Reply labels beyond these, transcripts and sample sizes are left out.

VARIABLES source, draft, entry, proposal, suppressed
vars == <<source, draft, entry, proposal, suppressed>>

Sources == {"positive", "not_now", "negative", "unsubscribe", "human_edit"}

TypeOK ==
  /\ source \in Sources \cup {"none"}
  /\ draft \in {"none", "clean", "personal"}
  /\ entry \in {"none", "open", "promoted", "dropped"}
  /\ proposal \in {"none", "proposed", "approved"}
  /\ suppressed \in BOOLEAN

Init ==
  /\ source = "none"
  /\ draft = "none"
  /\ entry = "none"
  /\ proposal = "none"
  /\ suppressed = FALSE

Arrive(s) ==
  /\ source = "none"
  /\ source' = s
  /\ suppressed' = (s = "unsubscribe")
  /\ UNCHANGED <<draft, entry, proposal>>

\* The agent writes the lesson. It might include personal data by mistake.
Write ==
  /\ source # "none"
  /\ draft = "none"
  /\ entry = "none"
  /\ draft' \in {"clean", "personal"}
  /\ UNCHANGED <<source, entry, proposal, suppressed>>

\* Gluely refuses it, so the agent writes it again.
Refuse ==
  /\ draft = "personal"
  /\ draft' = "none"
  /\ UNCHANGED <<source, entry, proposal, suppressed>>

Keep ==
  /\ draft = "clean"
  /\ entry = "none"
  /\ entry' = "open"
  /\ UNCHANGED <<source, draft, proposal, suppressed>>

Propose ==
  /\ entry = "open"
  /\ proposal = "none"
  /\ proposal' = "proposed"
  /\ UNCHANGED <<source, draft, entry, suppressed>>

Approve ==
  /\ entry = "open"
  /\ proposal = "proposed"
  /\ proposal' = "approved"
  /\ entry' = "promoted"
  /\ UNCHANGED <<source, draft, suppressed>>

Drop ==
  /\ entry = "open"
  /\ proposal = "proposed"
  /\ entry' = "dropped"
  /\ UNCHANGED <<source, draft, proposal, suppressed>>

Done ==
  /\ entry \in {"promoted", "dropped"}
  /\ UNCHANGED vars

Next ==
  \/ \E s \in Sources : Arrive(s)
  \/ Write \/ Refuse \/ Keep \/ Propose \/ Approve \/ Drop
  \/ Done

Spec == Init /\ [][Next]_vars

LogHoldsNoPersonalData == entry # "none" => draft = "clean"

LessonHasASource == entry # "none" => source # "none"

OnlyAPersonPromotes == entry = "promoted" => proposal = "approved"

UnsubscribeSuppresses == source = "unsubscribe" => suppressed

OnlyUnsubscribeSuppresses == suppressed => source = "unsubscribe"

====
