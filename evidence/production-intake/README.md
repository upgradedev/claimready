# One query against a production first notice system

**In 285,701 records that the operator classifies as first notices of loss, all five attributes
queried were present.** The five are `occurredDate`, `address`, `driver`, `vehicle` and `policy`.

Measured 2026-09-02 with the operator's permission, inside the account that holds the data, using
the database's own COUNT so that counts came back and **no items at all**. No record was read,
transferred, copied or stored.

## What this does not establish, first, because that is the part that gets misread

**It is not a measurement of completeness.** The query asks whether an attribute EXISTS on a record.
It does not ask whether the value is non-empty, plausible, or correct. A field holding an empty
string counts as present here. So this says nothing about answer quality, and the rate of unusable
answers can only be higher than the zero absences found, never lower.

**It is not that insurer's requirement list.** The five attributes were chosen by us as the ones any
motor first notice must carry. We did not have the operator's own definition of what its intake
requires, and we did not test satisfaction of it. A different set of attributes would give a
different number.

**It is not evidence about ClaimReady.** Nothing here was collected through this project, caused by
it, or compared against it. No causal claim connects the two, and this file makes none.

**It does not generalise.** One operator, one line of business, one tenant, one point in time.

**How records were classified is the operator's, not ours.** A record counts as a first notice when
its `_collectionName` is the operator's own value for one, which is the same classification their
production system uses. We did not re-derive it.

## What it does support

The scale and shape of the domain. A first notice in production carries a date, a location, a
driver, a vehicle and a policy, and it does so across 285,701 records at one operator. Something has
to decide which fields a given policy needs, and at this volume that decision is not a hypothetical.

That is the problem ClaimReady addresses. Whether it addresses it better than any existing intake is
**not measured here**, and the model study that did try to measure something adjacent came out
against this page and is published in `evidence/impact`.

## Method, and what is deliberately withheld

The store is a DynamoDB table in the operator's own AWS account. Two queries ran against a secondary
index, both with `--select COUNT`, which makes the database return counts and no items:

1. how many records under this tenant's case paths the operator classifies as first notices, rather
   than the related records that hang off a case, such as injured parties, third parties and
   services
2. how many of those lack any one of the five attributes, using `attribute_not_exists` joined by
   `OR`

The shape of the second, with the identifiers removed:

```sh
aws dynamodb query \
  --table-name <withheld> --index-name <withheld> --region <withheld> \
  --key-condition-expression "#t = :t AND begins_with(partitionPath, :p)" \
  --filter-expression "#cn = :claims AND (attribute_not_exists(#occurred) OR attribute_not_exists(#addr) OR attribute_not_exists(#drv) OR attribute_not_exists(#veh) OR attribute_not_exists(#pol))" \
  --select COUNT
```

Results, summed over the paged responses:

| | |
|---|---|
| records under this tenant's case paths | 822,260 |
| of those, classified by the operator as first notices | 285,701 |
| first notices lacking at least one of the five attributes | **0** |

**The operator, the table, the index and the region are withheld on purpose.** The permission covers
computing aggregates and publishing them. It does not cover naming a customer, and the volume of an
insurer's claims is their commercial information rather than ours.

## The error this file exists because of

The first version of this measurement reported **65.3% incomplete**, and it was wrong.

The filter matched every record whose path begins with the case prefix. In that store a case holds
several kinds of record: the notice, the injured parties, the third parties, and the services
attached to it. A services record has no driver and no vehicle, correctly, so every one of them
counted as an incomplete first notice.

The number that came out, 65.3%, was almost exactly the share of the population that was not a first
notice at all. It looked like a finding. It was an artefact of the query.

It was caught by asking one more question of the data before publishing anything: how many of these
records does the operator classify as first notices. The answer was 285,701 of 822,260, and once the
filter was narrowed to those, the absences went to zero.

**The wrong number is recorded here beside the right one rather than replaced.** A measurement that
reversed under its own follow-up check is the reason to believe what replaced it, and hiding the
reversal would remove the only thing that makes the second number credible.
