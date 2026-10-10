// Pure coding-standards options model. No 'vscode' import.
import { NameRequirement, NAMING_STYLES, NamingStyle } from './naming';

export type Severity = 'suggestion' | 'warning' | 'error';
export type VarPreference = 'whenTypeIsApparent' | 'always' | 'never';

export interface CodingStandards {
  readonly severity: Severity;
  readonly naming: {
    readonly types: NamingStyle;
    readonly interfacePrefix: boolean;
    readonly typeParameterPrefix: boolean;
    readonly methods: NamingStyle;
    readonly asyncSuffix: boolean;
    readonly properties: NamingStyle;
    readonly publicFields: NamingStyle;
    readonly privateFields: NamingStyle;
    readonly privateStaticFields: NamingStyle;
    readonly constants: NamingStyle;
    readonly localsAndParameters: NamingStyle;
  };
  readonly style: {
    readonly var: VarPreference;
    readonly braces: boolean;
    readonly fileScopedNamespaces: boolean;
    readonly usingsOutsideNamespace: boolean;
    readonly predefinedTypes: boolean;
  };
}

/** Microsoft's .NET runtime conventions. */
export const DEFAULT_STANDARDS: CodingStandards = {
  severity: 'warning',
  naming: {
    types: 'PascalCase',
    interfacePrefix: true,
    typeParameterPrefix: true,
    methods: 'PascalCase',
    asyncSuffix: true,
    properties: 'PascalCase',
    publicFields: 'PascalCase',
    privateFields: '_camelCase',
    privateStaticFields: 's_camelCase',
    constants: 'PascalCase',
    localsAndParameters: 'camelCase',
  },
  style: {
    var: 'whenTypeIsApparent',
    braces: true,
    fileScopedNamespaces: true,
    usingsOutsideNamespace: true,
    predefinedTypes: true,
  },
};

/** Reads options through a getter (e.g. WorkspaceConfiguration.get), falling back to defaults for invalid values. */
export function readStandards(get: (key: string) => unknown): CodingStandards {
  const pick = <T extends string>(key: string, allowed: readonly T[], fallback: T): T => {
    const v = get(key);
    return typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
  };
  const bool = (key: string, fallback: boolean) => {
    const v = get(key);
    return typeof v === 'boolean' ? v : fallback;
  };
  const d = DEFAULT_STANDARDS;
  const style = (key: keyof CodingStandards['naming'], fallback: NamingStyle) => pick(`naming.${key}`, NAMING_STYLES, fallback);
  return {
    severity: pick('severity', ['suggestion', 'warning', 'error'] as const, d.severity),
    naming: {
      types: style('types', d.naming.types),
      interfacePrefix: bool('naming.interfacePrefix', d.naming.interfacePrefix),
      typeParameterPrefix: bool('naming.typeParameterPrefix', d.naming.typeParameterPrefix),
      methods: style('methods', d.naming.methods),
      asyncSuffix: bool('naming.asyncSuffix', d.naming.asyncSuffix),
      properties: style('properties', d.naming.properties),
      publicFields: style('publicFields', d.naming.publicFields),
      privateFields: style('privateFields', d.naming.privateFields),
      privateStaticFields: style('privateStaticFields', d.naming.privateStaticFields),
      constants: style('constants', d.naming.constants),
      localsAndParameters: style('localsAndParameters', d.naming.localsAndParameters),
    },
    style: {
      var: pick('style.var', ['whenTypeIsApparent', 'always', 'never'] as const, d.style.var),
      braces: bool('style.braces', d.style.braces),
      fileScopedNamespaces: bool('style.fileScopedNamespaces', d.style.fileScopedNamespaces),
      usingsOutsideNamespace: bool('style.usingsOutsideNamespace', d.style.usingsOutsideNamespace),
      predefinedTypes: bool('style.predefinedTypes', d.style.predefinedTypes),
    },
  };
}

export type SymbolKind =
  | 'type' | 'interface' | 'typeParameter' | 'method' | 'asyncMethod' | 'property'
  | 'publicField' | 'privateField' | 'privateStaticField' | 'constant' | 'local' | 'parameter';

export const SYMBOL_LABELS: Record<SymbolKind, string> = {
  type: 'Type', interface: 'Interface', typeParameter: 'Type parameter', method: 'Method', asyncMethod: 'Async method',
  property: 'Property', publicField: 'Non-private field', privateField: 'Private field', privateStaticField: 'Private static field',
  constant: 'Constant', local: 'Local variable', parameter: 'Parameter',
};

export function requirementFor(kind: SymbolKind, s: CodingStandards): NameRequirement {
  const n = s.naming;
  switch (kind) {
    case 'type': return { style: n.types };
    case 'interface': return n.interfacePrefix ? { style: n.types, prefix: 'I' } : { style: n.types };
    case 'typeParameter': return n.typeParameterPrefix ? { style: 'PascalCase', prefix: 'T' } : { style: 'PascalCase' };
    case 'method': return { style: n.methods };
    case 'asyncMethod': return n.asyncSuffix ? { style: n.methods, suffix: 'Async' } : { style: n.methods };
    case 'property': return { style: n.properties };
    case 'publicField': return { style: n.publicFields };
    case 'privateField': return { style: n.privateFields };
    case 'privateStaticField': return { style: n.privateStaticFields };
    case 'constant': return { style: n.constants };
    case 'local':
    case 'parameter': return { style: n.localsAndParameters };
  }
}
