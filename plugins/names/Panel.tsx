import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import type { PluginPanelProps } from '@/lib/plugin-panels'

const THEMES = ['fantasy', 'scifi', 'historical'] as const
const GENDERS = ['male', 'female', 'neutral'] as const

interface GeneratedName {
  name: string
  theme: string
  gender: string
}

export function NamesPanel(_props: PluginPanelProps) {
  const [theme, setTheme] = useState<string>('fantasy')
  const [gender, setGender] = useState<string>('neutral')
  const [result, setResult] = useState<GeneratedName | null>(null)
  const [history, setHistory] = useState<GeneratedName[]>([])
  const [loading, setLoading] = useState(false)
  const [copied, setCopied] = useState<string | null>(null)

  const handleGenerate = async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/plugins/names/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ theme, gender }),
      })
      if (!res.ok) throw new Error('Failed to generate')
      const data: GeneratedName = await res.json()
      setResult(data)
      setHistory((prev) => [data, ...prev].slice(0, 10))
    } finally {
      setLoading(false)
    }
  }

  const handleCopy = async (name: string) => {
    await navigator.clipboard.writeText(name)
    setCopied(name)
    setTimeout(() => setCopied(null), 1500)
  }

  return (
    <div className="flex flex-col h-full p-3 gap-3">
      <p>
        Generate character names based on selected themes and genders.
        The tools are registered and will be automatically included in the context for relevant generations.
      </p>
      {/* Theme selector */}
      <div>
        <label className="text-xs text-muted-foreground mb-1 block">Theme</label>
        <div className="flex gap-1">
          {THEMES.map((t) => (
            <Button
              key={t}
              size="sm"
              variant={theme === t ? 'default' : 'outline'}
              className="flex-1 text-xs capitalize"
              onClick={() => setTheme(t)}
            >
              {t}
            </Button>
          ))}
        </div>
      </div>

      {/* Gender selector */}
      <div>
        <label className="text-xs text-muted-foreground mb-1 block">Gender</label>
        <div className="flex gap-1">
          {GENDERS.map((g) => (
            <Button
              key={g}
              size="sm"
              variant={gender === g ? 'default' : 'outline'}
              className="flex-1 text-xs capitalize"
              onClick={() => setGender(g)}
            >
              {g}
            </Button>
          ))}
        </div>
      </div>

      {/* Generate button */}
      <Button onClick={handleGenerate} disabled={loading} className="w-full">
        {loading ? 'Generating...' : 'Generate Name'}
      </Button>

      {/* Result */}
      {result && (
        <div className="flex items-center justify-between rounded-md border p-2">
          <span className="font-medium">{result.name}</span>
          <Button
            size="sm"
            variant="ghost"
            className="text-xs"
            onClick={() => handleCopy(result.name)}
          >
            {copied === result.name ? 'Copied!' : 'Copy'}
          </Button>
        </div>
      )}

      {/* History */}
      {history.length > 0 && (
        <div className="flex-1 min-h-0">
          <label className="text-xs text-muted-foreground mb-1 block">History</label>
          <ScrollArea className="h-full">
            <div className="space-y-1">
              {history.map((item, i) => (
                <div
                  key={`${item.name}-${item.theme}-${item.gender}`}
                  role="button"
                  tabIndex={0}
                  className="flex items-center justify-between rounded px-2 py-1 text-sm hover:bg-muted/50 cursor-pointer"
                  onClick={() => handleCopy(item.name)}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleCopy(item.name) } }}
                >
                  <span>{item.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {copied === item.name ? 'Copied!' : `${item.theme}/${item.gender}`}
                  </span>
                </div>
              ))}
            </div>
          </ScrollArea>
        </div>
      )}
    </div>
  )
}
