"""Generates the CodeXStudio color themes from one palette definition.

Run: python3 scripts/generate-themes.py
"""
import json, pathlib

DARK = dict(
    name="CodeXStudio Dark", type="dark",
    bg="#1E1E1E", bg_alt="#252526", bg_deep="#181818", bg_hover="#2D2D30", border="#3F3F46", border_soft="#333337",
    fg="#DCDCDC", fg_muted="#A0A0A0", fg_faint="#6E6E6E", accent="#7C5CD6", accent_fg="#FFFFFF", accent_soft="#7C5CD640",
    sel="#264F78", sel_inactive="#3A3D41", line="#2A2A2E", find="#9E6A03AA", find_other="#623315AA", link="#4FA3FF",
    error="#F14C4C", warning="#E5B95C", info="#4FA3FF", success="#6CC24A",
    status_bg="#5B3FB0", status_debug="#C25B00", status_noFolder="#3B3B3F",
    # syntax
    comment="#6A9955", keyword="#569CD6", control="#D8A0DF", string="#D69D85", string_esc="#FFD68F", number="#B5CEA8",
    typ="#4EC9B0", interface="#B8D7A3", struct="#86C691", enum="#B8D7A3", typeparam="#B8D7A3", method="#DCDCAA",
    prop="#DCDCDC", field="#DCDCDC", local="#9CDCFE", param="#9CDCFE", constant="#4FC1FF", namespace="#DCDCDC",
    preproc="#9B9B9B", xmlTag="#569CD6", xmlAttr="#9CDCFE", operator="#B4B4B4", regex="#D16969", invalid="#F44747",
    ansi=["#1E1E1E","#F14C4C","#6CC24A","#E5B95C","#4FA3FF","#C586C0","#4EC9B0","#CCCCCC",
          "#808080","#FF6E6E","#8EE06E","#F2D27B","#7DBBFF","#DDA6F2","#70E0C8","#FFFFFF"],
)
LIGHT = dict(
    name="CodeXStudio Light", type="light",
    bg="#FFFFFF", bg_alt="#F5F5F7", bg_deep="#EEEEF2", bg_hover="#E6E6EC", border="#CCCEDB", border_soft="#DDDDE3",
    fg="#1E1E1E", fg_muted="#5A5A5A", fg_faint="#9A9A9A", accent="#5B3FB0", accent_fg="#FFFFFF", accent_soft="#5B3FB030",
    sel="#ADD6FF", sel_inactive="#E5EBF1", line="#F3F3F8", find="#F8C9AB", find_other="#FFE6A3", link="#0060C0",
    error="#D42020", warning="#B57800", info="#0060C0", success="#2E8B22",
    status_bg="#5B3FB0", status_debug="#C25B00", status_noFolder="#6E6E78",
    comment="#008000", keyword="#0000FF", control="#8F08C4", string="#A31515", string_esc="#B26100", number="#098658",
    typ="#2B91AF", interface="#2B91AF", struct="#2B91AF", enum="#2B91AF", typeparam="#2B91AF", method="#74531F",
    prop="#1E1E1E", field="#1E1E1E", local="#1F377F", param="#1F377F", constant="#0070C1", namespace="#1E1E1E",
    preproc="#808080", xmlTag="#800000", xmlAttr="#E50000", operator="#1E1E1E", regex="#811F3F", invalid="#CD3131",
    ansi=["#000000","#CD3131","#107C10","#949800","#0451A5","#BC05BC","#0598BC","#555555",
          "#666666","#CD3131","#14CE14","#B5BA00","#0451A5","#BC05BC","#0598BC","#A5A5A5"],
)

