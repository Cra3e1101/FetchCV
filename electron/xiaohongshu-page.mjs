// Self-contained: this function is serialized into the sandboxed renderer.
// Only visible access UI can interrupt a note read; interview prose is evidence,
// even when it discusses login, CAPTCHA, or security interview questions.
export function inspectXiaohongshuPage(document, { isNote, text = "", imageCount = 0, hasExactNote = false, hasCandidates = false, loggedIn = false } = {}) {
  const visible = node => Boolean(node && (node.getClientRects().length || node.offsetWidth || node.offsetHeight));
  const content = node => String(node?.innerText || node?.textContent || "").replace(/\s+/g, " ").trim();
  const inContent = node => Boolean(node.closest('#detail-desc, .note-content, .note-text, .comment-item, .comment-list, .note-item'));
  const matches = selector => Array.from(document.querySelectorAll(selector)).filter(node => visible(node) && !inContent(node));
  const captcha = matches('iframe[src*="captcha" i], [class*="captcha" i], [id*="captcha" i]').length > 0
    || matches('[class*="verify" i], [role="dialog"]').some(node => /验证码|人机验证|安全验证|完成验证|captcha|verify you are human|security check/i.test(content(node)));
  const loginWords = /登录后查看|扫码登录|手机号登录|登录即可|请先登录|登录后推荐|登录探索/;
  const login = matches('[class*="login-container" i], [class*="login-modal" i], [class*="login-mask" i], [role="dialog"]')
    .some(node => loginWords.test(content(node)));
  // Retain text-only login/error pages without letting a note title dismiss a
  // visible login overlay. A simple header Login button is not an access wall.
  const emptyLogin = !hasExactNote && !hasCandidates && !text.trim() && loginWords.test(content(document.body));
  const rateLimited = matches('[class*="error" i], [role="alert"], [role="dialog"]')
    .some(node => /访问频繁|访问异常|操作频繁|请求过于频繁|稍后再试/.test(content(node)));
  const userAction = captcha ? "captcha" : rateLimited ? "rate_limited" : login || emptyLogin ? "login" : "";
  const noteReady = Boolean(isNote && !userAction && text.length >= 80
    && /面经|面试|一面|二面|三面|终面|HR面|面试官|复盘|问题|追问|自我介绍|case|群面/i.test(text));
  // Image notes and short notes have finished loading too. This is deliberately
  // separate from noteReady: their body still needs OCR/content validation.
  const ready = Boolean(isNote && !userAction && (noteReady || (hasExactNote && (text.trim() || imageCount > 0)) || imageCount > 0));
  const accountSessionConfirmed = !userAction && (loggedIn === true
    || matches('a[href*="/user/profile/"]').some(node => /^(我|个人主页|我的主页)$/.test(content(node))));
  return { captcha, login: login || emptyLogin, userAction, noteReady, ready, accountSessionConfirmed };
}
