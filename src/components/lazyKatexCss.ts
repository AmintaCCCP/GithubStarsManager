// Side-effect-only module: pulls KaTeX's stylesheet (and its fonts) into the
// async chunk graph so they are fetched only when a document actually contains
// math. Imported dynamically from MarkdownRenderer together with
// remark-math/rehype-katex.
import 'katex/dist/katex.min.css';
