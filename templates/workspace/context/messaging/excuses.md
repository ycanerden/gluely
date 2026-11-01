---
id: excuses
status: template
updated: {{date}}
excuses:
  - signal: signal.job_switch
    pattern: "Congrats on the move to {new_company}. At {old_company} you..."
    never: ["I saw you changed jobs"]
  - signal: signal.hiring
    pattern: "Saw {company} is hiring a {role}. Teams at that stage usually..."
    never: []
  - signal: signal.post_engagement
    pattern: "Your comment on {author}'s post about {topic}..."
    never: ["I noticed you liked"]
  - signal: signal.page_follow
    pattern: "Lead with a useful resource, and never mention the follow."
    never: ["saw you followed"]
  - signal: signal.connection
    pattern: "{teammate} suggested I reach out... (only when it's true)"
    never: []
  - signal: signal.inbound_form
    pattern: "You asked about {topic}. Here is the direct answer..."
    never: []
---
# Excuses

An excuse is the honest reason to reach out now. No excuse, no message.
Each signal maps to an opener, and to what you must never say. `gluely check draft` enforces the never list.
