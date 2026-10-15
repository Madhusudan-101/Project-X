/**
 * Routes each call on a service object to either the live implementation or the
 * demo one, decided per call. The demo object is never given the live client, and
 * the live object is never invoked while `isDemo()` is true.
 */
export function withDemo<T extends object>(live: T, demo: T, isDemo: () => boolean): T {
  return new Proxy(live, {
    get(target, prop) {
      const source = isDemo() ? demo : target;
      const value = Reflect.get(source, prop);
      return typeof value === "function" ? value.bind(source) : value;
    },
  });
}
