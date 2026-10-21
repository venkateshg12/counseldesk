import { z } from "zod";

/*
  Models asked for JSON sometimes get the envelope wrong even at temperature 0: the object comes
  back cut off, wrapped in an extra layer (`{"intent":{"intent":"x","reason":"y"}`) or inside a code
  fence. This turns that output into the value the caller asked for, or fails the way the caller
  already handles (SyntaxError for unparseable text, ZodError for the wrong shape).

  Repairs are only tried after a strict parse fails, and every candidate still has to pass the
  caller's schema, so a repair can never smuggle in a value the schema would have refused.
 */

const stripFence = (text: string) => {
  const trimmed = text.trim();
  const match = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return match ? match[1]! : trimmed;
};

// Appends the closing quote / brackets a cut-off or sloppy answer is missing.
export const closeOpenBrackets = (text: string) => {
  const stack: string[] = [];
  let inString = false;
  let escaped = false;

  for (const char of text) {
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === "{") stack.push("}");
    else if (char === "[") stack.push("]");
    else if ((char === "}" || char === "]") && stack.at(-1) === char)
      stack.pop();
  }

  return text + (inString ? '"' : "") + stack.reverse().join("");
};

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const parseModelJson = <T>(content: string, schema: z.ZodType<T>): T => {
  const text = stripFence(content);

  const candidates: string[] = [text];
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first !== -1 && last > first)
    candidates.push(text.slice(first, last + 1));
  if (first !== -1) candidates.push(closeOpenBrackets(text.slice(first)));

  let syntaxError: SyntaxError | undefined;
  let schemaError: unknown;

  for (const candidate of candidates) {
    let value: unknown;
    try {
      value = JSON.parse(candidate);
    } catch (error) {
      syntaxError ??= error as SyntaxError;
      continue;
    }

    const direct = schema.safeParse(value);
    if (direct.success) return direct.data;
    schemaError ??= direct.error;

    // One extra layer around the object that was asked for.
    if (isPlainObject(value)) {
      const keys = Object.keys(value);
      const inner = keys.length === 1 ? value[keys[0]!] : undefined;
      if (isPlainObject(inner)) {
        const unwrapped = schema.safeParse(inner);
        if (unwrapped.success) return unwrapped.data;
      }
    }
  }

  // Prefer the wrong-shape error when the text did parse, so callers see what the model sent.
  throw schemaError ?? syntaxError ?? new SyntaxError("Empty model response");
};

type JsonProperty = { type?: string; enum?: unknown[]; maxLength?: number };

const SIMPLE_TYPES = ["string", "number", "integer", "boolean"];

const exampleValue = (property: JsonProperty): unknown => {
  if (property.enum) return property.enum[0];
  if (property.type === "string") return "<text>";
  if (property.type === "boolean") return true;
  return 0;
};

/*
  How to tell a chat model what JSON to send back. Handing it a raw JSON Schema made it echo the
  schema's own property definitions (`{"intent":{"type":"string","enum":[...]}`) for plain questions,
  so for flat objects the fields are described in words, with an example of the shape. Anything
  more complex falls back to the schema itself.
 */
export const describeJsonReply = (schema: z.ZodType): string => {
  const { $schema: _ignored, ...json } = z.toJSONSchema(schema) as Record<
    string,
    unknown
  > & { properties?: Record<string, JsonProperty>; required?: string[] };

  const properties = json.properties;
  const isFlat =
    json.type === "object" &&
    properties &&
    Object.values(properties).every(
      (property) => property.enum || SIMPLE_TYPES.includes(property.type ?? ""),
    );

  if (!isFlat || !properties) {
    return `Respond with only a JSON object that matches this JSON Schema:\n${JSON.stringify(json)}`;
  }

  const required = new Set(json.required ?? []);
  const fields = Object.entries(properties)
    .map(([name, property]) => {
      const kind = property.enum
        ? `exactly one of ${property.enum.map((value) => JSON.stringify(value)).join(", ")}`
        : property.type;
      const limit = property.maxLength
        ? ` (at most ${property.maxLength} characters)`
        : "";
      return `- "${name}": ${kind}${limit}${required.has(name) ? "" : ", optional"}`;
    })
    .join("\n");
  const example = JSON.stringify(
    Object.fromEntries(
      Object.entries(properties).map(([name, property]) => [
        name,
        exampleValue(property),
      ]),
    ),
  );

  return `Respond with only one JSON object holding real values for these fields (never a schema or a description of one):\n${fields}\nShape of the answer: ${example}`;
};
