# Controlled Web Tools

Updated: 2026-07-19

FetchCV exposes three public-web capabilities through `ToolGateway`: `search_web`, `read_web_page` and `import_job_posting`. The model never receives a raw HTTP client or the Claude SDK WebFetch tool.

## Request boundary

- HTTPS only by default; HTTP requires an explicit development override.
- URL credentials, localhost, `.local`, private, loopback, link-local, reserved and non-global addresses are rejected.
- Only ports 80 and 443 are accepted.
- Every redirect target is resolved and checked again.
- Environment proxy variables are ignored.
- Timeout is bounded and decoded responses are capped at 2 MB.
- Supported content types are HTML, XHTML, plain text and JSON.
- Common credential-like query parameters are removed before URLs enter business data or Trace.

These checks reduce SSRF risk for a local sidecar. They are not a browser sandbox and do not execute page JavaScript.

## Search

The default provider order is Bing followed by DuckDuckGo. `FETCHCV_WEB_SEARCH_ENDPOINT` may contain one or more comma-separated HTTPS search endpoints. Search results are extracted only from provider result containers and internal provider links are discarded. Every returned target URL passes the same public-address policy.

## Recruiting pages

The importer prefers Schema.org `JobPosting` JSON-LD and extracts title, hiring organization, location, description and posting dates. Static visible text is the fallback. A successful import updates the Job source fields and stores a `job_posting_page` MaterialAsset with URL and SHA-256 provenance.

If the Job already contains different JD text, the Agent creates a `replace_job_description` approval and pauses. It can overwrite only after the approval is persisted and the Run resumes.

## Dynamic pages and unsupported pages

The HTTP adapter does not execute page JavaScript. When a public recruiting page is client-rendered, FetchCV may hand it to the Electron-controlled browser bridge, keep the page inside the Agent window and read the visible result. Login-only sites, CAPTCHA and aggressive anti-bot systems pause for explicit user action; FetchCV does not bypass challenges or return cookies to the model.
