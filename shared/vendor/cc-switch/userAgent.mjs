// CC Switch, copyright (c) 2025 Jason Young. MIT; see ./LICENSE.
// Transpiled from upstream 85ad4969b3399500baaea9d46b1e08f87aba80e1.
function isValidUserAgentHeader(value) {
  const trimmed = value.trim();
  if (trimmed === "") return true;
  return !/[\x00-\x08\x0a-\x1f\x7f]/.test(trimmed);
}
export {
  isValidUserAgentHeader
};
