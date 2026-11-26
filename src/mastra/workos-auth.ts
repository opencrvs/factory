import { MastraAuthWorkos } from '@mastra/auth-workos';

/**
 * WorkOS sign-in with two fixes for `@mastra/auth-workos` 1.7.0.
 *
 * 1. Sign-in failed with "Data is not JSON serializable". The WorkOS SDK
 *    (`@workos-inc/node` 12) gives the user `Date` values for `createdAt`,
 *    `updatedAt` and `lastSignInAt`. The provider puts this user into the
 *    session cookie, and `@workos/authkit-session` 0.7 seals the cookie with
 *    `iron-webcrypto` 2, which refuses `Date` values. The same thing happens
 *    when AuthKit refreshes a session. This class changes the user to plain
 *    JSON (dates become ISO strings) when WorkOS returns it. AuthKit 0.9.1
 *    does the same, but `@mastra/auth-workos` 1.7.0 only accepts `^0.7.1`.
 *    Remove this fix when Mastra releases a version that uses AuthKit 0.9.1
 *    or later.
 *
 * 2. When the code exchange at `/auth/callback` fails, Factory sends the
 *    browser back to `/auth/login` and does not log the error. WorkOS then
 *    signs the person in again at once, so the browser goes round until it
 *    stops with "too many redirects". This class logs the error before
 *    Factory hides it. The `rawData` field of a WorkOS error can contain a
 *    pending authentication token, so the log does not include it.
 */
export class PatchedMastraAuthWorkos extends MastraAuthWorkos {
  constructor(...args: ConstructorParameters<typeof MastraAuthWorkos>) {
    super(...args);
    // AuthService (session refresh) uses this same WorkOS client, so the
    // change also applies to refreshed sessions.
    const userManagement = this.workos.userManagement;
    const authenticateWithCode = userManagement.authenticateWithCode.bind(userManagement);
    userManagement.authenticateWithCode = async payload => withPlainUser(await authenticateWithCode(payload));
    const authenticateWithRefreshToken = userManagement.authenticateWithRefreshToken.bind(userManagement);
    userManagement.authenticateWithRefreshToken = async payload =>
      withPlainUser(await authenticateWithRefreshToken(payload));
  }

  override async handleCallback(...args: Parameters<MastraAuthWorkos['handleCallback']>) {
    try {
      return await super.handleCallback(...args);
    } catch (error) {
      console.error('[auth] The WorkOS code exchange at /auth/callback failed:', describeError(error));
      throw error;
    }
  }
}

/**
 * Returns the result with a JSON copy of `user`. The type still says `Date`,
 * but the values are ISO strings. A session that AuthKit reads back from the
 * cookie also has strings, so the code after this already accepts them.
 */
function withPlainUser<T extends { user: unknown }>(result: T): T {
  return { ...result, user: JSON.parse(JSON.stringify(result.user)) };
}

const SAFE_ERROR_FIELDS = ['name', 'message', 'status', 'code', 'error', 'errorDescription', 'requestID'];

export function describeError(error: unknown): Record<string, unknown> {
  if (!(error instanceof Error)) return { error: String(error) };
  const fields = error as Error & Record<string, unknown>;
  return Object.fromEntries(
    SAFE_ERROR_FIELDS.map(key => [key, fields[key]]).filter(([, value]) => value !== undefined && value !== ''),
  );
}
