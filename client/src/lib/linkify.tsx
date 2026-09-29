import type { ReactNode } from "react";

// http(s) URLs, www. hosts, and bare hosts with a path or a common TLD (patreon.com/x, reddit.com/u/x, ko-fi.com/x)
const URL_RE = /((?:https?:\/\/|www\.)[^\s<>"']+|(?<![\w@.\/])[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|net|org|io|me|co|to|gg|fm|tv|app|xyz|link|page|social|art|audio|blog|shop|store|uk|au|ca|de|fr|nl|es|it|se|nz|us)(?:\/[^\s<>"']*)?)/gi;

/** Plain text with URLs turned into safe outbound links. Trailing punctuation stays outside the link. */
export function linkify(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0, i = 0;
  for (const m of text.matchAll(URL_RE)) {
    let url = m[0];
    let trail = "";
    // don't swallow sentence punctuation or an unbalanced closing bracket
    for (;;) {
      const t = url.at(-1);
      if (t && ".,;:!?'\"".includes(t)) { trail = t + trail; url = url.slice(0, -1); continue; }
      if (t === ")" && (url.match(/\(/g)?.length ?? 0) < (url.match(/\)/g)?.length ?? 0)) { trail = t + trail; url = url.slice(0, -1); continue; }
      break;
    }
    const start = m.index!;
    if (start > last) out.push(text.slice(last, start));
    const href = /^https?:\/\//i.test(url) ? url : `https://${url}`;
    out.push(<a key={i++} href={href} target="_blank" rel="noopener nofollow noreferrer ugc" className="text-accent-2 hover:underline break-all">{url}</a>);
    if (trail) out.push(trail);
    last = start + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}
