"""Explainable job-conditioned ranking, following lexical candidate retrieval.

Policy weights are engineering priors, NOT learned relevance probabilities.
No access/scope or evidence-validation decision may depend on this score.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
import math
import re

from .job_context import context_value

POLICY_VERSION = 'interview-reference-v3'
# Preserve relative relevance weights; evidence availability is reported separately.
WEIGHTS = {k: v / .90 for k, v in {'role': .40, 'organization': .25, 'recency': .15, 'lexical': .10}.items()}
HALF_LIFE_DAYS = 365


def recruitment_type(value):
    """Recognize explicit recruitment labels/titles, not arbitrary JD prose.

    Callers must not pass the whole JD: '有实习经历者优先' is not a job type.
    Ambiguous or absent labels remain unknown. Campus internships are internships.
    """
    text = normalize(value)
    if text in {'internship', 'intern', '实习', '实习生', '暑期实习', '日常实习'} or re.search(r'实习(?!经历|经验)', text):
        return 'internship'
    if text in {'campus', 'graduate', '校招', '校园招聘', '秋招', '春招'} or any(
            term in text for term in ('校招', '校园招聘', '秋招', '春招', '应届生')):
        return 'campus'
    if text in {'social', 'experienced', '社招', '社会招聘'} or any(
            term in text for term in ('社招', '社会招聘')):
        return 'social'
    return ''
COMPANIES = {
    '字节跳动': ('字节跳动', '字节', 'bytedance', 'tiktok', '抖音'),
    '阿里巴巴': ('阿里巴巴', '阿里', '淘宝', '天猫'),
    '去哪儿': ('去哪儿旅行', '去哪儿'), '携程': ('携程', 'trip.com', 'ctrip'),
    '小米': ('小米', 'xiaomi'), '百度': ('百度', 'baidu'), '得物': ('得物', 'dewu'),
    '腾讯': ('腾讯', 'tencent'), '美团': ('美团', 'meituan'),
    '拼多多': ('拼多多', 'pdd'), '理想': ('理想',), '小红书': ('小红书', 'xiaohongshu'),
    '滴滴出行': ('滴滴出行', '滴滴', '青桔'),
}

def normalize(value):
    return re.sub(r'\s+', '', str(value or '')).casefold()

def company_key(value):
    text = normalize(value)
    for key, aliases in COMPANIES.items():
        if text in aliases:
            return key
    return text

def role_family(value):
    text = normalize(value)
    if any(x in text for x in ('产品工程师', 'productengineer')):
        return 'engineering'
    # Product operations must not be mistaken for product management.
    if any(x in text for x in ('产品运营', '内容运营', '策略运营', '运营', '增长投放')):
        return 'operations'
    if any(x in text for x in ('数据分析', '数分', '数据科学', '商业分析', '经营分析')):
        return 'analytics'
    if any(x in text for x in ('产品经理', '产品', '产培生')):
        return 'product'
    if any(x in text for x in ('开发', '算法', '工程师', '测试')):
        return 'engineering'
    return ''


def engineering_specialty(value):
    text = normalize(value)
    for name, terms in (
        ('algorithm', ('算法', '机器学习', '深度学习')),
        ('frontend', ('前端', 'frontend')),
        ('testing', ('测试', 'qa工程师')),
        ('backend', ('后端', '服务端', 'java开发', 'golang')),
        ('embedded', ('嵌入式', '固件')),
    ):
        if any(term in text for term in terms):
            return name
    return ''

def date_score(published_at, *, now, half_life_days=HALF_LIFE_DAYS):
    try:
        date = datetime.fromisoformat(str(published_at or '').replace('Z', '+00:00'))
        if date.tzinfo is None:
            date = date.replace(tzinfo=timezone.utc)
        age = (now - date).total_seconds() / 86400
        if age < 0:
            return .35, None, 'future_date_unverified'
        # Floor retains older conceptual material without presenting it as recent.
        return .25 + .75 * 2 ** (-age / half_life_days), round(age, 2), 'publication_time'
    except (ValueError, TypeError, OverflowError):
        return .35, None, 'unknown'

@dataclass
class RankedInterview:
    hit: object
    ranking: dict

def score_interview(source, *, company, role, business_unit='', lexical_rank=1,
                    preview='', include_other_companies=False, now=None, recruitment_type_target='', target_context=None):
    now = now or datetime.now(timezone.utc)
    if now.tzinfo is None:
        now = now.replace(tzinfo=timezone.utc)
    meta = source.metadata_json or {}
    title = normalize(source.title)
    target = company_key(company)
    aliases = COMPANIES.get(target, (normalize(company),))
    title_companies = {key for key, names in COMPANIES.items() if any(n in title for n in names)}
    requested_scope = meta.get('scope_origin') == 'request_not_verified'
    trusted_company = '' if requested_scope else company_key(source.company)
    title_same = any(normalize(n) in title for n in aliases if n)
    same_company = title_same or (not title_companies and trusted_company == target)
    # A request's company/role tags cannot establish the post's own scope.
    title_family = role_family(source.title)
    source_family = title_family or ('' if requested_scope else role_family(source.role))
    # Confirmed JD context supplies the existing family/specialty checks when
    # an official title is generic. The scoring policy and weights stay fixed.
    function = context_value(target_context, 'function')
    direction = context_value(target_context, 'sub_direction')
    target_family = role_family(function) or role_family(role)
    role_match = bool(target_family and target_family == source_family)
    if not target_family:
        role_match = len(normalize(role)) >= 2 and normalize(role) in title
    target_specialty = engineering_specialty(direction) or engineering_specialty(role)
    source_specialty = engineering_specialty(source.title) or ('' if requested_scope else engineering_specialty(source.role))
    if target_family == 'engineering' and target_specialty and source_specialty and target_specialty != source_specialty:
        role_match = False
    excluded = None
    if not role_match:
        excluded = 'role_not_supported_by_source'
    elif not same_company and not include_other_companies:
        excluded = 'company_not_supported_by_source'
    evidence_text = normalize(f'{source.title} {preview}')
    unit = normalize(business_unit)
    explicit_unit = normalize(source.business_unit) if not requested_scope else ''
    same_unit = bool(same_company and unit and (unit in evidence_text or unit == explicit_unit))
    if same_unit:
        scope, org = 'same_company_department_role', 1.0
    elif same_company and unit and explicit_unit:
        scope, org = 'same_company_other_department_role', .55
    elif same_company:
        scope, org = 'same_company_role_department_unconfirmed', .65 if unit else 1.0
    else:
        scope, org = 'other_company_role_reference_only', .15
    exact_role = len(normalize(role)) >= 2 and normalize(role) in title
    role_value = 1.0 if exact_role else .80 if role_match else 0.0
    freshness, age, date_basis = date_score(source.published_at, now=now)
    # A note ID is a timestamp hint, not verified interview/publication time.
    if meta.get('published_at_basis') == 'note_id_inferred':
        freshness, age, date_basis = .35, None, 'note_id_inferred_unverified'
    quality = .5
    if meta.get('link_status') == 'verified':
        quality += .15
    if source.status == 'analyzed' and source.extracted_questions:
        quality += .25
    if meta.get('extraction') == 'nowcoder-public-ssr':
        quality += .10
    if source.status == 'ocr_pending' or meta.get('image_evidence_pending'):
        quality *= .6
    parts = dict(role=role_value, organization=org, recency=freshness,
                 lexical=1 / (1 + math.log2(max(1, lexical_rank))))
    target_type = recruitment_type(recruitment_type_target)
    source_type = recruitment_type(source.title)
    weights = WEIGHTS
    if target_type:
        # A deliberately small prior, never an eligibility gate. Keep the
        # existing relevance weights in their original proportions.
        weights = {k: v * .95 for k, v in WEIGHTS.items()} | {'recruitment_type': .05}
        parts['recruitment_type'] = 1.0 if target_type == source_type else .5 if not source_type else .25
    score = sum(weights[k] * v for k, v in parts.items()) if not excluded else 0
    return dict(policy=POLICY_VERSION, score=round(score,6), eligible=excluded is None, target_context=target_context or {},
                evidence_availability=dict(score=round(min(1, quality),6), used_in_ranking=False,
                    meaning='availability_only_not_truth_or_independence'),
                exclusion_reason=excluded, scope=scope, components={k:round(v,6) for k,v in parts.items()},
                weights=weights, age_days=age, date_basis=date_basis, half_life_days=HALF_LIFE_DAYS,
                recruitment_type=dict(target=target_type or 'unknown', source=source_type or 'unknown',
                    source_basis='title_explicit_label' if source_type else 'unknown',
                    used_in_ranking=bool(target_type), hard_filter=False),
                role_match_level='exact_title_phrase' if exact_role else 'functional_family_only',
                engineering_specialty=source_specialty or 'unknown',
                department_evidence='source_text_or_curated_field' if same_unit else 'unconfirmed',
                source_scope_basis='source_title' if title_same else 'stored_scope' if same_company else 'other_or_unknown',
                score_meaning='ranking_prior_not_probability_or_truth')

def rank_interviews(hits, *, company, role, business_unit='', include_other_companies=False, now=None,
                    recruitment_type_target='', target_context=None):
    results=[]
    for index,hit in enumerate(hits,1):
        ranking=score_interview(hit.item,company=company,role=role,business_unit=business_unit,
            lexical_rank=index,preview=hit.preview,include_other_companies=include_other_companies,now=now,
            recruitment_type_target=recruitment_type_target, target_context=target_context)
        if ranking['eligible']:
            results.append(RankedInterview(hit,ranking))
    results.sort(key=lambda r:(-r.ranking['score'],r.hit.item.id))
    # One original reposted under multiple URLs should not fill the entire top-k.
    seen=set();unique=[]
    for item in results:
        source = item.hit.item
        identities = {f'hash:{source.content_hash}'} if source.content_hash else set()
        if source.source_url:
            identities.add(f'url:{source.source_url}')
        if identities & seen:
            continue
        seen.update(identities);unique.append(item)
    return unique
