/*
 * This program source code file is part of KiCad, a free EDA CAD application.
 *
 * Copyright The KiCad Developers, see AUTHORS.txt for contributors.
 *
 * This program is free software: you can redistribute it and/or modify it
 * under the terms of the GNU General Public License as published by the
 * Free Software Foundation, either version 3 of the License, or (at your
 * option) any later version.
 *
 * This program is distributed in the hope that it will be useful, but
 * WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU
 * General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License along
 * with this program.  If not, see <http://www.gnu.org/licenses/>.
 */

#include "assistant_panel.h"

#include <string_utils.h>
#include <widgets/webview_panel.h>
#include <wx/filename.h>
#include <wx/intl.h>
#include <wx/sizer.h>


namespace
{

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

wxString fileTail( const wxString& aPath )
{
    if( aPath.IsEmpty() )
        return wxEmptyString;

    return wxFileName( aPath ).GetFullName();
}


wxString safeProject( const ASSISTANT_PANEL_CONTEXT& ctx )
{
    if( !ctx.projectName.IsEmpty() )
        return ctx.projectName;

    if( !ctx.projectPath.IsEmpty() )
        return wxFileName( ctx.projectPath ).GetName();

    return wxEmptyString;
}


wxString editorLabel( const ASSISTANT_PANEL_CONTEXT& ctx )
{
    switch( ctx.kind )
    {
    case ASSISTANT_CONTEXT_KIND::SCHEMATIC: return _( "Schematic" );
    case ASSISTANT_CONTEXT_KIND::PCB:       return _( "PCB" );
    default:                                return _( "Project" );
    }
}


wxString inputPlaceholder( const ASSISTANT_PANEL_CONTEXT& ctx )
{
    if( !ctx.hasProject )
        return _( "Open a project first..." );

    switch( ctx.kind )
    {
    case ASSISTANT_CONTEXT_KIND::SCHEMATIC:
        return _( "Ask anything, @ to mention, / for workflow..." );
    case ASSISTANT_CONTEXT_KIND::PCB:
        return _( "Ask anything, @ to mention, / for workflow..." );
    default:
        return _( "Ask anything, @ to mention, / for workflow..." );
    }
}


// ---------------------------------------------------------------------------
// CSS -- modeled after Cursor/Antigravity agent panel
// ---------------------------------------------------------------------------

wxString buildCss()
{
    return wxS( R"CSS(
*,
*::before,
*::after {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
}

:root {
    --bg:         #1b1d23;
    --bg-2:       #222430;
    --bg-3:       #2a2d3a;
    --bg-user:    #1f2533;
    --bg-input:   #232633;
    --border:     #2e3244;
    --border-2:   #3d4155;
    --border-glow:#4a5070;
    --text:       #d4d8e8;
    --text-2:     #8c92a8;
    --text-3:     #5c6178;
    --white:      #eaedf6;
    --accent:     #6b8afd;
    --accent-2:   #7c9aff;
    --accent-dim: rgba(107,138,253,0.10);
    --accent-glow:rgba(107,138,253,0.25);
    --teal:       #5ccfb0;
    --teal-dim:   rgba(92,207,176,0.12);
    --orange:     #e0a67a;
    --purple:     #c98dda;
    --green:      #7dce82;
    --red:        #e06c75;
    --radius:     8px;
    --radius-lg:  12px;
    --font:       -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui,
                  sans-serif;
    --mono:       "SF Mono", "Fira Code", Menlo, monospace;
}

html, body {
    height: 100%;
    background: var(--bg);
    color: var(--text);
    font-family: var(--font);
    font-size: 13px;
    line-height: 1.5;
    -webkit-font-smoothing: antialiased;
    overflow: hidden;
}

/* ── Shell ────────────────────────────────────────────────── */

.shell {
    display: flex;
    flex-direction: column;
    height: 100vh;
    background: linear-gradient(180deg, #1d2028 0%, var(--bg) 100%);
}

/* ── Header ───────────────────────────────────────────────── */

.header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 14px;
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
    min-height: 42px;
    background: rgba(22, 24, 32, 0.8);
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
}

.header-title {
    flex: 1;
    min-width: 0;
    font-size: 13px;
    font-weight: 600;
    color: var(--white);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    letter-spacing: -0.01em;
}

.h-btn {
    width: 26px;
    height: 26px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: 1px solid transparent;
    border-radius: 6px;
    background: transparent;
    color: var(--text-2);
    cursor: pointer;
    flex-shrink: 0;
    transition: all 0.15s;
}

.h-btn:hover {
    background: var(--bg-3);
    border-color: var(--border);
    color: var(--text);
}

.h-btn svg {
    width: 14px;
    height: 14px;
    stroke: currentColor;
    fill: none;
    stroke-width: 1.8;
    stroke-linecap: round;
    stroke-linejoin: round;
}

/* ── Messages ─────────────────────────────────────────────── */

.messages {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    overflow-x: hidden;
    padding: 14px 12px;
    display: flex;
    flex-direction: column;
    gap: 10px;
}

.messages::-webkit-scrollbar {
    width: 5px;
}
.messages::-webkit-scrollbar-track {
    background: transparent;
}
.messages::-webkit-scrollbar-thumb {
    background: var(--border);
    border-radius: 3px;
}
.messages::-webkit-scrollbar-thumb:hover {
    background: var(--border-2);
}

/* ── User bubble ──────────────────────────────────────────── */

.m-user {
    display: flex;
    justify-content: flex-end;
    align-items: flex-end;
    gap: 6px;
    padding: 0;
}

.m-user-text {
    max-width: 85%;
    padding: 9px 14px;
    border-radius: 16px 16px 4px 16px;
    background: var(--accent);
    color: #fff;
    font-size: 13px;
    line-height: 1.55;
    font-weight: 450;
    word-break: break-word;
}

.m-retry {
    flex-shrink: 0;
    width: 20px;
    height: 20px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: none;
    border-radius: 5px;
    background: transparent;
    color: var(--text-3);
    cursor: pointer;
    opacity: 0;
    transition: all 0.15s;
    margin-bottom: 2px;
}

.m-user:hover .m-retry {
    opacity: 1;
}

.m-retry:hover {
    color: var(--text-2);
    background: var(--bg-3);
}

.m-retry svg {
    width: 12px;
    height: 12px;
    stroke: currentColor;
    fill: none;
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
}

/* ── Agent bubble ─────────────────────────────────────────── */

.m-agent {
    display: flex;
    justify-content: flex-start;
    padding: 0;
}

.m-agent-text {
    max-width: 90%;
    padding: 10px 14px;
    border-radius: 16px 16px 16px 4px;
    background: var(--bg-2);
    border: 1px solid var(--border);
}

.m-agent-text {
    font-size: 13px;
    line-height: 1.65;
    color: var(--text);
}

.m-agent-text strong {
    font-weight: 600;
    color: var(--white);
}

.m-agent-text code {
    font-family: var(--mono);
    font-size: 11.5px;
    padding: 2px 6px;
    border-radius: 5px;
    background: rgba(224, 166, 122, 0.10);
    border: 1px solid rgba(224, 166, 122, 0.12);
    color: var(--orange);
}

.m-agent-text ol,
.m-agent-text ul {
    padding-left: 20px;
    margin: 8px 0;
}

.m-agent-text li {
    margin: 5px 0;
    padding-left: 4px;
}

.m-agent-text li::marker {
    color: var(--text-3);
}

.m-agent-text p {
    margin: 8px 0;
}
.m-agent-text p:first-child {
    margin-top: 0;
}
.m-agent-text p:last-child {
    margin-bottom: 0;
}

/* ── Tool call / work indicator ──────────────────────────── */

.m-tool {
    padding: 6px 14px;
}

.m-tool-row {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 5px 10px;
    border-radius: var(--radius);
    background: var(--teal-dim);
    border: 1px solid rgba(92,207,176,0.10);
    font-size: 12px;
    color: var(--teal);
    cursor: pointer;
    transition: all 0.15s;
}

.m-tool-row:hover {
    background: rgba(92,207,176,0.18);
    border-color: rgba(92,207,176,0.20);
}

.m-tool-row svg {
    width: 13px;
    height: 13px;
    stroke: currentColor;
    fill: none;
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
    flex-shrink: 0;
}

.m-tool-label {
    font-weight: 600;
    font-size: 11px;
    letter-spacing: 0.01em;
}

.m-tool-chevron {
    width: 10px;
    height: 10px;
    stroke-width: 2.5;
    opacity: 0.7;
}

/* ── File pills ───────────────────────────────────────────── */

.m-files {
    padding: 6px 14px;
}

.m-files-header {
    font-size: 11px;
    font-weight: 600;
    color: var(--text-3);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    margin-bottom: 6px;
}

.m-files-list {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
}

.m-file {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 4px 10px;
    border-radius: 6px;
    background: var(--bg-3);
    border: 1px solid var(--border);
    font-size: 12px;
    color: var(--text);
    cursor: pointer;
    text-decoration: none;
    transition: all 0.15s;
}

.m-file:hover {
    background: rgba(107,138,253,0.08);
    border-color: rgba(107,138,253,0.20);
    color: var(--white);
}

.m-file-icon {
    color: var(--accent);
    font-size: 11px;
    font-weight: 700;
    font-family: var(--mono);
}

.m-file-ext {
    color: var(--text-3);
    font-size: 11px;
    margin-left: 2px;
}

/* ── Action row (copy, review changes, etc.) ──────────────── */

.m-actions {
    padding: 6px 14px 10px;
    display: flex;
    align-items: center;
    gap: 6px;
}

.m-act-btn {
    width: 28px;
    height: 28px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--bg-2);
    color: var(--text-3);
    cursor: pointer;
    transition: all 0.15s;
}

.m-act-btn:hover {
    background: var(--bg-3);
    color: var(--text);
    border-color: var(--border-2);
}

.m-act-btn svg {
    width: 13px;
    height: 13px;
    stroke: currentColor;
    fill: none;
    stroke-width: 1.8;
    stroke-linecap: round;
    stroke-linejoin: round;
}

.m-act-spacer {
    flex: 1;
}

.m-act-primary {
    height: 28px;
    padding: 0 12px;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    border: 1px solid var(--border-2);
    border-radius: var(--radius);
    background: var(--bg-3);
    color: var(--text);
    font-family: var(--font);
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
    white-space: nowrap;
    transition: all 0.15s;
}

.m-act-primary:hover {
    background: rgba(107,138,253,0.12);
    color: var(--white);
    border-color: rgba(107,138,253,0.30);
}

.m-act-primary svg {
    width: 13px;
    height: 13px;
    stroke: currentColor;
    fill: none;
    stroke-width: 1.8;
    stroke-linecap: round;
    stroke-linejoin: round;
}

/* ── Composer ─────────────────────────────────────────────── */

.composer-wrap {
    padding: 10px 12px 8px;
    flex-shrink: 0;
}

.composer-box {
    border: 1px solid var(--border-2);
    border-radius: var(--radius-lg);
    background: var(--bg-2);
    overflow: hidden;
    transition: border-color 0.2s, box-shadow 0.2s;
    box-shadow: 0 2px 8px rgba(0,0,0,0.15);
}

.composer-box:focus-within {
    border-color: var(--accent);
    box-shadow: 0 0 0 1px var(--accent-dim), 0 2px 12px rgba(0,0,0,0.25);
}

.composer-box textarea {
    display: block;
    width: 100%;
    min-height: 36px;
    max-height: 120px;
    padding: 10px 14px;
    border: none;
    background: transparent;
    color: var(--text);
    font-family: var(--font);
    font-size: 13px;
    line-height: 1.5;
    resize: none;
    outline: none;
}

.composer-box textarea::placeholder {
    color: var(--text-3);
}

.composer-bar {
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 4px 6px 6px;
    border-top: 1px solid var(--border);
}

.cb {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
    height: 26px;
    padding: 0 8px;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: var(--text-3);
    font-family: var(--font);
    font-size: 11px;
    font-weight: 500;
    cursor: pointer;
    white-space: nowrap;
    transition: all 0.12s;
}

.cb:hover {
    background: var(--bg-3);
    color: var(--text);
}

.cb svg {
    width: 14px;
    height: 14px;
    stroke: currentColor;
    fill: none;
    stroke-width: 1.8;
    stroke-linecap: round;
    stroke-linejoin: round;
    flex-shrink: 0;
}

.cb-icon {
    width: 26px;
    padding: 0;
}

.cb-toggle {
    color: var(--text-2);
    font-weight: 500;
}

.cb-toggle::before {
    content: "\2303";
    font-size: 13px;
    margin-right: 3px;
    opacity: 0.45;
    font-weight: 400;
}

.cb-spacer {
    flex: 1;
}

.cb-send {
    width: 28px;
    height: 28px;
    padding: 0;
    border: none;
    border-radius: 50%;
    background: var(--accent);
    color: #fff;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition: all 0.15s;
    box-shadow: 0 1px 4px rgba(107,138,253,0.3);
}

.cb-send:hover {
    background: #7c9aff;
    box-shadow: 0 2px 8px rgba(107,138,253,0.45);
}

.cb-send:disabled {
    background: var(--bg-3);
    color: var(--text-3);
    box-shadow: none;
    cursor: default;
}

.cb-send svg {
    width: 14px;
    height: 14px;
    stroke: currentColor;
    fill: none;
    stroke-width: 2.2;
}

/* ── Status bar ───────────────────────────────────────────── */

.statusbar {
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 4px 14px;
    border-top: 1px solid var(--border);
    background: rgba(22, 24, 32, 0.6);
    flex-shrink: 0;
    min-height: 24px;
}

.sb-item {
    font-size: 11px;
    color: var(--text-3);
    white-space: nowrap;
}

/* ── Scrollbar for composer ───────────────────────────────── */

.composer-box textarea::-webkit-scrollbar {
    width: 4px;
}
.composer-box textarea::-webkit-scrollbar-track {
    background: transparent;
}
.composer-box textarea::-webkit-scrollbar-thumb {
    background: var(--border);
    border-radius: 2px;
}
)CSS" );
}


