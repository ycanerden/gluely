---- MODULE SendGates ----
\* Explanation model of the gates in front of a send.
\* A like or a visit is not consent. Excluded and suppressed people are not sent.
\* A send carries play, variant, and context, and only after a person approves.
\* Volume caps, freshness, and cross-play arbitration are left out.

VARIABLES gate, touch, attr, approved
vars == <<gate, touch, attr, approved>>

TypeOK ==
  /\ gate \in {"checking", "engaged", "excluded", "suppressed", "clear"}
  /\ touch \in {"none", "approved", "sent"}
  /\ attr \in {"missing", "play, variant, context", "bare"}
  /\ approved \in BOOLEAN

Init ==
  /\ gate = "checking"
  /\ touch = "none"
  /\ attr = "missing"
  /\ approved = FALSE

Engage ==
  /\ gate = "checking"
  /\ gate' = "engaged"
  /\ UNCHANGED <<touch, attr, approved>>

Exclude ==
  /\ gate \in {"checking", "engaged"}
  /\ gate' = "excluded"
  /\ UNCHANGED <<touch, attr, approved>>

Suppress ==
  /\ gate \in {"checking", "engaged"}
  /\ gate' = "suppressed"
  /\ UNCHANGED <<touch, attr, approved>>

Clear ==
  /\ gate \in {"checking", "engaged"}
  /\ gate' = "clear"
  /\ UNCHANGED <<touch, attr, approved>>

Approve ==
  /\ gate = "clear"
  /\ touch = "none"
  /\ ~approved
  /\ touch' = "approved"
  /\ approved' = TRUE
  /\ UNCHANGED <<gate, attr>>

\* The only send writes the attribution. It is enabled from a clear gate,
\* never from excluded or suppressed.
Send ==
  /\ gate = "clear"
  /\ touch = "approved"
  /\ approved
  /\ touch' = "sent"
  /\ attr' = "play, variant, context"
  /\ UNCHANGED <<gate, approved>>

Done ==
  /\ \/ gate \in {"excluded", "suppressed"}
     \/ touch = "sent"
  /\ UNCHANGED vars

Next == Engage \/ Exclude \/ Suppress \/ Clear \/ Approve \/ Send \/ Done

Spec == Init /\ [][Next]_vars

NoSendWhenSuppressed == touch = "sent" => gate # "suppressed"

NoSendWhenExcluded == touch = "sent" => gate # "excluded"

EverySendHasAttribution == touch = "sent" => attr = "play, variant, context"

NoBareAttribution == attr # "bare"

HumanApprovesBeforeSend == touch \in {"approved", "sent"} => approved

EngagementIsNotConsent == gate = "engaged" => touch = "none" /\ ~approved

SendOnlyFromAClearGate == touch = "sent" => gate = "clear"

====
