/** POST /v2/fetch/companies/check body: the vendor's `UrlOrIdCompanyBody`,
 *  the very body of `POST /v2/fetch/companies` (`url`, `id`, or both; `id`
 *  wins). */
export { zFetchCompanyBody as zCheckCompanyBody } from "../../fetch-company/schema/inputs.ts";
