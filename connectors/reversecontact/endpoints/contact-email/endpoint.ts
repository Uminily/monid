import { defineEndpoint, Unit, UsageModelKind } from "@shared/core";
import { zContactEmailBody } from "./schema/inputs.ts";

/**
 * POST /v2/contact/email: a person's professional or personal email
 * addresses.
 *
 * ASYNCHRONOUS UPSTREAM. The submit answers a job acknowledgement
 * (`data.webhookId`) and debits at once: 3 credits for a `professional`
 * lookup (the default), 5 for `personal` and `any`. The result is read from
 * `GET /v2/webhooks/{webhookId}` (free, not rate limited), whose
 * `data.status` goes `created` / `in_progress` to `succeeded` or `errored`.
 * The lifecycle long-polls it (`?wait=20`: upstream answers as soon as the
 * job ends, or after 20 s with the job still running), so one run returns
 * the finished lookup.
 *
 * THE POLL'S RECEIPT SETTLES THE RUN. The price follows the emails found,
 * not `emailType`: 3 credits for a professional email, 5 for a personal
 * one, each kind billed once, so an `any` lookup costs 3, 5 or 8, the 8 only
 * when it finds both. Upstream settles the upfront debit when the result
 * arrives (a miss refunded, an `any` refunded 2 or debited 3 more), and the
 * submit's receipt never shows it: only the poll's `data.creditsConsumed`
 * is net of it, and final once the job ends. So this endpoint (and
 * `contact/phone`, with byte-identical fns) overrides the provider's
 * evidence and consolidate to read that figure.
 *
 * A job that ends `errored` settles as a provider error, zero-billed, as
 * upstream refunds it: `*-not-found` is a 404, `invalid-request` a 400,
 * `fetch-data-error` (safe to retry) and anything unknown a 502.
 *
 * BUDGET. Over 38,398 production jobs (30 days to 2026-10-21), completion
 * took 16 s at the median, 100 s at p95, 160 s at p99 and 321 s at most.
 * `runMs` is 10 minutes. A run abandoned past it settles at zero while the
 * job may still bill upstream, so the budget is set well past the worst
 * case observed. `pollMs` is the 2 s upstream's `Retry-After` asks for
 * between two reads of a running job.
 */
export default defineEndpoint({
    meta: {
        displayName: "Find Email",
        summary: "Find a person's professional or personal email address " +
            "from their LinkedIn URL, or their name and company domain.",
        description: "Find a person's email addresses from their LinkedIn " +
            "profile URL, or from their name (`fullName`, or `firstName` " +
            "and `lastName`) with their company domain. `emailType` " +
            "chooses the kind: `professional` (the default), `personal`, " +
            "or `any` for either. The lookup runs asynchronously " +
            "upstream, typically in 15 seconds and rarely over 3 minutes; " +
            "this endpoint waits for it and returns the finished result: " +
            "`data.result` lists the addresses found as `{value, type}`, " +
            "`type` being `professional` or `personal`. Built for " +
            "outreach and for completing a known person into a reachable " +
            "address. Billed on the emails found, not on `emailType`: 3 " +
            "credits for a professional email, 5 for a personal one, each " +
            "kind billed once, so an `any` lookup costs 3, 5 or 8 (the 8 " +
            "only when it finds both). No address found answers 404 and " +
            "costs nothing.",
        docsUrl: "https://docs.reversecontact.com/endpoints/contact-email",
        categories: ["people-enrichment"],
        notes: [
            "A miss is a 404 with `code` `email-not-found` or " +
            "`person-not-found`, free.",
            "Upstream checks before the lookup that the account could pay " +
            "its most expensive result (3 credits for `professional`, 5 " +
            "for `personal`, 8 for `any`): a balance check, not the price.",
        ],
    },
    request: { method: "POST", path: "/v2/contact/email" },
    input: { schema: { body: zContactEmailBody } },
    timeouts: { requestMs: 35_000, runMs: 600_000, pollMs: 2_000 },
    lifecycle: {
        start: async ({ utils }) => {
            const res = await utils.request();
            if (res.status < 200 || res.status >= 300) {
                return {
                    kind: "COMPLETED",
                    httpStatus: res.status,
                    output: res.body,
                };
            }
            const webhookId = utils.json.optionalGet(
                res.body,
                "$.data.webhookId",
            );
            if (typeof webhookId !== "string" || webhookId === "") {
                throw Object.assign(
                    new Error("Reverse Contact submit returned no webhookId"),
                    { retriable: false },
                );
            }
            return { kind: "RUNNING", state: { externalRunId: webhookId } };
        },
        poll: async ({ data, utils }) => {
            const webhookId = data.lifecycle.state.externalRunId;
            if (webhookId === undefined) {
                throw Object.assign(
                    new Error("Reverse Contact poll without a webhookId"),
                    { retriable: false },
                );
            }
            // Long poll: upstream holds the read up to 20 s while the job
            // runs and answers as soon as it ends.
            const res = await utils.http({
                method: "GET",
                path: "/v2/webhooks/" + encodeURIComponent(webhookId),
                queryParams: { wait: "20" },
            });
            // A lookup that failed, not a job that ended: read again, later.
            if (res.status === 408 || res.status === 429 || res.status >= 500) {
                return { kind: "RUNNING", pollAfterMs: 5_000 };
            }
            if (res.status < 200 || res.status >= 300) {
                return {
                    kind: "COMPLETED",
                    httpStatus: res.status,
                    output: res.body,
                };
            }
            const status = utils.json.optionalGet(res.body, "$.data.status");
            if (status === "succeeded") {
                return { kind: "COMPLETED", httpStatus: 200, output: res.body };
            }
            if (status === "errored") {
                const code = utils.json.optionalGet(
                    res.body,
                    "$.data.errorCode",
                );
                const miss = code === "email-not-found" ||
                    code === "phone-not-found" ||
                    code === "person-not-found" || code === "data-not-found";
                return {
                    kind: "COMPLETED",
                    httpStatus: miss
                        ? 404
                        : code === "invalid-request"
                        ? 400
                        : 502,
                    providerHttpStatus: res.status,
                    output: res.body,
                };
            }
            return { kind: "RUNNING" };
        },
    },
    usage: {
        model: {
            kind: UsageModelKind.PER_UNIT,
            unit: Unit.CREDIT,
            consumes: { credit: "default", amount: 1 },
            label: "email lookup",
            description: "Reverse Contact credits net of refunds, as the " +
                "job's receipt reports them: 3 for a professional email " +
                "found, 5 for a personal one",
        },
        /** The ceiling: the most this lookup's `emailType` can cost. */
        estimate: ({ data }) => ({
            counts: {
                CREDIT: data.input.body.emailType === "any"
                    ? 8
                    : data.input.body.emailType === "personal"
                    ? 5
                    : 3,
            },
        }),
        /** The job's own receipt, net of refunds. */
        evidence: ({ data, utils }) => {
            const consumed = utils.json.optionalNum(
                data.output,
                "$.data.creditsConsumed",
            );
            return {
                counts: consumed === undefined ? {} : { CREDIT: consumed },
            };
        },
        /** The same receipt as the claim, lifted out with the poll's own
         *  `quotas` block (the account's balance, and a 0 for the poll). */
        consolidate: ({ data, utils }) => {
            const withoutQuotas = utils.json.pluck(data.output, "$.quotas")
                .rest;
            const { value, rest } = utils.json.pluck(
                withoutQuotas,
                "$.data.creditsConsumed",
            );
            return {
                credits: {
                    ...(typeof value === "number" && value > 0
                        ? { default: value }
                        : {}),
                },
                output: rest,
            };
        },
    },
});
