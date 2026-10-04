/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_FIREBASE_API_KEY?: string;
  readonly VITE_FIREBASE_AUTH_DOMAIN?: string;
  readonly VITE_FIREBASE_PROJECT_ID?: string;
  readonly VITE_FIREBASE_APP_ID?: string;
  readonly VITE_USE_EMULATORS?: string;
  readonly VITE_AUTH_EMULATOR_URL?: string;
  readonly VITE_API_BASE_URL?: string;
  readonly VITE_APP_URL?: string;
  /**
   * Comma-separated, for the sign-in screen's client-side hint ONLY. The
   * server's `ALLOWED_DOMAINS` is the allowlist that actually decides.
   */
  readonly VITE_ALLOWED_DOMAINS?: string;
  /** Contest name in the header, if it should differ from the default. */
  readonly VITE_CONTEST_NAME?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
