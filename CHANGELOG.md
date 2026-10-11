# Changelog

## Unreleased

- SQL database projects: database icon, .dacpac build-output node, Publish / Schema Compare / Deploy DACPAC through the optional mssql extension, and a warning for Microsoft.Build.Sql 1.x on .NET SDK 10.
- Build configuration picker (Debug / Release / custom configurations and platforms from the solution) in the status bar; used by Build, Clean, Test, Run and Debug and saved per solution.
- The solution layout (virtual folders, startup project) is stored in `.vscode/.codeStudio-settings`.
- Solution Explorer icon colors are contributed theme colors (`codestudio.*Icon`) with dark/light/high-contrast defaults, customizable per theme.
- Set as Startup Project, Start Debugging (via the C# extension's coreclr debugger) and Start Without Debugging (`dotnet run`), with a status bar item.
- NuGet Package Manager UI (Browse / Installed / Updates, version picker, install / update / update all / uninstall, project switcher).
- C# formatter with `dotnet format` (default) or CSharpier engines, plus an Install CSharpier command.
- Bracket-pair colorization, guides and matching enabled for C#; six bracket colors in both themes.
- Coding standards (opt-in): configurable naming and code-style rules, live diagnostics with rename quick fixes, managed `.editorconfig` section, optional build enforcement, and Check/Fix commands via `dotnet format`.
- Solution Explorer is the default explorer (shown in the Explorer sidebar, Files view hidden) with `codestudio.defaultExplorer` and a "Restore VS Code Default Explorer" command to revert.
- New Project from any installed `dotnet new` template, added to the solution (and to a virtual folder when invoked on one).
- New Item with 14 C# templates and Visual Studio-style namespace inference.

## 0.1.0 — 2026-10-10

Initial release.

- Solution Explorer view with solution folders, projects, dependencies (frameworks, NuGet packages, project references) and project files.
- `.sln` and `.slnx` parsing with validation and clear errors.
- Virtual solution folders stored in a CodeXStudio layout file (create, rename, delete, nest, drag and drop, move projects).
- Build, restore, clean, test, add project reference, add existing project and NuGet package commands through the `dotnet` CLI.
- CodeXStudio Dark and CodeXStudio Light color themes.
- "Apply Recommended Settings" command with per-setting review.
