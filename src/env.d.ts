/// <reference types="vite/client" />
import type { EngineApi } from '@shared/preload';

declare global {
  interface Window {
    engine: EngineApi;
  }
}

