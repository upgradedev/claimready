# Checking a ClaimReady packet, without ClaimReady

You have been handed a JSON file that says it is a first notice of loss packet. It carries a
SHA-256 digest and it says the digest covers the content. This page is how you check that for
yourself, using nothing from this project.

That last part is the point. Everything else that proves the digest lives inside this repository:
`src/core/packet.js` computes it, `scripts/verify_packet.mjs` recomputes it, and a unit test agrees
with both. All of that is us marking our own work. A digest is only worth something to a person on
the other side of it, so what follows is three routes that a stranger can run with a stock Node, a
stock Python 3, and a hashing tool that ships with the operating system. None of them imports a line
of our code.

**Nobody outside this project has run any of this yet.** The value of this page is that the check is
now runnable by someone who is not us, not that someone already did. See
[What has not been checked](#what-has-not-been-checked) at the bottom, which lists that honestly
rather than quietly.

## Contents

- [What you are holding](#what-you-are-holding)
- [What the digest covers, and what it does not](#what-the-digest-covers-and-what-it-does-not)
- [What the digest is not](#what-the-digest-is-not)
- [The canonical form, in five rules](#the-canonical-form-in-five-rules)
- [Route 1, Node with no dependencies](#route-1-node-with-no-dependencies)
- [Route 2, Python 3 with no dependencies](#route-2-python-3-with-no-dependencies)
- [Route 3, hash a file with a tool the operating system already has](#route-3-hash-a-file-with-a-tool-the-operating-system-already-has)
- [The worked example](#the-worked-example)
- [What a refusal looks like](#what-a-refusal-looks-like)
- [Line endings, and the trap that produces a false mismatch](#line-endings-and-the-trap-that-produces-a-false-mismatch)
- [Our own route, for completeness](#our-own-route-for-completeness)
- [What has not been checked](#what-has-not-been-checked)

## What you are holding

A packet is one JSON object with exactly three keys at the top.

```
{
  "content":        { ...everything about the filed claim... },
  "content_digest": "sha256:<64 hex characters>",
  "generated_at":   "2026-09-01T09:15:31.000Z"
}
```

`content` is the packet. `content_digest` is the claim being made about it. `generated_at` is when
that particular copy was written out.

Both times in a packet are written one way and one way only: a full ISO-8601 instant in UTC to the
millisecond, which is exactly what `new Date().toISOString()` produces. That is `generated_at` here
and `content.filed.at` inside. The page refuses to file a claim without one, and refuses to read one
back in any other shape, so two packets can be compared by string rather than by parsing. An offset
such as `+02:00` is refused as well as a missing zone, even though it can name the same moment: the
digest is over the bytes, not over the moment.

Inside `content`, `version` is 2. Read it before you read anything else. Version 1 wrote
`coverage.covered` as a plain true or false, and a cover decision on this page can be a yes that
still depends on something the claim has not said yet, such as who was driving. Version 2 carries
`coverage.provisional` and `coverage.provisional_reason` beside it, and a reader that renders a
decision from `covered` alone will state a settled answer where the packet is telling you the
question is still open. If you have code pinned to version 1, that is what changed under it.

## What the digest covers, and what it does not

The digest is taken over `content` alone. Nothing else in the file is hashed.

Inside the digest, so a change to any of it moves the digest:

- `kind` and `version`, which say what format this is
- `synthetic` and `notice`, which say this is a demonstration and not a filing
- `reference`, the claim reference with the filed revision on the end
- `filed`, the time, the revision and the route the filing took
- `policy`, the policy number, the insurer, and which rule pack the cover was read from
- `claim`, every answered field with the label the claimant saw
- `provenance`, which answers arrived through a tool and which through the page
- `pinned_by_the_claimant`, the fields no tool was allowed to move
- `coverage`, the decision, whether that decision is still provisional and what it is waiting on,
  the clause, the excess and the currency
- `requirements`, what the intake asked for and what answered each one
- `human_actions_completed` and `tool_calls`

Outside the digest, so a change to either of them does not move it:

- `content_digest` itself, for the obvious reason
- `generated_at`

`generated_at` is deliberately outside. Two people can export the same filed claim a minute apart,
and both copies have to agree, or the digest cannot be used to say the two describe the same thing.
A clock inside the hashed part would break that on every export. [The worked
example](#the-worked-example) demonstrates both halves of this. One character changed inside
`content` moves the digest, and a completely different `generated_at` does not.

## What the digest is not

It is a bare SHA-256. There is no key and no signature anywhere in this system.

So be precise about what a matching digest tells you. It tells you the content in front of you is
the content the digest was computed over. It lets two copies of a packet be compared without reading
four thousand characters of JSON side by side. It catches an edit made by somebody who did not
recompute the digest, which is the ordinary case of a file that got changed in transit or in a mail
client.

It does not tell you who made the packet. Anyone can edit `content`, recompute the digest with the
routes on this page, and produce a file that verifies. If you need origin rather than integrity, you
need a signature over the digest, and this project does not ship one. That is a real limitation and
it is written here rather than left for you to work out.

And one field deserves saying out loud, because it is the field that reads like a receipt.
`content.filed.through` says the claim was filed through a control on the page. Inside the running
page that sentence is checked rather than asserted: `src/core/packet.js` refuses to build anything
at all unless the claim object it was handed is the object `fileClaim` in `src/core/claim.js`
returned, and that record is a map held privately in the module with no way to write to it from
outside. A status typed by hand, and a copy of a filed claim, both get a refusal instead of a
document.

The record names an object, so `fileClaim` freezes the whole claim it files, every nested value
with it, before that object is recorded. Otherwise the check would be about an address rather than
about a state: the page hands the same live object to whatever draws the packet, and a value
changed after the filing would have been sealed and hashed under a sentence saying the filing had
already happened. So the packet carries what passed the file gate, and nothing that arrived after
it.

The record also holds what that filing was decided under, and that half is newer. The rule pack,
whose policy it is and the steps a person had carried out do not live on the claim: they arrive on
the call that builds the packet, so they used to be believed. A pack carrying the right id and the
wrong rules is refused now, and so is a list of steps that is not the list the claim was filed with.
The insurer, the clause and the excess in the document below are the ones the filing was decided
under, rather than the ones the last caller offered.

That check lives entirely inside one browser tab and it dies with the tab. It cannot travel in the
file. So to you, holding the packet, `filed.through` is a sentence the page wrote, exactly like
every other sentence in there, and nothing on this page lets you check it. It is not a signature and
it is not an insurer receipt. What it does is stop this page describing a filing it did not perform.

## The canonical form, in five rules

The bytes that get hashed are not the bytes in the file. They are `content` written out again in a
canonical form, so that key order and whitespace cannot change the answer. The rules are the whole
specification:

1. Object keys are sorted at every level of nesting.
2. Two space indent, the shape `JSON.stringify(value, null, 2)` and `json.dumps(value, indent=2)`
   both produce.
3. Line feed line endings, never carriage return line feed.
4. UTF-8 bytes, with non-ASCII characters left as themselves rather than escaped.
5. One trailing line feed at the very end.

Then take the SHA-256 of those bytes and write it as lowercase hex with `sha256:` in front.

Two notes on rule 1. Sorting is over the key strings as they are, and every key in a packet is plain
ASCII, so a JavaScript sort by UTF-16 code unit and a Python sort by code point give the same order.
Arrays keep the order they are in, because their order is meaningful. `tool_calls` is oldest first,
and shuffling it would be a change to the packet rather than a formatting choice.

One note on rule 2, and it is the one way the routes below can disagree without anybody editing a
packet. The canonical form assumes every number renders the same in both languages. That holds for
integers and it is what the rule packs carry, but JavaScript writes `250.0` as `250` while Python
writes it as `250.0`, so a packet that ever carried a trailing decimal zero would make route 1 and
route 2 answer differently and both refuse a packet that was fine. No field in a packet carries one
today. If you ever see the two routes disagree on an untouched file, look for that before you look
for an edit.

The source of truth for this is `canonicalise` in `src/core/packet.js`. The two routes below
reimplement it in about five lines each, which is the point. A specification you have to trust our
code for is not a specification.

## Route 1, Node with no dependencies

Save this as `check.mjs`. It imports `node:fs` and `node:crypto` and nothing else. It reaches the
hash through `createHash` rather than through Web Crypto, which is the API the page itself calls, so
it is a different route in rather than the same call made again. Be precise about how much that is
worth. On one Node install both of those end up in the same underlying library, so route 1 is an
independent canonicaliser and only partly an independent hash. Route 2 and route 3 are where the
second and third hash implementations come from.

```js
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const packet = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const sort = (n) => (n === null || typeof n !== 'object') ? n
  : Array.isArray(n) ? n.map(sort)
  : Object.keys(n).sort().reduce((o, k) => (o[k] = sort(n[k]), o), {});
const canonical = JSON.stringify(sort(packet.content), null, 2) + '\n';

console.log('recomputed ' + 'sha256:' + createHash('sha256').update(canonical, 'utf8').digest('hex'));
console.log('claimed    ' + packet.content_digest);
```

Run it:

```
node check.mjs packet.json
```

The two lines it prints must be identical. As a single command, for a shell that lets you paste one:

```
node -e "const fs=require('fs'),c=require('crypto');const p=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));const s=n=>n===null||typeof n!=='object'?n:Array.isArray(n)?n.map(s):Object.keys(n).sort().reduce((o,k)=>(o[k]=s(n[k]),o),{});const t=JSON.stringify(s(p.content),null,2)+'\n';console.log('recomputed '+'sha256:'+c.createHash('sha256').update(t,'utf8').digest('hex'));console.log('claimed    '+p.content_digest);" packet.json
```

The quoting in that one line is written for a POSIX shell. In PowerShell or `cmd` the nested quotes
will fight you, and the saved file above is the version to use.

## Route 2, Python 3 with no dependencies

Save this as `check.py`. Standard library only. Nothing to install.

```python
import json, hashlib, sys

packet = json.load(open(sys.argv[1], encoding='utf-8'))
canonical = json.dumps(packet['content'], sort_keys=True, indent=2, ensure_ascii=False) + '\n'

print('recomputed sha256:' + hashlib.sha256(canonical.encode('utf-8')).hexdigest())
print('claimed    ' + packet['content_digest'])
```

```
python check.py packet.json
```

`ensure_ascii=False` is rule 4 and it matters. Leave it out and Python escapes any non-ASCII
character to a backslash u escape, which changes the bytes and therefore the digest. Every other
default in `json.dumps` already matches. With `indent=2` the separators are a comma and a colon
followed by a space, which is what JavaScript writes too.

This route agreeing with route 1 is worth more than either on its own. It is a different
canonicaliser and a different hash implementation, written from the five rules rather than from our
code.

## Route 3, hash a file with a tool the operating system already has

The first two routes do the hashing inside a scripting language. This one does not. It writes the
canonical bytes to a file, then hands that file to a hashing tool that came with the machine.

Write the file first. Either language will do it, and the write step is the part to be careful
about:

```python
import json, sys

packet = json.load(open(sys.argv[1], encoding='utf-8'))
canonical = json.dumps(packet['content'], sort_keys=True, indent=2, ensure_ascii=False) + '\n'
open(sys.argv[2], 'w', encoding='utf-8', newline='').write(canonical)
```

```
python write_canonical.py packet.json content.canonical.json
```

`newline=''` is not optional on Windows. Without it Python turns every line feed into a carriage
return line feed on the way out, and the digest of that file will not match anything.

Then hash it. On Linux, macOS or Git Bash:

```
sha256sum content.canonical.json
```

On Windows, with no extra software:

```
certutil -hashfile content.canonical.json SHA256
```

`certutil` prints the hex on its own line with no `sha256:` in front, so compare the 64 characters
rather than the whole string. `sha256sum` prints the hex, then a space, then the file name.

## The worked example

There is a real packet in this repository at
[`docs/handler-packet.example.json`](handler-packet.example.json). It was produced by
`src/core/packet.js` from the demonstration claim this project ships, and its digest is real.

**The claim in it is synthetic.** Maria K., policy MTR-2026-0417, the Volara Terra 5, the plate
SYN-4417 and Northwind Mutual are all invented for this demonstration. No insurer backend is
connected to this project, nothing has been sent anywhere, and the packet says so in its own
`synthetic` and `notice` fields rather than in a footnote. It is a filed claim in the sense that the
filing control on the page was pressed, and in no other sense.

The digest it claims is:

```
sha256:4c934f45d3c980df0cdd471117cca2dc4d3b0b10ae1b9d48f7c7a57a51764243
```

All three routes were run against that file on 2026-09-01 and returned the same 64 characters:

| Route | Command | Result |
|---|---|---|
| 1, Node `node:crypto` | `node check.mjs docs/handler-packet.example.json` | `sha256:4c934f45d3c980df0cdd471117cca2dc4d3b0b10ae1b9d48f7c7a57a51764243` |
| 2, Python `hashlib` | `python check.py docs/handler-packet.example.json` | `sha256:4c934f45d3c980df0cdd471117cca2dc4d3b0b10ae1b9d48f7c7a57a51764243` |
| 3a, `sha256sum` | `sha256sum content.canonical.json` | `4c934f45d3c980df0cdd471117cca2dc4d3b0b10ae1b9d48f7c7a57a51764243` |
| 3b, `certutil` | `certutil -hashfile content.canonical.json SHA256` | `4c934f45d3c980df0cdd471117cca2dc4d3b0b10ae1b9d48f7c7a57a51764243` |

The canonical form of that packet's `content` is 4,300 bytes. The whole file, envelope included, is
4,768 bytes.

The example is pinned by a test. `tests/unit/handler_verification.test.js` recomputes the digest
from the file using `node:crypto`, checks it against the `content_digest` in the file, and checks it
against the digest written on this page. If any of the three drift apart, that test fails and this
page cannot go out saying something the file does not.

The file is not edited by hand. `node scripts/gen_packet_example.mjs` writes it, from the sample
claim and the shipped Northwind rules, through the same module the page builds a packet with. Both
timestamps in it are constants in that script rather than readings off a clock, so running it twice
writes the same bytes and the digest only moves when the packet actually changes. Run it with
`--check` and it says whether the file on disk is still the file it writes, without touching it, and
prints the three byte counts this page quotes.

## What a refusal looks like

A digest that never refuses anything is decoration, so here it is refusing.

The excess in the example is 250 EUR, under clause OD-4.1. Change one character of it, from
`"deductible": 250` to `"deductible": 350`, and change nothing else. That is exactly the edit
somebody would make if they wanted a handler to read a different number, and it is one keystroke.

All three routes then report the same different digest, and none of them matches what the file still
claims:

```
recomputed sha256:e8d1c86f6d9295dde632d431d40ceb1203e50b1110ff081be7f136a6c69b10da
claimed    sha256:4c934f45d3c980df0cdd471117cca2dc4d3b0b10ae1b9d48f7c7a57a51764243
```

Route 1 and route 2 printed that pair. Route 3, through both `sha256sum` and `certutil`, printed
`e8d1c86f6d9295dde632d431d40ceb1203e50b1110ff081be7f136a6c69b10da`. Three implementations, one
answer, and the answer is no.

Now the other half, which is the more useful one for you. Take the untouched example and change
`generated_at` from `2026-09-01T09:15:31.000Z` to `2031-12-25T23:59:59.000Z`, a date six years out.
Every route still returns the digest ending `4243` and still matches. That is `generated_at` sitting
outside the digest, working as intended. A packet exported twice from one filed revision is the same
packet, and you can tell, which is the property that makes the digest usable for comparing two
copies.

## Line endings, and the trap that produces a false mismatch

The digest is over line feed bytes. Git on Windows is commonly configured with
`core.autocrlf=true`, which rewrites text files on checkout, and until 2026-09-01 this repository
had no `.gitattributes`, so a Windows clone got `docs/handler-packet.example.json` with carriage
return line feed endings.

It now carries one, and that file is pinned to line feeds in it. The pin was added after watching
the damage rather than in anticipation of it: in a fresh clone of this repository at `ab2db69`,
`node --test tests/unit`, the second command the README quickstart gives a judge, printed
`5022 !== 4864` and failed. The test that failed was building its own carriage return copy on top of
a checkout that had already been converted, so it measured a file with doubled endings. Both halves
were repaired, because either alone leaves somebody exposed: the pin stops the conversion for anyone
cloning from here on, and the test normalises its base first, which is what protects a reader whose
checkout was converted before the pin existed or who set `core.autocrlf` themselves.

None of that changes what routes 1 and 2 do, and the pin is a convenience rather than the thing the
promise rests on. A converted checkout never broke either route, and it is worth knowing why. Both
of them parse the JSON and write the canonical form out again from the parsed object, so the line
endings in the file they read never reach the hash. This was checked rather than assumed. A copy of the example with every line
feed replaced by a carriage return line feed, 4,928 bytes instead of 4,768, verifies under both
routes and returns the digest ending `4243`.

Route 3 is the one to be careful with, because it hashes a file directly. Two ways to get a false
mismatch out of it:

- Writing the canonical file without `newline=''`, on Windows. Python converts the line endings on
  the way out and the digest changes.
- Writing it with PowerShell redirection. PowerShell 5.1 writes UTF-16 with a byte order mark by
  default, and it adds a carriage return line feed. Neither of those is the canonical form, and the
  digest will be wrong twice over.

If route 3 disagrees with routes 1 and 2, suspect the file you wrote before you suspect the packet.
Check its size first. The canonical content of the example is 4,300 bytes, and a file that is
noticeably larger has picked up carriage returns or a byte order mark.

## Our own route, for completeness

This repository ships `scripts/verify_packet.mjs`, which does the same thing using the same module
that built the packet. It is not independent, and it is listed last on purpose.

```
node scripts/verify_packet.mjs docs/handler-packet.example.json
```

It printed the reference, the filed revision, the claimed digest and the recomputed digest, said the
digest matched, and exited 0. Run against the copy with the excess changed to 350 it printed both
digests, said the packet had been edited since it was built, and exited 1.

Exit 2 is a file it cannot read as a packet this build describes, and that check runs BEFORE the
digest. A digest says nothing about whether the bytes it covers describe a packet, so a document
with a filing time reading `09:15` and a provenance badge reading `via carrier pigeon` verifies
perfectly as long as its digest was computed over itself. Measured on the example with those two
edits and the digest recomputed over the result:

```
claimed   : sha256:d83cf1ee1987cd1e754ca18d38ef7d834f9f07dc36ce8cbf3d1bcb25fc867f84
recomputed: sha256:d83cf1ee1987cd1e754ca18d38ef7d834f9f07dc36ce8cbf3d1bcb25fc867f84
```

The digest is real and it matches. The document is not a packet. So the script checks the shape
first, using the same schema the page runs before it seals anything, and prints every problem it
found instead of a digest:

```
packet.json is not a packet this build describes, so the digest was not checked.
A digest over a document like this would only make it look checked.

  filed.at is "09:15", and a filing time has to be a full UTC instant such as 2026-09-01T09:15:00.000Z.
  provenance says damage_zone arrived "via carrier pigeon", and this page writes only via tool, via page, policy, derived.
```

Routes 1 to 3 on this page check the digest and nothing else, and that is the right division. They
exist so you do not have to trust our code, and a schema is our opinion about our own document. If
you want the shape checked too, that is what this script is for.

Use it if you have a clone. If you have only the packet, use routes 1 to 3, which is the situation
this page exists for.

## What has not been checked

These are open. None of them is a pass, and none of them becomes one by being written down.

**OWNER GATED. Nobody outside this project has verified a packet.** Every digest on this page was
produced on the maintainer's machine. Manual step to close it: send a packet and this page to a
person with no connection to this project, ask them to run route 1 and route 2, and record what
they report, with the date and the digest they got.

**OWNER GATED. No second machine has confirmed any of it.** One machine, one Node build, one Python
build. SHA-256 does not vary by machine, so this is unlikely to be where a surprise lives, but it
has not been done. Manual step: run route 1 and route 2 on a second machine with a different
operating system and record both outputs.

**OWNER GATED. The packet checked here came from the module, not from the deployed page.** The
example was built by calling `src/core/packet.js` directly, along the same journey the unit tests
drive. The page assembles the envelope in `src/ui/app.js`, and the readiness gate currently reports
the live URL as not deployed. Manual step: open the live page in a clean browser with no extensions
and no account, work the demonstration claim through to filed, press Copy the JSON, save it, and run
route 1 against it. If the digest verifies, the shipped page and the module agree. Until then, what
is proven is that the module emits a packet that verifies.

If that browser refuses the clipboard write, which a locked down profile and a page inside a frame
both do, the page puts the same JSON on screen in a box under the readable packet. Select it, save
it, and run the same route against it. It is the same string the button would have handed over.

**OWNER GATED. No claims handler has read a packet and said whether they could open a file from
it.** Verifying the digest says the packet is intact. It says nothing about whether the packet is
any use to the person who receives one. The questions that would answer that are written down and
blank, before anyone was approached, in `evidence/handler-review/protocol.md` and its response form.
Nobody has been approached, so that folder is an empty instrument. Manual step: find someone who has
handled motor first notice of loss for an insurer or a broker and has no interest in this entry
placing, send them a packet and this page and nothing else, and commit the form they hand back
without editing it.

**Not applicable, stated so it is not mistaken for missing.** There is no insurer to send a packet
to and no third party service in this system. Every route on this page runs offline, against a file
you already have. Nothing here needs a network.
