import Markdown from 'react-markdown'

type StreamMarkdownVariant = 'default' | 'prose'

interface StreamMarkdownProps {
  content: string
  streaming?: boolean
  /** Typography variant. "prose" uses serif fonts for the reading experience. */
  variant?: StreamMarkdownVariant
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
  },
}

export function StreamMarkdown({ content, streaming, variant = 'default' }: StreamMarkdownProps) {
  const s = variantStyles[variant]

  return (
    <span className={`stream-markdown ${s.root}`}>
      <Markdown
        components={{
          p: ({ children }) => <p className={s.p}>{children}</p>,
          strong: ({ children }) => <strong className={s.strong}>{children}</strong>,
          em: ({ children }) => <em className={s.em}>{children}</em>,
          ul: ({ children }) => <ul className={s.ul}>{children}</ul>,
          ol: ({ children }) => <ol className={s.ol}>{children}</ol>,
          li: ({ children }) => <li className={s.li}>{children}</li>,
          code: ({ className, children }) => {
            const isBlock = className?.includes('language-')
            if (isBlock) {
              return <code className={s.codeBlock}>{children}</code>
            }
            return <code className={s.codeInline}>{children}</code>
          },
          pre: ({ children }) => <>{children}</>,
          h1: ({ children }) => <p className={s.heading}>{children}</p>,
          h2: ({ children }) => <p className={s.heading}>{children}</p>,
          h3: ({ children }) => <p className={s.heading}>{children}</p>,
          blockquote: ({ children }) => (
            <blockquote className={s.blockquote}>{children}</blockquote>
          ),
          hr: () => <hr className={s.hr} />,
        }}
      >
        {content}
      </Markdown>
      {streaming && <span className={s.cursor} />}
    </span>
  )
}
