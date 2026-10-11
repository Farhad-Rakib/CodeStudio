import assert from 'node:assert/strict';
import * as path from 'node:path';
import { describe, it } from 'node:test';
import { targetVerbArgs } from '../src/dotnet/dotnet-args';
import { parseProjectXml } from '../src/solution/project-reader';
import { projectKindFromPath } from '../src/solution/solution-model';
import { dacpacPath, isSdkStyleSqlProject, sqlSdkCompatibilityWarning, sqlSdkVersion } from '../src/sql/sql-project';

describe('SQL database projects', () => {
  it('recognizes .sqlproj files and builds them with dotnet and the active configuration', () => {
    const proj = path.resolve('/repo/db/Db.sqlproj');
    assert.equal(projectKindFromPath(proj), 'sqlproj');
    assert.deepEqual(targetVerbArgs('build', proj, { configuration: 'Release', platform: 'Any CPU' }), ['build', proj, '-nologo', '-c', 'Release']);
  });

  it('reads the Microsoft.Build.Sql version from both Sdk forms', () => {
    const attrForm = parseProjectXml('<Project Sdk="Microsoft.Build.Sql/2.3.0"><PropertyGroup><Name>Db</Name></PropertyGroup></Project>', '/r/Db.sqlproj');
    assert.equal(attrForm.sdk, 'Microsoft.Build.Sql/2.3.0');
    const elementForm = parseProjectXml('<Project><Sdk Name="Microsoft.Build.Sql" Version="1.0.0" /></Project>', '/r/Db.sqlproj');
    assert.equal(elementForm.sdk, 'Microsoft.Build.Sql/1.0.0');
    assert.equal(sqlSdkVersion(elementForm.sdk), '1.0.0');
    assert.equal(sqlSdkVersion('Microsoft.NET.Sdk'), undefined);
    assert.ok(isSdkStyleSqlProject('Microsoft.Build.Sql/2.3.0'));
    assert.ok(isSdkStyleSqlProject('Microsoft.Build.Sql'));
    assert.ok(!isSdkStyleSqlProject(undefined), 'legacy SSDT project');
  });

  it('warns only for Microsoft.Build.Sql 1.x on .NET SDK 10 or later', () => {
    assert.match(sqlSdkCompatibilityWarning('Microsoft.Build.Sql/1.0.0', '10.0.301')!, /MSB4019.*2\.3\.0/s);
    assert.equal(sqlSdkCompatibilityWarning('Microsoft.Build.Sql/1.0.0', '9.0.100'), undefined);
    assert.equal(sqlSdkCompatibilityWarning('Microsoft.Build.Sql/2.3.0', '10.0.301'), undefined);
    assert.equal(sqlSdkCompatibilityWarning('Microsoft.Build.Sql', '10.0.301'), undefined, 'version from global.json is unknown');
    assert.equal(sqlSdkCompatibilityWarning(undefined, '10.0.301'), undefined);
  });

  it('locates the .dacpac for a configuration', () => {
    const proj = path.resolve('/repo/db/Db.sqlproj');
    assert.equal(dacpacPath(proj, 'Debug'), path.resolve('/repo/db/bin/Debug/Db.dacpac'));
    assert.equal(dacpacPath(proj, 'Release'), path.resolve('/repo/db/bin/Release/Db.dacpac'));
  });
});
