# What is in this folder, and what is wrong with it

GitHub renders this file when you open the folder, which is the point: one of these images asserts
things that are not true, and an HTML comment in the main README cannot warn anybody who arrives
here directly.

## `architecture.jpg`, superseded, six wrong facts

**It was removed from the README on 2026-09-02 and is kept on disk only so the list below can be
checked against it.** Nothing links to it. It is not the architecture diagram: the Mermaid diagram
under [How it fits together](../../README.md#how-it-fits-together) is, and it is text this repository
can check, correct and diff.

| What the picture says | What is true | Command |
| --- | --- | --- |
| `939 / 939 TESTS PASSED` in the badge, and `Unit Tests: 939 Passing` in the footer | **953** | `node --test tests/unit` |
| `Source Line Coverage: 98.22%` | **98.11** | `node --test --experimental-test-coverage --test-reporter=./tests/support/coverage_report.mjs --test-reporter-destination=stdout tests/unit` |
| tool 1, `describe_claim_surface` | `describe_claim` | `grep -hoE "name: '[a-z_]+'" src/webmcp/tools/*.js` |
| tool 3, `read_policy_requirements` | `get_requirements` | same |
| tool 7, `estimate_repair` | `get_repair_estimate` | same |
| `<form toolname="claim_form" toolautosubmit>` | `toolname="record_supporting_details"`, and **four** attributes, not two: `toolname`, `tooldescription`, `toolparamdescription`, `toolautosubmit` | `grep -n toolname index.html` |

Six of its nine tool names are right and three are names this build has never had. A judge who read
the picture and then opened the page would go looking for a tool that is not there. `Chrome
Assertions: 178 Live Checks` is the one number in the footer that still reproduces.

## `thumbnail.jpg`, the video thumbnail, kept deliberately

The still published with the video on YouTube. It is a marketing image rather than a claim about the
product: the small type in it is generated texture and does not read as anything, and it carries no
number. **It is kept by an explicit owner decision**, recorded here so that a later reader does not
take its absence from the correction list above as an oversight. The one line worth knowing when you
look at it: it says `AUTOMATED FNOL`, and the product's whole argument is that filing is not
automated, which every other surface says plainly, the video included.

## `video-thumbnail.jpg`

A smaller still. Nothing references it.
