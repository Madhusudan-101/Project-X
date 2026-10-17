import { describe, expect, it } from "vitest";
import { checkDisplays, readIsExtended } from "@/components/candidate/oa/start/display-check";

describe("checkDisplays", () => {
  it("trusts screen.isExtended when the browser has it (no permission prompt)", async () => {
    expect(await checkDisplays({ screen: { isExtended: true } })).toEqual({ status: "multiple", count: null, method: "is-extended" });
    expect(await checkDisplays({ screen: { isExtended: false } })).toEqual({ status: "single", count: 1, method: "is-extended" });
  });

  it("does not ask for the window-management permission when isExtended already answered", async () => {
    let asked = false;
    await checkDisplays({ screen: { isExtended: false }, getScreenDetails: async () => ((asked = true), { screens: [1, 2] }) });
    expect(asked).toBe(false);
  });

  it("falls back to getScreenDetails for an exact count", async () => {
    expect(await checkDisplays({ getScreenDetails: async () => ({ screens: [{}, {}, {}] }) })).toEqual({
      status: "multiple", count: 3, method: "window-management",
    });
    expect(await checkDisplays({ getScreenDetails: async () => ({ screens: [{}] }) })).toEqual({
      status: "single", count: 1, method: "window-management",
    });
  });

  it("says 'unknown' (never guesses) when the permission is refused or the browser has no API", async () => {
    const refused = { getScreenDetails: async () => { throw new DOMException("denied", "NotAllowedError"); } };
    expect(await checkDisplays(refused)).toEqual({ status: "unknown", count: null, method: "unsupported" });
    expect(await checkDisplays({})).toEqual({ status: "unknown", count: null, method: "unsupported" });
    expect(await checkDisplays({ screen: {} })).toEqual({ status: "unknown", count: null, method: "unsupported" });
  });

  it("readIsExtended is null unless the browser reports a boolean", () => {
    expect(readIsExtended({ screen: { isExtended: true } })).toBe(true);
    expect(readIsExtended({ screen: { isExtended: undefined } })).toBeNull();
    expect(readIsExtended({})).toBeNull();
  });
});
