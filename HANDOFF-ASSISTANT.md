# Handoff: KiCad AI Assistant Panel

## What This Is

A fork of KiCad 10.99 (development branch) with an integrated AI assistant panel. The panel is a WebView-based chat interface docked on the right side of all three KiCad applications (Project Manager, Eeschema, PCBnew). It includes a working JS-to-C++ message bridge and a unified dark theme applied across the entire manager frame.

The panel currently echoes user messages back. There is no AI backend connected yet.

## Quick Start

```bash
cd kicad-master/build-assistant
ninja -j$(sysctl -n hw.ncpu) kicad    # ~2 min incremental, ~20 min clean
open kicad/kicad.app
# View > Panels > Assistant to toggle the panel
```

Build prerequisites: CMake 4+, Ninja, wxWidgets 3.3.2, protobuf, KiCad's full dependency set. The existing build-assistant/ directory has a working CMakeCache -- don't delete it.

Known build issue: `_eeschema.kiface` and `_pcbnew.kiface` compile successfully but don't always land in the correct bundle path. The main KiCad manager app launches fine; opening Eeschema/PCBnew from within it may fail with a kiface loading error. This is a macOS app bundle assembly issue, not a compilation problem.

## Architecture

```
ASSISTANT_PANEL (wxPanel)
    |
    +-- WEBVIEW_PANEL (wxWebView wrapper)
    |       |
    |       +-- Generated HTML/CSS/JS page
    |       |       - Chat bubble UI (Cursor/Antigravity style)
    |       |       - JS event handlers for send, Enter key, auto-resize
    |       |       - window.appendMessage() callable from C++
    |       |
    |       +-- Message handler: "assistant"
    |               JS calls: window.webkit.messageHandlers.assistant.postMessage(text)
    |               C++ receives via: WEBVIEW_PANEL::OnScriptMessage -> callback
    |
    +-- m_messages: std::vector<ASSISTANT_MESSAGE>
    |       In-memory conversation history (user + agent turns)
    |       Not persisted to disk yet
    |
    +-- ASSISTANT_PANEL_HOST (interface)
            Implemented by all three frame classes
            Provides: GetAssistantPanelContext() -> project/document metadata
```

### Message Flow (Working)

```
User types in textarea
    -> JS: send() fires on Enter or button click
    -> JS: window.webkit.messageHandlers.assistant.postMessage(text)
    -> C++: WEBVIEW_PANEL::OnScriptMessage dispatches to "assistant" handler
    -> C++: ASSISTANT_PANEL::onUserMessage(text)
        -> Stores ASSISTANT_MESSAGE{USER, text} in m_messages
        -> Calls appendMessageToDOM() which runs:
           m_webView->RunScriptAsync("window.appendMessage('user', 'escaped text')")
        -> Creates echo response ASSISTANT_MESSAGE{AGENT, "Echo: " + text}
        -> Calls appendMessageToDOM() again for the agent message
    -> JS: window.appendMessage() creates DOM elements, scrolls to bottom
```

The echo in `onUserMessage()` at `assistant_panel.cpp:1081` is the replacement point for a real backend.

### Context Refresh Flow

Each frame calls `refreshAssistantPanel()` on significant events (project open/close, file save, ERC completion, etc.). This calls `ASSISTANT_PANEL::RefreshContext()` which rebuilds the entire HTML page from `m_messages` + current context. This means conversation history survives context refreshes but any JS state (scroll position, textarea content) is lost.

## Files Modified (From Upstream KiCad)

### Core Assistant Panel (new files)

| File | Lines | Purpose |
|------|-------|---------|
| `kicad/assistant_panel.h` | 91 | Header: ASSISTANT_PANEL, ASSISTANT_MESSAGE, ASSISTANT_PANEL_HOST, ASSISTANT_PANEL_CONTEXT |
| `kicad/assistant_panel.cpp` | 1120 | Implementation: HTML/CSS/JS generation, message handlers, DOM injection |

### Frame Integration (modified files)

