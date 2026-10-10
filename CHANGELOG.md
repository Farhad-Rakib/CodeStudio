# Changelog

## Unreleased

- NuGet Package Manager UI (Browse / Installed / Updates, version picker, install / update / update all / uninstall, project switcher).
- C# formatter with `dotnet format` (default) or CSharpier engines, plus an Install CSharpier command.
- Bracket-pair colorization, guides and matching enabled for C#; six bracket colors in both themes.
- Coding standards (opt-in): configurable naming and code-style rules, live diagnostics with rename quick fixes, managed `.editorconfig` section, optional build enforcement, and Check/Fix commands via `dotnet format`.
- Solution Explorer is the default explorer (shown in the Explorer sidebar, Files view hidden) with `dotpilot.defaultExplorer` and a "Restore VS Code Default Explorer" command to revert.
- New Project from any installed `dotnet new` template, added to the solution (and to a virtual folder when invoked on one).
- New Item with 14 C# templates and Visual Studio-style namespace inference.

## 0.1.0 — 2026-10-10

Initial release.

- Solution Explorer view with solution folders, projects, dependencies (frameworks, NuGet packages, project references) and project files.
- `.sln` and `.slnx` parsing with validation and clear errors.
- Virtual solution folders stored in `.dotpilot/solution-layout.json` (create, rename, delete, nest, drag and drop, move projects).
- Build, restore, clean, test, add project reference, add existing project and NuGet package commands through the `dotnet` CLI.
- DotPilot Dark and DotPilot Light color themes.
- "Apply Recommended Settings" command with per-setting review.