# Monokai variants, after Wimer Hazenberg's classic palette and VS Code's "Monokai Dimmed".
MONOKAI = dict(
    name="CodeXStudio Monokai", type="dark", key="monokai",
    bg="#272822", bg_alt="#1E1F1C", bg_deep="#1A1B17", bg_hover="#3E3D32", border="#414339", border_soft="#34352D",
    fg="#F8F8F2", fg_muted="#A59F85", fg_faint="#75715E", accent="#F92672", accent_fg="#FFFFFF", accent_soft="#F9267240",
    sel="#49483E", sel_inactive="#3E3D32", line="#3E3D3255", find="#FFE79280", find_other="#FFE79240", link="#66D9EF",
    error="#F92672", warning="#E6DB74", info="#66D9EF", success="#A6E22E",
    status_bg="#414339", status_debug="#FD971F", status_noFolder="#34352D",
    comment="#75715E", keyword="#F92672", control="#F92672", string="#E6DB74", string_esc="#AE81FF", number="#AE81FF",
    typ="#66D9EF", interface="#66D9EF", struct="#66D9EF", enum="#66D9EF", typeparam="#FD971F", method="#A6E22E",
    prop="#F8F8F2", field="#F8F8F2", local="#F8F8F2", param="#FD971F", constant="#AE81FF", namespace="#F8F8F2",
    preproc="#75715E", xmlTag="#F92672", xmlAttr="#A6E22E", operator="#F92672", regex="#E6DB74", invalid="#F44747",
    ansi=["#333333","#C4265E","#86B42B","#B3B42B","#6A7EC8","#8C6BC8","#56ADBC","#E3E3DD",
          "#666666","#F92672","#A6E22E","#E2E22E","#819AFF","#AE81FF","#66D9EF","#F8F8F2"],
)
MONOKAI_DIMMED = dict(
    name="CodeXStudio Monokai Dimmed", type="dark", key="monokaiDimmed",
    bg="#1E1E1E", bg_alt="#272727", bg_deep="#191919", bg_hover="#303030", border="#3A3A3A", border_soft="#2F2F2F",
    fg="#C5C8C6", fg_muted="#9A9B99", fg_faint="#676867", accent="#565656", accent_fg="#FFFFFF", accent_soft="#70707060",
    sel="#676B7180", sel_inactive="#505050", line="#30303080", find="#9A9B9960", find_other="#9A9B9930", link="#6089B4",
    error="#C4625B", warning="#D0B344", info="#6089B4", success="#9AA83A",
    status_bg="#505050", status_debug="#CE6700", status_noFolder="#353535",
    comment="#9A9B99", keyword="#9872A2", control="#9872A2", string="#9AA83A", string_esc="#D0B344", number="#6089B4",
    typ="#9B0000", interface="#B05A65", struct="#B05A65", enum="#B05A65", typeparam="#D0B344", method="#CE6700",
    prop="#C5C8C6", field="#C5C8C6", local="#C5C8C6", param="#6089B4", constant="#408080", namespace="#C5C8C6",
    preproc="#676867", xmlTag="#9872A2", xmlAttr="#CE6700", operator="#676867", regex="#D0B344", invalid="#C4625B",
    ansi=["#1E1E1E","#C4625B","#9AA83A","#D0B344","#6089B4","#9872A2","#408080","#C5C8C6",
          "#676867","#E07A73","#B4C24F","#E6C85A","#7AA3D0","#B48CBE","#5AA0A0","#FFFFFF"],
)

ANSI_NAMES = ["Black","Red","Green","Yellow","Blue","Magenta","Cyan","White"]

# Rainbow brackets: distinct, readable hues per nesting level (VS Code cycles through 1-6).
BRACKETS = {
    "dark": ["#FFD700", "#DA70D6", "#4FA3FF", "#4EC9B0", "#F28B54", "#B8D7A3"],
    "monokai": ["#E6DB74", "#AE81FF", "#66D9EF", "#A6E22E", "#FD971F", "#F92672"],
    "monokaiDimmed": ["#D0B344", "#9872A2", "#6089B4", "#9AA83A", "#CE6700", "#B05A65"],
    "light": ["#0431FA", "#319331", "#7B3814", "#B5179E", "#0E7C86", "#A35200"],
}

