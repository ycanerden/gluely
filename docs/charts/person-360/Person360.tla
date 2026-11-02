---- MODULE Person360 ----
\* Explanation model of the Person 360 loop. Not the product implementation.
\* A LinkedIn URL is not the key. An internal id is. Events are appended.
\* Person 360 is filled in from that ledger. The CRM receives sales-ready
\* fields only, never a raw pooled list of people.
\* Enrichment, merges, and field ownership beyond this boundary are left out.

VARIABLES who, log, picture, crm, idMinted
vars == <<who, log, picture, crm, idMinted>>

LedgerAppendOnly ==
  \/ log = <<>>
  \/ log = <<"signal">>
  \/ log = <<"signal", "ready">>

TypeOK ==
  /\ who \in {"none", "id", "url"}
  /\ LedgerAppendOnly
  /\ picture \in {"blank", "shown"}
  /\ crm \in {"out", "whitelist", "stage", "raw"}
  /\ idMinted \in BOOLEAN

Init ==
  /\ who = "none"
  /\ log = <<>>
  /\ picture = "blank"
  /\ crm = "out"
  /\ idMinted = FALSE

Mint ==
  /\ who = "none"
  /\ who' = "id"
  /\ idMinted' = TRUE
  /\ UNCHANGED <<log, picture, crm>>

Link ==
  /\ idMinted
  /\ who = "id"
  /\ who' = "url"
  /\ UNCHANGED <<log, picture, crm, idMinted>>

LogSignal ==
  /\ idMinted
  /\ log = <<>>
  /\ log' = <<"signal">>
  /\ UNCHANGED <<who, picture, crm, idMinted>>

AppendReady ==
  /\ log = <<"signal">>
  /\ log' = <<"signal", "ready">>
  /\ UNCHANGED <<who, picture, crm, idMinted>>

Refresh ==
  /\ log # <<>>
  /\ picture = "blank"
  /\ picture' = "shown"
  /\ UNCHANGED <<who, log, crm, idMinted>>

\* The push writes whitelist fields. It never writes "raw".
Push ==
  /\ picture = "shown"
  /\ log = <<"signal", "ready">>
  /\ crm = "out"
  /\ crm' = "whitelist"
  /\ UNCHANGED <<who, log, picture, idMinted>>

Mirror ==
  /\ crm = "whitelist"
  /\ crm' = "stage"
  /\ UNCHANGED <<who, log, picture, idMinted>>

Done ==
  /\ who = "url"
  /\ log = <<"signal", "ready">>
  /\ picture = "shown"
  /\ crm = "stage"
  /\ UNCHANGED vars

Next ==
  \/ Mint \/ Link \/ LogSignal \/ AppendReady \/ Refresh \/ Push \/ Mirror \/ Done

Spec == Init /\ [][Next]_vars

\* The log stays, or it grows by the next event. It never shrinks or rewrites.
LogNeverShrinks ==
  [][
    \/ log' = log
    \/ log = <<>> /\ log' = <<"signal">>
    \/ log = <<"signal">> /\ log' = <<"signal", "ready">>
  ]_vars

ViewFollowsLedger == picture = "shown" => log # <<>> /\ idMinted

SignalNeedsAPerson == log # <<>> => idMinted

UrlOnInternalId == who = "url" => idMinted

CrmNeverGetsRawPooledPii == crm # "raw"

CrmOnlyAfterSalesReady ==
  crm \in {"whitelist", "stage"} => picture = "shown" /\ log = <<"signal", "ready">>

====