// ---------------------------------------------------------------------------
// SVG icons (minimal inline, Cursor-style thin strokes)
// ---------------------------------------------------------------------------

wxString svgPlus()
{
    return wxS( R"(<svg viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>)" );
}

wxString svgArrowRight()
{
    return wxS( R"(<svg viewBox="0 0 24 24"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>)" );
}

wxString svgRetry()
{
    return wxS( R"(<svg viewBox="0 0 24 24"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>)" );
}

wxString svgMore()
{
    return wxS( R"(<svg viewBox="0 0 24 24"><circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/></svg>)" );
}

wxString svgClose()
{
    return wxS( R"(<svg viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>)" );
}

wxString svgChevronRight()
{
    return wxS( R"(<svg class="m-tool-chevron" viewBox="0 0 24 24"><polyline points="9 18 15 12 9 6"/></svg>)" );
}

wxString svgCode()
{
    return wxS( R"(<svg viewBox="0 0 24 24"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>)" );
}

wxString svgCopy()
{
    return wxS( R"(<svg viewBox="0 0 24 24"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>)" );
}

wxString svgFile()
{
    return wxS( R"(<svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>)" );
}

wxString svgMic()
{
    return wxS( R"(<svg viewBox="0 0 24 24"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/></svg>)" );
}

