/**
 * Test infrastructure only. `config.ts` imports `electron` for path lookup;
 * the logic under test (`pickOutputDisplay`) is pure, so vitest aliases the
 * electron module to this stub. Nothing in `src/` or `electron/` imports it.
 */
export const app = {
  isPackaged: false,
  getPath: () => '/tmp/projection-engine-test',
  getAppPath: () => '/tmp/projection-engine-test',
};
