type ConsoleLevel = 'error' | 'warn' | 'info' | 'debug';

function serializeArg(value: unknown) {
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack,
    };
  }
  if (typeof value === 'string') {
    return value;
  }
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return String(value);
  }
}

function toMessage(args: unknown[]): string {
  return args
    .map((arg) => {
      if (typeof arg === 'string') {
        return arg;
      }
      if (arg instanceof Error) {
        return arg.message;
      }
      try {
        return JSON.stringify(arg);
      } catch {
        return String(arg);
      }
    })
    .join(' ');
}

export function installElectronLoggerBridge(targetWindow: Window & typeof globalThis = window) {
  if (typeof targetWindow === 'undefined') {
    return { installed: false };
  }

  const bridge = targetWindow.electronAPI?.log;
  if (!bridge) {
    return { installed: false };
  }

  if ((targetWindow as any).__electronLogBridgeInstalled) {
    return { installed: true };
  }

  const originalConsoles = new Map<ConsoleLevel, (...args: unknown[]) => void>();

  (['error', 'warn', 'info', 'debug'] as const).forEach((level) => {
    const logFn = bridge[level];
    if (typeof logFn !== 'function') {
      return;
    }

    const original = targetWindow.console[level] ?? targetWindow.console.log;
    originalConsoles.set(level, original.bind(targetWindow.console));

    targetWindow.console[level] = (...args: unknown[]) => {
      try {
        const message = toMessage(args);
        logFn(message, { args: args.map(serializeArg) });
      } catch {
        // Swallow logging errors to avoid recursive console spam.
      }
      original(...args);
    };
  });

  Object.defineProperty(targetWindow, '__electronLogBridgeInstalled', {
    value: true,
    writable: false,
    enumerable: false,
  });

  const restore = () => {
    originalConsoles.forEach((fn, level) => {
      targetWindow.console[level] = fn;
    });
  };

  return { installed: true, restore };
}

export default installElectronLoggerBridge;
