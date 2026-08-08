@AGENTS.md

---

The line above is an **import, not a link**. Claude Code inlines that file into the session,
so the rules arrive with the task instead of waiting to be discovered — which is the whole
difference between a rule that is followed and one that is merely available. A link cost a
tool call to follow and, on the turns that mattered, did not get followed at all.

Everything about changing this repo lives in AGENTS.md, and only there, so that every tool
and every contributor reads the same file. Do not copy rules into this one: two files that
say almost the same thing is how they start disagreeing.
