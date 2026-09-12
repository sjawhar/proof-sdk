import { $nodeSchema } from '@milkdown/kit/utils';
import type { DOMOutputSpec, Node as ProseMirrorNode, NodeSpec } from '@milkdown/kit/prose/model';

import { withBlockIdSpec } from './editor/schema/block-ids.js';

export type BlockAttributeKind = 'string' | 'bool' | 'enum' | 'string[]' | 'actor' | 'timestamp';

export interface BlockAttributeSchema {
  kind: BlockAttributeKind;
  choices?: readonly string[];
  default: string | boolean | readonly string[];
  server?: boolean;
}

export interface BlockTypeSchema {
  name: string;
  content: string;
  render: 'host';
  attributes: Readonly<Record<string, BlockAttributeSchema>>;
}

export interface BlockSchema {
  version: number;
  types: readonly BlockTypeSchema[];
}

export type HostBlockRenderer = (node: ProseMirrorNode) => DOMOutputSpec;

type DirectiveNode = {
  type: 'containerDirective' | 'leafDirective' | 'textDirective';
  name?: string;
  attributes?: Record<string, string>;
  children?: DirectiveNode[];
};

function directiveName(name: string): boolean {
  return /^[A-Za-z0-9_-]+$/.test(name);
}

function knownNames(schema: BlockSchema): string {
  return [...schema.types].map(({ name }) => name).sort().join(', ');
}

export function validateBlockSchema(schema: BlockSchema): void {
  if (!Number.isInteger(schema.version) || schema.version <= 0) {
    throw new Error('block schema version must be a positive integer');
  }
  if (schema.types.length === 0) throw new Error('block schema must declare at least one type');
  const names = new Set<string>();
  for (const type of schema.types) {
    if (!directiveName(type.name)) throw new Error(`typed block name ${JSON.stringify(type.name)} is invalid`);
    if (names.has(type.name)) throw new Error(`typed block ${JSON.stringify(type.name)} is declared twice`);
    names.add(type.name);
    if (typeof type.content !== 'string' || type.content.trim() === '') {
      throw new Error(`typed block ${JSON.stringify(type.name)} must declare a non-empty content rule`);
    }
    if (type.render !== 'host') throw new Error(`typed block ${JSON.stringify(type.name)} has unsupported render ${JSON.stringify(type.render)}`);
    for (const [name, attribute] of Object.entries(type.attributes)) {
      if (!directiveName(name)) throw new Error(`typed block ${JSON.stringify(type.name)} attribute ${JSON.stringify(name)} is invalid`);
      if (attribute.kind === 'enum' && (attribute.choices?.length ?? 0) === 0) {
        throw new Error(`typed block ${JSON.stringify(type.name)} attribute ${JSON.stringify(name)} enum has no choices`);
      }
    }
  }
}

function parseAttribute(typeName: string, name: string, attribute: BlockAttributeSchema, value: string): string | boolean | string[] {
  switch (attribute.kind) {
    case 'string':
    case 'actor':
    case 'timestamp':
      return value;
    case 'bool':
      if (value !== 'true' && value !== 'false') throw new Error(`typed block ${JSON.stringify(typeName)} attribute ${JSON.stringify(name)} must be true or false`);
      return value === 'true';
    case 'enum':
      if (!attribute.choices?.includes(value)) {
        throw new Error(`typed block ${JSON.stringify(typeName)} attribute ${JSON.stringify(name)} must be one of ${attribute.choices?.join(', ')}, got ${JSON.stringify(value)}`);
      }
      return value;
    case 'string[]': {
      let values: unknown;
      try {
        values = JSON.parse(value);
      } catch {
        throw new Error(`typed block ${JSON.stringify(typeName)} attribute ${JSON.stringify(name)} must be a JSON string array`);
      }
      if (!Array.isArray(values) || values.some((item) => typeof item !== 'string')) {
        throw new Error(`typed block ${JSON.stringify(typeName)} attribute ${JSON.stringify(name)} must be a JSON string array`);
      }
      return values;
    }
  }
}

function schemaAttrs(type: BlockTypeSchema): Record<string, { default: string | boolean | readonly string[] }> {
  return Object.fromEntries(Object.entries(type.attributes).map(([name, attribute]) => [name, { default: attribute.default }]));
}

