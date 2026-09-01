## What this supports

**Nothing yet.** No v2 run exists. `evidence/impact/runs-v2` is empty, the counts above are zeros,
and this file is where the reading goes once there is something to read.

It exists now, before any run, for two reasons. The analyzer inlines it verbatim, so whoever writes
the interpretation writes it into a named file rather than into the report, where it would be
indistinguishable from the generated part. And its absence had a consequence: the command published
in `protocol-v2.md` omitted `--interpretation`, the analyzer fell back to the v1 file, and a reader
following our own instruction produced a v2 report carrying v1's counts underneath `AWAITING_RUNS`
and a table of zeros. The flag is written out in the protocol now, with that history beside it.

When v2 runs exist, what goes here is the reading and nothing else: what the counts say, what they
do not say, and the seeded and unseeded pair side by side. It is published whichever way it goes,
including against the page, which is what v1 did.
