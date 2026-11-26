import { MastraAuthWorkos } from '@mastra/auth-workos';

/**
 * WorkOS sign-in that logs a failed code exchange.
 *
 * When the code exchange at `/auth/callback` fails, Factory sends the browser
 * back to `/auth/login` and does not log the error. WorkOS then signs the
 * person in again at once, so the browser goes round until it stops with
 * "too many redirects". This class logs the error before Factory hides it.
 *
 * The log contains only fields that hold no tokens. The `rawData` field of a
 * WorkOS error can contain a pending authentication token, so it is not
 * logged.
 */
export class LoggedMastraAuthWorkos extends MastraAuthWorkos {
  override async handleCallback(...args: Parameters<MastraAuthWorkos['handleCallback']>) {
    try {
      return await super.handleCallback(...args);
    } catch (error) {
      console.error('[auth] The WorkOS code exchange at /auth/callback failed:', describeError(error));
      throw error;
    }
  }
}

const SAFE_ERROR_FIELDS = ['name', 'message', 'status', 'code', 'error', 'errorDescription', 'requestID'];

export function describeError(error: unknown): Record<string, unknown> {
  if (!(error instanceof Error)) return { error: String(error) };
  const fields = error as Error & Record<string, unknown>;
  return Object.fromEntries(
    SAFE_ERROR_FIELDS.map(key => [key, fields[key]]).filter(([, value]) => value !== undefined && value !== ''),
  );
}
