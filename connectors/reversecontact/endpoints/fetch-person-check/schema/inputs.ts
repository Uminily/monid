/** POST /v2/fetch/persons/check body: the vendor's `UrlOrIdPersonBody`,
 *  the very body of `POST /v2/fetch/persons` (`url`, `id`, or both; `id`
 *  wins). */
export { zFetchPersonBody as zCheckPersonBody } from "../../fetch-person/schema/inputs.ts";
