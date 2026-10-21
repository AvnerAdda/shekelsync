import '@testing-library/jest-dom/vitest';
import type { TestingLibraryMatchers } from '@testing-library/jest-dom/matchers';

// jest-dom 7 still augments Assertion; Vitest 5 reads custom matcher types here.
declare module 'vitest' {
  // Module augmentation requires an interface so Vitest's declarations can merge.
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface Matchers<R, T> extends TestingLibraryMatchers<T, R> {}
}