def bracket_colors(p):
    hues = BRACKETS[p.get("key", p["type"])]
    c = {f"editorBracketHighlight.foreground{i + 1}": h for i, h in enumerate(hues)}
    c["editorBracketHighlight.unexpectedBracket.foreground"] = p["error"]
    for i, h in enumerate(hues):
        c[f"editorBracketPairGuide.activeBackground{i + 1}"] = h + "CC"
        c[f"editorBracketPairGuide.background{i + 1}"] = h + "40"
    return c

# Solution Explorer icon colors (ids contributed in package.json `contributes.colors`).
EXPLORER = {
    "dark": {"solutionIcon": "#B180D7", "solutionFolderIcon": "#DCB67A", "virtualFolderIcon": "#E8C46A", "csharpProjectIcon": "#9B7BEA",
             "fsharpProjectIcon": "#56B6C2", "vbProjectIcon": "#75BEFF", "sqlProjectIcon": "#E2A45C", "webProjectIcon": "#4FA3FF", "testProjectIcon": "#6CC24A",
             "packageIcon": "#4FA3FF", "dependencyIcon": "#A0A0A0", "errorIcon": "#F14C4C"},
    "monokai": {"solutionIcon": "#AE81FF", "solutionFolderIcon": "#E6DB74", "virtualFolderIcon": "#FD971F", "csharpProjectIcon": "#AE81FF",
                "fsharpProjectIcon": "#66D9EF", "vbProjectIcon": "#66D9EF", "sqlProjectIcon": "#FD971F", "webProjectIcon": "#66D9EF", "testProjectIcon": "#A6E22E",
                "packageIcon": "#66D9EF", "dependencyIcon": "#A59F85", "errorIcon": "#F92672"},
    "monokaiDimmed": {"solutionIcon": "#9872A2", "solutionFolderIcon": "#D0B344", "virtualFolderIcon": "#CE6700", "csharpProjectIcon": "#9872A2",
                      "fsharpProjectIcon": "#408080", "vbProjectIcon": "#6089B4", "sqlProjectIcon": "#CE6700", "webProjectIcon": "#6089B4", "testProjectIcon": "#9AA83A",
                      "packageIcon": "#6089B4", "dependencyIcon": "#9A9B99", "errorIcon": "#C4625B"},
    "light": {"solutionIcon": "#652D90", "solutionFolderIcon": "#B8862B", "virtualFolderIcon": "#C28A00", "csharpProjectIcon": "#5B3FB0",
              "fsharpProjectIcon": "#0E7C86", "vbProjectIcon": "#1A73C9", "sqlProjectIcon": "#A65E00", "webProjectIcon": "#0060C0", "testProjectIcon": "#2E8B22",
              "packageIcon": "#0060C0", "dependencyIcon": "#616161", "errorIcon": "#D42020"},
}

