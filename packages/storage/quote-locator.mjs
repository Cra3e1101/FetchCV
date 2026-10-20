// Exact matching only. A located quote proves a byte-backed text occurrence,
// not that the quote entails a claim. Offsets use Unicode code points.
export function locateUniqueQuote(text, quote) {
  if (typeof text !== 'string' || typeof quote !== 'string' || !quote.trim() || quote.length > 100000) return { state: 'unresolved', reason: 'invalid_quote' };
  const index = text.indexOf(quote);
  if (index < 0) return { state: 'unresolved', reason: 'quote_not_found' };
  if (text.indexOf(quote, index + 1) >= 0) return { state: 'unresolved', reason: 'ambiguous_quote' };
  const start = [...text.slice(0, index)].length;
  return { state: 'located', start, end: start + [...quote].length, offsetUnit: 'unicode_codepoint' };
}
