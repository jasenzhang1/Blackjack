import katex from 'katex';
import 'katex/dist/katex.min.css';
import { useMemo } from 'react';

/** Renders a LaTeX formula with KaTeX (inline by default, `block` for display math). */
export function TeX({ children, block = false }: { children: string; block?: boolean }) {
  const html = useMemo(() => katex.renderToString(children, { displayMode: block, throwOnError: false, strict: false }), [children, block]);
  if (block) return <div className="tex-block" dangerouslySetInnerHTML={{ __html: html }} />;
  return <span dangerouslySetInnerHTML={{ __html: html }} />;
}
