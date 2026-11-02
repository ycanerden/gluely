---- MODULE Person360 ----
\* Explanation model of the Person 360 loop. Not the product implementation.
\* A LinkedIn URL is not the key. An internal id is. Events are appended.
\* Person 360 is filled in from that ledger. The CRM receives sales-ready
\* fields only, so a person with no sales-ready mark never reaches it.
\* A stage change that comes back from the CRM goes on the ledger like any event.
\* Enrichment, merges, and field ownership beyond this boundary are left out.

VARIABLES who, log, picture, crm, idMinted
vars == <<who, log, picture, crm, idMinted>>

LedgerAppendOnly ==
  \/ log = <<>>
  \/ log = <<"signal">>
  \/ log = <<"signal", "ready">>
  \/ log = <<"signal", "ready", "stage">>

TypeOK ==
  /\ who \in {"none", "id", "url"}
  /\ LedgerAppendOnly
  /\ picture \in {"blank", "shown"}
  /\ crm \in {"out", "whitelist", "stage"}
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

Push ==
  /\ picture = "shown"
  /\ log = <<"signal", "ready">>
  /\ crm = "out"
  /\ crm' = "whitelist"
  /\ UNCHANGED <<who, log, picture, idMinted>>

Mirror ==
  /\ crm = "whitelist"
  /\ crm' = "stage"
  /\ log' = <<"signal", "ready", "stage">>
  /\ UNCHANGED <<who, picture, idMinted>>

Done ==
  /\ who = "url"
  /\ log = <<"signal", "ready", "stage">>
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
    \/ log = <<"signal", "ready">> /\ log' = <<"signal", "ready", "stage">>
  ]_vars

ViewFollowsLedger == picture = "shown" => log # <<>> /\ idMinted

SignalNeedsAPerson == log # <<>> => idMinted

UrlOnInternalId == who = "url" => idMinted

CrmOnlyAfterSalesReady ==
  crm \in {"whitelist", "stage"} =>
    picture = "shown" /\ log \in {<<"signal", "ready">>, <<"signal", "ready", "stage">>}

StageIsLogged == crm = "stage" => log = <<"signal", "ready", "stage">>

====
