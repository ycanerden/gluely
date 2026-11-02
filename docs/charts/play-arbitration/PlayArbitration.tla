---- MODULE PlayArbitration ----
\* Explanation model of play arbitration for one person.
\* Two plays can want the same person. One becomes the active play.
\* The loser is recorded as stepped aside, not dropped silently.
\* In this model job-switch outranks hiring.
\* Cooldown days, account caps, and signal-strength ties are left out.

VARIABLES job, hiring, active
vars == <<job, hiring, active>>

TypeOK ==
  /\ job \in {"quiet", "wants", "active", "aside"}
  /\ hiring \in {"quiet", "wants", "active", "aside"}
  /\ active \in {"none", "job", "hiring"}

Init == job = "quiet" /\ hiring = "quiet" /\ active = "none"

SignalJob ==
  /\ active = "none"
  /\ job = "quiet"
  /\ job' = "wants"
  /\ UNCHANGED <<hiring, active>>

SignalHiring ==
  /\ active = "none"
  /\ hiring = "quiet"
  /\ hiring' = "wants"
  /\ UNCHANGED <<job, active>>

EnrolJob ==
  /\ active = "none"
  /\ job = "wants"
  /\ hiring = "quiet"
  /\ job' = "active"
  /\ active' = "job"
  /\ UNCHANGED hiring

EnrolHiring ==
  /\ active = "none"
  /\ hiring = "wants"
  /\ job = "quiet"
  /\ hiring' = "active"
  /\ active' = "hiring"
  /\ UNCHANGED job

Arbitrate ==
  /\ active = "none"
  /\ job = "wants"
  /\ hiring = "wants"
  /\ job' = "active"
  /\ hiring' = "aside"
  /\ active' = "job"

AsideHiring ==
  /\ active = "job"
  /\ job = "active"
  /\ hiring = "quiet"
  /\ hiring' = "aside"
  /\ UNCHANGED <<job, active>>

AsideJob ==
  /\ active = "hiring"
  /\ hiring = "active"
  /\ job = "quiet"
  /\ job' = "aside"
  /\ UNCHANGED <<hiring, active>>

Done ==
  /\ \/ /\ job = "active" /\ hiring = "aside" /\ active = "job"
     \/ /\ job = "aside" /\ hiring = "active" /\ active = "hiring"
  /\ UNCHANGED vars

Next ==
  \/ SignalJob \/ SignalHiring
  \/ EnrolJob \/ EnrolHiring
  \/ Arbitrate
  \/ AsideHiring \/ AsideJob
  \/ Done

Spec == Init /\ [][Next]_vars

OneActivePlay ==
  /\ ~(job = "active" /\ hiring = "active")
  /\ (active = "job") = (job = "active")
  /\ (active = "hiring") = (hiring = "active")

LoserIsRecorded ==
  /\ hiring = "aside" => active = "job" /\ job = "active"
  /\ job = "aside" => active = "hiring" /\ hiring = "active"

====
