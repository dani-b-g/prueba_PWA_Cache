import type { IncomingMessage, ServerResponse } from 'node:http';

export declare function isDown(): boolean;
export declare function mockApi(
  req: IncomingMessage,
  res: ServerResponse,
  next?: () => unknown,
): unknown;
