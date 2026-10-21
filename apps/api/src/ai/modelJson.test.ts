import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  closeOpenBrackets,
  describeJsonReply,
  parseModelJson,
} from "./modelJson.js";

const schema = z.object({
  intent: z.enum(["question", "wants_lawyer"]),
  reason: z.string(),
});
const good = { intent: "wants_lawyer", reason: "asked for a lawyer" };

describe("parseModelJson", () => {
  it("parses clean JSON", () => {
    expect(parseModelJson(JSON.stringify(good), schema)).toEqual(good);
  });

  it("strips a code fence and surrounding chatter", () => {
    expect(
      parseModelJson("```json\n" + JSON.stringify(good) + "\n```", schema),
    ).toEqual(good);
    expect(
      parseModelJson(`Sure! ${JSON.stringify(good)} Hope that helps.`, schema),
    ).toEqual(good);
  });

  it("repairs the real failure: an extra wrapper object and a missing closing brace", () => {
    const seen =
      '{"intent":{"intent":"wants_lawyer","reason":"User explicitly states they want to talk to a lawyer."}';
    expect(parseModelJson(seen, schema)).toEqual({
      intent: "wants_lawyer",
      reason: "User explicitly states they want to talk to a lawyer.",
    });
  });

  it("repairs a cut-off object", () => {
    expect(
      parseModelJson('{"intent":"question","reason":"asks about fees"', schema),
    ).toEqual({
      intent: "question",
      reason: "asks about fees",
    });
    expect(
      parseModelJson('{"intent":"question","reason":"asks about', schema),
    ).toEqual({
      intent: "question",
      reason: "asks about",
    });
  });

  it("never accepts a value the schema refuses", () => {
    expect(() =>
      parseModelJson('{"intent":"hack","reason":"x"}', schema),
    ).toThrow(z.ZodError);
    expect(() =>
      parseModelJson('{"intent":{"intent":"hack","reason":"x"}', schema),
    ).toThrow(z.ZodError);
    expect(() => parseModelJson('{"other":1}', schema)).toThrow(z.ZodError);
  });

  it("throws a SyntaxError for text with no JSON, and for an empty answer", () => {
    expect(() => parseModelJson("I cannot help with that.", schema)).toThrow(
      SyntaxError,
    );
    expect(() => parseModelJson("", schema)).toThrow(SyntaxError);
  });
});

describe("closeOpenBrackets", () => {
  it("closes strings, arrays and objects in the right order, ignoring brackets inside strings", () => {
    expect(closeOpenBrackets('{"a":[1,2')).toBe('{"a":[1,2]}');
    expect(closeOpenBrackets('{"a":"x}')).toBe('{"a":"x}"}');
    expect(closeOpenBrackets('{"a":"quote \\" still open')).toBe(
      '{"a":"quote \\" still open"}',
    );
    expect(closeOpenBrackets('{"a":1}')).toBe('{"a":1}');
  });
});

describe("describeJsonReply", () => {
  it("describes a flat object in words, with an example that satisfies the schema", () => {
    const text = describeJsonReply(schema);
    expect(text).toContain(
      '"intent": exactly one of "question", "wants_lawyer"',
    );
    expect(text).toContain('"reason": string');
    expect(text).toContain("never a schema");
    // The schema's own words must not be in there for the model to echo.
    expect(text).not.toContain('"type":"string"');
    expect(text).not.toContain("$schema");

    const example = JSON.parse(text.split("Shape of the answer: ")[1]!);
    expect(schema.parse(example)).toEqual(example);
  });

  it("marks optional fields and states length limits", () => {
    const text = describeJsonReply(
      z.object({ name: z.string().max(50), note: z.string().optional() }),
    );
    expect(text).toContain('"name": string (at most 50 characters)');
    expect(text).toContain('"note": string, optional');
  });

  it("falls back to the JSON Schema for nested shapes", () => {
    const text = describeJsonReply(z.object({ items: z.array(z.string()) }));
    expect(text).toContain("matches this JSON Schema");
    expect(text).toContain('"items"');
  });
});
