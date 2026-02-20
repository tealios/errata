import type { ReactNode } from 'react'

export interface HelpSubsection {
  id: string
  title: string
  content: ReactNode
}

export interface HelpSection {
  id: string
  title: string
  description: string
  subsections: HelpSubsection[]
}

function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex items-center px-1.5 py-0.5 rounded border border-border/40 bg-muted/40 text-[10px] font-mono font-medium text-foreground/60 leading-none">
      {children}
    </kbd>
  )
}

function ToolCard({ name, description }: { name: string; description: string }) {
  return (
    <div className="rounded-md border border-border/25 bg-accent/15 px-3 py-2.5 mb-2 last:mb-0">
      <code className="text-[11.5px] font-mono font-medium text-primary/80">{name}</code>
      <p className="text-[11.5px] text-muted-foreground mt-0.5 leading-snug">{description}</p>
    </div>
  )
}

function Tip({ children }: { children: ReactNode }) {
  return (
    <div className="border-l-2 border-primary/25 pl-3 py-1.5 my-2.5">
      <p className="text-[11.5px] text-foreground/55 leading-relaxed italic">{children}</p>
    </div>
  )
}

function P({ children }: { children: ReactNode }) {
  return <p className="text-[12.5px] text-foreground/65 leading-relaxed mb-2.5 last:mb-0">{children}</p>
}

function Mono({ children }: { children: ReactNode }) {
  return <code className="text-[11px] font-mono text-primary/70 bg-primary/5 px-1 py-0.5 rounded">{children}</code>
}