def colors(p):
    c = {
        "focusBorder": p["accent"], "foreground": p["fg"], "descriptionForeground": p["fg_muted"],
        "disabledForeground": p["fg_faint"], "errorForeground": p["error"], "icon.foreground": p["fg"],
        "selection.background": p["sel"], "widget.border": p["border"], "widget.shadow": "#00000040",
        "textLink.foreground": p["link"], "textLink.activeForeground": p["link"],
        "button.background": p["accent"], "button.foreground": p["accent_fg"], "button.hoverBackground": p["status_bg"],
        "button.secondaryBackground": p["bg_hover"], "button.secondaryForeground": p["fg"],
        "input.background": p["bg_alt"], "input.border": p["border"], "input.foreground": p["fg"],
        "input.placeholderForeground": p["fg_faint"], "inputOption.activeBorder": p["accent"],
        "dropdown.background": p["bg_alt"], "dropdown.border": p["border"], "dropdown.foreground": p["fg"],
        "checkbox.background": p["bg_alt"], "checkbox.border": p["border"],
        "badge.background": p["accent"], "badge.foreground": p["accent_fg"],
        "progressBar.background": p["accent"],
        "scrollbarSlider.background": p["fg_faint"] + "50", "scrollbarSlider.hoverBackground": p["fg_faint"] + "80",
        "scrollbarSlider.activeBackground": p["fg_faint"] + "B0",

        "editor.background": p["bg"], "editor.foreground": p["fg"],
        "editorLineNumber.foreground": p["fg_faint"], "editorLineNumber.activeForeground": p["fg"],
        "editorCursor.foreground": p["fg"], "editor.selectionBackground": p["sel"],
        "editor.inactiveSelectionBackground": p["sel_inactive"], "editor.selectionHighlightBackground": p["sel"] + "60",
        "editor.wordHighlightBackground": p["sel"] + "50", "editor.wordHighlightStrongBackground": p["sel"] + "80",
        "editor.lineHighlightBackground": p["line"], "editor.lineHighlightBorder": p["border_soft"],
        "editor.findMatchBackground": p["find"], "editor.findMatchHighlightBackground": p["find_other"],
        "editor.rangeHighlightBackground": p["sel"] + "30",
        "editorIndentGuide.background1": p["border_soft"], "editorIndentGuide.activeBackground1": p["fg_faint"],
        "editorBracketMatch.background": p["sel"] + "60", "editorBracketMatch.border": p["fg_faint"],
        **bracket_colors(p),
        **{f"codestudio.{k}": v for k, v in EXPLORER[p.get("key", p["type"])].items()},
        "editorWhitespace.foreground": p["fg_faint"] + "60", "editorRuler.foreground": p["border_soft"],
        "editorCodeLens.foreground": p["fg_muted"],
        "editorError.foreground": p["error"], "editorWarning.foreground": p["warning"], "editorInfo.foreground": p["info"],
        "editorHint.foreground": p["success"],
        "editorGutter.addedBackground": p["success"], "editorGutter.modifiedBackground": p["info"],
        "editorGutter.deletedBackground": p["error"],
        "editorOverviewRuler.errorForeground": p["error"], "editorOverviewRuler.warningForeground": p["warning"],
        "editorOverviewRuler.border": p["border_soft"],
        "editorWidget.background": p["bg_alt"], "editorWidget.border": p["border"],
        "editorSuggestWidget.background": p["bg_alt"], "editorSuggestWidget.border": p["border"],
        "editorSuggestWidget.selectedBackground": p["sel"], "editorHoverWidget.background": p["bg_alt"],
        "editorHoverWidget.border": p["border"], "peekView.border": p["accent"],
        "peekViewEditor.background": p["bg_deep"], "peekViewResult.background": p["bg_alt"],
        "peekViewTitle.background": p["bg_alt"], "editorInlayHint.foreground": p["fg_muted"],
        "editorInlayHint.background": p["bg_hover"] + "80",
        "editorStickyScroll.background": p["bg"], "editorStickyScrollHover.background": p["bg_hover"],

        "editorGroup.border": p["border"], "editorGroupHeader.tabsBackground": p["bg_alt"],
        "editorGroupHeader.tabsBorder": p["border_soft"],
        "tab.activeBackground": p["bg"], "tab.activeForeground": p["fg"], "tab.activeBorderTop": p["accent"],
        "tab.inactiveBackground": p["bg_alt"], "tab.inactiveForeground": p["fg_muted"], "tab.border": p["border_soft"],
        "tab.hoverBackground": p["bg_hover"], "tab.unfocusedActiveBorderTop": p["fg_faint"],
        "breadcrumb.foreground": p["fg_muted"], "breadcrumb.focusForeground": p["fg"],
        "breadcrumb.background": p["bg"],

        "activityBar.background": p["bg_deep"], "activityBar.foreground": p["fg"],
        "activityBar.inactiveForeground": p["fg_faint"], "activityBar.activeBorder": p["accent"],
        "activityBar.border": p["border_soft"], "activityBarBadge.background": p["accent"],
        "activityBarBadge.foreground": p["accent_fg"],
        "sideBar.background": p["bg_alt"], "sideBar.foreground": p["fg"], "sideBar.border": p["border_soft"],
        "sideBarTitle.foreground": p["fg"], "sideBarSectionHeader.background": p["bg_alt"],
        "sideBarSectionHeader.border": p["border_soft"],
        "list.activeSelectionBackground": p["accent_soft"] if p["type"] == "light" else p["sel"],
        "list.activeSelectionForeground": p["fg"], "list.inactiveSelectionBackground": p["sel_inactive"],
        "list.hoverBackground": p["bg_hover"], "list.focusOutline": p["accent"],
        "list.highlightForeground": p["link"], "list.errorForeground": p["error"],
        "list.warningForeground": p["warning"], "list.dropBackground": p["accent_soft"],
        "tree.indentGuidesStroke": p["border"], "tree.inactiveIndentGuidesStroke": p["border_soft"],

        "panel.background": p["bg"], "panel.border": p["border"], "panelTitle.activeBorder": p["accent"],
        "panelTitle.activeForeground": p["fg"], "panelTitle.inactiveForeground": p["fg_muted"],
        "terminal.background": p["bg"], "terminal.foreground": p["fg"], "terminal.selectionBackground": p["sel"],
        "terminalCursor.foreground": p["fg"],
        "problemsErrorIcon.foreground": p["error"], "problemsWarningIcon.foreground": p["warning"],
        "problemsInfoIcon.foreground": p["info"],

        "statusBar.background": p["status_bg"], "statusBar.foreground": "#FFFFFF", "statusBar.border": p["status_bg"],
        "statusBar.debuggingBackground": p["status_debug"], "statusBar.debuggingForeground": "#FFFFFF",
        "statusBar.noFolderBackground": p["status_noFolder"], "statusBarItem.remoteBackground": p["accent"],
        "statusBarItem.hoverBackground": "#FFFFFF25",
        "titleBar.activeBackground": p["bg_deep"], "titleBar.activeForeground": p["fg"],
        "titleBar.inactiveBackground": p["bg_deep"], "titleBar.inactiveForeground": p["fg_muted"],
        "titleBar.border": p["border_soft"], "menu.background": p["bg_alt"], "menu.foreground": p["fg"],
        "menu.selectionBackground": p["sel"], "menu.border": p["border"], "menu.separatorBackground": p["border"],
        "quickInput.background": p["bg_alt"], "quickInputList.focusBackground": p["sel"],
        "notifications.background": p["bg_alt"], "notifications.border": p["border"],
        "gitDecoration.modifiedResourceForeground": p["info"], "gitDecoration.untrackedResourceForeground": p["success"],
        "gitDecoration.deletedResourceForeground": p["error"], "gitDecoration.ignoredResourceForeground": p["fg_faint"],
    }
    for i, n in enumerate(ANSI_NAMES):
        c[f"terminal.ansi{n}"] = p["ansi"][i]
        c[f"terminal.ansiBright{n}"] = p["ansi"][i + 8]
    return c

