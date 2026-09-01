---
name: interview-research
description: Build a traceable interview brief from local knowledge, Xiaohongshu primary sources, and corroborating public interview communities.
---

# Interview research

Use this Skill when the user asks for 面经、面试问题、面试准备，或在完成岗位
简历后请求面试情报。

## Required workflow

1. Read the current job context when company, business unit, role or JD focus is
   not already explicit. Never infer a business unit merely from the company.
2. Call `search_interview_knowledge` first. Reuse relevant captured sources and
   avoid fetching the same URL again. If it returns `ready_for_brief=true`,
   immediately cluster the verified questions and call `build_interview_brief`
   with `ready_source_ids`. Do not stop with a progress or evidence-limitation
   message, and do not recapture those sources.
3. If local evidence is thin, call `discover_interview_sources` with the
   company, precise role and any confirmed business unit. Include semantically
   adjacent `query_terms` when a title is narrow. For example, “AI产品实习生” may
   expand to “AI产品经理实习生” and “AI产品经理”. An exact-title miss is not evidence
   that no posts exist.
4. Xiaohongshu public notes are the primary corpus. Use
   `discover_interview_sources`; it first exhausts relevant Xiaohongshu
   discovery and then discovers readable 牛客、知乎、CSDN sources for
   corroboration. Never use generic `search_web` or `read_web_page` to bypass
   the dedicated capture, quote verification, and persistence pipeline.
   Search-result snippets are not evidence.
5. Discovery results are not evidence. Call `capture_interview_source` for
   every relevant public result; do not stop at an arbitrary count. Continue
   until discovery reports exhaustion, consecutive results are duplicates, or
   platform access protection stops the run. Preserve two Xiaohongshu coverage
   tiers: first the same company + confirmed business unit + functional role,
   then the same company + functional role in another or unspecified business
   unit. Only after Xiaohongshu discovery completes should 牛客、知乎、CSDN
   sources be captured as supplemental corroboration. Four analyzed sources
   including at least one Xiaohongshu source are the minimum for evidence to be
   marked sufficient. A
   one-post brief is allowed only when explicitly marked as limited evidence.
   Public
   `xhslink.com` share links pasted by the user are valid direct inputs. Never
   claim to have read a page that returned login, CAPTCHA, an empty shell,
   404, or another error. Invalid links must not enter the final source list.
   If questions exist only in images, label image evidence as pending OCR.
6. For every captured source, extract only questions supported by a short exact
   quote, then call `analyze_interview_source`. Separate reported interview
   questions from the author's preparation suggestions.
7. Cluster semantically equivalent questions across sources. Call
   `build_interview_brief` with exact source IDs for every cluster. The tool
   computes frequency; never invent counts. One source is one experience; two
   or more independent verified sources may be described as recurring. Every
   question must include a concise `why_it_matters` explanation and a concrete
   `preparation` action so the expanded brief never becomes an empty shell. If no
   readable Xiaohongshu source is available, supplemental websites may still
   support a limited brief, but must never be presented as Xiaohongshu evidence.
8. Recommendations must connect recurring questions to the current JD and the
   user's verified resume facts. Never invent candidate experience.
9. In the final answer, state evidence coverage and limitations, list likely
   question themes, and give concrete preparation actions. List every source
   actually used in newest-first order and include its publication date when
   available. The original post URL is the primary reading action; FetchCV's
   local snapshot is a secondary backup.

Xiaohongshu access is read-only and rate-limited, but it has no fixed post-count
cap. FetchCV may reuse its own encrypted
local Xiaohongshu session when one already exists, but session values must never
enter the model, backend database, logs or exported source links. It must never
request QR login during an Agent task, like, comment, follow, publish, bypass
CAPTCHA, or expose credentials. Persisted local text snapshots remain available
as backup when an original URL later expires.
