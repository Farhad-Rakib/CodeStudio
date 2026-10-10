# CodeStudio Solution Explorer

CodeStudio brings a Visual Studio-style .NET workflow to VS Code. It adds a Solution Explorer with virtual solution folders, `dotnet` CLI commands in context menus, and matching dark and light themes.

CodeStudio is an independent project. It is not affiliated with Microsoft and does not use Visual Studio branding or assets.

## Features

### Solution Explorer
- Opens `.sln` and `.slnx` files. It auto-opens the last solution, or the only one in the workspace.
- Shows the solution, solution folders and solution items as defined in the solution file.
- Shows each project with its target frameworks. Icons distinguish C#, F#, VB, web and test projects.
- Each project has a **Dependencies** node (Frameworks, Packages, Projects) and lists the files and folders on disk. `bin` and `obj` are hidden by default.
- Search the tree with the filter button. It matches folder and project names and keeps their parents visible.
- Includes Refresh and Collapse All. The tree reloads automatically when the solution, the layout file or a project file changes.

### Default explorer
CodeStudio makes **Solution Explorer the default explorer** out of the box. In workspaces that contain a `.sln`/`.slnx`, it appears in VS Code's Explorer sidebar and gets focus when the solution loads. The built-in Files view is hidden, and a one-time notification tells you what changed.

To return to VS Code's normal layout, use any of these:
- **Settings → Extensions → CodeStudio → Default Explorer**: uncheck it, or click the "Restore VS Code Default Explorer" link in its description.
- The **...** menu of Solution Explorer: *Restore VS Code Default Explorer*.
- The Command Palette: *CodeStudio: Restore VS Code Default Explorer*.

When you switch back, the Files view returns and Solution Explorer moves to the CodeStudio icon in the Activity Bar. *Make Solution Explorer the Default Explorer* turns it on again. In workspaces without a solution, CodeStudio never hides the Files view. If it was hidden from an earlier .NET workspace, it is shown again there.

> Turn the setting off before uninstalling CodeStudio. VS Code doesn't let an extension run code on uninstall, so a Files view hidden by CodeStudio stays hidden. If that happens, right-click the Explorer header and check **Folders**, or run *View: Reset View Locations*.

### Startup project, Run and Debug
- Right-click a project → **Set as Startup Project**. The startup project is shown in bold with a "startup" label, and it's saved in `.vscode/.codeStudio-settings`. Use **Configure Startup Project...** on the solution node to pick from the runnable projects.
- **Start Debugging** (toolbar ▷, status bar, or F5 while Solution Explorer has focus) builds the project and launches it with the C# extension's `coreclr` debugger. Web apps open in the browser once they're listening. CodeStudio doesn't include a debugger: without a C# extension, it offers to install one or to start without debugging.
- **Start Without Debugging** (Ctrl+F5 in Solution Explorer) runs `dotnet run --project`, which uses the project's `launchSettings.json` profiles.
- Both commands are also on every project's context menu, so you can start a project that isn't the startup project.

### Virtual solution folders
- Create, rename, delete and nest virtual folders.
- Move projects into virtual folders, or between them, with **Move Project Here**, **Move to Virtual Folder**, or drag and drop.
- **Remove from Virtual Folder** returns a project to its location in the solution file.
- The layout is saved in `.vscode/.codeStudio-settings` (JSON) in the solution's folder, next to your other VS Code settings. Other files in `.vscode` are never touched. **Virtual folders never move files and never modify the `.sln`/`.slnx` file.** Commit the file to share the layout with your team, or add `.vscode/.codeStudio-settings` to `.gitignore` to keep it personal.

### .NET commands
| Node | Commands |
| --- | --- |
| Solution | New Project, Open Solution, Refresh, Build / Restore / Clean Solution, Add Existing Project, Add Virtual Folder |
| Virtual folder | New Project, Add Virtual Folder, Move Project Here, Rename, Delete |
| Project / folder | New Item, Open Project File, Manage NuGet Packages (UI), Build Project, Run Tests (test projects only), Add Project Reference, Manage NuGet Packages, Move to Virtual Folder |

