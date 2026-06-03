# Ask AI Tab — Design Spec

**Date:** 2026-06-03
**Status:** Approved, pending implementation plan

## Goal

Add a dedicated "Ask AI" tab to the sidebar that provides a full-page chat interface with the AI assistant, alongside a brand overview panel for context. The existing floating bubble stays on all other pages.

## Architecture

Three files change, one new file is created. The existing `useAssistant` hook, `AssistantBubble`, and `AssistantPanel` are untouched — the new page composes its own chat UI using the same hook.

## Files

| Action | Path | Responsibility |
|--------|------|----------------|
| Modify | `src/components/Sidebar.tsx` | Add Ask AI nav item |
| Create | `src/pages/AskAI.tsx` | Full-page chat layout |
| Modify | `src/App.tsx` | Add `/ask-ai` route, hide bubble on that route |
| No change | `src/hooks/useAssistant.ts` | Already builds bp+lp digest |

## 1. Sidebar — Ask AI nav item

Add to the `PAGES` array in `Sidebar.tsx`, after FTDs:

```ts
{ path: '/ask-ai', label: 'Ask AI', icon: <Sparkles icon (lucide-react)> }
```

No brand sub-list for this route (it's not a BP/LP route). The existing `hasBrandList` logic handles this automatically.

## 2. AskAI page — layout

Two-column layout:

**Left panel (320px, fixed width, scrollable):**
- Header: "What I know" title
- Brand cards — one per brand, showing: brand name (colored dot), total ranking keywords, avg position, top-3 count. Data sourced from `digest.bp.timeline[0].perBrand` and `digest.lp.timeline[0].perBrand`.
- Suggested questions section below the cards — same 5 starter chips as the floating panel, but rendered as a vertical list of clickable items that send to the chat.

**Right panel (flex-1, full height):**
- Header bar: "Ask AI" title + Sparkles icon + Reset button (clears chat)
- Messages area (scrollable, flex-1): same bubble rendering as AssistantPanel — user messages right-aligned dark, assistant messages left-aligned light
- Streaming cursor (…) while response is loading
- Error row in red if request fails
- Bottom bar: Summarize button + text input + Send/Stop button

**Empty state:** when no messages, show "Ask about rankings, trends, or specific keyword positions across all brands and sites." in the messages area.

**Offline state:** if `reachable === false`, show the offline message and disable input (same logic as AssistantPanel).

## 3. App.tsx changes

- Add `import { AskAI } from './pages/AskAI'`
- Add route: `<Route path="/ask-ai" element={<AskAI />} />`
- Hide floating `AssistantBubble` when on `/ask-ai`: wrap its render in `location.pathname !== '/ask-ai'`

## 4. AskAI hook usage

```ts
const { messages, isStreaming, error, reachable, send, summarize, stop, reset } =
  useAssistant(snapshots, 'bp-sites')   // category param unused — hook builds both bp+lp
```

`hasData` = `snapshots.length > 0`

## Styling

Follows existing design tokens: `bg-white`, `border-[#E2E8F0]`, `text-[#0F172A]`, `rounded-[10px]`, dark background `#07090F`. Left panel has a right border separator. Brand dot colors from `brand.color` in `brands.ts`.

## Out of scope

Chat history persistence across page navigations (resets on unmount — same as bubble). Mobile layout optimization. Any changes to the floating bubble behavior on other pages.
