/**
 * About section for Settings: wordmark, the real semantic version, a short tagline, and
 * outbound links (docs, Discord, GitHub, releases). Replaces the old single-line attribution
 * footer. Quiet and typographic per the design language; no em dashes in copy.
 */
import { ExternalLink } from 'lucide-react'
import { SectionHeading, SettingsCard } from './primitives'
import { DesktopUpdatesControls } from './DesktopUpdatesPanel'

const LINKS: { label: string; href: string }[] = [
  { label: 'Documentation', href: 'https://github.com/tealios/errata/tree/master/docs' },
  { label: 'Discord community', href: 'https://discord.gg/ywVFKvdH49' },
  { label: 'GitHub repository', href: 'https://github.com/tealios/errata' },
  { label: 'Releases and changelog', href: 'https://github.com/tealios/errata/releases' },
]

export function AboutSection() {
  return (
    <div>
      <SectionHeading label="About" />
      <SettingsCard>
        <div className="flex items-baseline justify-between gap-3 px-3 py-3">
          <div className="min-w-0">
            <p className="font-display text-2xl italic leading-none tracking-tight text-foreground">
              Errata
            </p>
            <p className="mt-1.5 text-[0.625rem] leading-snug text-muted-foreground">
              LLM-assisted writing, built around a fragment system.
            </p>
          </div>
          <span className="shrink-0 font-mono text-[0.6875rem] tabular-nums text-muted-foreground">
            v{__APP_VERSION__}
          </span>
        </div>

        {LINKS.map((link) => (
          <a
            key={link.href}
            href={link.href}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-between gap-3 px-3 py-2 text-[0.75rem] text-foreground/80 transition-colors hover:bg-accent/40 hover:text-foreground"
          >
            {link.label}
            <ExternalLink className="size-3 shrink-0 text-muted-foreground" />
          </a>
        ))}
      </SettingsCard>

      <div className="mt-4">
        <DesktopUpdatesControls />
      </div>

      <p className="mt-2 text-center text-[0.625rem] leading-relaxed text-muted-foreground">
        Built by{' '}
        <a
          href="https://github.com/nokusukun"
          target="_blank"
          rel="noopener noreferrer"
          className="underline transition-colors hover:text-foreground/70"
        >
          nokusukun
        </a>
        {' · '}GPL-2.0
      </p>
    </div>
  )
}
