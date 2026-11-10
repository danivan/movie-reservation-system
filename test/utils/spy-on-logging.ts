import { Logger } from '@nestjs/common';

type AnyFn = (...args: unknown[]) => unknown;

export const CONSOLE_METHODS = [
  'log',
  'info',
  'debug',
  'warn',
  'error',
  'trace',
] as const;

export const LOGGER_METHODS = [
  'log',
  'error',
  'warn',
  'debug',
  'verbose',
  'fatal',
] as const;

export type LoggingSpy = {
  // e.g. 'console.log', 'Logger.prototype.error', 'Logger.warn' (static).
  channel: string;
  spy: jest.SpyInstance;
};

export type LoggingSpies = {
  spies: LoggingSpy[];
  // Channels that received at least one call since the spies were created.
  calls: () => string[];
  // Fails naming every channel that was called.
  expectNoLogging: () => void;
};

const spyOnMethods = (
  target: object,
  label: string,
  names: readonly string[],
  into: LoggingSpy[],
) => {
  const record = target as Record<string, AnyFn>;
  for (const name of names) {
    // Skip methods this Nest/Node version doesn't define.
    if (typeof record[name] !== 'function') {
      continue;
    }
    const spy = jest.spyOn(record, name).mockImplementation(() => undefined);
    into.push({ channel: `${label}.${name}`, spy });
  }
};

/**
 * Silences and spies on every console method and every Nest `Logger`
 * method (instance and static).
 *
 * Restoring is left to the caller: call `jest.restoreAllMocks()` in
 * `afterEach`.
 *
 * `process.stdout.write` is deliberately not spied on: Jest writes there
 * too.
 */
export const spyOnAllLogging = (): LoggingSpies => {
  const spies: LoggingSpy[] = [];
  spyOnMethods(console, 'console', CONSOLE_METHODS, spies);
  spyOnMethods(Logger.prototype, 'Logger.prototype', LOGGER_METHODS, spies);
  spyOnMethods(Logger, 'Logger', LOGGER_METHODS, spies);

  const calls = () =>
    spies
      .filter(({ spy }) => spy.mock.calls.length > 0)
      .map(({ channel }) => channel);

  const expectNoLogging = () => {
    // Comparing the list of called channels makes a failure name them.
    expect(calls()).toEqual([]);
  };

  return { spies, calls, expectNoLogging };
};
