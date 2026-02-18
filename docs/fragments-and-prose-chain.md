# Fragments & Prose Chain

Everything in Errata is a **fragment** — prose, characters, guidelines, knowledge, images, icons, and chapter markers. Fragments are the atomic data unit. The **prose chain** orders prose fragments into a readable story timeline, with support for variations and branching.

This document covers the full data model and API surface you need to write an importer or integrate with Errata programmatically.

## Fragment Schema

Every fragment is a JSON object conforming to this schema. Source: `src/server/fragments/schema.ts`.

| Field | Type | Default | Constraints | Description |
|---|---|---|---|---|
| `id` | `string` | — | `/^[a-z]{2,4}-[a-z0-9]{4,12}$/` | Unique ID with type prefix. See [Fragment IDs](#fragment-ids). |
| `type` | `string` | — | min 1 char | Fragment type (e.g. `prose`, `character`, `guideline`). |
| `name` | `string` | — | max 100 chars | Human-readable name. |
| `description` | `string` | — | max 250 chars | Short description. |
| `content` | `string` | — | — | Main content body (prose text, character bio, knowledge entry, etc.). |
| `tags` | `string[]` | `[]` | — | Freeform tags for organization. |
| `refs` | `string[]` | `[]` | Each matches fragment ID pattern | References to other fragment IDs. |
| `sticky` | `boolean` | `false` | — | If `true`, always included in LLM context. |
| `placement` | `"system" \| "user"` | `"user"` | — | Which LLM message role this fragment is placed in. |
| `createdAt` | `string` | — | ISO 8601 datetime | Creation timestamp. |
| `updatedAt` | `string` | — | ISO 8601 datetime | Last modification timestamp. |
| `order` | `integer` | `0` | — | Sort order within its type group. |
| `meta` | `Record<string, unknown>` | `{}` | — | Arbitrary metadata. Used for generation info, import sources, visual refs, etc. |
| `archived` | `boolean` | `false` | — | Soft-delete flag. Archived fragments are excluded from listings by default. |
| `version` | `integer` | `1` | min 1 | Current version number. Incremented on each content change. |
| `versions` | `FragmentVersion[]` | `[]` | — | Version history snapshots. See below. |

### FragmentVersion

Each entry in `versions` captures a previous state:

| Field | Type | Description |
|---|---|---|
| `version` | `integer` | Version number of this snapshot. |
| `name` | `string` | Name at the time of the snapshot. |
| `description` | `string` | Description at the time. |
| `content` | `string` | Content at the time. |
| `createdAt` | `string` | ISO 8601 datetime when this version was recorded. |
| `reason` | `string?` | Optional reason (e.g. `"manual-update"`, `"revert-to-2"`). |

When a fragment is updated through the API's `PUT` endpoint, the previous state is automatically snapshotted into `versions` and `version` is incremented.

## Fragment Types

Built-in types are registered in `src/server/fragments/registry.ts`. Each type defines a prefix, sticky default, and how it renders into LLM context.

| Type | Prefix | Sticky by Default | Context Rendering | LLM Tools |
|---|---|---|---|---|
| `prose` | `pr` | `false` | Content as-is | No |
| `character` | `ch` | `false` | `## {name}\n{content}` | No |
| `guideline` | `gl` | `true` | `**{name}**: {content}` | No |
| `knowledge` | `kn` | `false` | `### {name}\n{content}` | No |
| `image` | `im` | `false` | `[image:{id}] {name} - {description}` | No |
| `icon` | `ic` | `false` | `[icon:{id}] {name} - {description}` | No |
| `marker` | `mk` | `false` | *(empty — markers are structural, not content)* | No |

Plugins can register additional types with custom prefixes via the `FragmentTypeRegistry`.

### Type semantics

- **prose** — Story text. Ordered by the prose chain. Not directly included via the fragment list; the prose chain controls which prose fragments appear in context.
- **character** — Character definitions. Bio, personality, appearance. Sticky characters are always in context; non-sticky ones appear in a shortlist the LLM can query.
- **guideline** — Writing instructions. Sticky by default — they're always in context. Used for style rules, tone guidance, dos/don'ts.
- **knowledge** — World-building facts, lore, rules. Non-sticky by default; the LLM sees a shortlist and can read full entries via tools.
- **image** / **icon** — Media references. Content is typically a base64 data URL or external URL.
- **marker** — Chapter markers. Inserted into the prose chain to delimit chapters. Renders no content into LLM context but structures the story timeline.

## Fragment IDs

Source: `src/lib/fragment-ids.ts`.

### Format

```
{prefix}-{6 consonant-vowel alternating chars}
```

Examples: `pr-bakife`, `ch-gomazu`, `gl-tivone`, `kn-dubera`, `mk-sanoti`

### Generation rules

1. The prefix is looked up from the type → prefix map. If the type isn't in the map, the first 4 lowercase characters of the type name are used.
2. The suffix is 6 characters with consonant-vowel alternation (positions 0,2,4 are consonants; 1,3,5 are vowels).
3. Consonant pool: `bdfgkmnprstvz` (13 chars).
4. Vowel pool: `aeiou` (5 chars).
5. This produces ~274k unique IDs per type prefix.

### Prefix map

| Type | Prefix |
|---|---|
| `prose` | `pr` |
| `character` | `ch` |
| `guideline` | `gl` |
| `knowledge` | `kn` |
| `image` | `im` |
| `icon` | `ic` |
| `marker` | `mk` |

The ID regex enforced by the schema is: `/^[a-z]{2,4}-[a-z0-9]{4,12}$/`

When writing an importer, you can generate IDs yourself as long as they match this pattern and are unique within the story. The consonant-vowel alternation is a convention, not enforced by the regex.

## Prose Chain

The prose chain is the ordered sequence of prose sections that make up the story. Source: `src/server/fragments/prose-chain.ts`, schema in `src/server/fragments/schema.ts`.

### Schema

```json
{
  "entries": [
    {
      "proseFragments": ["pr-bakife"],
      "active": "pr-bakife"
    },
    {
      "proseFragments": ["pr-gomazu", "pr-tivone"],
      "active": "pr-tivone"
    }
  ]
}
```

### Concepts

- **Entry** — A single section/position in the story. Contains one or more prose fragment IDs.
- **`proseFragments`** — Array of all fragment IDs at this position. When a section is regenerated or refined, the new fragment is added here alongside the original. These are the "variations" or "rewrites" of a section.
- **`active`** — The currently selected fragment ID for this position. This is what the reader sees and what's included in LLM context. Must be one of the IDs in `proseFragments`.

### How it works

The prose chain is the **story timeline**. Reading the `active` field from each entry in order gives the current story text:

```
entry[0].active → "Once upon a time..."
entry[1].active → "The hero set out on a journey..."
entry[2].active → "They arrived at the castle..."
```

When the author generates new prose, a new entry is appended. When they regenerate an existing section, a new fragment is created and added as a variation to that entry (the new fragment becomes `active`). The author can switch between variations using `switchActiveProse`.

### Marker entries

Chapter markers (type `marker`) are also entries in the prose chain. They appear at a position in the chain like any prose section, but their fragments render no text. They delimit chapters for organizational and summarization purposes.

### Operations

| Function | Description |
|---|---|
| `initProseChain(dataDir, storyId, fragmentId)` | Create a new chain with one entry. |
| `addProseSection(dataDir, storyId, fragmentId)` | Append a new entry at the end. |
| `insertProseSection(dataDir, storyId, fragmentId, position)` | Insert at a specific index. |
| `addProseVariation(dataDir, storyId, sectionIndex, fragmentId)` | Add a variation to an existing entry (sets it active). |
| `switchActiveProse(dataDir, storyId, sectionIndex, fragmentId)` | Change which variation is active. |
| `removeProseSection(dataDir, storyId, sectionIndex)` | Remove an entry; returns the fragment IDs that were in it. |
| `findSectionIndex(dataDir, storyId, fragmentId)` | Find which entry contains a given fragment ID. |
| `getActiveProseIds(dataDir, storyId)` | Get all active fragment IDs in order (the current timeline). |
| `getFullProseChain(dataDir, storyId)` | Get the full chain with all variations. |

## Storage Layout

Errata uses filesystem storage — no database. All data lives under the `DATA_DIR` (default `./data`). Source: `src/server/fragments/storage.ts`, `src/server/fragments/branches.ts`.

### Directory tree

```
data/
├── config.json                              # Global config (providers, defaults)
└── stories/
    └── {storyId}/
        ├── meta.json                        # Story metadata (StoryMeta)
        ├── block-config.json                # Block editor config (optional)
        ├── branches.json                    # Branch index
        └── branches/
            └── {branchId}/                  # "main" is the default branch
                ├── prose-chain.json         # Prose chain
                ├── associations.json        # Tag/ref indices
                ├── fragments/
                │   ├── pr-bakife.json       # Individual fragment files
                │   ├── ch-gomazu.json
                │   ├── gl-tivone.json
                │   └── ...
                ├── generation-logs/
                │   └── gen-xxxxx.json
                └── librarian/
                    ├── state.json
                    └── analyses/
                        └── ...
```

### Key details

- **Story IDs** are URL-safe slugs derived from the story name, suffixed with a timestamp: `my-story-lk5abc`.
- **Branch-aware paths**: Content (fragments, prose chain, associations, librarian data) lives under `branches/{branchId}/`. The default branch is always `main`. The `branches.json` file tracks which branch is active.
- **Fragment files** are named `{fragmentId}.json` and contain the full fragment object.
- **`prose-chain.json`** stores the chain for the active branch.
- **`meta.json`** and `branches.json` live at the story root (not branch-scoped).

### Example fragment file (`pr-bakife.json`)

```json
{
  "id": "pr-bakife",
  "type": "prose",
  "name": "[Continuation] The story begins",
  "description": "The story begins with a dark and stormy night.",
  "content": "It was a dark and stormy night. The wind howled through the empty streets...",
  "tags": [],
  "refs": [],
  "sticky": false,
  "placement": "user",
  "createdAt": "2025-01-15T10:30:00.000Z",
  "updatedAt": "2025-01-15T10:30:00.000Z",
  "order": 0,
  "meta": {
    "generatedFrom": "Begin the story with a dark and stormy night"
  },
  "archived": false,
  "version": 1,
  "versions": []
}
```

### Example prose-chain.json

```json
{
  "entries": [
    {
      "proseFragments": ["pr-bakife"],
      "active": "pr-bakife"
    },
    {
      "proseFragments": ["pr-gomazu", "pr-dubera"],
      "active": "pr-dubera"
    },
    {
      "proseFragments": ["mk-sanoti"],
      "active": "mk-sanoti"
    },
    {
      "proseFragments": ["pr-tivone"],
      "active": "pr-tivone"
    }
  ]
}
```

In this example, entry 1 has two variations (`pr-gomazu` is the original, `pr-dubera` is a regeneration that's now active). Entry 2 is a chapter marker.

## API Reference

All endpoints are prefixed with `/api`. Request/response bodies are JSON.

### Stories

| Method | Path | Body | Response |
|---|---|---|---|
| `POST` | `/stories` | `{ name, description }` | `StoryMeta` |
| `GET` | `/stories` | — | `StoryMeta[]` |
| `GET` | `/stories/:storyId` | — | `StoryMeta` |
| `PUT` | `/stories/:storyId` | `{ name, description, summary? }` | `StoryMeta` |
| `DELETE` | `/stories/:storyId` | — | `{ ok: true }` |
| `PATCH` | `/stories/:storyId/settings` | Partial settings object | `StoryMeta` |

### Fragments

| Method | Path | Body | Response |
|---|---|---|---|
| `POST` | `/stories/:storyId/fragments` | `{ type, name, description, content, tags?, meta? }` | `Fragment` |
| `GET` | `/stories/:storyId/fragments` | Query: `?type=prose&includeArchived=true` | `Fragment[]` |
| `GET` | `/stories/:storyId/fragments/:fragmentId` | — | `Fragment` |
| `PUT` | `/stories/:storyId/fragments/:fragmentId` | `{ name, description, content, sticky?, order?, placement?, meta? }` | `Fragment` |
| `PATCH` | `/stories/:storyId/fragments/:fragmentId` | `{ oldText, newText }` | `Fragment` (content find-replace) |
| `DELETE` | `/stories/:storyId/fragments/:fragmentId` | — | `{ ok: true }` (must be archived first) |

The `PUT` endpoint creates a version snapshot automatically. The `PATCH` endpoint does a string find-replace on the fragment's content.

Deletion requires the fragment to be archived first (422 error otherwise).

### Fragment lifecycle

| Method | Path | Body | Response |
|---|---|---|---|
| `POST` | `/stories/:storyId/fragments/:fragmentId/archive` | — | `Fragment` |
| `POST` | `/stories/:storyId/fragments/:fragmentId/restore` | — | `Fragment` |
| `POST` | `/stories/:storyId/fragments/:fragmentId/revert` | — | `Fragment` (reverts to previous version) |

### Fragment versions

| Method | Path | Body | Response |
|---|---|---|---|
| `GET` | `/stories/:storyId/fragments/:fragmentId/versions` | — | `{ versions: FragmentVersion[] }` |
| `POST` | `/stories/:storyId/fragments/:fragmentId/versions/:version/revert` | — | `Fragment` |

### Tags

| Method | Path | Body | Response |
|---|---|---|---|
| `GET` | `/stories/:storyId/fragments/:fragmentId/tags` | — | `{ tags: string[] }` |
| `POST` | `/stories/:storyId/fragments/:fragmentId/tags` | `{ tag }` | `{ ok: true }` |
| `DELETE` | `/stories/:storyId/fragments/:fragmentId/tags` | `{ tag }` | `{ ok: true }` |

### Refs

| Method | Path | Body | Response |
|---|---|---|---|
| `GET` | `/stories/:storyId/fragments/:fragmentId/refs` | — | `{ refs: string[], backRefs: string[] }` |
| `POST` | `/stories/:storyId/fragments/:fragmentId/refs` | `{ targetId }` | `{ ok: true }` |
| `DELETE` | `/stories/:storyId/fragments/:fragmentId/refs` | `{ targetId }` | `{ ok: true }` |

### Sticky & placement

| Method | Path | Body | Response |
|---|---|---|---|
| `PATCH` | `/stories/:storyId/fragments/:fragmentId/sticky` | `{ sticky: boolean }` | `{ ok: true, sticky }` |
| `PATCH` | `/stories/:storyId/fragments/:fragmentId/placement` | `{ placement: "system" \| "user" }` | `{ ok: true, placement }` |

### Reorder

| Method | Path | Body | Response |
|---|---|---|---|
| `PATCH` | `/stories/:storyId/fragments/reorder` | `{ items: [{ id, order }] }` | `{ ok: true }` |

### Fragment types

| Method | Path | Response |
|---|---|---|
| `GET` | `/stories/:storyId/fragment-types` | `[{ type, prefix, stickyByDefault }]` |

### Prose chain

| Method | Path | Body | Response |
|---|---|---|---|
| `GET` | `/stories/:storyId/prose-chain` | — | `{ entries: [{ proseFragments: [...], active }] }` (fragments expanded with id, name, description, createdAt, generationMode) |
| `POST` | `/stories/:storyId/prose-chain` | `{ fragmentId }` | `{ ok: true }` (append section) |
| `POST` | `/stories/:storyId/prose-chain/:sectionIndex/switch` | `{ fragmentId }` | `{ ok: true }` (switch active variation) |
| `DELETE` | `/stories/:storyId/prose-chain/:sectionIndex` | — | `{ ok: true, archivedFragmentIds }` (removes section, archives fragments) |

### Chapters

| Method | Path | Body | Response |
|---|---|---|---|
| `POST` | `/stories/:storyId/chapters` | `{ name, description?, content?, position }` | `{ fragment }` (creates marker + inserts into chain) |
| `POST` | `/stories/:storyId/chapters/:fragmentId/summarize` | — | `{ summary, reasoning, modelId, durationMs }` |

### Branches

| Method | Path | Body | Response |
|---|---|---|---|
| `GET` | `/stories/:storyId/branches` | — | `BranchesIndex` |
| `POST` | `/stories/:storyId/branches` | `{ name, parentBranchId, forkAfterIndex? }` | `BranchMeta` |
| `PATCH` | `/stories/:storyId/branches/active` | `{ branchId }` | `{ ok: true }` |
| `PUT` | `/stories/:storyId/branches/:branchId` | `{ name }` | `BranchMeta` |
| `DELETE` | `/stories/:storyId/branches/:branchId` | — | `{ ok: true }` |

### Story export/import

| Method | Path | Body | Response |
|---|---|---|---|
| `GET` | `/stories/:storyId/export` | Query: `?includeLogs=true&includeLibrarian=true` | ZIP file (binary) |
| `POST` | `/stories/import` | `multipart/form-data` with `file` field | `StoryMeta` |

## Import/Export Format

Errata's clipboard and file export uses a JSON envelope format. Source: `src/lib/fragment-clipboard.ts`.

### Single fragment export

```json
{
  "_errata": "fragment",
  "version": 1,
  "source": "uuid-of-source-instance",
  "exportedAt": "2025-01-15T10:30:00.000Z",
  "fragment": {
    "type": "character",
    "name": "Elena Vasquez",
    "description": "A retired detective drawn back into one last case.",
    "content": "Elena is 52, sharp-eyed, with silver-streaked hair...",
    "tags": ["protagonist", "detective"],
    "sticky": false
  },
  "attachments": [
    {
      "kind": "image",
      "name": "Elena portrait",
      "description": "Character portrait",
      "content": "data:image/png;base64,...",
      "boundary": { "x": 0, "y": 0, "width": 512, "height": 512 }
    }
  ]
}
```

The `_errata` field identifies the format. `"fragment"` for single fragments, `"fragment-bundle"` for multi-fragment bundles.

### Bundle export

```json
{
  "_errata": "fragment-bundle",
  "version": 1,
  "source": "uuid-of-source-instance",
  "exportedAt": "2025-01-15T10:30:00.000Z",
  "storyName": "The Last Case",
  "fragments": [
    {
      "type": "character",
      "name": "Elena Vasquez",
      "description": "A retired detective.",
      "content": "Elena is 52...",
      "tags": ["protagonist"],
      "sticky": false
    },
    {
      "type": "guideline",
      "name": "Noir tone",
      "description": "Maintain noir atmosphere.",
      "content": "Write in a hardboiled noir style...",
      "tags": ["style"],
      "sticky": true
    }
  ]
}
```

### Importing via API

The export format is a client-side convenience. To import programmatically, use the fragment CRUD endpoints directly:

1. `POST /api/stories` — create a story.
2. `POST /api/stories/:storyId/fragments` — create each fragment.
3. `POST /api/stories/:storyId/prose-chain` — add prose fragments to the chain in order.

## Porting Guide: SillyTavern / TavernAI to Errata

This section maps SillyTavern concepts to Errata fragments and walks through importing a conversation history.

### Concept mapping

| SillyTavern | Errata | Notes |
|---|---|---|
| Message (assistant) | `prose` fragment in prose chain | Each assistant message becomes a prose fragment. |
| Message (user) | `prose` fragment in prose chain | User messages also become prose fragments. Prefix with the character/user name if desired. |
| Character card | `character` fragment | Name, description, personality go into content. |
| Character card — system prompt | `guideline` fragment with `sticky: true` | System prompts map to always-on guidelines. |
| Character card — scenario | `knowledge` fragment | The scenario/setting becomes world knowledge. |
| Character card — first message | First `prose` fragment in chain | The greeting becomes the opening prose entry. |
| Character card — example messages | `guideline` fragment | Example dialogue becomes a style/voice guideline. |
| World Info / Lorebook entry | `knowledge` or `guideline` fragment | Each lorebook entry becomes a fragment. Type is inferred from `constant`/`position` fields (see [lorebook heuristic](#lorebook-entry-type-heuristic)). Activation `keys` become fragment tags. The UI import dialog allows overriding the inferred type per-entry. |
| Author's Note | `guideline` fragment with `sticky: true` | Author's notes that should always be in context. |
| System prompt (global) | `guideline` fragment with `sticky: true`, `placement: "system"` | Use `placement: "system"` to put it in the system message. |

### Step-by-step import

#### 1. Create the story

```bash
curl -X POST http://localhost:7739/api/stories \
  -H "Content-Type: application/json" \
  -d '{"name": "Imported Chat", "description": "Imported from SillyTavern"}'
```

Save the returned `id` (e.g. `imported-chat-lk5abc`).

#### 2. Import the character card

```bash
curl -X POST http://localhost:7739/api/stories/imported-chat-lk5abc/fragments \
  -H "Content-Type: application/json" \
  -d '{
    "type": "character",
    "name": "Elena",
    "description": "A retired detective drawn back into one last case.",
    "content": "Elena is 52, sharp-eyed, with silver-streaked hair. She speaks in clipped sentences and never fully trusts anyone.",
    "tags": ["protagonist"]
  }'
```

If the character card has a system prompt, create a sticky guideline:

```bash
curl -X POST http://localhost:7739/api/stories/imported-chat-lk5abc/fragments \
  -H "Content-Type: application/json" \
  -d '{
    "type": "guideline",
    "name": "System Prompt",
    "description": "Imported system prompt from character card.",
    "content": "You are roleplaying as Elena. Stay in character at all times. Write in third person.",
    "tags": ["imported", "system-prompt"]
  }'
```

The guideline will be sticky by default (the server applies `stickyByDefault` from the type registry).

#### 3. Import world info / lorebook

```bash
curl -X POST http://localhost:7739/api/stories/imported-chat-lk5abc/fragments \
  -H "Content-Type: application/json" \
  -d '{
    "type": "knowledge",
    "name": "The City of Ashvale",
    "description": "Setting information for the noir city.",
    "content": "Ashvale is a sprawling coastal city perpetually shrouded in fog...",
    "tags": ["setting", "ashvale"]
  }'
```

#### 4. Import the message history as prose fragments

For each message in the conversation, create a prose fragment and add it to the chain:

```bash
# First message (the character's greeting / first_mes)
curl -X POST http://localhost:7739/api/stories/imported-chat-lk5abc/fragments \
  -H "Content-Type: application/json" \
  -d '{
    "type": "prose",
    "name": "Opening",
    "description": "Elena greeting.",
    "content": "Elena sat at the bar, nursing a whiskey. She looked up as the door opened. \"You must be the one they sent,\" she said, not bothering to stand."
  }'
# Returns { "id": "pr-bakife", ... }

# Add to prose chain
curl -X POST http://localhost:7739/api/stories/imported-chat-lk5abc/prose-chain \
  -H "Content-Type: application/json" \
  -d '{"fragmentId": "pr-bakife"}'

# Second message
curl -X POST http://localhost:7739/api/stories/imported-chat-lk5abc/fragments \
  -H "Content-Type: application/json" \
  -d '{
    "type": "prose",
    "name": "Response",
    "description": "User response to Elena.",
    "content": "I pulled up a stool next to her. \"Word travels fast in this town. I hear you'\''re the best.\""
  }'
# Returns { "id": "pr-gomazu", ... }

curl -X POST http://localhost:7739/api/stories/imported-chat-lk5abc/prose-chain \
  -H "Content-Type: application/json" \
  -d '{"fragmentId": "pr-gomazu"}'
```

Repeat for each message. The prose chain preserves insertion order — each `POST` appends to the end.

#### 5. Optional: add chapter markers

If you want to break the imported conversation into chapters:

```bash
curl -X POST http://localhost:7739/api/stories/imported-chat-lk5abc/chapters \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Chapter 2: The Investigation",
    "position": 5
  }'
```

The `position` is the index in the prose chain where the marker is inserted (0-based, shifts subsequent entries).

### Character card import (PNG + JSON)

Errata includes a built-in importer for TavernAI / SillyTavern character cards (`src/lib/importers/tavern-card.ts`). Both PNG and raw JSON formats are supported, including `character_book` (lorebook/world book) entries.

#### Supported formats

| Format | Spec | How it works |
|---|---|---|
| PNG (`.png`) | V2 `chara` / V3 `ccv3` | JSON embedded as base64 in PNG `tEXt` chunks |
| JSON (`.json`) | V2 / V3 | Raw JSON with `data.name` + card fields, or `spec` field |

Both formats can contain a `character_book` object with lorebook entries.

#### What gets imported

The importer builds a list of **importable items** from a card. Each item maps to an Errata fragment:

| Card field | Errata type | Sticky | Placement | Notes |
|---|---|---|---|---|
| Main character (`name` + `description` + `personality`) | `character` | No | `user` | Always present, always enabled |
| `scenario` | `knowledge` | No | `user` | Only when non-empty |
| `first_mes` | `prose` | No | `user` | Added to prose chain on import |
| `system_prompt` | `guideline` | Yes | `system` | Only when non-empty |
| `character_book` entries | Inferred | Varies | Varies | See heuristic below |

#### Lorebook entry type heuristic

Each lorebook entry is assigned an Errata fragment type based on its properties:

- `constant: true` OR `position: "before_char"` → **guideline** (sticky, system placement)
- Otherwise → **knowledge**

Users can override the suggested type per-entry in the import dialog before importing.

#### Lorebook entry mapping

| Lorebook field | Errata field | Notes |
|---|---|---|
| `name` or `comment` or first 3 `keys` | Fragment `name` | Falls back in order |
| `content` | Fragment `content` | Full text |
| `content` (truncated to 250 chars) | Fragment `description` | Auto-truncated |
| `keys` | Fragment `tags` | Activation keywords become tags |
| `constant: true` | `sticky: true` | Always in context |
| `position: "before_char"` | `placement: "system"` | Placed in system message |
| `enabled` | Pre-checked in UI | Disabled entries are unchecked by default |
| `insertion_order`, `priority`, `selective`, `secondary_keys` | Fragment `meta` | Preserved for reference |

#### UI import flows

**Drag-and-drop onto a story:**
- PNG without lorebook → simple character card import (portrait + character fragment)
- PNG with lorebook → full import dialog with grouped item list and portrait thumbnail
- JSON file → full import dialog with grouped item list

**Drag-and-drop onto the homepage (no story):**
- Auto-creates a new story named after the character
- Navigates to the story and opens the import dialog

**URL fetch:**
- Paste a raw JSON URL (GitHub gist, CDN, etc.) into the import dialog
- Fetches and parses the card, showing all entries for selection

The import dialog groups items by source (Character, Card Extras, Lorebook) and allows per-entry type override, select/deselect all, and shows content previews with tag badges.

#### Programmatic API

```ts
import {
  // PNG functions
  extractTavernCards,
  importTavernCard,
  isTavernCardPng,
  extractParsedCard,
  // JSON functions
  parseCardJson,
  isTavernCardJson,
  // Shared
  buildImportableItems,
  inferEntryType,
} from '@/lib/importers/tavern-card'

// PNG character card (simple — character fragment only)
const buffer: ArrayBuffer = await file.arrayBuffer()
if (isTavernCardPng(buffer)) {
  const character = importTavernCard(buffer)
  // character.type === 'character'
  // character.name, .description, .content, .tags, .meta
}

// PNG character card (full — with lorebook items)
const parsed = extractParsedCard(buffer)
if (parsed) {
  // parsed.card — TavernCardData (name, description, characterBook, etc.)
  // parsed.book — CharacterBook | null (lorebook entries)
  // parsed.items — ImportableItem[] (all items ready for import)
}

// JSON character card
const text = await file.text()
const parsed = parseCardJson(text)
if (parsed) {
  // Same shape as extractParsedCard result
  // parsed.card, parsed.book, parsed.items
}

// Quick detection
isTavernCardJson(jsonString) // true if valid card JSON
isTavernCardPng(arrayBuffer) // true if valid card PNG
```

### Writing a bulk importer script

Here's the general pattern for a Node.js/Bun script that imports a SillyTavern chat export:

```ts
const BASE = 'http://localhost:7739/api'

async function importChat(storyName: string, messages: Array<{ role: string; content: string }>) {
  // 1. Create story
  const story = await fetch(`${BASE}/stories`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: storyName, description: 'Imported from SillyTavern' }),
  }).then(r => r.json())

  // 2. Create prose fragments and build chain
  for (const msg of messages) {
    const fragment = await fetch(`${BASE}/stories/${story.id}/fragments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'prose',
        name: `[${msg.role}] ${msg.content.slice(0, 80)}`,
        description: msg.content.slice(0, 250),
        content: msg.content,
      }),
    }).then(r => r.json())

    await fetch(`${BASE}/stories/${story.id}/prose-chain`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fragmentId: fragment.id }),
    })
  }

  return story
}
```

### Tips for importers

- **Fragment names** are max 100 chars. Truncate long message previews.
- **Fragment descriptions** are max 250 chars.
- **Fragment IDs** are auto-generated by the API — you don't need to generate them yourself when using the HTTP endpoints.
- **Sticky defaults** are applied server-side based on the fragment type. Guidelines default to `sticky: true`. If you want a non-sticky guideline, update it after creation via `PATCH /sticky`.
- **Order matters** for the prose chain. Add fragments to the chain in chronological order.
- **Branching** is optional. All content starts on the `main` branch. You can create branches later via the API.
- **Archived fragments** won't appear in regular listings. Use archiving for superseded content, not deletion.
- The API returns full fragment objects on creation, so you always have the generated `id` for the next step.

## File Reference

| File | Purpose |
|---|---|
| `src/server/fragments/schema.ts` | Zod schemas for Fragment, ProseChain, StoryMeta, Branches |
| `src/server/fragments/storage.ts` | Filesystem CRUD for stories and fragments |
| `src/server/fragments/prose-chain.ts` | Prose chain read/write operations |
| `src/server/fragments/registry.ts` | Fragment type registry (built-in types + plugin types) |
| `src/server/fragments/branches.ts` | Branch management, content root resolution |
| `src/server/fragments/associations.ts` | Tag and ref index management |
| `src/lib/fragment-ids.ts` | ID generation with prefix map and consonant-vowel alternation |
| `src/lib/fragment-clipboard.ts` | Export/import JSON envelope format |
| `src/lib/importers/tavern-card.ts` | TavernAI / SillyTavern character card parser (PNG + JSON, lorebook) |
| `src/components/fragments/CharacterCardImportDialog.tsx` | Import dialog for character cards with lorebook entries |
| `src/components/fragments/TavernCardImportDialog.tsx` | Simple PNG character card import dialog (no lorebook) |
| `src/server/api.ts` | All HTTP API endpoints |
