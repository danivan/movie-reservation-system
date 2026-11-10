import { ConsoleLogger, Logger } from '@nestjs/common';

type AnyFn = (...args: unknown[]) => unknown;

// Always spied on, even if the console object doesn't expose them as keys.
// Every other function-valued key of `console` is spied on as well.
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

// Function-valued keys that are not logging channels.
const NON_CHANNEL_KEYS = new Set(['constructor', 'Console']);

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

// Every function-valued data property of `target` and its prototype chain
// (Jest's console keeps some methods on its prototype). Accessors are skipped
// so no getter runs.
const functionKeys = (target: object): string[] => {
  const names = new Set<string>();
  for (
    let level: object | null = target;
    level !== null && level !== Object.prototype;
    level = Object.getPrototypeOf(level)
  ) {
    for (const name of Object.getOwnPropertyNames(level)) {
      const descriptor = Object.getOwnPropertyDescriptor(level, name);
      if (
        !NON_CHANNEL_KEYS.has(name) &&
        typeof descriptor?.value === 'function'
      ) {
        names.add(name);
      }
    }
  }
  return [...names];
};

const spyOnMethods = (
  target: object,
  label: string,
  names: readonly string[],
  into: LoggingSpy[],
) => {
  const record = target as Record<string, AnyFn>;
  for (const name of new Set(names)) {
    // Skip methods this Nest/Node version doesn't define.
    if (typeof record[name] !== 'function') {
      continue;
    }
    const spy = jest.spyOn(record, name).mockImplementation(() => undefined);
    into.push({ channel: `${label}.${name}`, spy });
  }
};

/**
 * Silences and spies on every function-valued key of `console`, every Nest
 * `Logger` method (instance and static), and every `ConsoleLogger` instance
 * method (Nest's default logger, also used directly via `new ConsoleLogger`).
 *
 * Restoring is left to the caller: call `jest.restoreAllMocks()` in
 * `afterEach`.
 *
 * `process.stdout.write` is deliberately not spied on: Jest writes there
 * too.
 */
export const spyOnAllLogging = (): LoggingSpies => {
  const spies: LoggingSpy[] = [];
  spyOnMethods(
    console,
    'console',
    [...CONSOLE_METHODS, ...functionKeys(console)],
    spies,
  );
  spyOnMethods(Logger.prototype, 'Logger.prototype', LOGGER_METHODS, spies);
  spyOnMethods(Logger, 'Logger', LOGGER_METHODS, spies);
  spyOnMethods(
    ConsoleLogger.prototype,
    'ConsoleLogger.prototype',
    LOGGER_METHODS,
    spies,
  );

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