wxString svgCheck()
{
    return wxS( R"(<svg viewBox="0 0 24 24"><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>)" );
}

wxString svgZap()
{
    return wxS( R"(<svg viewBox="0 0 24 24"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>)" );
}


// ---------------------------------------------------------------------------
// HTML builders
// ---------------------------------------------------------------------------

wxString buildHeader( const ASSISTANT_PANEL_CONTEXT& ctx )
{
    wxString title;

    if( ctx.hasProject )
        title = safeProject( ctx ) + wxS( " - " ) + editorLabel( ctx );
    else
        title = _( "New chat" );

    wxString html;
    html += wxS( R"(<div class="header">)" );

    html += wxString::Format(
            wxS( R"(<div class="header-title">%s</div>)" ),
            EscapeHTML( title ) );

    html += wxString::Format(
            wxS( R"(<button class="h-btn" title="%s">%s</button>)" ),
            EscapeHTML( _( "New" ) ), svgPlus() );

    html += wxString::Format(
            wxS( R"(<button class="h-btn" title="%s">%s</button>)" ),
            EscapeHTML( _( "More" ) ), svgMore() );

    html += wxString::Format(
            wxS( R"(<button class="h-btn" title="%s">%s</button>)" ),
            EscapeHTML( _( "Close" ) ), svgClose() );

    html += wxS( R"(</div>)" );
    return html;
}