Build, restore, clean and test run as VS Code tasks. They use the built-in `$msCompile` problem matcher, so errors appear in the Problems panel. Reference, package and solution edits go through `dotnet add` / `dotnet remove` / `dotnet sln add`, so CodeStudio never rewrites solution or project files itself. Every process starts with an argument array and no shell.

### Templates
- **New Project...** is on the solution node, virtual folders and the view toolbar. It lists every project template installed in your .NET SDK, read from `dotnet new list`, including ones you installed yourself. There's also an "Other template..." option where you type a short name.
  - You name the project, and CodeStudio suggests `src/<Name>`, or `tests/<Name>` for test templates.
  - It runs `dotnet new`, then adds the project with `dotnet sln add`.
  - Started from a virtual folder, it places the new project in that folder.
- **New Item...** is on C# projects and their folders. It creates files from these templates: Class, Interface, Record, Struct, Enum, Static Class, Abstract Class, Exception, API Controller, Minimal API Endpoints, Background Service, and xUnit/NUnit/MSTest test classes.
  - The namespace comes from the project's `RootNamespace` (or the project name) plus the folder path, as in Visual Studio. For example: `Contoso.Core.Domain.Orders`.
  - Templates are ordered by project type: the matching test framework first in test projects, controllers and endpoints first in web projects.
  - Files are never overwritten.

### NuGet Package Manager
Open it with **Manage NuGet Packages** on a project, from the package icon on a project's *Packages* node, or from the Solution Explorer toolbar. It works like Visual Studio's NuGet window:
- **Browse:** searches nuget.org, showing icons, authors, download counts and verified owners. Use *Include prerelease* to see preview versions too.
- **Installed:** lists the project's packages, with a filter.
- **Updates:** lists packages with newer versions, plus an **Update all** button.
- **Details pane:** a version picker with **Install**, **Update** and **Uninstall** buttons, and links to nuget.org, the project site and the license.
- **Project selector:** switches the panel to another project in the solution.

Changes run through `dotnet add package` / `dotnet remove package`. Package IDs and versions from the page are checked again before any command runs. The panel uses a strict Content Security Policy, and links open only if they're `https://`. Packages whose versions are managed centrally in `Directory.Packages.props` show as *central*.

### Formatter
CodeStudio provides a C# formatter for **Format Document** and format on save. Choose the engine with `codestudio.formatter.engine`:
- **`dotnet-format`** (default) is built into the SDK and follows your `.editorconfig`, including CodeStudio's coding standards. It fixes whitespace and indentation, and formats unsaved buffers through a temporary copy, so nothing is written next to your files.
- **`csharpier`** is CSharpier, the opinionated "Prettier" for C#. It rewraps and restructures code consistently. Run **CodeStudio: Install CSharpier** to add it as a local tool for the solution (recommended, so the team shares one version) or as a global tool.

If another C# formatter is installed, run *Format Document With... → Configure Default Formatter* and pick CodeStudio. *Apply Recommended Settings* can also set it as the default.

### Solution Explorer colors
Solution Explorer icons use CodeStudio's own theme colors, so they follow whichever theme you use:

| Color ID | Used for |
| --- | --- |
| `codestudio.solutionIcon` | Solution node |
| `codestudio.solutionFolderIcon` / `codestudio.virtualFolderIcon` | Solution folders / virtual folders |
| `codestudio.csharpProjectIcon`, `fsharpProjectIcon`, `vbProjectIcon` | Projects by language |
| `codestudio.webProjectIcon` / `codestudio.testProjectIcon` | Web and test projects |
| `codestudio.packageIcon` / `codestudio.dependencyIcon` | NuGet packages / frameworks and references |
| `codestudio.errorIcon` | Projects that can't be read |

Every color has defaults for dark, light and high-contrast themes, and CodeStudio Dark and Light define their own values. Other themes can set these IDs in their `colors`. You can override them for one theme, or for all themes, in `settings.json`:

```jsonc
"workbench.colorCustomizations": {
  "[CodeStudio Dark]": { "codestudio.csharpProjectIcon": "#B48EFF" },
  "[Default Light Modern]": { "codestudio.virtualFolderIcon": "#B07800" },
  "codestudio.testProjectIcon": "#3FB950"
}
```

