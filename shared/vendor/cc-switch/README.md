# CC Switch source attribution

Source: https://github.com/farion1231/cc-switch

Revision: `85ad4969b3399500baaea9d46b1e08f87aba80e1`

`requestOverrides.mjs` and `userAgent.mjs` are JavaScript transpilations of
`src/lib/requestOverrides.ts` and `src/lib/userAgent.ts`. MIT, copyright
2025 Jason Young; the complete license is included alongside these files.

FetchCV uses the upstream JSON/header validation functions directly. Its own
`shared/provider-settings.mjs` adds Pi/HTTP client restrictions, protected
Agent fields, per-protocol parameter validation and credential masking.
The provider form follows CC Switch's basic/advanced/request-override grouping;
it does not import Claude Code environment settings or CC Switch's Rust proxy.
