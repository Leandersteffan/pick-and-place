// Web_App spec validator (Requirement 3.1).
// One Ajv2020 instance, compiled once from the shared schema file that the
// Backend's Python jsonschema validator also reads.
import Ajv2020 from 'ajv/dist/2020';
import type { ErrorObject } from 'ajv';
import schema from '../../../schema/spec.v1.schema.json';

export interface SpecError {
  pointer: string;
  message: string;
  keyword: string;
}

export interface SpecVerdict {
  valid: boolean;
  errors: SpecError[];
}

const ajv = new Ajv2020({ allErrors: true, strict: true, discriminator: true });
const validate = ajv.compile(schema);

// Part types the discriminator accepts, read from the oneOf branches so the
// message cannot drift from the schema.
interface TypeProp { enum?: string[]; const?: string }
const defs = schema.$defs as unknown as Record<string, { properties?: { type?: TypeProp } }>;
const PART_TYPES: string[] = schema.properties.parts.items.oneOf.flatMap((branch) => {
  const prop = defs[branch.$ref.replace('#/$defs/', '')]?.properties?.type;
  return prop?.enum ?? (prop?.const !== undefined ? [prop.const] : []);
});

// ajv's discriminator reports a bad or missing tag on the part itself. The
// Backend reports a type that matches no branch as an `enum` error on
// /parts/<i>/type, and a missing type only through `required`. Map ajv's error
// the same way so both lists line up. Returns null to drop the error.
function fromDiscriminator(error: ErrorObject): SpecError | null {
  const params = error.params as { error?: string; tag?: string; tagValue?: unknown };
  if (params.error === 'tag' && params.tagValue === undefined) return null;
  return {
    pointer: `${error.instancePath}/${params.tag ?? 'type'}`,
    message: `${JSON.stringify(params.tagValue)} is not one of ${PART_TYPES.join(', ')}`,
    keyword: 'enum',
  };
}

function toSpecError(error: ErrorObject): SpecError | null {
  if (error.keyword === 'discriminator') return fromDiscriminator(error);
  return {
    // instancePath is already an RFC 6901 JSON pointer, "" for the root.
    pointer: error.instancePath,
    message: error.message ?? error.keyword,
    keyword: error.keyword,
  };
}

function compare(a: SpecError, b: SpecError): number {
  // Same order as the Backend: by pointer, then keyword (plain code-point order,
  // like Python's sorted on str).
  if (a.pointer !== b.pointer) return a.pointer < b.pointer ? -1 : 1;
  if (a.keyword !== b.keyword) return a.keyword < b.keyword ? -1 : 1;
  return 0;
}

export function validateSpec(spec: unknown): SpecVerdict {
  const valid = validate(spec) as boolean;
  const errors = valid
    ? []
    : (validate.errors ?? [])
        .map(toSpecError)
        .filter((e): e is SpecError => e !== null)
        .sort(compare);
  return { valid, errors };
}
