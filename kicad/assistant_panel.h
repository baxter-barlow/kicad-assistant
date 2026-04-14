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

#ifndef ASSISTANT_PANEL_H
#define ASSISTANT_PANEL_H

#include <wx/panel.h>
#include <wx/string.h>
#include <vector>

class WEBVIEW_PANEL;

enum class ASSISTANT_CONTEXT_KIND
{
    MANAGER,
    SCHEMATIC,
    PCB
};


struct ASSISTANT_PANEL_CONTEXT
{
    ASSISTANT_CONTEXT_KIND kind = ASSISTANT_CONTEXT_KIND::MANAGER;
    bool                   hasProject = false;
    wxString               frameLabel;
    wxString               projectName;
    wxString               projectPath;
    wxString               documentLabel;
    wxString               documentPath;
    wxString               workspacePath;
};


class ASSISTANT_PANEL_HOST
{
public:
    virtual ~ASSISTANT_PANEL_HOST() = default;

    virtual ASSISTANT_PANEL_CONTEXT GetAssistantPanelContext() const = 0;
};


inline constexpr int ASSISTANT_PANE_MIN_WIDTH = 320;
inline constexpr int ASSISTANT_PANE_DEFAULT_WIDTH = 420;


struct ASSISTANT_MESSAGE
{
    enum ROLE { USER, AGENT };

    ROLE     role;
    wxString text;
};


class ASSISTANT_PANEL : public wxPanel
{
public:
    ASSISTANT_PANEL( wxWindow* aParent, ASSISTANT_PANEL_HOST& aHost );

    void RefreshContext();

private:
    void onUserMessage( const wxString& aText );
    void appendMessageToDOM( const ASSISTANT_MESSAGE& aMsg );

    wxString buildFullPage() const;

    ASSISTANT_PANEL_HOST&              m_host;
    WEBVIEW_PANEL*                     m_webView;
    std::vector<ASSISTANT_MESSAGE>     m_messages;
};

#endif // ASSISTANT_PANEL_H
