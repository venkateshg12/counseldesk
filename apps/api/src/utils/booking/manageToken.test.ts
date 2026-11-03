import { describe, expect, it } from "vitest";
import {
  appointmentIdFromToken,
  createManageToken,
  verifyManageToken,
} from "./manageToken.js";

const SECRET = "a".repeat(40);
const ID = "3f1c2d4e-5a6b-4c7d-8e9f-0a1b2c3d4e5f";
const OTHER_ID = "99999999-5a6b-4c7d-8e9f-0a1b2c3d4e5f";

describe("manage token", () => {
  it("verifies for the same appointment and link version", () => {
    const token = createManageToken(SECRET, ID, 1);
    expect(verifyManageToken(SECRET, token, ID, 1)).toBe(true);
    expect(appointmentIdFromToken(token)).toBe(ID);
  });

  it("stops verifying once the link version is bumped (cancel or reschedule)", () => {
    const token = createManageToken(SECRET, ID, 1);
    expect(verifyManageToken(SECRET, token, ID, 2)).toBe(false);
  });

  it("rejects another appointment, a wrong secret and a tampered signature", () => {
    const token = createManageToken(SECRET, ID, 1);
    expect(verifyManageToken(SECRET, token, OTHER_ID, 1)).toBe(false);
    expect(verifyManageToken("b".repeat(40), token, ID, 1)).toBe(false);
    expect(verifyManageToken(SECRET, `${token}x`, ID, 1)).toBe(false);
  });

  it("rejects malformed tokens without throwing", () => {
    for (const bad of [
      "",
      "abc",
      "a.b",
      `${ID}.x.y`,
      `${ID}.1`,
      `${ID}.1.s.t`,
    ]) {
      expect(verifyManageToken(SECRET, bad, ID, 1)).toBe(false);
    }
    expect(appointmentIdFromToken("not-a-token")).toBeNull();
  });
});
