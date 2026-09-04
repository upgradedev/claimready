# Owner attestation, for the four rows no script can prove

`scripts/readiness.mjs` refuses to award a PASS to anything a person did by hand. Four rows stay
`OWNER GATED` forever: opening the page in a real WebMCP client, uploading the video, filling the
form, and pressing Submit. No check here can watch any of those happen.

**What this file changes, and what it deliberately does not.** The gate reads the table below and
prints, beside each row it matches, the date and the evidence the owner recorded. **It never turns a
row into a PASS and it never moves the tally.** The point is narrower than that and worth stating: a
gate whose last line reads *the owner gated rows above are still owed by a person* is telling a
reader the entry has not been submitted, hours after it was. That sentence was wrong, and it was
wrong in the one command the README tells a judge to run.

**The gate refuses this file rather than ignoring it.** An id below that is not an owner gated row,
or a row in the table that does not parse, fails the run. A file that can silently say nothing is a
file nobody notices has gone stale, and this repository has been bitten by exactly that.

**This is an attestation, which is a person's word.** It is not evidence and it is not labelled as
any. Where an outside fact can be checked, the third column names the command rather than asserting
the outcome, so a reader can go and look instead of believing a line in a table.

| Row | Date | What the owner did, and what anybody can check |
| --- | --- | --- |
| O5 | 2026-09-03 | Opened the live URL in the ChatGPT desktop app's built in browser and ran the README prompts, and separately in Chrome `151.0.7922.174` with `chrome://flags/#enable-webmcp-testing` on. The machine half of this is `node evals/browser_probe.mjs` in CI: run 33828470561 at `ecd4c09` printed `probe: PASS. 178 checks against the deployed page, none failed.` The row stays owner gated because a run is not a person watching |
| O1 | 2026-09-03 | Uploaded the cut and set visibility to Public. `curl -s -L "https://www.youtube.com/watch?v=cazdzwy2qKU"` returns `"isPrivate":false`, `"isUnlisted":false` and `"lengthSeconds":"169"` |
| O2 | 2026-09-03 | Filled every field on the Devpost form: repository, live URL, description, video, gallery and captions. The published entry is <https://devpost.com/software/claimready-fy4toi> |
| O3 | 2026-09-03 | Pressed Submit. The hackathon manage page reads `SUBMITTED`, and it was read back after every later edit, because editing a submitted entry is the way this can silently revert |
