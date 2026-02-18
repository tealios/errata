import { memo, useMemo, type ReactNode, Children, isValidElement, cloneElement } from 'react'
import Markdown from 'react-markdown'

type StreamMarkdownVariant = 'default' | 'prose'

interface StreamMarkdownProps {
  content: string
  streaming?: boolean
  /** Typography variant. "prose" uses serif fonts for the reading experience. */
  variant?: StreamMarkdownVariant
  /** Optional transform applied to text nodes (e.g. for character mention highlighting) */
  textTransform?: (text: string) => ReactNode
}

const variantStyles: Record<StreamMarkdownVariant, {
  root: string
  p: string
  strong: string
  em: string
  ul: string
  ol: string
  li: string
  codeBlock: string
  codeInline: string
  heading: string
  blockquote: string
  hr: string
  cursor: string
  /** Plain text paragraph style used during streaming to avoid costly markdown parsing */
  streamingP: string
}> = {
  default: {
    root: '',
    p: 'mb-2 last:mb-0',
    strong: 'font-semibold',
    em: 'italic',
    ul: 'list-disc pl-4 mb-2 last:mb-0',
    ol: 'list-decimal pl-4 mb-2 last:mb-0',
    li: 'mb-0.5',
    codeBlock: 'block bg-muted/50 rounded px-2 py-1.5 my-1.5 text-[11px] font-mono overflow-x-auto whitespace-pre',
    codeInline: 'bg-muted/50 rounded px-1 py-0.5 text-[11px] font-mono',
    heading: 'font-semibold mb-1',
    blockquote: 'border-l-2 border-border/50 pl-2 my-1.5 text-muted-foreground/70',
    hr: 'border-border/30 my-2',
    cursor: 'inline-block w-0.5 h-[1em] bg-primary/60 animate-pulse ml-px align-text-bottom',
    streamingP: 'mb-2 last:mb-0',
  },
  prose: {
    root: 'prose-content',
    p: 'mb-[0.85em] last:mb-0',
    strong: 'font-semibold',
    em: 'italic',
    ul: 'list-disc pl-6 mb-[0.85em] last:mb-0',
    ol: 'list-decimal pl-6 mb-[0.85em] last:mb-0',
    li: 'mb-1 pl-0.5',
    codeBlock: 'block bg-muted/40 rounded-md px-3 py-2 my-3 text-[12px] font-mono overflow-x-auto whitespace-pre leading-relaxed',
    codeInline: 'bg-muted/40 rounded px-1.5 py-0.5 text-[12px] font-mono',
    heading: 'font-display font-normal text-[1.15em] mb-2 mt-4 first:mt-0',
    blockquote: 'border-l-2 border-primary/20 pl-4 my-4 italic text-foreground/70',
    hr: 'border-border/20 my-6',
    cursor: 'inline-block w-[2px] h-[1.1em] bg-primary/50 animate-pulse ml-0.5 align-text-bottom rounded-full',
    streamingP: 'mb-[0.85em] last:mb-0',
  },
}

/** Recursively apply textTransform to string children in a React node tree */
function processChildren(children: ReactNode, textTransform: (text: string) => ReactNode): ReactNode {
  return Children.map(children, child => {
    if (typeof child === 'string') {
      return textTransform(child)
    }
    if (isValidElement(child) && (child.props as Record<string, unknown>).children) {
      return cloneElement(child, {}, processChildren((child.props as Record<string, unknown>).children as ReactNode, textTransform))
    }
    return child
  })
}

/** Split text into paragraphs on double-newlines for lightweight streaming render */
function StreamingText({ content, className, textTransform }: { content: string; className: string; textTransform?: (text: string) => ReactNode }) {
  const paragraphs = useMemo(() => content.split(/\n\n+/), [content])
  return (
    <>
      {paragraphs.map((p, i) => (
        <p key={`${i}-${p.slice(0, 32)}`} className={className}>
          {textTransform ? textTransform(p) : p}
        </p>
      ))}
    </>
  )
}

/**
 * Markdown renderer optimized for streaming.
 *
 * During streaming (`streaming=true`), renders as plain text split by paragraph
 * breaks — no markdown parsing at all. This avoids O(n²) behavior from
 * react-markdown re-parsing the entire accumulated text on every chunk.
 *
 * When streaming ends, renders the full content through react-markdown once.
 */
export const StreamMarkdown = memo(function StreamMarkdown({
  content,
  streaming,
  variant = 'default',
  textTransform,
}: StreamMarkdownProps) {
  const s = variantStyles[variant]
  const tx = textTransform
    ? (children: ReactNode) => processChildren(children, textTransform)
    : (children: ReactNode) => children

  // During streaming: render as plain text paragraphs (fast, O(n))
  // After streaming: render through markdown parser (once, O(n))
  if (streaming) {
    return (
      <span className={`stream-markdown ${s.root}`}>
        <StreamingText content={content} className={s.streamingP} textTransform={textTransform} />
        <span className={s.cursor} />
      </span>
    )
  }

  return (
    <span className={`stream-markdown ${s.root}`}>
      <Markdown
        components={{
          p: ({ children }) => <p className={s.p}>{tx(children)}</p>,
          strong: ({ children }) => <strong className={s.strong}>{tx(children)}</strong>,
          em: ({ children }) => <em className={s.em}>{tx(children)}</em>,
          ul: ({ children }) => <ul className={s.ul}>{children}</ul>,
          ol: ({ children }) => <ol className={s.ol}>{children}</ol>,
          li: ({ children }) => <li className={s.li}>{tx(children)}</li>,
          code: ({ className, children }) => {
            const isBlock = className?.includes('language-')
            if (isBlock) {
              return <code className={s.codeBlock}>{children}</code>
            }
            return <code className={s.codeInline}>{children}</code>
          },
          pre: ({ children }) => <>{children}</>,
          h1: ({ children }) => <p className={s.heading}>{tx(children)}</p>,
          h2: ({ children }) => <p className={s.heading}>{tx(children)}</p>,
          h3: ({ children }) => <p className={s.heading}>{tx(children)}</p>,
          blockquote: ({ children }) => (
            <blockquote className={s.blockquote}>{tx(children)}</blockquote>
          ),
          hr: () => <hr className={s.hr} />,
        }}
      >
        {content}
      </Markdown>
    </span>
  )
})
