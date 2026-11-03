import { describe, expect, it } from "vitest";
import { isValidKey } from "../src/storage";

describe("storage keys", () => {
  it("accepts only generated keys", () => {
    const id = "0b4f2c1e-8f3a-4d2b-9c1e-1234567890ab";
    expect(isValidKey(`uploads/${id}.jpg`)).toBe(true);
    expect(isValidKey(`outputs/${id}.webp`)).toBe(true);
    for (const bad of ["../.env", "uploads/../../.env", "uploads/x.jpg", `secrets/${id}.jpg`, `uploads/${id}.jpg/../x`]) {
      expect(isValidKey(bad)).toBe(false);
    }
  });
});