function directiveAttrs(type: BlockTypeSchema, attrs: Record<string, string> | undefined): Record<string, string | boolean | string[]> {
  const parsed: Record<string, string | boolean | string[]> = {};
  for (const [name, attribute] of Object.entries(type.attributes)) {
    const value = attrs?.[name];
    parsed[name] = value === undefined || attribute.server ? attribute.default : parseAttribute(type.name, name, attribute, value);
  }
  for (const name of Object.keys(attrs ?? {})) {
    if (name !== 'id' && name !== 'className' && !(name in type.attributes)) {
      throw new Error(`typed block ${JSON.stringify(type.name)} does not declare attribute ${JSON.stringify(name)}`);
    }
    if (name === 'className') {
      throw new Error(`typed block ${JSON.stringify(type.name)} does not declare attribute "class"`);
    }
  }
  if (attrs?.id) parsed.blockId = attrs.id;
  return parsed;
}

function markdownAttrs(type: BlockTypeSchema, node: ProseMirrorNode): Record<string, string> {
  const attributes: Record<string, string> = {};
  const blockId = node.attrs.blockId;
  if (typeof blockId !== 'string' || blockId === '') throw new Error(`typed block ${JSON.stringify(type.name)} is missing blockId`);
  attributes.id = blockId;
  for (const [name, definition] of Object.entries(type.attributes)) {
    const value = node.attrs[name];
    if (value === undefined) throw new Error(`typed block ${JSON.stringify(type.name)} is missing attribute ${JSON.stringify(name)}`);
    attributes[name] = definition.kind === 'bool' ? String(value) : definition.kind === 'string[]' ? JSON.stringify(value) : String(value);
  }
  return attributes;
}

export function blockSchemaPlugins(schema: BlockSchema, renderBlock?: HostBlockRenderer) {
  validateBlockSchema(schema);
  return schema.types.map((type) => $nodeSchema(type.name, () => {
    const spec: NodeSpec = withBlockIdSpec({
      attrs: schemaAttrs(type),
      content: type.content,
      group: 'block',
      defining: true,
      isolating: true,
      parseDOM: [{ tag: `section[data-proof-block-type="${type.name}"]` }],
      toDOM: (node) => renderBlock?.(node) ?? [
        'section',
        {
          class: `proof-typed-block proof-typed-block-${type.name}`,
          'data-proof-block-type': type.name,
        },
        0,
      ],
      parseMarkdown: {
        match: (node) => (node as DirectiveNode).type === 'containerDirective' && (node as DirectiveNode).name === type.name,
        runner: (state, node, nodeType) => {
          const directive = node as DirectiveNode;
          state.openNode(nodeType, directiveAttrs(type, directive.attributes));
          state.next(directive.children);
          state.closeNode();
        },
      },
      toMarkdown: {
        match: (node) => node.type.name === type.name,
        runner: (state, node) => {
          state.openNode('containerDirective', undefined, {
            name: type.name,
            attributes: markdownAttrs(type, node),
          });
          state.next(node.content);
          state.closeNode();
        },
      },
    });
    return spec;
  }));
}

function visit(node: DirectiveNode, schema: BlockSchema): void {
  if (node.type === 'leafDirective') throw new Error('leaf directives (::name) are not supported');
  if (node.type === 'textDirective') throw new Error('text directives (:name{...}) are not supported');
  if (node.type === 'containerDirective') {
    const name = node.name ?? '';
    const type = schema.types.find((candidate) => candidate.name === name);
    if (!type) throw new Error(`unknown typed block ${JSON.stringify(name)} (known types: ${knownNames(schema)})`);
    directiveAttrs(type, node.attributes);
  }
  for (const child of node.children ?? []) visit(child, schema);
}

export function remarkTypedBlocks(schema: BlockSchema) {
  validateBlockSchema(schema);
  return (tree: { children?: DirectiveNode[] }) => {
    for (const child of tree.children ?? []) visit(child, schema);
  };
}

export function rejectUnsupportedDirectiveSyntax(markdown: string): void {
  for (const [index, line] of markdown.split('\n').entries()) {
    const trimmed = line.trimStart();
    if (trimmed.startsWith(':::') && trimmed !== ':::') {
      if (!/^:::[A-Za-z0-9_-]+\{.*\}$/.test(trimmed)) {
        throw new Error(`line ${index + 1}: typed block directives use :::name{...}; Pandoc fenced divs and malformed directives are not supported`);
      }
    }
  }
}