wxString messageHtml( const ASSISTANT_MESSAGE& msg )
{
    if( msg.role == ASSISTANT_MESSAGE::USER )
    {
        return wxString::Format(
            wxS( R"(<div class="m-user"><div class="m-user-text">%s</div>)"
                 R"(<button class="m-retry">%s</button></div>)" ),
            EscapeHTML( msg.text ), svgRetry() );
    }
    else
    {
        return wxString::Format(
            wxS( R"(<div class="m-agent"><div class="m-agent-text"><p>%s</p></div></div>)" ),
            EscapeHTML( msg.text ) );
    }
}


wxString buildConversation( const std::vector<ASSISTANT_MESSAGE>& messages,
                            const ASSISTANT_PANEL_CONTEXT& ctx )
{
    wxString html;
    html += wxS( R"(<div class="messages" id="messages">)" );

    if( messages.empty() && !ctx.hasProject )
    {
        html += wxS( R"(<div class="m-agent"><div class="m-agent-text">)" );
        html += wxString::Format(
                wxS( R"(<p>%s</p>)" ),
                EscapeHTML( _( "Open a project to get started. I can help with schematic review, "
                               "ERC analysis, PCB layout checks, and design iteration." ) ) );
        html += wxS( R"(</div></div>)" );
    }
    else if( messages.empty() )
    {
        html += wxS( R"(<div class="m-agent"><div class="m-agent-text">)" );
        html += wxString::Format(
                wxS( R"(<p>%s</p>)" ),
                EscapeHTML( _( "Ready. Ask me anything about this design." ) ) );
        html += wxS( R"(</div></div>)" );
    }
    else
    {
        for( const auto& msg : messages )
            html += messageHtml( msg );
    }

    html += wxS( R"(</div>)" );
    return html;
}


