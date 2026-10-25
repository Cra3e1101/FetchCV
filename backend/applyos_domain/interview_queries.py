"""Bounded, inspectable JD query expansion; never treats JD text as instructions."""
from __future__ import annotations

import re

VERSION = "jd-query-v1"
# Small explicit alias lexicon, not a semantic model. Every expansion records
# the literal JD span that triggered it; unknown terms remain an open limitation.
ALIASES = (
    ("多模态", "VLM", "视觉语言模型"), ("大语言模型", "LLM", "大模型"),
    ("检索增强", "RAG"), ("智能体", "Agent"), ("微调", "SFT"),
    ("数据分析", "数分"), ("用户研究", "用户调研"),
    ("需求分析", "需求挖掘"), ("用户增长", "增长策略"),
    ("内容运营", "内容策划"), ("市场传播", "品牌传播"),
    ("推荐系统", "推荐算法"), ("计算机视觉", "CV"),
    ("自然语言处理", "NLP"), ("SQL",), ("Python",), ("C++",),
    ("A/B测试", "AB测试", "实验设计"), ("转化率",), ("留存",),
)


def jd_query_plan(jd_text: str = "", title: str = "", *, context_json: dict | None = None) -> dict:
    # Preserve offsets into the original string. Bound work, not a prompt budget.
    full_body = str(jd_text or "")[:40000]
    body = full_body[:30000]
    features = []
    for aliases in ALIASES:
        for term in aliases:
            pattern = re.escape(term)
            if term.isascii():
                pattern = r"(?<![A-Za-z0-9])" + pattern + r"(?![A-Za-z0-9])"
            match = re.search(pattern, body, re.I)
            if match:
                features.append({"term": term, "span": [match.start(), match.end()],
                                 "quote": match.group(), "aliases": list(aliases)})
                break
    features.sort(key=lambda item: item["span"][0])
    features = features[:8]
    from .job_context import normalize_context, context_value
    context = normalize_context(context_json, full_body)
    context_terms = [context_value(context, key) for key in ("function", "sub_direction", "business_unit")]
    kind = context_value(context, "recruitment_type")
    if kind:
        context_terms.append({"campus": "校招", "internship": "实习", "social": "社招"}[kind])
    return {"version": VERSION, "jd_present": bool(body.strip()), "job_context": context,
            "title": str(title or "")[:240], "features": features,
            "terms": list(dict.fromkeys([term for term in context_terms if term] + [f["term"] for f in features] + [t for f in features for t in f["aliases"]])),
            "method": "bounded_literal_aliases_not_semantic_extraction"}


def jd_topic_coverage(jd_text, sources):
    """Lexical topic observations, never proof of requirement/competency coverage."""
    plan = jd_query_plan(jd_text)
    topics = []
    for feature in plan['features']:
        ids = []
        for source in sources:
            body = source.raw_text or ''
            quotes = [q.get('evidence_quote', '') for q in source.extracted_questions or []
                      if q.get('evidence_quote') and q['evidence_quote'] in body]
            if any(term.casefold() in quote.casefold() for term in feature['aliases'] for quote in quotes):
                ids.append(source.id)
        topics.append({**feature, 'source_ids':ids,
                       'status':'lexical_evidence_found' if ids else 'not_observed'})
    return {'topics':topics, 'coverage_verified':False, 'basis':'verified_quotes_literal_alias_match',
            'limitations':'词法命中不证明JD要求已覆盖；未提取的要求、语义对应和用户经历缺口仍需核验'}
