# Character Chat

Character Chat lets you talk to a character as if they were in-world, constrained by story context and the selected story point.

## Overview

- Conversations are stored per-story on disk and can be listed, resumed, or deleted.
- Chat responses stream as NDJSON events (`text`, `reasoning`, `tool-call`, `tool-result`, `finish`).
- The chat agent uses read-only fragment tools so it can look things up without mutating story data.
- Model routing supports character-chat-specific provider/model settings with fallback to story defaults.

## Data Model

Conversation storage type (`src/server/character-chat/storage.ts`):

```ts
type PersonaMode =
  | { type: 'character'; characterId: string }
  | { type: 'stranger' }
  | { type: 'custom'; prompt: string }
```

```ts
interface CharacterChatConversation {
  id: string
  characterId: string
  persona: PersonaMode
  storyPointFragmentId: string | null
  title: string
  messages: Array<{
    role: 'user' | 'assistant'
    content: string
    reasoning?: string
    createdAt: string
  }>
  createdAt: string
  updatedAt: string
}
```

## Storage Layout

Character chat data is stored under the active content root:

```text
data/stories/<storyId>/
  character-chat/
    conversations/
      cc-<timestamp>-<random>.json
```

`storyPointFragmentId` acts as a context cutoff. The agent only sees story context up to that point.

## API

Routes are defined in `src/server/api.ts`.

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/stories/:storyId/character-chat/conversations` | List conversations (optional `?characterId=...`) |
| `GET` | `/stories/:storyId/character-chat/conversations/:conversationId` | Get one conversation |
| `POST` | `/stories/:storyId/character-chat/conversations` | Create a conversation |
| `DELETE` | `/stories/:storyId/character-chat/conversations/:conversationId` | Delete a conversation |
| `POST` | `/stories/:storyId/character-chat/conversations/:conversationId/chat` | Stream character response |

### Create conversation payload

```json
{
  "characterId": "ch-ab12",
  "persona": { "type": "stranger" },
  "storyPointFragmentId": "pr-xy12",
  "title": "Interrogation in the courtyard"
}
```

### Chat payload

```json
{
  "messages": [
    { "role": "user", "content": "What happened in the archive fire?" }
  ]
}
```

### Streaming format (NDJSON)

Example events from `/chat` stream:

```json
{"type":"text","text":"I remember smoke before I saw flames..."}
{"type":"tool-call","id":"...","toolName":"fragmentGet","args":{"id":"pr-ab12"}}
{"type":"tool-result","id":"...","toolName":"fragmentGet","result":{"ok":true}}
{"type":"finish","finishReason":"stop","stepCount":2}
```

## Provider/Model Selection

Character chat resolves models with role `character-chat` (`src/server/llm/client.ts`) using this preference order:

1. `story.settings.characterChatProviderId` + `story.settings.characterChatModelId`
2. Fallback to story generation defaults: `providerId` + `modelId`

## Frontend Integration

- Main UI: `src/components/character-chat/CharacterChatView.tsx`
- Shared message rendering: `src/components/chat/ChatMessageParts.tsx`
- Client API wrapper: `src/lib/api/character-chat.ts`
- Story route toggle: `src/routes/story.$storyId.tsx`

The Character Chat view is mounted from the story route, and the view toggle is hidden while the user is inside chat mode.

## Related Files

- `src/server/character-chat/chat.ts`
- `src/server/character-chat/llm-agents.ts`
- `src/server/character-chat/storage.ts`
- `src/server/character-chat/agents.ts`
- `tests/character-chat/chat.test.ts`
- `tests/character-chat/storage.test.ts`
