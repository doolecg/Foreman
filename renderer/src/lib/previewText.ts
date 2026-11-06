export type Preview = { lines: string[]; hidden: number; clipped: boolean }

// Display-only: the first `maxLines` lines, each cut to `maxChars`. `hidden` counts the lines left out;
// `clipped` is true when any shown line was cut, so a one-line command that is very long still offers "Show more".
export function previewText(text: string, maxLines: number, maxChars = 120): Preview {
  const all = text.replace(/\r\n?/g, '\n').replace(/\n$/, '').split('\n')
  if (all.length === 1 && all[0] === '') return { lines: [], hidden: 0, clipped: false }
  let clipped = false
  const lines = all.slice(0, maxLines).map((l) => {
    if (l.length <= maxChars) return l
    clipped = true
    // Don't cut a surrogate pair (emoji) in half.
    let end = maxChars - 1
    const c = l.charCodeAt(end - 1)
    if (c >= 0xd800 && c <= 0xdbff) end--
    return l.slice(0, end) + '…'
  })
  return { lines, hidden: Math.max(0, all.length - lines.length), clipped }
}
