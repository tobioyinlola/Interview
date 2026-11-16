import { act, renderHook } from "@testing-library/react";

import { useAutosave } from "./useAutosave";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const setup = (
  initial: string,
  save = vi.fn().mockResolvedValue(undefined),
  enabled = true,
) => {
  const hook = renderHook(
    ({ value, enabled }) =>
      useAutosave({ text: value }, save, { enabled, delayMs: 2000 }),
    { initialProps: { value: initial, enabled } },
  );
  return { ...hook, save };
};

describe("useAutosave", () => {
  it("does not save the value that was just loaded", async () => {
    const { save } = setup("hello");
    await act(() => vi.advanceTimersByTimeAsync(10_000));
    expect(save).not.toHaveBeenCalled();
  });

  it("saves once, after the delay, with the latest value", async () => {
    const { rerender, save, result } = setup("a");
    rerender({ value: "ab", enabled: true });
    await act(() => vi.advanceTimersByTimeAsync(1500));
    rerender({ value: "abc", enabled: true });
    await act(() => vi.advanceTimersByTimeAsync(1500)); // 1.5 s after the last edit: not yet
    expect(save).not.toHaveBeenCalled();
    expect(result.current.status).toBe("dirty");
    await act(() => vi.advanceTimersByTimeAsync(600));
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith({ text: "abc" });
    expect(result.current.status).toBe("saved");
  });

  it("does nothing while disabled, then treats the first enabled value as the baseline", async () => {
    const { rerender, save } = setup("", undefined, false);
    rerender({ value: "loaded from server", enabled: true });
    await act(() => vi.advanceTimersByTimeAsync(10_000));
    expect(save).not.toHaveBeenCalled();
  });

  it("reports an error and retries on demand", async () => {
    const save = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue(undefined);
    const { rerender, result } = setup("a", save);
    rerender({ value: "b", enabled: true });
    await act(() => vi.advanceTimersByTimeAsync(2100));
    expect(result.current.status).toBe("error");
    await act(() => result.current.retry());
    expect(save).toHaveBeenCalledTimes(2);
    expect(result.current.status).toBe("saved");
  });

  it("flushes unsaved changes when the page is left inside the delay window", async () => {
    const { rerender, unmount, save } = setup("a");
    rerender({ value: "edited", enabled: true });
    await act(() => vi.advanceTimersByTimeAsync(500));
    unmount();
    expect(save).toHaveBeenCalledWith({ text: "edited" });
  });

  it("does not flush on unmount when everything is already saved", async () => {
    const { rerender, unmount, save } = setup("a");
    rerender({ value: "b", enabled: true });
    await act(() => vi.advanceTimersByTimeAsync(2100));
    unmount();
    expect(save).toHaveBeenCalledTimes(1);
  });
});