| File | What Changed |
|------|-------------|
| `kicad/kicad_manager_frame.h` | Added ASSISTANT_PANEL_HOST inheritance, member vars for panel |
| `kicad/kicad_manager_frame.cpp` | Panel creation in AUI, dark theme colors on frame/tree/toolbar/launcher/statusbar, toggle/refresh methods |
| `kicad/menubar.cpp` | Added View > Panels > Assistant menu item |
| `kicad/tools/kicad_manager_actions.h/cpp` | Defined showAssistantPanel action |
| `kicad/tools/kicad_manager_control.h/cpp` | ToggleAssistantPanel() handler |
| `kicad/project_tree_pane.cpp` | Dark border colors in onPaint(), added kiplatform/ui.h include |
| `eeschema/sch_edit_frame.h/cpp` | ASSISTANT_PANEL_HOST, panel creation, toggle, context provider |
| `eeschema/eeschema_settings.h/cpp` | show_assistant_panel, assistant_panel_width persistence |
| `eeschema/menubar.cpp` | View > Panels > Assistant |
| `eeschema/tools/sch_editor_control.h/cpp` | ShowAssistantPanel() |
| `pcbnew/pcb_edit_frame.h/cpp` | Same pattern as eeschema |
| `pcbnew/pcbnew_settings.h/cpp` | Same settings pattern |
| `pcbnew/menubar_pcb_editor.cpp` | View > Panels > Assistant |
| `pcbnew/tools/board_editor_control.h/cpp` | ToggleAssistantPanel() |
| `pcbnew/toolbars_pcb_editor.cpp` | Minor toolbar change |

### Shared Infrastructure (modified files)

| File | What Changed |
|------|-------------|
| `common/tool/actions.cpp` | Global `ACTIONS::showAssistantPanel` definition |
| `include/tool/actions.h` | Declaration |
| `common/settings/kicad_settings.cpp` | m_ShowAssistantPanel, m_AssistantPanelWidth params |
| `include/settings/kicad_settings.h` | Member declarations |
| `common/widgets/wx_aui_art_providers.cpp` | Dark theme colors in WX_AUI_DOCK_ART constructor |

### Build System

| File | What Changed |
|------|-------------|
| `kicad/CMakeLists.txt` | assistant_panel.cpp added to KICAD_SRCS (line ~35) |
| `eeschema/CMakeLists.txt` | `../kicad/assistant_panel.cpp` added (line 361) |
| `pcbnew/CMakeLists.txt` | `../kicad/assistant_panel.cpp` added (line 367) |

## Dark Theme System

The dark theme is applied conditionally when `KIPLATFORM::UI::IsDarkTheme()` returns true (which it does on macOS dark mode).

**AUI dock art** (`common/widgets/wx_aui_art_providers.cpp`): Sets pane border, sash, background, caption, and gripper colors. Thins sash to 2px. This affects all three apps globally since they share `WX_AUI_DOCK_ART`.

**Manager frame** (`kicad/kicad_manager_frame.cpp`): After AUI setup, walks the widget tree to set background/foreground on toolbar, project tree + children, notebook, launcher + scrolled window + static text labels, and status bar.

**Project tree paint** (`kicad/project_tree_pane.cpp`): Border lines in onPaint() use dark colors instead of system colors.

Color palette (CSS variable names from assistant_panel.cpp):
```
--bg:         #1b1d23    Frame background, launcher
--bg-2:       #222430    Surfaces (toolbar, tree pane, status bar, agent bubbles)
--bg-3:       #2a2d3a    Hover states, elevated surfaces
--border:     #2e3244    AUI sash/borders, pane dividers
--border-2:   #3d4155    Composer box border, brighter interactive borders
--text:       #d4d8e8    Primary text
--text-2:     #8c92a8    Secondary text, inactive captions
--text-3:     #5c6178    Tertiary text, placeholders
--accent:     #6b8afd    User chat bubbles, send button, focus glow
```

## What Works

- Panel toggles on/off via View > Panels > Assistant in all three apps
- Panel width and visibility persist in settings across sessions
- Panel content updates on project open/close, file save, ERC/DRC completion
- User can type messages, hit Enter or click send
- Messages appear as chat bubbles (user = blue right-aligned, agent = dark left-aligned)
- Send button enables/disables based on textarea content
- Textarea auto-resizes up to 120px
- Conversation history survives context refreshes within a session
- Dark theme is cohesive across the manager frame

## What Does Not Work

- **No AI backend.** `onUserMessage()` echoes input. This is the single replacement point.
- **No message persistence.** `m_messages` is in-memory only. Closing the panel or app loses history.
- **Full page rebuild on context refresh.** `RefreshContext()` calls `SetPage()` which rebuilds everything. This clears JS state. A smarter approach would only update the context-dependent parts (header, status bar, footer).
- **Eeschema/PCBnew kiface loading.** The kiface files compile but the macOS bundle doesn't always place them correctly. The assistant panel code IS compiled into both kiface targets -- the issue is purely app bundle assembly.
- **Native widget colors.** wxTreeCtrl selection highlight, BITMAP_BUTTON backgrounds, and scrollbars use macOS native drawing. `SetBackgroundColour` doesn't fully control these.
- **No dark theme for eeschema/pcbnew frames.** The AUI dock art applies globally, but the per-frame `SetBackgroundColour` calls only exist in `kicad_manager_frame.cpp`. Eeschema and PCBnew would need the same treatment in their constructors.