Editor syntax colors can be customized per theme the same way with `editor.tokenColorCustomizations` and `editor.semanticTokenColorCustomizations`, for example `"[CodeStudio Dark]": { "rules": { "interface": "#B8D7A3" } }`.

### Bracket colors
For C# files, CodeStudio turns on colored bracket pairs, active bracket-pair guides and always-on bracket matching. These are language defaults, so your own settings override them. Both CodeStudio themes define six bracket colors, plus guide colors and an "unexpected bracket" color.

### Coding standards
Turn on **Settings → CodeStudio → Coding Standards: Enabled** (off by default) to enforce naming and code-style rules. Run *CodeStudio: Configure Coding Standards...* to jump to the options.

| Option | Default |
| --- | --- |
| Types (class/struct/record/enum/delegate) | `PascalCase` |
| Interfaces start with `I` / type parameters start with `T` | on / on |
| Methods / `async` methods end with `Async` | `PascalCase` / on |
| Properties and events / non-private fields | `PascalCase` |
| Private fields / private static fields | `_camelCase` / `s_camelCase` |
| Constants | `PascalCase` |
| Locals and parameters | `camelCase` |
| `var` usage, braces, file-scoped namespaces, usings outside namespace, `int` vs `Int32` | when type is apparent, required, on, on, on |
| Severity | `warning` (or `suggestion` / `error`) |

Naming options can be set to `PascalCase`, `camelCase`, `_camelCase`, `m_camelCase`, `s_camelCase`, `snake_case` or `UPPER_CASE`.

When it's on, the rules are enforced in four places:
1. **Live in the editor.** CodeStudio checks C# naming as you type, using a lightweight checker that doesn't need a C# extension. A lightbulb quick fix renames each violation:
   - With a C# language extension installed, it uses the extension's rename, which updates the whole solution.
   - Without one, it renames private fields, locals and parameters within their file. It won't rename public members, because they may be used in other files.
2. **`.editorconfig`.** CodeStudio writes the rules to a managed block, between `# BEGIN/END CodeStudio coding standards`, in `.editorconfig` beside the solution. Your own content in that file is kept. The C# language service, Visual Studio and `dotnet format` then apply the same rules. Turning the feature off removes the block, and deletes the file if CodeStudio created it.
3. **Builds (optional).** *Enforce In Build* adds `-p:EnforceCodeStyleInBuild=true` to CodeStudio's Build and Run Tests commands. Violations then appear as `IDE1006`/`IDE00xx` build diagnostics in the Problems panel. With severity `error`, the build fails.
4. **Commands.** *Check Coding Standards* runs `dotnet format style --verify-no-changes` on the whole solution. *Fix Coding Standards* runs `dotnet format style` to apply code-style fixes. `dotnet format` doesn't rename naming violations, so use the quick fix for those.

The editor checker is deliberately conservative: it's pattern-based, not a full C# parser. It may miss some declarations, such as tuple-typed members or lambda parameters. Roslyn, through the generated `.editorconfig`, is the complete check.

### Themes
**CodeStudio Dark** and **CodeStudio Light** appear in *Preferences: Color Theme*. They include semantic token colors for C# classes, interfaces, structs, enums, methods, properties, locals and parameters.

### Recommended settings
Run **CodeStudio: Apply Recommended Settings...**, choose User or Workspace settings, then review the list:
- Each setting shows its proposed value and why it's recommended.
- Only settings you haven't set are pre-selected. Settings you already set show your current value and stay unchecked.
- **Preview JSON** shows exactly what will be written before you confirm.

The recommendations are 4-space C# indentation, format on save, bracket-pair colorization and active guides, no minimap, semantic highlighting, CodeLens, sticky scroll, peek for multiple definitions, Problems decorations, terminal scrollback, and the CodeStudio Dark theme. The only silent default is the C# indentation (`[csharp]` tab size 4, spaces). It comes from `configurationDefaults`, so it never overrides a value you set.

