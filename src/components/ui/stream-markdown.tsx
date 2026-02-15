import Markdown from 'react-markdown'

interface StreamMarkdownProps {
  content: string
  streaming?: boolean
}

export function StreamMarkdown({ content, streaming }: StreamMarkdownProps) {
  return (
    <span className="stream-markdown">
      <Markdown
        components={{
          p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
          strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
          em: ({ children }) => <em className="italic">{children}</em>,
          ul: ({ children }) => <ul className="list-disc pl-4 mb-2 last:mb-0">{children}</ul>,
          ol: ({ children }) => <ol className="list-decimal pl-4 mb-2 last:mb-0">{children}</ol>,
          li: ({ children }) => <li className="mb-0.5">{children}</li>,
          code: ({ className, children }) => {
            const isBlock = className?.includes('language-')
            if (isBlock) {
              return (
                <code className="block bg-muted/50 rounded px-2 py-1.5 my-1.5 text-[11px] font-mono overflow-x-auto whitespace-pre">
                  {children}
                </code>
              )
            }
            return (
              <code className="bg-muted/50 rounded px-1 py-0.5 text-[11px] font-mono">
                {children}
              </code>
            )
          },
          pre: ({ children }) => <>{children}</>,
          h1: ({ children }) => <p className="font-semibold mb-1">{children}</p>,
          h2: ({ children }) => <p className="font-semibold mb-1">{children}</p>,
          h3: ({ children }) => <p className="font-semibold mb-1">{children}</p>,
          blockquote: ({ children }) => (
            <blockquote className="border-l-2 border-border/50 pl-2 my-1.5 text-muted-foreground/70">
              {children}
            </blockquote>
          ),
          hr: () => <hr className="border-border/30 my-2" />,
        }}
      >
        {content}
      </Markdown>
      {streaming && (
        <span className="inline-block w-0.5 h-[1em] bg-primary/60 animate-pulse ml-px align-text-bottom" />
      )}
    </span>
  )
}
