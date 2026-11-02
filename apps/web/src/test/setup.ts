import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// Vitest doesn't enable globals here, so Testing Library can't auto-register cleanup.
afterEach(() => cleanup());