wxString buildComposer( const ASSISTANT_PANEL_CONTEXT& ctx )
{
    wxString html;

    html += wxS( R"(<div class="composer-wrap">)" );

    // Composer container
    html += wxS( R"(<div class="composer-box">)" );
    html += wxString::Format(
            wxS( R"(<textarea rows="1" placeholder="%s"></textarea>)" ),
            EscapeHTML( inputPlaceholder( ctx ) ) );

    // Bottom toolbar inside the box
    html += wxS( R"(<div class="composer-bar">)" );

    // + button
    html += wxString::Format(
            wxS( R"(<button class="cb cb-icon">%s</button>)" ), svgPlus() );

    // Planning toggle
    html += wxString::Format(
            wxS( R"(<button class="cb cb-toggle">%s</button>)" ),
            EscapeHTML( _( "Planning" ) ) );

    // Model selector
    html += wxString::Format(
            wxS( R"(<button class="cb cb-toggle">%s</button>)" ),
            EscapeHTML( _( "Claude Opus" ) ) );

    html += wxS( R"(<div class="cb-spacer"></div>)" );

    // Mic
    html += wxString::Format(
            wxS( R"(<button class="cb cb-icon">%s</button>)" ), svgMic() );

    // Send
    html += wxString::Format(
            wxS( R"(<button class="cb-send" disabled>%s</button>)" ), svgArrowRight() );

    html += wxS( R"(</div>)" ); // composer-bar
    html += wxS( R"(</div>)" ); // composer-box
    html += wxS( R"(</div>)" ); // composer-wrap

    return html;
}


wxString buildStatusBar( const ASSISTANT_PANEL_CONTEXT& ctx )
{
    wxString html;

    html += wxS( R"(<div class="statusbar">)" );

    // Editor context
    html += wxString::Format(
            wxS( R"(<span class="sb-item">%s</span>)" ),
            EscapeHTML( editorLabel( ctx ) ) );

    // Project
    if( ctx.hasProject )
    {
        html += wxString::Format(
                wxS( R"(<span class="sb-item">%s</span>)" ),
                EscapeHTML( safeProject( ctx ) ) );
    }

    // Document
    wxString doc = fileTail( ctx.documentPath );
    if( !doc.IsEmpty() )
    {
        html += wxString::Format(
                wxS( R"(<span class="sb-item">%s</span>)" ),
                EscapeHTML( doc ) );
    }

    html += wxS( R"(</div>)" );
    return html;
}


// ---------------------------------------------------------------------------
// JavaScript for interactivity
// ---------------------------------------------------------------------------