export const HELP_SECTIONS: HelpSection[] = [
  {
    id: 'generation',
    title: 'Generation',
    description: 'How Errata generates prose continuations using your fragments and model tools.',
    subsections: [
      {
        id: 'overview',
        title: 'How it works',
        content: (
          <>
            <P>
              When you generate, Errata assembles your story context — prose history, sticky fragments,
              and shortlists — into a prompt, then streams a continuation from the model.
            </P>
            <P>
              The pipeline follows this sequence: your author input is combined with the story context,
              plugin hooks run (if any), the model generates text using available tools, and the output
              is streamed back to you in real time.
            </P>
            <Tip>
              The model sees your sticky fragments in full and non-sticky fragments as one-line shortlists.
              Use the <Mono>sticky</Mono> toggle on fragments to control what the model always sees.
            </Tip>
          </>
        ),
      },
      {
        id: 'context-building',
        title: 'Context building',
        content: (
          <>
            <P>
              When you hit Generate, Errata assembles a prompt from your story's fragments and sends
              it to the model. This happens in a specific sequence — understanding it helps you control
              what the model sees and how it writes.
            </P>

            <div className="mt-3 mb-3">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-2">The pipeline</p>
              <div className="space-y-1.5">
                {[
                  ['1', 'Load fragments', 'All fragments are loaded and sorted by type — prose, guidelines, characters, knowledge.'],
                  ['2', 'Apply context limit', 'Recent prose is selected from the chain based on your Context Limit setting (fragment count, token budget, or character budget).'],
                  ['3', 'Split sticky / non-sticky', 'Sticky fragments go in full. Non-sticky become one-line shortlist entries (ID, name, description).'],
                  ['4', 'Plugin beforeContext hooks', 'Enabled plugins can modify the context state — adding, removing, or reordering fragments before they\'re rendered.'],
                  ['5', 'Assemble messages', 'Everything is rendered into a system message and a user message.'],
                  ['6', 'Plugin beforeGeneration hooks', 'Plugins get a final chance to modify the assembled messages before they\'re sent.'],
                  ['7', 'Stream to model', 'The prompt is sent. The model can call tools (if enabled) to look up fragments, then writes prose.'],
                  ['8', 'Save & analyze', 'Output is saved as a new prose fragment, plugin afterGeneration/afterSave hooks run, and the librarian is triggered.'],
                ].map(([num, label, desc]) => (
                  <div key={num} className="flex gap-2.5 items-start">
                    <span className="shrink-0 w-4 h-4 rounded-full bg-foreground/8 text-[9px] font-mono font-bold text-foreground/40 flex items-center justify-center mt-0.5">{num}</span>
                    <div className="min-w-0">
                      <span className="text-[12px] font-medium text-foreground/70">{label}</span>
                      <p className="text-[11px] text-muted-foreground leading-snug">{desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="mt-4 mb-1">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-2">What the model sees</p>
            </div>
            <P>
              The final prompt is two messages. The <strong className="text-foreground/75">system message</strong> contains
              writing instructions, the list of available tools, and any sticky fragments placed
              in <Mono>system</Mono> position. The <strong className="text-foreground/75">user message</strong> contains,
              in order:
            </P>
            <div className="rounded-md border border-border/25 bg-accent/10 px-3 py-2.5 mb-2.5 space-y-0.5">
              {[
                'Story name and description',
                'Rolling summary (maintained by the librarian)',
                'Sticky fragments (user-placed) — full content',
                'Non-sticky shortlists — one-line per fragment',
                'Recent prose from the chain (context-limited)',
                'Your author input',
              ].map((item, i) => (
                <p key={item} className="text-[11.5px] text-foreground/55 leading-snug">
                  <span className="text-muted-foreground mr-1.5">{i + 1}.</span>{item}
                </p>
              ))}
            </div>

            <Tip>
              Use the Debug panel to see exactly what was sent for any generation — the Prompt tab
              shows both messages in full.
            </Tip>
          </>
        ),
      },
      {
        id: 'built-in-tools',
        title: 'Built-in tools',
        content: (
          <>
            <P>
              The model can call tools during generation to look up fragment details before writing prose.
              Enable or disable individual tools in <strong className="text-foreground/75">Settings</strong>.
            </P>

            <div className="mt-3 mb-1">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-2">Read tools</p>
              <ToolCard
                name="getFragment(id)"
                description="Retrieve full content of any fragment by its ID. Works across all types."
              />
              <ToolCard
                name="listFragments(type?)"
                description="List fragments with their ID, type, name, and description. Optionally filter by type."
              />
              <ToolCard
                name="searchFragments(query, type?)"
                description="Full-text search across all fragment content. Returns matching IDs and excerpts."
              />
              <ToolCard
                name="listFragmentTypes()"
                description="List all registered fragment types with their prefix and defaults."
              />
            </div>

            <div className="mt-4 mb-1">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-2">Type-specific aliases</p>
              <P>
                For each registered fragment type, the model also gets dedicated aliases:
              </P>
              <div className="rounded-md border border-border/25 bg-accent/15 px-3 py-2.5 mb-2">
                <div className="space-y-1">
                  <p className="text-[11px] font-mono text-foreground/55">
                    <span className="text-primary/70">getCharacter</span>(id), <span className="text-primary/70">listCharacters</span>()
                  </p>
                  <p className="text-[11px] font-mono text-foreground/55">
                    <span className="text-primary/70">getGuideline</span>(id), <span className="text-primary/70">listGuidelines</span>()
                  </p>
                  <p className="text-[11px] font-mono text-foreground/55">
                    <span className="text-primary/70">getKnowledge</span>(id), <span className="text-primary/70">listKnowledge</span>()
                  </p>
                  <p className="text-[11px] font-mono text-foreground/55">
                    <span className="text-primary/70">getProse</span>(id), <span className="text-primary/70">listProse</span>()
                  </p>
                </div>
              </div>
            </div>

            <div className="mt-4 mb-1">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-2">Write tools (librarian only)</p>
              <P>
                These are available to the librarian agent but not during regular generation:
              </P>
              <ToolCard name="createFragment(type, name, description, content)" description="Create a new fragment of any type." />
              <ToolCard name="updateFragment(id, content, description)" description="Overwrite a fragment's content entirely." />
              <ToolCard name="editFragment(id, oldText, newText)" description="Search-and-replace within a fragment's content." />
              <ToolCard name="editProse(oldText, newText)" description="Search-and-replace across all active prose in the chain." />
              <ToolCard name="deleteFragment(id)" description="Permanently delete a fragment." />
            </div>
          </>
        ),
      },
      {
        id: 'output-format',
        title: 'Output format',
        content: (
          <>
            <P>
              Choose between <Mono>plaintext</Mono> and <Mono>markdown</Mono> output in Settings.
            </P>
            <P>
              <strong className="text-foreground/75">Plaintext</strong> produces clean prose without any
              formatting markers. Best for literary fiction and simple narratives.
            </P>
            <P>
              <strong className="text-foreground/75">Markdown</strong> allows the model to use emphasis,
              headings, and other formatting. Good for structured content or stories with distinct sections.
            </P>
          </>
        ),
      },
      {
        id: 'max-steps',
        title: 'Max steps',
        content: (
          <>
            <P>
              Controls how many tool-use rounds the model can perform before it must produce output.
              Default is 10 steps. Each step is one tool call + result cycle.
            </P>
            <Tip>
              If the model is calling too many tools before writing, lower this number.
              If it seems to cut off tool lookups prematurely, increase it.
            </Tip>
          </>
        ),
      },
      {
        id: 'summarization',
        title: 'Summarization',
        content: (
          <>
            <P>
              The context limit means older prose eventually falls out of the prompt. Summarization
              is what preserves that lost context — it's the model's long-term memory.
            </P>
            <P>
              After each generation, the librarian reads the new prose and writes a short
              summary update. These updates are stitched together into a rolling summary that
              appears in the prompt as "Story Summary So Far", positioned before the recent prose.
            </P>
            <P>
              The <strong className="text-foreground/75">summarization threshold</strong> controls
              how many most-recent prose positions are kept out of the rolling summary.
              In other words, the newest N prose sections stay as raw prose context first,
              and older sections are folded into the summary as they age past that threshold.
              Setting it to 0 means new summaries are applied immediately.
            </P>
            <P>
              <strong className="text-foreground/75">Summary compaction</strong> keeps the rolling
              summary bounded for long stories. When the summary would exceed
              <strong className="text-foreground/75"> Max characters</strong>, Errata compacts it down
              toward <strong className="text-foreground/75">Target characters</strong> so summary growth
              does not consume your prompt budget over time.
            </P>
            <P>
              If you also use chapter markers, see <strong className="text-foreground/75">Hierarchical summaries</strong>
              for a meso-level memory layer between the rolling summary and recent prose.
            </P>
            <Tip>
              Summarization and the context limit work as a pair: the context limit controls how
              much raw prose the model sees, and summarization ensures everything before that
              window is still represented. If you increase the context limit, you may be able to
              lower the summarization threshold (or vice versa). For very long stories, use
              summary compaction to keep the summary stable while still preserving continuity.
            </Tip>
          </>
        ),
      },
      {
        id: 'hierarchical-summaries',
        title: 'Hierarchical summaries',
        content: (
          <>
            <P>
              The <strong className="text-foreground/75">Hierarchical summaries</strong> toggle adds
              chapter-level summaries into generation context when available. This works with marker
              fragments: when a marker has summary content, that summary can be included as a meso-level
              memory layer between the global rolling summary and recent raw prose.
            </P>
            <P>
              In practice, this gives the model three memory tiers:
            </P>
            <div className="rounded-md border border-border/25 bg-accent/10 px-3 py-2.5 mb-2.5 space-y-0.5">
              {[
                'Macro: rolling story summary maintained by the librarian.',
                'Meso: chapter/arc summaries from marker fragments near the current prose window.',
                'Micro: recent prose fragments included by your context limit.',
              ].map((item, i) => (
                <p key={item} className="text-[11.5px] text-foreground/55 leading-snug">
                  <span className="text-muted-foreground mr-1.5">{i + 1}.</span>{item}
                </p>
              ))}
            </div>
            <Tip>
              Enable this for long stories with chapter markers. It helps preserve arc-level continuity
              without increasing raw prose context as much.
            </Tip>
          </>
        ),
      },
      {
        id: 'context-limit',
        title: 'Context limit',
        content: (
          <>
            <P>
              This setting controls how much recent prose from the chain is included in the
              generation prompt (step 2 of the pipeline). Prose is always selected from the
              end of the chain backwards — the most recent writing comes first.
            </P>
            <P>
              Three modes are available:
            </P>
            <P>
              <strong className="text-foreground/75">Fragments</strong> — Include the last N prose fragments
              regardless of their length. Default is 10. Simple and predictable.
            </P>
            <P>
              <strong className="text-foreground/75">Tokens</strong> — Include recent prose up to an estimated
              token budget. Tokens are approximated at 1 token per 4 characters. Use this when your fragments
              vary widely in length and you want consistent prompt sizes.
            </P>
            <P>
              <strong className="text-foreground/75">Characters</strong> — Include recent prose up to a raw
              character count. Useful for precise control over context size.
            </P>
            <P>
              In all modes, at least one prose fragment is always included even if it exceeds the
              budget. Everything before the limit is represented by the librarian's rolling summary,
              so the model still has awareness of earlier events — just not the raw text.
            </P>
            <Tip>
              A larger context limit means the model sees more of your actual prose, which
              helps with consistency and voice. But it also costs more tokens per generation
              and may push other context (guidelines, characters) proportionally further from
              the model's attention. Find the balance that works for your story.
            </Tip>
          </>
        ),
      },
      {
        id: 'keyboard-shortcuts',
        title: 'Keyboard shortcuts',
        content: (
          <>
            <P>
              Keyboard shortcuts are managed by the <strong className="text-foreground/75">Keybinds</strong> plugin.
              Enable it in Settings to configure shortcuts for generation, navigation, and other actions.
            </P>
            <P>
              Some defaults when the plugin is active:
            </P>
            <div className="space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-[12px] text-foreground/65">Generate & save</span>
                <span className="flex items-center gap-1"><Kbd>Ctrl</Kbd><span className="text-muted-foreground">+</span><Kbd>Enter</Kbd></span>
              </div>
              <div className="h-px bg-border/15" />
              <div className="flex items-center justify-between">
                <span className="text-[12px] text-foreground/65">Close panel / dialog</span>
                <Kbd>Esc</Kbd>
              </div>
            </div>
            <Tip>
              Check the Keybinds plugin panel for the full list of available shortcuts and to
              customize them.
            </Tip>
          </>
        ),
      },
      {
        id: 'debug-panel',
        title: 'Debug panel',
        content: (
          <>
            <P>
              The debug panel lets you inspect generation logs after they complete. Each log records
              the full prompt (system + user messages), all tool calls with arguments and results,
              the model's output, and timing statistics.
            </P>
            <P>
              Open it from the generation panel's <strong className="text-foreground/75">Debug</strong> button,
              or from the <strong className="text-foreground/75">debug icon</strong> on any prose block
              in the chain view.
            </P>
            <Tip>
              Use the debug panel to understand why the model made certain choices. Check the
              Prompt tab to see exactly what context was sent, and the Tools tab to see which
              fragments the model looked up.
            </Tip>
          </>
        ),
      },
    ],
  },
  {
    id: 'blocks',
    title: 'Block Editor',
    description: 'Control the model context structure — disable, reorder, override, and create blocks.',
    subsections: [
      {
        id: 'overview',
        title: 'What are blocks',
        content: (
          <>
            <P>
              Every generation prompt is built from <strong className="text-foreground/75">blocks</strong> — discrete
              sections like writing instructions, the tool listing, story info, prose history, and your author input.
              Blocks are assembled automatically from your story data, then compiled into the system and user messages
              that the model sees.
            </P>
            <P>
              The <strong className="text-foreground/75">Block Editor</strong> lets you see and control these blocks
              directly. To enable it, set <strong className="text-foreground/75">Prompt control</strong> to{' '}
              <Mono>Advanced</Mono> in Settings. The Block Editor and Fragment Order panels then appear
              in the sidebar under <strong className="text-foreground/75">Management</strong>.
            </P>
            <Tip>
              Use the <strong className="text-foreground/75">Preview</strong> button in the Block Editor to see exactly
              what the compiled prompt looks like with your changes applied.
            </Tip>
          </>
        ),
      },
      {
        id: 'builtin-blocks',
        title: 'Builtin blocks',
        content: (
          <>
            <P>
              These blocks are generated automatically from your story data. They appear in every
              generation (unless you disable them).
            </P>
            <div className="mt-3 mb-1">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-2">System message</p>
              <div className="space-y-1.5 mb-3">
                {[
                  ['instructions', 'Core writing assistant instructions and output rules.'],
                  ['tools', 'List of available tools the model can call during generation.'],
                  ['system-fragments', 'Sticky fragments placed in "system" position (if any).'],
                ].map(([name, desc]) => (
                  <div key={name} className="flex gap-2 items-start">
                    <code className="text-[10.5px] font-mono text-primary/70 bg-primary/5 px-1 py-0.5 rounded shrink-0 mt-px">{name}</code>
                    <p className="text-[11.5px] text-muted-foreground leading-snug">{desc}</p>
                  </div>
                ))}
              </div>
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-2">User message</p>
              <div className="space-y-1.5">
                {[
                  ['story-info', 'Story name and description.'],
                  ['summary', 'Rolling story summary maintained by the librarian.'],
                  ['user-fragments', 'Sticky fragments placed in "user" position (if any).'],
                  ['shortlist-*', 'One-line listings of non-sticky guidelines, knowledge, characters.'],
                  ['prose', 'Recent prose from the chain, limited by your context limit setting.'],
                  ['author-input', 'Your direction for what should happen next.'],
                ].map(([name, desc]) => (
                  <div key={name} className="flex gap-2 items-start">
                    <code className="text-[10.5px] font-mono text-primary/70 bg-primary/5 px-1 py-0.5 rounded shrink-0 mt-px">{name}</code>
                    <p className="text-[11.5px] text-muted-foreground leading-snug">{desc}</p>
                  </div>
                ))}
              </div>
            </div>
            <Tip>
              Some blocks are conditional — <Mono>summary</Mono> only appears if the librarian has
              produced a summary, and <Mono>system-fragments</Mono> only appears if you have sticky
              fragments placed in the system message.
            </Tip>
          </>
        ),
      },
      {
        id: 'disabling',
        title: 'Disabling blocks',
        content: (
          <>
            <P>
              Click the <strong className="text-foreground/75">toggle button</strong> on any block row to
              disable it. Disabled blocks are excluded from the prompt entirely — the model won't see them.
            </P>
            <P>
              Common uses: disable the <Mono>tools</Mono> block if you don't want the model to call tools,
              disable <Mono>summary</Mono> if the librarian's summary is causing issues, or disable
              shortlist blocks to keep the prompt shorter.
            </P>
            <Tip>
              Disabling a block doesn't delete anything — toggle it back on anytime to restore it.
            </Tip>
          </>
        ),
      },
      {
        id: 'overriding',
        title: 'Overriding content',
        content: (
          <>
            <P>
              Expand any builtin block to see its content preview and modify it. Choose a <strong className="text-foreground/75">content mode</strong>:
            </P>
            <div className="rounded-md border border-border/25 bg-accent/10 px-3 py-2.5 mb-2.5 space-y-1.5">
              <div>
                <p className="text-[11.5px] font-medium text-foreground/65">None</p>
                <p className="text-[11px] text-muted-foreground leading-snug">
                  Default — the block uses its original content with no modifications.
                </p>
              </div>
              <div className="h-px bg-border/15" />
              <div>
                <p className="text-[11.5px] font-medium text-foreground/65">Prepend</p>
                <p className="text-[11px] text-muted-foreground leading-snug">
                  Your text is inserted before the block's original content. Use this to add rules or
                  context at the top without losing the defaults.
                </p>
              </div>
              <div className="h-px bg-border/15" />
              <div>
                <p className="text-[11.5px] font-medium text-foreground/65">Append</p>
                <p className="text-[11px] text-muted-foreground leading-snug">
                  Your text is added after the block's original content. Good for adding supplementary notes.
                </p>
              </div>
              <div className="h-px bg-border/15" />
              <div>
                <p className="text-[11.5px] font-medium text-foreground/65">Override</p>
                <p className="text-[11px] text-muted-foreground leading-snug">
                  The block's original content is entirely replaced with your text. Use this to write
                  your own system prompt or completely redefine a section.
                </p>
              </div>
            </div>
            <Tip>
              Overriding the <Mono>instructions</Mono> block is a powerful way to customize the model's
              behavior without writing a plugin. For example, replace it with genre-specific writing directions.
            </Tip>
          </>
        ),
      },
      {
        id: 'reordering',
        title: 'Reordering blocks',
        content: (
          <>
            <P>
              Drag blocks by their <strong className="text-foreground/75">grip handle</strong> to reorder them.
              The order controls how blocks appear within their role group — system blocks are ordered among
              system blocks, and user blocks among user blocks.
            </P>
            <P>
              Reordering affects what the model pays attention to. Models tend to focus more on content at
              the beginning and end of a message. Place your most important context accordingly.
            </P>
          </>
        ),
      },
      {
        id: 'custom-blocks',
        title: 'Custom blocks',
        content: (
          <>
            <P>
              Click <strong className="text-foreground/75">Add Custom Block</strong> at the bottom of the
              Block Editor to inject your own content into the model prompt. Custom blocks sit alongside
              builtin blocks and can be reordered, enabled, or disabled the same way.
            </P>
            <P>
              When creating a custom block, choose:
            </P>
            <div className="rounded-md border border-border/25 bg-accent/10 px-3 py-2.5 mb-2.5 space-y-1.5">
              <div>
                <p className="text-[11.5px] font-medium text-foreground/65">Role</p>
                <p className="text-[11px] text-muted-foreground leading-snug">
                  <Mono>system</Mono> for instructions and rules the model should follow.{' '}
                  <Mono>user</Mono> for story context and reference material.
                </p>
              </div>
              <div className="h-px bg-border/15" />
              <div>
                <p className="text-[11.5px] font-medium text-foreground/65">Type: Simple</p>
                <p className="text-[11px] text-muted-foreground leading-snug">
                  Plain text injected as-is. Use for static instructions, world rules, style guides,
                  or any fixed content.
                </p>
              </div>
              <div className="h-px bg-border/15" />
              <div>
                <p className="text-[11.5px] font-medium text-foreground/65">Type: Script</p>
                <p className="text-[11px] text-muted-foreground leading-snug">
                  JavaScript that runs at generation time and returns a string. Has access to story data
                  through a <Mono>ctx</Mono> parameter. The block is omitted if the script returns empty.
                </p>
              </div>
            </div>
          </>
        ),
      },
      {
        id: 'script-blocks',
        title: 'Script blocks',
        content: (
          <>
            <P>
              Script blocks are custom blocks that run JavaScript at generation time. Write a function body
              that receives <Mono>ctx</Mono> and returns a string. If it returns empty or throws an error,
              the block is handled gracefully.
            </P>
            <div className="mt-3 mb-1">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-2">Available on ctx</p>
              <div className="space-y-1 mb-3">
                {[
                  ['ctx.story', 'Story metadata — name, description, summary, settings.'],
                  ['ctx.proseFragments', 'Recent prose fragments included in context.'],
                  ['ctx.stickyGuidelines', 'Pinned guideline fragments (full content).'],
                  ['ctx.stickyKnowledge', 'Pinned knowledge fragments (full content).'],
                  ['ctx.stickyCharacters', 'Pinned character fragments (full content).'],
                  ['ctx.guidelineShortlist', 'Non-pinned guidelines.'],
                  ['ctx.knowledgeShortlist', 'Non-pinned knowledge.'],
                  ['ctx.characterShortlist', 'Non-pinned characters.'],
                  ['ctx.authorInput', 'The author\'s current direction.'],
                ].map(([field, desc]) => (
                  <div key={field} className="flex gap-2 items-start">
                    <code className="text-[10.5px] font-mono text-primary/70 bg-primary/5 px-1 py-0.5 rounded shrink-0 mt-px">{field}</code>
                    <p className="text-[11px] text-muted-foreground leading-snug">{desc}</p>
                  </div>
                ))}
              </div>
            </div>
            <div className="mt-3 mb-1">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-2">Examples</p>
              <div className="space-y-2">
                <div className="rounded-md border border-border/25 bg-accent/15 px-3 py-2 text-[11px] font-mono text-foreground/55 leading-relaxed whitespace-pre-wrap">{`// Word count tracker
const total = ctx.proseFragments
  .reduce((n, f) => n + f.content.split(/\\s+/).length, 0)
return \`Current story length: ~\${total} words.\``}</div>
                <div className="rounded-md border border-border/25 bg-accent/15 px-3 py-2 text-[11px] font-mono text-foreground/55 leading-relaxed whitespace-pre-wrap">{`// Active character reminder
const names = ctx.stickyCharacters
  .map(c => c.name).join(', ')
if (!names) return ''
return \`Active characters: \${names}.\``}</div>
                <div className="rounded-md border border-border/25 bg-accent/15 px-3 py-2 text-[11px] font-mono text-foreground/55 leading-relaxed whitespace-pre-wrap">{`// Conditional pacing note
const n = ctx.proseFragments.length
if (n < 3) return 'Early story — establish setting.'
if (n > 15) return 'Move toward resolution.'
return ''`}</div>
              </div>
            </div>
            <Tip>
              If a script throws an error, the block shows a "[Script error]" message in the prompt so
              you can spot the problem. Check the Preview to verify scripts work as expected.
            </Tip>
          </>
        ),
      },
    ],
  },
  {
    id: 'fragments',
    title: 'Fragments',
    description: 'Everything in Errata is a fragment. Learn how they compose into your story.',
    subsections: [
      {
        id: 'overview',
        title: 'What are fragments',
        content: (
          <>
            <P>
              Fragments are the building blocks of your story. Every piece of content — prose passages,
              character profiles, world knowledge, writing guidelines — is stored as a fragment with
              a unique ID, name, description, and content body.
            </P>
            <P>
              Fragment IDs follow a short, readable pattern: a 2-character type prefix followed by 4-8
              characters. For example, <Mono>pr-katemi</Mono> for prose, <Mono>ch-bokura</Mono> for
              characters, <Mono>gl-sideno</Mono> for guidelines, <Mono>kn-taviku</Mono> for knowledge.
            </P>
          </>
        ),
      },
      {
        id: 'types',
        title: 'Fragment types',
        content: (
          <>
            <P>
              <strong className="text-foreground/75">Prose</strong> — The story itself. Prose fragments form
              a chain (ordered sequence) that represents the narrative. Each generation appends a new prose
              fragment to the chain.
            </P>
            <P>
              <strong className="text-foreground/75">Characters</strong> — Character profiles, backstories,
              and personality descriptions. Sticky characters are always visible to the model; non-sticky
              appear as shortlist entries the model can look up.
            </P>
            <P>
              <strong className="text-foreground/75">Guidelines</strong> — Writing style instructions, tone
              guidance, genre conventions, and rules the model should follow. Think of these as persistent
              writing directions.
            </P>
            <P>
              <strong className="text-foreground/75">Knowledge</strong> — World-building details, lore,
              timelines, magic systems, geography, and any reference information the model can consult.
            </P>
          </>
        ),
      },
      {
        id: 'sticky',
        title: 'Sticky vs non-sticky',
        content: (
          <>
            <P>
              <strong className="text-foreground/75">Sticky fragments</strong> are included in full in every
              generation prompt. The model always sees their complete content. Use this for critical
              guidelines, main characters, or essential world details.
            </P>
            <P>
              <strong className="text-foreground/75">Non-sticky fragments</strong> appear only as one-line
              entries in a shortlist (ID, name, description). The model can use tools to look up their
              full content if needed. This keeps the prompt focused while still making information accessible.
            </P>
            <Tip>
              Keep only the most important fragments sticky. Too many sticky fragments inflate the prompt
              and can dilute the model's attention. Let the model discover peripheral details via tools.
            </Tip>
          </>
        ),
      },
      {
        id: 'tags-refs',
        title: 'Tags & references',
        content: (
          <>
            <P>
              <strong className="text-foreground/75">Tags</strong> are freeform labels for organizing fragments.
              Use them for filtering and search.
            </P>
            <P>
              <strong className="text-foreground/75">References</strong> link one fragment to another by ID.
              When the model looks up a fragment, it can see what other fragments are related and follow
              the reference chain.
            </P>
          </>
        ),
      },
    ],
  },
  {
    id: 'librarian',
    title: 'Librarian',
    description: 'The background agent that maintains your story\'s memory and knowledge.',
    subsections: [
      {
        id: 'overview',
        title: 'What the librarian does',
        content: (
          <>
            <P>
              The librarian is a background agent that runs automatically after each prose generation.
              It reads through your <strong className="text-foreground/75">entire fragment collection</strong> — prose,
              characters, guidelines, and knowledge — to maintain a rolling summary, detect character
              mentions, flag contradictions, suggest new knowledge, and track the timeline.
            </P>
            <P>
              Every time you generate prose, the librarian analyzes it in the context of everything
              you've written so far. It's your story's memory, catching things you might miss as
              the narrative grows.
            </P>
          </>
        ),
      },
      {
        id: 'chat-tab',
        title: 'Chat',
        content: (
          <>
            <P>
              The <strong className="text-foreground/75">Chat</strong> tab lets you talk directly to
              the librarian about your story. Ask it questions about characters, plot threads,
              timeline, or anything else — it has full access to your fragments and its own analysis
              history.
            </P>
            <Tip>
              Use chat to ask things like "What do we know about this character?" or
              "Are there any unresolved plot threads?" The librarian draws on everything it's analyzed.
            </Tip>
          </>
        ),
      },
      {
        id: 'story-tab',
        title: 'Story',
        content: (
          <>
            <P>
              The <strong className="text-foreground/75">Story</strong> tab shows the librarian's
              ongoing analysis of your narrative. It's organized into several sections:
            </P>
            <P>
              <strong className="text-foreground/75">Findings</strong> — a quick overview showing
              the total number of contradictions and pending suggestions across all analyses.
            </P>
            <P>
              <strong className="text-foreground/75">Analyses</strong> — each prose generation gets
              its own analysis entry. Expand one to see the summary update, which characters appeared,
              any contradictions found, knowledge suggestions, and timeline events detected.
            </P>
            <P>
              <strong className="text-foreground/75">Characters</strong> — tracks which characters
              are mentioned in recent prose and how often, so you can see who's active in the story.
            </P>
            <P>
              <strong className="text-foreground/75">Timeline</strong> — a chronological list of
              events the librarian has extracted from your prose, linked back to the fragments
              they came from.
            </P>
          </>
        ),
      },
      {
        id: 'contradictions',
        title: 'Contradictions',
        content: (
          <>
            <P>
              The librarian cross-references new prose against your existing fragments to catch
              inconsistencies. When it finds one, it flags the contradiction with a description
              and the specific fragment IDs involved.
            </P>
            <P>
              Each contradiction includes a <strong className="text-foreground/75">Fix</strong> button
              that opens the Refine tool with pre-filled instructions to resolve the issue. The
              librarian will rewrite the fragment to fix the inconsistency while preserving the
              rest of its content.
            </P>
          </>
        ),
      },
      {
        id: 'suggestions',
        title: 'Knowledge suggestions',
        content: (
          <>
            <P>
              When the librarian detects new information in your prose — a new character, a world-building
              detail, an important object — it creates a knowledge suggestion. Each suggestion includes
              a name, type, and description.
            </P>
            <P>
              Suggestions can either create a brand new fragment or update an existing one. Click
              the <strong className="text-foreground/75">+</strong> button to accept a suggestion,
              and the fragment will be created or updated immediately.
            </P>
            <Tip>
              Suggestions that update existing fragments show which fragment they target, so you
              can review before accepting.
            </Tip>
          </>
        ),
      },
      {
        id: 'refine',
        title: 'Refining fragments',
        content: (
          <>
            <P>
              The <strong className="text-foreground/75">Refine</strong> section at the bottom of
              the Story tab lets you ask the librarian to rewrite or improve any character, guideline,
              or knowledge fragment. Select a fragment from the dropdown, provide optional instructions,
              and the librarian will generate an updated version.
            </P>
            <P>
              Refine is also triggered automatically from contradiction Fix buttons, pre-filling the
              instructions with what needs to be resolved.
            </P>
            <Tip>
              Use refine to keep fragments up to date as your story evolves — the librarian
              understands your full story context when rewriting.
            </Tip>
          </>
        ),
      },
      {
        id: 'auto-suggestions',
        title: 'Auto-apply suggestions',
        content: (
          <>
            <P>
              The toggle at the top of the Librarian panel controls whether suggestions are
              applied automatically. When enabled, the librarian will create and update fragments
              on its own — for example, adding a character fragment when someone new appears in the prose,
              or updating a knowledge fragment when details change.
            </P>
            <Tip>
              This is off by default. Enable it if you want the librarian to proactively maintain
              your story's knowledge base without manual intervention. Auto-applied suggestions
              are marked with an "Auto" badge so you can review what changed.
            </Tip>
          </>
        ),
      },
      {
        id: 'activity-tab',
        title: 'Activity',
        content: (
          <>
            <P>
              The <strong className="text-foreground/75">Activity</strong> tab shows a log of every
              agent run the librarian has performed. Each entry shows the agent name, when it ran,
              how long it took, and whether it succeeded or failed.
            </P>
            <P>
              Expand a run to see the full trace tree — the librarian may invoke sub-agents
              (analyze, refine, chat) and you can inspect each step's status and timing.
            </P>
          </>
        ),
      },
      {
        id: 'status',
        title: 'Status indicator',
        content: (
          <>
            <P>
              The status strip below the tabs shows the librarian's current state:
              a green dot means idle, amber means queued, blue with a pulse means actively analyzing,
              and red indicates an error. The fragment ID being processed is shown alongside.
            </P>
          </>
        ),
      },
    ],
  },
  {
    id: 'timelines',
    title: 'Timelines',
    description: 'Explore alternate story directions by forking your narrative at any point.',
    subsections: [
      {
        id: 'overview',
        title: 'What are timelines',
        content: (
          <>
            <P>
              Timelines let you branch your story to explore alternate directions without losing
              previous work. Each timeline is a complete, independent copy of your story's content —
              prose, fragments, librarian data, and all metadata.
            </P>
            <P>
              Every story starts with a single timeline called <strong className="text-foreground/75">Main</strong>.
              You can create new timelines at any point, and each one evolves independently from there.
              Edits and generations in one timeline never affect another.
            </P>
          </>
        ),
      },
      {
        id: 'creating',
        title: 'Creating a timeline',
        content: (
          <>
            <P>
              There are two ways to create a new timeline:
            </P>
            <P>
              <strong className="text-foreground/75">From the timeline bar</strong> — Click the{' '}
              <Mono>+</Mono> button in the top bar. This creates a full copy of the current
              timeline, including all prose and fragments. You can then continue writing from the end.
            </P>
            <P>
              <strong className="text-foreground/75">From a prose section</strong> — Click the{' '}
              <strong className="text-foreground/75">Timeline</strong> button on any prose block
              in the chain view. This forks the story <em>at that point</em> — the new timeline
              keeps everything up to and including that section, and you write an alternate
              continuation from there.
            </P>
            <Tip>
              Forking from a specific prose section is the most common use. It lets you ask
              "what if the story went differently here?" and explore the answer without
              affecting your main narrative.
            </Tip>
          </>
        ),
      },
      {
        id: 'switching',
        title: 'Switching timelines',
        content: (
          <>
            <P>
              Click any timeline tab in the top bar to switch to it. The entire view updates —
              prose chain, fragments, librarian state — to show that timeline's content. You can
              switch back and forth freely without losing anything.
            </P>
            <P>
              The timeline bar appears automatically when your story has more than one timeline.
              If you've hidden it, you can re-show it from the Timeline Manager in the sidebar.
            </P>
          </>
        ),
      },
      {
        id: 'managing',
        title: 'Managing timelines',
        content: (
          <>
            <P>
              Hover over the active timeline tab and click the <Mono>...</Mono> menu to access
              management options:
            </P>
            <P>
              <strong className="text-foreground/75">Rename</strong> — Change the timeline's name.
              The name is just a label and doesn't affect the content.
            </P>
            <P>
              <strong className="text-foreground/75">Delete</strong> — Permanently remove a timeline
              and all its content. This cannot be undone. The Main timeline cannot be deleted.
            </P>
            <P>
              The <strong className="text-foreground/75">Timeline Manager</strong> panel in the sidebar
              provides a more detailed view, showing each timeline's parent and fork point
              (e.g., "from Main at section 3").
            </P>
          </>
        ),
      },
      {
        id: 'isolation',
        title: 'Data isolation',
        content: (
          <>
            <P>
              Each timeline is fully independent. When you create a timeline, everything is copied:
            </P>
            <div className="rounded-md border border-border/25 bg-accent/10 px-3 py-2.5 mb-2.5 space-y-0.5">
              {[
                'Prose chain and all prose fragments',
                'Character, guideline, and knowledge fragments',
                'Fragment associations and tags',
                'Librarian state, analyses, and chat history',
                'Generation logs',
                'Block configuration',
              ].map((item, i) => (
                <p key={item} className="text-[11.5px] text-foreground/55 leading-snug">
                  <span className="text-muted-foreground mr-1.5">{i + 1}.</span>{item}
                </p>
              ))}
            </div>
            <P>
              After the copy, the timelines diverge completely. Creating a character in one timeline
              won't create it in another. The librarian tracks each timeline's story independently.
            </P>
            <Tip>
              Story-level settings (name, description, model configuration) are shared across
              all timelines. Only the content within each timeline is isolated.
            </Tip>
          </>
        ),
      },
    ],
  },
  {
    id: 'stories',
    title: 'Stories',
    description: 'Managing your stories, cover images, and the story gallery.',
    subsections: [
      {
        id: 'cover-images',
        title: 'Cover images',
        content: (
          <>
            <P>
              Each story can have a <strong className="text-foreground/75">cover image</strong> that
              appears on the story card in the gallery and as a banner at the top of the prose view.
            </P>
            <P>
              You can set a cover image in three places:
            </P>
            <div className="rounded-md border border-border/25 bg-accent/10 px-3 py-2.5 mb-2.5 space-y-0.5">
              {[
                'Create dialog — upload an image when creating a new story.',
                'Story list — hover over a card and click the camera icon.',
                'Info panel — switch to edit mode and use the Cover Image field.',
              ].map((item, i) => (
                <p key={item} className="text-[11.5px] text-foreground/55 leading-snug">
                  <span className="text-muted-foreground mr-1.5">{i + 1}.</span>{item}
                </p>
              ))}
            </div>
            <Tip>
              Cover images are stored as data URLs, so they're self-contained in your story data.
              Use reasonably sized images to keep story files manageable.
            </Tip>
          </>
        ),
      },
      {
        id: 'gallery',
        title: 'Story gallery',
        content: (
          <>
            <P>
              The home page displays your stories as a responsive grid of portrait cards.
              Stories with cover images show the image as a background; stories without one get a
              generated gradient based on their ID.
            </P>
            <P>
              Each card shows the story name, description, fragment counts (prose, characters,
              knowledge, guidelines), and last-updated date. Hover to reveal a camera icon for
              quickly setting a cover, or the delete button to remove the story.
            </P>
          </>
        ),
      },
    ],
  },
  {
    id: 'settings',
    title: 'Settings',
    description: 'Configuring providers, plugins, appearance, and generation behavior.',
    subsections: [
      {
        id: 'providers',
        title: 'model providers',
        content: (
          <>
            <P>
              Errata supports multiple model providers. Each provider has an API endpoint and key.
              You can set different providers for generation (prose output) and the librarian
              (background analysis).
            </P>
            <P>
              Add providers through the Manage Providers panel in Settings.
            </P>
          </>
        ),
      },
      {
        id: 'prompt-control',
        title: 'Prompt control',
        content: (
          <>
            <P>
              <strong className="text-foreground/75">Simple mode</strong> (default) groups sticky fragments by type
              (guidelines, then knowledge, then characters) in the prompt. The block structure is fixed.
            </P>
            <P>
              <strong className="text-foreground/75">Advanced mode</strong> unlocks two sidebar panels:
            </P>
            <div className="rounded-md border border-border/25 bg-accent/10 px-3 py-2.5 mb-2.5 space-y-1.5">
              <div>
                <p className="text-[11.5px] font-medium text-foreground/65">Block Editor</p>
                <p className="text-[11px] text-muted-foreground leading-snug">
                  Disable, reorder, and override entire context blocks (instructions, tools, story info,
                  prose, etc.). Create custom blocks with plain text or JavaScript scripts.
                </p>
              </div>
              <div className="h-px bg-border/15" />
              <div>
                <p className="text-[11.5px] font-medium text-foreground/65">Fragment Order</p>
                <p className="text-[11px] text-muted-foreground leading-snug">
                  Drag pinned fragments into a custom order and toggle their placement between system
                  and user messages.
                </p>
              </div>
            </div>
            <Tip>
              See the <strong className="text-foreground/75">Block Editor</strong> help section for full details
              on blocks, overrides, and custom script blocks.
            </Tip>
          </>
        ),
      },
      {
        id: 'plugins',
        title: 'Plugins',
        content: (
          <>
            <P>
              Plugins extend Errata with new fragment types, model tools, API routes, and sidebar
              panels. Enable or disable them per-story in Settings.
            </P>
            <P>
              Each plugin can hook into four stages of the generation pipeline:
            </P>
            <div className="rounded-md border border-border/25 bg-accent/10 px-3 py-2.5 mb-2.5 space-y-1.5">
              <div>
                <p className="text-[11.5px] font-medium text-foreground/65">beforeContext</p>
                <p className="text-[11px] text-muted-foreground leading-snug">
                  Runs after fragments are loaded but before messages are assembled. Plugins can
                  add, remove, or reorder fragments in the context state.
                </p>
              </div>
              <div className="h-px bg-border/15" />
              <div>
                <p className="text-[11.5px] font-medium text-foreground/65">beforeGeneration</p>
                <p className="text-[11px] text-muted-foreground leading-snug">
                  Runs after messages are assembled. Plugins can modify the final system and user
                  messages before they're sent to the model.
                </p>
              </div>
              <div className="h-px bg-border/15" />
              <div>
                <p className="text-[11.5px] font-medium text-foreground/65">afterGeneration</p>
                <p className="text-[11px] text-muted-foreground leading-snug">
                  Runs after the model responds. Plugins can transform the generated text before
                  it's saved as a fragment.
                </p>
              </div>
              <div className="h-px bg-border/15" />
              <div>
                <p className="text-[11.5px] font-medium text-foreground/65">afterSave</p>
                <p className="text-[11px] text-muted-foreground leading-snug">
                  Runs after the prose fragment is persisted. Plugins can trigger side effects
                  like notifications or external syncs.
                </p>
              </div>
            </div>
            <P>
              Plugins can also register custom model tools that the model can call during generation,
              alongside the built-in fragment tools.
            </P>
          </>
        ),
      },
    ],
  },
]

/** Find a section by ID */
export function findSection(sectionId: string): HelpSection | undefined {
  return HELP_SECTIONS.find((s) => s.id === sectionId)
}

/** Find a subsection within a section */
export function findSubsection(sectionId: string, subsectionId: string): HelpSubsection | undefined {
  const section = findSection(sectionId)
  return section?.subsections.find((s) => s.id === subsectionId)
}
