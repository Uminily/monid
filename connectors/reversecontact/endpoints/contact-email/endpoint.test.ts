import { assertEquals, assertRejects } from "@std/assert";
import { fromFileUrl } from "@std/path";
import type { Json } from "@shared/core";
import { loadFixture, runEndpoint, testSealedUnit } from "@shared/testing";

const FIXTURES = fromFileUrl(new URL("../../fixtures/", import.meta.url));
const chain = (name: string) => loadFixture(`${FIXTURES}${name}.json`);
const ID = "reversecontact#v2/contact/email";
const asRecord = (value: Json | undefined) =>
    value as Record<string, Json | undefined>;

const URL_BODY = { url: "https://www.linkedin.com/in/janedoe" };

const run = async (fixture: string, body: Record<string, Json> = URL_BODY) =>
    runEndpoint({
        unit: await testSealedUnit(ID),
        input: { body },
        mode: "replay",
        fixture: await chain(fixture),
    });

Deno.test(`${ID} found: the run waits for the job and settles on the job's own receipt, not the poll's quotas`, async () => {
    const result = await run("synthetic-contact-email-found");
    assertEquals(result.httpStatus, 200);
    assertEquals(result.isProviderError, false);
    // the acknowledgement's receipt (3) and the poll's quotas (0) both
    // leave; `data.creditsConsumed` (3, net of refunds) is the bill
    assertEquals(result.usage, {
        credits: { default: 3 },
        evidence: { CREDIT: 3 },
    });
    const output = asRecord(result.output);
    assertEquals("quotas" in output, false);
    const data = asRecord(output.data);
    assertEquals("creditsConsumed" in data, false);
    assertEquals(data.status, "succeeded");
    assertEquals(data.result, [{
        value: "jane.doe@example.com",
        type: "professional",
    }]);
});

Deno.test(`${ID} not found: a refunded job is a 404 with its code and a readable message, zero usage`, async () => {
    const result = await run("synthetic-contact-email-not-found");
    assertEquals(result.httpStatus, 404);
    assertEquals(result.isProviderError, true);
    assertEquals(result.usage, { credits: {}, evidence: {} });
    const output = asRecord(result.output);
    assertEquals(output.code, "email-not-found");
    assertEquals(
        output.message,
        "No email address of the requested kind was found for this person. Nothing was billed.",
    );
    assertEquals("quotas" in asRecord(output.raw), false);
});

Deno.test(`${ID} any, both kinds found: the receipt's 8 settles the run, the extra 3 upstream debited on the result included`, async () => {
    const result = await run("synthetic-contact-email-any-both", {
        ...URL_BODY,
        emailType: "any",
    });
    assertEquals(result.httpStatus, 200);
    assertEquals(result.usage, {
        credits: { default: 8 },
        evidence: { CREDIT: 8 },
    });
    const data = asRecord(asRecord(result.output).data);
    assertEquals(
        (data.result as Array<Record<string, Json>>).map((email) => email.type),
        ["professional", "personal"],
    );
});

Deno.test(`${ID} any, professional only: settles at 3, not at the 5 debited upfront`, async () => {
    const result = await run("synthetic-contact-email-any-professional", {
        ...URL_BODY,
        emailType: "any",
    });
    assertEquals(result.httpStatus, 200);
    assertEquals(result.usage, {
        credits: { default: 3 },
        evidence: { CREDIT: 3 },
    });
});

Deno.test(`${ID} upstream failure: fetch-data-error is a retriable 502, zero usage`, async () => {
    const result = await run("synthetic-contact-fetch-error");
    assertEquals(result.httpStatus, 502);
    assertEquals(result.isProviderError, true);
    assertEquals(result.usage, { credits: {}, evidence: {} });
    assertEquals(asRecord(result.output).code, "fetch-data-error");
});

Deno.test(`${ID} a 503 on the poll holds the run open; the next read settles it`, async () => {
    const result = await run("synthetic-contact-poll-transient");
    assertEquals(result.httpStatus, 200);
    assertEquals(result.usage, {
        credits: { default: 3 },
        evidence: { CREDIT: 3 },
    });
});

Deno.test(`${ID} a finished job without its receipt fails closed (FN_CONTRACT), never a zero bill`, async () => {
    // the phone finder's evidence is the same interned fn (provider.test.ts)
    await assertRejects(
        () => run("synthetic-contact-receipt-missing"),
        Error,
        "FN_CONTRACT",
    );
});

Deno.test(`${ID} refused at submit (402): settles at once, zero usage, no poll`, async () => {
    const result = await run("synthetic-insufficient-credits");
    assertEquals(result.httpStatus, 402);
    assertEquals(result.isProviderError, true);
    assertEquals(result.usage, { credits: {}, evidence: {} });
    assertEquals(asRecord(result.output).code, "INSUFFICIENT_CREDITS");
});

Deno.test(`${ID} budget: 10 minutes, past the slowest production job (321 s), read every 2 s as upstream's Retry-After asks`, async () => {
    const unit = await testSealedUnit(ID);
    assertEquals(unit.doc.timeouts, {
        requestMs: 35_000,
        runMs: 600_000,
        pollMs: 2_000,
    });
});
