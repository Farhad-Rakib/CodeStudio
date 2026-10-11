# Upcoming features

Features planned for CodeXStudio, grouped by priority. Each one wraps the `dotnet` CLI (or another official
tool) rather than reimplementing it, and loads only when it is first used.

## Next up

### Multiple startup projects
- ~~Status bar picker for the active configuration and platform~~ (done: see the README).
- Mark several projects as startup projects, each with an action (Start, Start without debugging, None),
  like Visual Studio's "Multiple startup projects" dialog. F5 starts them together; stopping stops all of them.
- Saved per solution in `.vscode/.codeStudio-settings`.

### NuGet "Consolidate" tab
- Lists packages that are installed at different versions across projects in the solution.
- Pick a version and the projects to align, then update them in one step.
- Respects Central Package Management (`Directory.Packages.props`) when it is used.

### Microservice solutions
- Named launch groups ("Backend only", "Full stack") that start a chosen set of projects together.
- Per-project launch profile (from `launchSettings.json`) and environment variables inside a group.
- Port overview: which project listens on which URL, with port-conflict warnings before starting.
- Optional hooks for Docker Compose and .NET Aspire AppHost projects: when an AppHost exists, run it
  instead of starting services one by one.

## Planned

### Project and run setup
- **Launch profile picker**: choose a `launchSettings.json` profile (http / https / IIS Express) next to
  the run button.
- **Manage User Secrets**: right-click a project to run `dotnet user-secrets init` and open `secrets.json`.
- **Project Properties editor**: target framework, nullable, implicit usings, output type, assembly info
  and package metadata, written back to the `.csproj`.

### Data and deployment
- **EF Core migrations**: add, remove and apply migrations and generate SQL scripts (wraps `dotnet ef`).
- **Publish profiles (`.pubxml`)**: folder, self-contained, single-file and container publishing
  (wraps `dotnet publish`).
- **SQL publish without the mssql extension** (fallback): script / deploy report / publish through
  SqlPackage, with review before publishing and data-loss protection on. Only if users ask for it;
  the mssql-based Publish / Schema Compare / Deploy DACPAC integration is done.

### Scaffolding
- Add Controller / Razor Page / Identity (wraps `dotnet aspnet-codegenerator`).

### Solution Explorer
- File operations on physical nodes: new file, new folder, rename, delete.
- Native solution folder editing for `.sln` / `.slnx` (through the `dotnet` CLI).
- Project build order and project dependencies view; unload / reload project.
- Test Explorer integration.

### NuGet
- Browse private feeds from `nuget.config`, not only nuget.org.

## Ideas (not scheduled)
- `.resx` resource editor.
- Class View / Object Browser.
- Code metrics.
- MSBuild-evaluated project information instead of static `.csproj` reading.
- CI workflow for the extension itself.

## Out of scope
Profiler and diagnostic tools, IntelliTrace and architecture diagrams. These are large, debugger-specific
features that belong to Microsoft's C# tooling.