wxString buildScript()
{
    return wxS( R"JS(
<script>
(function() {
    const textarea = document.querySelector('.composer-box textarea');
    const sendBtn  = document.querySelector('.cb-send');
    const messages = document.getElementById('messages');

    // --- Auto-resize textarea ---
    function autoResize() {
        textarea.style.height = 'auto';
        textarea.style.height = Math.min(textarea.scrollHeight, 120) + 'px';
    }
    textarea.addEventListener('input', function() {
        autoResize();
        sendBtn.disabled = !textarea.value.trim();
    });

    // --- Send message ---
    function send() {
        const text = textarea.value.trim();
        if (!text) return;

        // Post to C++ handler
        if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.assistant) {
            window.webkit.messageHandlers.assistant.postMessage(text);
        }

        textarea.value = '';
        autoResize();
        sendBtn.disabled = true;
    }

    sendBtn.addEventListener('click', send);

    textarea.addEventListener('keydown', function(e) {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            send();
        }
    });

    // --- Append message to DOM (called from C++ via RunScriptAsync) ---
    window.appendMessage = function(role, text) {
        var div;
        if (role === 'user') {
            div = document.createElement('div');
            div.className = 'm-user';
            div.innerHTML = '<div class="m-user-text">' + escapeHtml(text) + '</div>';
        } else {
            div = document.createElement('div');
            div.className = 'm-agent';
            div.innerHTML = '<div class="m-agent-text"><p>' + escapeHtml(text) + '</p></div>';
        }
        messages.appendChild(div);
        messages.scrollTop = messages.scrollHeight;
    };

    function escapeHtml(s) {
        var d = document.createElement('div');
        d.textContent = s;
        return d.innerHTML;
    }

    // Scroll to bottom on load
    messages.scrollTop = messages.scrollHeight;
})();
</script>
)JS" );
}


// ---------------------------------------------------------------------------
// Full page assembly
// ---------------------------------------------------------------------------

wxString makeAssistantHtml( const std::vector<ASSISTANT_MESSAGE>& messages,
                            const ASSISTANT_PANEL_CONTEXT& ctx )
{
    wxString html;
    html += wxS( R"(<!doctype html><html><head><meta charset="utf-8"><style>)" );
    html += buildCss();
    html += wxS( R"(</style></head><body><div class="shell">)" );
    html += buildHeader( ctx );
    html += buildConversation( messages, ctx );
    html += buildComposer( ctx );
    html += buildStatusBar( ctx );
    html += wxS( R"(</div>)" );
    html += buildScript();
    html += wxS( R"(</body></html>)" );
    return html;
}

} // namespace


// ---------------------------------------------------------------------------
// ASSISTANT_PANEL
// ---------------------------------------------------------------------------

ASSISTANT_PANEL::ASSISTANT_PANEL( wxWindow* aParent, ASSISTANT_PANEL_HOST& aHost ) :
        wxPanel( aParent ),
        m_host( aHost ),
        m_webView( new WEBVIEW_PANEL( this ) )
{
    wxBoxSizer* sizer = new wxBoxSizer( wxVERTICAL );
    sizer->Add( m_webView, 1, wxEXPAND );
    SetSizer( sizer );

    // Register the message handler BEFORE loading content.
    // BindLoadedEvent ensures OnWebViewLoaded fires after SetPage,
    // which triggers DoInitHandlers to register JS-side handlers.
    m_webView->AddMessageHandler( wxS( "assistant" ),
                                  [this]( const wxString& aPayload )
                                  {
                                      onUserMessage( aPayload );
                                  } );
    m_webView->BindLoadedEvent();

    RefreshContext();
}


void ASSISTANT_PANEL::RefreshContext()
{
    if( m_webView )
        m_webView->SetPage( buildFullPage() );
}


wxString ASSISTANT_PANEL::buildFullPage() const
{
    return makeAssistantHtml( m_messages, m_host.GetAssistantPanelContext() );
}


void ASSISTANT_PANEL::onUserMessage( const wxString& aText )
{
    if( aText.IsEmpty() )
        return;

    // Store user message
    m_messages.push_back( { ASSISTANT_MESSAGE::USER, aText } );
    appendMessageToDOM( m_messages.back() );

    // Echo back as agent (placeholder until real backend exists)
    wxString echo = wxString::Format( _( "Echo: %s" ), aText );
    m_messages.push_back( { ASSISTANT_MESSAGE::AGENT, echo } );
    appendMessageToDOM( m_messages.back() );
}


void ASSISTANT_PANEL::appendMessageToDOM( const ASSISTANT_MESSAGE& aMsg )
{
    wxString role = ( aMsg.role == ASSISTANT_MESSAGE::USER ) ? wxS( "user" ) : wxS( "agent" );

    // Escape for JS string literal (single quotes)
    wxString safeText = aMsg.text;
    safeText.Replace( wxS( "\\" ), wxS( "\\\\" ) );
    safeText.Replace( wxS( "'" ), wxS( "\\'" ) );
    safeText.Replace( wxS( "\n" ), wxS( "\\n" ) );
    safeText.Replace( wxS( "\r" ), wxS( "" ) );

    wxString script = wxString::Format(
            wxS( "window.appendMessage('%s', '%s');" ),
            role, safeText );

    m_webView->RunScriptAsync( script );
}
