# Tasks: add-connector-reversecontact

## 1. Drill the vendor surface

- [x] 1.1 Read the public v2 contract from the gateway's own validators and
      its OpenAPI document (2026-10-21, revised 2026-10-27): bodies, URL
      and id patterns, the
      success and error envelopes, the finders' acknowledgement and poll
- [x] 1.2 Pin the rates: 1 per fetch (0 on a miss), 2 per enrichment (0 on
      a miss), 1 per delivered search result, 1 base credit per prompt
      search, 0 for the counts and the availability checks, 3 per professional and 5 per personal email
      kind found, 20 per phone found (debited at submit, settled when the
      result arrives, refunded on a miss)
- [x] 1.3 Establish that every success envelope carries
      `quotas.creditsConsumed`, and that only the finders' poll reports the
      refund, in `data.creditsConsumed`
- [x] 1.4 Measure the finders' completion times on production jobs (30
      days): email p50 16 s, p99 160 s, max 321 s; phone max 30 s

## 2. Provider

- [x] 2.1 `provider.ts`: bearer auth, base URL, timeouts, the `default`
      pool, receipt-reading evidence and consolidate, `output.fromError`
      over the v2 envelope, the bare 410 and a finished job's `errorCode`
- [x] 2.2 Shared fragments in `schema/`: URL and id patterns, pagination,
      People and Organization filters, the finders' body

## 3. Endpoints (15)

- [x] 3.1 Fetch person and company, their availability checks, enrich
      person and company
- [x] 3.2 People Search, count, prompt, lookalike
- [x] 3.3 Organization Search, count, prompt
- [x] 3.4 Email and phone finders, each with the shared lifecycle and the
      job-receipt evidence and consolidate

## 4. Fixtures + tests

- [x] 4.1 28 provider-level chains, `synthetic-` prefixed until recorded
- [x] 4.2 22 replay tests: a literal rate table over the thirteen
      synchronous endpoints, the empty-page zero, a 2xx without its
      receipt failing closed, the checks' free miss, misses and error
      envelopes, estimates, schema gates (patterns, one-of rules, closed
      taxonomies, withheld fields), fn provenance, and the finders' chains
      (found, `any` finding one or both kinds, miss, upstream failure,
      transient poll, a finished job without its receipt, refusal at
      submit, phone finding off)
- [ ] 4.3 Record real chains and run `deno task test:live` once the
      provider key is in the platform's secret store

## 5. Verification

- [x] 5.1 `deno fmt --check` · `deno task lint` · `deno task check` clean
- [x] 5.2 `deno task test`: full suite green
- [x] 5.3 `deno task version:check`: no contract-surface change
- [x] 5.4 `deno task catalog endpoints --provider reversecontact` lists all
      15

## 6. Vendor contract revision (2026-10-27)

- [x] 6.1 Email finder: `emailType` on the body, estimate by kind (3, 5 or
      8 for `any`), copy saying the price follows the emails found
- [x] 6.2 Finders: long poll `?wait=20`, 2 s cadence, 5 s after a failed
      read
- [x] 6.3 People filters: `currentContractType`,
      `excludeCurrentContractType`, `contractType`, `excludeContractType`
      and `schoolName` added, `email` removed
- [x] 6.4 Rate card cited in the provider header and the rate table:
      `https://docs.reversecontact.com/pricing`

## 7. Maintainer review (2026-10-28)

- [x] 7.1 `#v2/fetch/persons/check` and `#v2/fetch/companies/check`: free,
      the fetches' body, a miss answering 200 `exists: false`
- [x] 7.2 Every evidence fn reads its receipt with `utils.json.num`
      (provider, email and phone finders): a 2xx without one fails
      `FN_CONTRACT`
- [x] 7.3 Regression tests for both, failing on the previous
      `optionalNum` reads