## Requirements
- VS Code 1.95 or later.
- [.NET SDK](https://dotnet.microsoft.com/download) on `PATH`, or set `codestudio.dotnetPath`. CodeStudio does not bundle the SDK.
- For IntelliSense and debugging, install a C# language extension. CodeStudio does not include a language server or debugger. If you build a Code - OSS-based distribution, check the license terms of any extension you plan to ship, because some Marketplace extensions may only be used with Microsoft's VS Code builds.

## Settings
| Setting | Default | Description |
| --- | --- | --- |
| `codestudio.defaultExplorer` | `true` | Show Solution Explorer in the Explorer sidebar and hide the built-in Files view; uncheck to restore VS Code's default Explorer |
| `codestudio.formatter.enabled` / `.engine` | `true` / `dotnet-format` | C# formatter and engine (`dotnet-format` or `csharpier`) |
| `codestudio.codingStandards.*` | off | Naming and code-style rules; see [Coding standards](#coding-standards) |
| `codestudio.autoOpenSingleSolution` | `true` | Open the solution automatically when the workspace has exactly one |
| `codestudio.dotnetPath` | `dotnet` | Path to the dotnet executable |
| `codestudio.explorer.showPhysicalFiles` | `true` | List project files and folders under each project |
| `codestudio.explorer.excludedFolders` | `bin, obj, .vs, .git, node_modules` | Folders hidden under projects |

## Development
```bash
npm install
npm run compile          # TypeScript -> out/
npm test                 # unit tests (node:test), no VS Code needed
npm run test:integration # downloads VS Code into .vscode-test/ and runs tests in an Extension Development Host
npm run package          # builds a .vsix with @vscode/vsce
```
Press **F5** in VS Code to launch an Extension Development Host. The integration tests restore and build `test/fixtures/SampleApp`, so they need the .NET 10 SDK and network access to nuget.org. They work on a temporary copy of the fixture.

Themes are generated from one palette: edit `scripts/generate-themes.py`, then run `python3 scripts/generate-themes.py`.

### Architecture
```
src/
  extension.ts              activation and wiring
  solution-manager.ts       open solution state, file watching, layout updates (vscode)
  logger.ts                 "CodeStudio" output channel and error reporting
  solution/                 UI-independent model and parsers (no vscode import)
    solution-model.ts, solution-reader.ts (.sln + .slnx), project-reader.ts
  storage/layout-store.ts   virtual-folder model, pure operations, LayoutStore interface + JSON store
  explorer/
    tree-builder.ts         pure merge of solution folders + virtual folders, filtering
    solution-tree-item.ts   node types -> TreeItems (icons, context values, stable ids)
    solution-tree-provider.ts  TreeDataProvider + drag and drop
  dotnet/
    dotnet-args.ts          pure argument building and validation
    sdk-detection.ts        dotnet --version / --list-sdks
    dotnet-runner.ts        tasks (ProcessExecution) and captured execFile calls
  commands/                 command handlers grouped by node type
  settings/recommended-settings.ts  recommendations and change planning
  standards/                naming rules, .editorconfig generation, C# naming checker (pure) + controller
  nuget/                    NuGet model + V3 client (pure), package manager webview panel
  format/                   C# formatter (dotnet format / CSharpier) and .editorconfig chain merging
  templates/                project template list parsing, C# item templates, namespace rules (pure)
```
Context menus are declared in `package.json` (`menus.view/item/context`) and keyed on each node's `contextValue`, so there is no separate context-menu module.

`LayoutStore` is the persistence boundary. A future native implementation could write solution folders into `.sln`/`.slnx`, but it must use a format-preserving writer that keeps unknown sections. Plain string replacement isn't safe for this.

## Known limitations
- Project files are read with a lightweight XML scan, not MSBuild evaluation. Conditions, imports and `Directory.Build.props` are not applied, and central package versions show as "(central)".
- Native solution folders from the solution file are read-only in CodeStudio. Projects can be moved out of them into virtual folders, but the folders themselves can't be renamed or removed.
- Virtual folders live at the solution root or inside other virtual folders, not inside native solution folders.
- Search matches folder and project names, not file contents or individual files. VS Code's built-in type-to-find also works in the tree.
- Legacy (pre-2012, format version < 11) solutions are rejected with an error.
