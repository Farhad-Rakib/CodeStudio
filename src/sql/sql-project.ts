// Pure helpers for SQL database projects (.sqlproj). No 'vscode' import.
import * as path from 'path';

export const SQL_SDK = 'Microsoft.Build.Sql';

/** Version of the Microsoft.Build.Sql SDK from a project's Sdk value ("Microsoft.Build.Sql/2.3.0"). */
export function sqlSdkVersion(sdk: string | undefined): string | undefined {
  const m = /^\s*Microsoft\.Build\.Sql\s*\/\s*([0-9][0-9A-Za-z.\-+]*)\s*$/i.exec(sdk ?? '');
  return m?.[1];
}

/** SDK-style projects use Microsoft.Build.Sql; anything else is a legacy (Visual Studio SSDT) project. */
export function isSdkStyleSqlProject(sdk: string | undefined): boolean {
  return /^\s*Microsoft\.Build\.Sql\b/i.test(sdk ?? '');
}

/**
 * Microsoft.Build.Sql 1.x imports NuGet pack targets that .NET SDK 10 no longer ships, so the build
 * fails with MSB4019. Returns a user-facing warning, or undefined when the combination is fine.
 */
export function sqlSdkCompatibilityWarning(sdk: string | undefined, dotnetSdkVersion: string): string | undefined {
  const version = sqlSdkVersion(sdk);
  const sqlMajor = version ? Number.parseInt(version, 10) : NaN;
  const dotnetMajor = Number.parseInt(dotnetSdkVersion, 10);
  if (!(sqlMajor < 2) || !(dotnetMajor >= 10)) return undefined;
  return `This project uses ${SQL_SDK} ${version}, which does not build with .NET SDK ${dotnetSdkVersion} (error MSB4019). `
    + `Change the Sdk to ${SQL_SDK}/2.3.0 or later in the project file.`;
}

/** Where `dotnet build` puts the .dacpac: bin/<Configuration>/<ProjectName>.dacpac. */
export function dacpacPath(projectPath: string, configuration: string): string {
  return path.join(path.dirname(projectPath), 'bin', configuration, `${path.basename(projectPath, path.extname(projectPath))}.dacpac`);
}
