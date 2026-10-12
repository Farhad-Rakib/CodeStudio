# Changelog

## 0.4.0 — 2026-10-12

- NuGet Package Manager supports private and organization feeds (Azure Artifacts, GitHub Packages, ProGet, ...). Package sources come from the same `nuget.config` files `dotnet restore` uses (the project folder and its parents, plus the user config), including `<clear/>`, disabled sources and stored credentials.
- Package source dropdown in the NuGet Package Manager: search one feed or "All" (merged results). The details pane shows which source a package came from.
- Manage NuGet Package Sources (panel button or the **CodeXStudio: Manage NuGet Package Sources...** command): add a source to the solution's or the user's `nuget.config`, enable, disable or remove it, and set credentials. Changes go through `dotnet nuget ... source`.
- When a feed asks for credentials, the panel offers to enter a user name and access token, saved in `nuget.config` (needed for restore) or in VS Code secret storage (browsing only). GitHub Packages errors explain the token requirements (`read:packages` scope, SSO authorization).
- Installed packages and update checks work on feeds that don't support exact-ID search, such as GitHub Packages.

## 0.3.0 — 2026-10-12

- Monokai and Monokai Dimmed color themes.
- Solution folders: New Solution Folder, Rename and Delete (contained projects are removed from the solution first), and moving projects into or out of solution folders (also by drag and drop).
- Solution items: New Item on a solution folder adds a solution item; rename, remove from solution, delete (to trash) and move to another solution folder.
- File operations on project files and folders: New Folder, Rename (F2), Delete (to trash), Cut / Copy / Paste (Visual Studio-style "Name - Copy" names) and drag-and-drop moves.
- Remove from Solution for projects, with an optional "Remove and Delete Files"; clears the project's virtual-folder assignment and startup project.

## 0.2.0

- Renamed to CodeXStudio (publisher `fhasancse`); display name "CodeXStudio - .NET Dev Assistant".
- Solution Explorer now has its own sidebar by default. Showing it in the Explorer sidebar is optional (`codestudio.defaultExplorer`), and CodeXStudio no longer tries to hide the built-in Files view, which VS Code doesn't allow. If 0.1.0 hid it, it is shown again.
- SQL database projects: database icon, .dacpac build-output node, Publish / Schema Compare / Deploy DACPAC through the optional mssql extension, and a warning for Microsoft.Build.Sql 1.x on .NET SDK 10.
- Build configuration picker (Debug / Release / custom configurations and platforms from the solution) in the status bar; used by Build, Clean, Test, Run and Debug and saved per solution.

## 0.1.0 — 2026-10-10

Initial release.

- Solution Explorer view with solution folders, projects, dependencies (frameworks, NuGet packages, project references) and project files.
- `.sln` and `.slnx` parsing with validation and clear errors.
- Virtual solution folders stored in a CodeXStudio layout file (create, rename, delete, nest, drag and drop, move projects).
- Build, restore, clean, test, add project reference, add existing project and NuGet package commands through the `dotnet` CLI.
- CodeXStudio Dark and CodeXStudio Light color themes.
- "Apply Recommended Settings" command with per-setting review.
- The solution layout (virtual folders, startup project) is stored in `.vscode/.codeStudio-settings`.
- Solution Explorer icon colors are contributed theme colors (`codestudio.*Icon`) with dark/light/high-contrast defaults, customizable per theme.
- Set as Startup Project, Start Debugging (via the C# extension's coreclr debugger) and Start Without Debugging (`dotnet run`), with a status bar item.
- NuGet Package Manager UI (Browse / Installed / Updates, version picker, install / update / update all / uninstall, project switcher).
- C# formatter with `dotnet format` (default) or CSharpier engines, plus an Install CSharpier command.
- Bracket-pair colorization, guides and matching enabled for C#; six bracket colors in both themes.
- Coding standards (opt-in): configurable naming and code-style rules, live diagnostics with rename quick fixes, managed `.editorconfig` section, optional build enforcement, and Check/Fix commands via `dotnet format`.
- Solution Explorer is the default explorer (shown in the Explorer sidebar, Files view hidden) with `codestudio.defaultExplorer` and a "Restore VS Code Default Explorer" command to revert. (changed in 0.2.0)
- New Project from any installed `dotnet new` template, added to the solution (and to a virtual folder when invoked on one).
- New Item with 14 C# templates and Visual Studio-style namespace inference.