def token_colors(p):
    t = lambda name, scope, fg, style=None: {"name": name, "scope": scope, "settings": {"foreground": fg, **({"fontStyle": style} if style else {})}}
    return [
        t("Comments", ["comment", "punctuation.definition.comment"], p["comment"]),
        t("XML doc comments", ["comment.documentation", "comment.block.documentation"], p["comment"]),
        t("XML doc tags", ["comment.documentation.name", "comment.documentation.attribute.name", "comment.documentation.delimiter"], p["preproc"]),
        t("Keywords", ["keyword", "storage.type", "storage.modifier", "keyword.other.var", "constant.language", "variable.language"], p["keyword"]),
        t("Control flow", ["keyword.control", "keyword.control.flow", "keyword.control.conditional", "keyword.control.loop", "keyword.control.trycatch", "keyword.control.context"], p["control"]),
        t("Operators", ["keyword.operator", "punctuation.accessor"], p["operator"]),
        t("Operator keywords", ["keyword.operator.expression", "keyword.operator.new", "keyword.operator.cast", "keyword.operator.logical.pattern"], p["keyword"]),
        t("Strings", ["string", "punctuation.definition.string"], p["string"]),
        t("String escapes", ["constant.character.escape", "constant.other.placeholder"], p["string_esc"]),
        t("Regex", ["string.regexp"], p["regex"]),
        t("Numbers", ["constant.numeric"], p["number"]),
        t("Types", ["entity.name.type", "entity.name.type.class", "support.type", "support.class", "entity.other.inherited-class", "storage.type.cs"], p["typ"]),
        t("Interfaces", ["entity.name.type.interface"], p["interface"]),
        t("Structs", ["entity.name.type.struct"], p["struct"]),
        t("Enums", ["entity.name.type.enum"], p["enum"]),
        t("Type parameters", ["entity.name.type.type-parameter"], p["typeparam"]),
        t("Namespaces", ["entity.name.type.namespace", "entity.name.namespace"], p["namespace"]),
        t("Methods", ["entity.name.function", "support.function"], p["method"]),
        t("Properties", ["variable.other.property", "entity.name.variable.property"], p["prop"]),
        t("Fields", ["variable.other.object.property", "entity.name.variable.field"], p["field"]),
        t("Enum members", ["entity.name.variable.enum-member", "variable.other.enummember"], p["constant"]),
        t("Locals", ["variable", "entity.name.variable.local"], p["local"]),
        t("Parameters", ["variable.parameter", "entity.name.variable.parameter"], p["param"]),
        t("Preprocessor", ["meta.preprocessor", "keyword.preprocessor", "entity.name.variable.preprocessor.symbol"], p["preproc"]),
        t("Attributes", ["entity.name.type.attribute", "support.type.attribute"], p["typ"]),
        t("XML tags", ["entity.name.tag", "punctuation.definition.tag"], p["xmlTag"]),
        t("XML attributes", ["entity.other.attribute-name"], p["xmlAttr"]),
        t("JSON keys", ["support.type.property-name.json"], p["local"]),
        t("Markup headings", ["markup.heading", "entity.name.section"], p["keyword"], "bold"),
        t("Markup bold", ["markup.bold"], p["fg"], "bold"),
        t("Markup italic", ["markup.italic"], p["fg"], "italic"),
        t("Invalid", ["invalid", "invalid.illegal"], p["invalid"]),
    ]