## Next Steps (In Priority Order)

### 1. Replace Echo With Claude API

In `assistant_panel.cpp`, `onUserMessage()` at line 1081:

```cpp
void ASSISTANT_PANEL::onUserMessage( const wxString& aText )
{
    // Store user message
    m_messages.push_back( { ASSISTANT_MESSAGE::USER, aText } );
    appendMessageToDOM( m_messages.back() );

    // THIS IS THE REPLACEMENT POINT
    // Currently echoes. Replace with backend call.
    wxString echo = wxString::Format( _( "Echo: %s" ), aText );
    m_messages.push_back( { ASSISTANT_MESSAGE::AGENT, echo } );
    appendMessageToDOM( m_messages.back() );
}
```

**Recommended approach:** Sidecar process. A TypeScript/Python process running alongside KiCad, communicating via:
- Option A: kiapi protobuf socket (already enabled, `KICAD_IPC_API: ON` in CMakeCache)
- Option B: Local HTTP server (simpler to prototype)
- Option C: Unix domain socket or named pipe

The sidecar handles the Claude API call, streams tokens back. The C++ side relays between WebView and sidecar.

**Why not in-process:** C++ HTTP clients are painful. The Anthropic SDK exists in TypeScript and Python. A sidecar lets you iterate on agent logic without recompiling KiCad.

### 2. Streaming Responses

The current `appendMessageToDOM()` injects a complete message. For streaming:

1. Add a JS function `window.startAgentMessage()` that creates an empty agent bubble and returns its ID
2. Add `window.appendToMessage(id, chunk)` that appends text to that bubble
3. Add `window.finalizeMessage(id)` that marks it complete
4. Call these from C++ as chunks arrive from the sidecar

### 3. Markdown Rendering

Agent responses need markdown. Options:
- Inject a lightweight JS markdown library (marked.js is ~30KB)
- Do markdown-to-HTML conversion in C++ before injection
- Use a simple regex-based converter for bold, code, lists (covers 90% of cases)

### 4. Tool Use / Function Calling

KiCad has two tool execution mechanisms:

**kiapi** (protobuf over Unix socket):
- `editor_commands.proto`: save, create items, selection, transactions
- `schematic_commands.proto`: schematic operations
- `board_commands.proto`: PCB operations
- Structured, versioned, request/response

**TOOL_ACTION system** (internal):
- `ACTIONS::*` for global actions
- `SCH_ACTIONS::*` for ~100+ schematic operations
- `PCB_ACTIONS::*` for board operations
- Invokable via `TOOL_MANAGER::RunAction()`
- Unstable API

Start with read-only tools: component list, net list, ERC/DRC results. These are safe and immediately useful.

### 5. Dark Theme for Eeschema/PCBnew

Copy the `IsDarkTheme()` block from `kicad_manager_frame.cpp` into:
- `eeschema/sch_edit_frame.cpp` (after AUI setup, ~line 350)
- `pcbnew/pcb_edit_frame.cpp` (after AUI setup, ~line 450)

Adapt for each frame's child widgets (properties panel, hierarchy panel, etc.).

### 6. Message Persistence

Options:
- JSON file per project: `~/.config/kicad/assistant/<project-hash>.json`
- SQLite (KiCad already uses sqlite for other things)
- Per-project directory: `.kicad_assistant/history.json`

### 7. Fix Kiface Bundle Assembly

The `_eeschema.kiface` and `_pcbnew.kiface` need to land in `KiCad.app/Contents/PlugIns/`. Check the CMake install rules and the macOS bundle post-build steps. The files compile fine -- it's a deployment path issue.

## Key Files to Read First

If you're picking this up cold, read in this order:

1. `kicad/assistant_panel.h` -- 91 lines, full API surface
2. `kicad/assistant_panel.cpp` lines 1040-1120 -- constructor, message handler, echo logic
3. `kicad/assistant_panel.cpp` lines 89-696 -- CSS (understand the visual design)
4. `kicad/assistant_panel.cpp` lines 950-1035 -- JS block (understand the message bridge)
5. `common/widgets/webview_panel.h` -- the WebView wrapper API
6. `kicad/kicad_manager_frame.cpp` lines 268-380 -- panel creation and dark theme setup

## Build Notes

- Debug build, arm64 macOS
- Ninja generator, ~2142 compilation units
- Incremental rebuild after touching assistant_panel.cpp: ~15 seconds
- Incremental rebuild after touching common/: ~2 minutes (relinks everything)
- `KICAD_IPC_API: ON` in CMakeCache (kiapi socket enabled)
- wxWebView uses native macOS WKWebView (no Chromium dependency)
- KiCad version: 10.99 development branch (post-10.0 release)
