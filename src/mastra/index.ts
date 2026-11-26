/**
 * Self-hosted Mastra entry for Mastra Factory.
 *
 * Every service is chosen explicitly here and runs on infrastructure you
 * operate: PostgreSQL for storage and recall vectors, WorkOS for sign-in, a
 * GitHub App for source control, and local sandboxes that run agent commands
 * on this machine. Swap any instance for another provider to change it.
 *
 * `mastra build` requires the entry to export a `Mastra` instance named
 * `mastra` constructed by a literal `new Mastra(...)` in THIS file — which is
 * why the factory returns constructor args from `prepare()` instead of the
 * instance.
 */

import { homedir } from 'node:os';
import { join } from 'node:path';

import { Mastra } from '@mastra/core/mastra';
import { createFactorySecretEncryption, LocalFactorySandbox, MastraFactory } from '@mastra/factory';
import { GithubIntegration } from '@mastra/factory/integrations/github/integration';
import { PgFactoryStorage, PgVector } from '@mastra/pg';

import { removeIdleSessionFolders } from './session-cleanup';
import { PatchedMastraAuthWorkos } from './workos-auth';

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required. See .env.example.`);
  return value;
}

/** Reads a whole number that is `min` or more, or returns the fallback when the variable is not set. */
function countEnv(name: string, fallback: number, min = 0): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min) throw new Error(`${name} must be a whole number that is ${min} or more.`);
  return value;
}

const sandboxRoot = join(homedir(), '.mastracode', 'web', 'sandboxes');

// Each session keeps a checkout of the repository, and Factory does not delete
// it. Delete the folders that nobody changed for some days. This must run
// before the server starts: see removeIdleSessionFolders. 0 turns it off.
await removeIdleSessionFolders(sandboxRoot, countEnv('FACTORY_SESSION_MAX_IDLE_DAYS', 7));

// TODO: drop the explicit sandbox once the `@mastra/factory` release that
// defaults it is `latest`. Until then `LocalFactorySandbox` needs its root and
// env spelled out. Only an allow-list of host variables reaches sandbox
// commands, so server secrets such as DATABASE_URL stay out of them.
const SANDBOX_ENV_KEYS = [
  'HOME',
  'USER',
  'LOGNAME',
  'SHELL',
  'TMPDIR',
  'LANG',
  'LC_ALL',
  'TERM',
  'TZ',
  'GIT_EXEC_PATH',
  'GIT_TEMPLATE_DIR',
  'SSL_CERT_FILE',
  'SSL_CERT_DIR',
];

function localSandbox(): LocalFactorySandbox {
  return new LocalFactorySandbox({
    root: sandboxRoot,
    env: Object.fromEntries(SANDBOX_ENV_KEYS.flatMap(key => (process.env[key] ? [[key, process.env[key]]] : []))),
  });
}

const databaseUrl = requiredEnv('DATABASE_URL');

export const factory = new MastraFactory({
  configVersion: 'factory-self-hosted-v1',
  // Reads WORKOS_API_KEY, WORKOS_CLIENT_ID, and WORKOS_REDIRECT_URI. The redirect defaults to <publicUrl>/auth/callback.
  // Without a fixed cookie password every restart signs everyone out.
  // PatchedMastraAuthWorkos fixes the session cookie and logs a failed sign-in (see workos-auth.ts).
  auth: new PatchedMastraAuthWorkos({
    fetchMemberships: true,
    session: { cookiePassword: requiredEnv('WORKOS_COOKIE_PASSWORD') },
  }),
  // Encrypts stored model-provider keys and integration secrets at rest.
  secretEncryption: createFactorySecretEncryption({
    primary: { id: 'v1', key: Buffer.from(requiredEnv('FACTORY_CREDENTIAL_ENCRYPTION_KEY'), 'base64') },
  }),
  storage: new PgFactoryStorage({ id: 'factory-storage', connectionString: databaseUrl }),
  vector: new PgVector({ id: 'factory-vectors', connectionString: databaseUrl }),
  integrations: [
    new GithubIntegration({
      appId: requiredEnv('GITHUB_APP_ID'),
      privateKey: requiredEnv('GITHUB_APP_PRIVATE_KEY'),
      clientId: requiredEnv('GITHUB_APP_CLIENT_ID'),
      clientSecret: requiredEnv('GITHUB_APP_CLIENT_SECRET'),
      slug: requiredEnv('GITHUB_APP_SLUG'),
      webhookSecret: requiredEnv('GITHUB_APP_WEBHOOK_SECRET'),
    }),
  ],
  // Runs agent commands on this machine as the server user, under
  // ~/.mastracode/web/sandboxes.
  sandbox: localSandbox(),
  // The agents run in the same container as the server, and each run can
  // install and build the repository. Factory defaults to 10 automated runs
  // and 2 more slots for replies from people, which is too much for one
  // server. Some runs continue outside these slots, so they limit the load
  // but do not set a hard maximum.
  dispatcher: {
    // Factory reads 0 as "use the default of 10", so the minimum is 1.
    maxInFlight: countEnv('MASTRACODE_DISPATCH_MAX_IN_FLIGHT', 2, 1),
    maxInteractiveInFlight: countEnv('MASTRACODE_DISPATCH_MAX_INTERACTIVE_IN_FLIGHT', 1),
  },
  publicUrl: process.env.MASTRACODE_PUBLIC_URL,
  // Signs OAuth `state` for integration connect flows; stable across restarts.
  stateSecret: requiredEnv('GITHUB_APP_WEBHOOK_SECRET'),
});

const preparedArgs = await factory.prepare();

// Construct the server-owned Mastra HERE so the `new Mastra(...)` literal lives
// in the entry file (see module docs). `prepare()` returns the constructor args
// carrying the controller (via `agentControllers`), storage, and the assembled
// `server` config (middleware + apiRoutes + cors). Keep the worker-relevant
// properties explicit so deploy builds can statically detect the worker topology.
export const mastra = new Mastra({
  ...preparedArgs,
  storage: preparedArgs.storage,
  pubsub: preparedArgs.pubsub,
  workers: preparedArgs.workers,
  workflows: preparedArgs.workflows,
});

await factory.finalize();