def semantic(p):
    return {
        "namespace": p["namespace"], "class": p["typ"], "class.static": p["typ"], "record": p["typ"],
        "struct": p["struct"], "recordStruct": p["struct"], "interface": p["interface"], "enum": p["enum"],
        "enumMember": p["constant"], "typeParameter": p["typeparam"], "delegate": p["typ"], "type": p["typ"],
        "method": p["method"], "function": p["method"], "extensionMethod": p["method"], "event": p["prop"],
        "property": p["prop"], "field": p["field"], "constant": p["prop"], "variable": p["local"],
        "local": p["local"], "parameter": p["param"], "label": p["fg_muted"],
        "keyword": p["keyword"], "controlKeyword": p["control"], "operatorOverloaded": p["method"],
        "string": p["string"], "stringEscapeCharacter": p["string_esc"], "number": p["number"],
        "comment": p["comment"], "regexp": p["regex"], "preprocessorKeyword": p["preproc"],
        "excludedCode": p["fg_faint"], "xmlDocCommentName": p["preproc"], "xmlDocCommentText": p["comment"],
        "xmlDocCommentDelimiter": p["preproc"], "xmlDocCommentAttributeName": p["preproc"],
        "*.deprecated": {"strikethrough": True},
    }

root = pathlib.Path(__file__).resolve().parent.parent / "themes"
for p, fname in [(DARK, "codestudio-dark-color-theme.json"), (LIGHT, "codestudio-light-color-theme.json"),
                 (MONOKAI, "codestudio-monokai-color-theme.json"), (MONOKAI_DIMMED, "codestudio-monokai-dimmed-color-theme.json")]:
    theme = {
        "$schema": "vscode://schemas/color-theme",
        "name": p["name"], "type": p["type"], "semanticHighlighting": True,
        "colors": colors(p), "tokenColors": token_colors(p), "semanticTokenColors": semantic(p),
    }
    (root / fname).write_text(json.dumps(theme, indent=2) + "\n")
    print("wrote", fname)
