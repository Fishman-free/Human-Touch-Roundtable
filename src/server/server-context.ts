import type { Server } from "socket.io";
import type { AiProvider, RuntimeOptions, TopicProvider } from "../application/ports.ts";
import { SqlitePersistence } from "../repository/sqlite-persistence.ts";
import { RoomRegistry, type RoomLifecycleOptions } from "./room-registry.ts";
import { SessionService } from "./session.ts";
import { SocketGateway } from "./socket-gateway.ts";
import type { ClientToServerEvents, ServerToClientEvents } from "./socket-contracts.ts";
import { secureRandom, systemClock } from "./runtime-dependencies.ts";

export interface ServerContextConfig {
  databasePath: string;
  sessionHmacKey: string | Buffer;
  runtime?: Partial<RuntimeOptions>;
  lifecycle?: Partial<RoomLifecycleOptions>;
}

export function createServerContext(config: ServerContextConfig, providers: {
  topics: TopicProvider;
  ai: AiProvider;
  diagnose?: (event: { roomId: string; kind: string }) => void;
}) {
  if (Buffer.byteLength(config.sessionHmacKey) < 32) throw new Error("SESSION_KEY_TOO_SHORT");
  const persistence = new SqlitePersistence(config.databasePath);
  const rooms = new RoomRegistry({
    clock: systemClock,
    random: secureRandom,
    store: persistence,
    topics: providers.topics,
    ai: providers.ai,
    diagnose: providers.diagnose,
  }, config.runtime, config.lifecycle);
  const sessions = new SessionService(persistence, config.sessionHmacKey);
  let registered = false;
  let initialized = false;
  let closed = false;

  return {
    async initialize() {
      if (closed || initialized) throw new Error(closed ? "SERVER_CONTEXT_CLOSED" : "SERVER_CONTEXT_ALREADY_INITIALIZED");
      await rooms.initialize();
      initialized = true;
    },
    register(io: Server<ClientToServerEvents, ServerToClientEvents>) {
      if (closed || registered || !initialized) throw new Error(closed ? "SERVER_CONTEXT_CLOSED" : registered
        ? "SOCKET_GATEWAY_ALREADY_REGISTERED" : "SERVER_CONTEXT_NOT_INITIALIZED");
      new SocketGateway(io, rooms, sessions).register();
      registered = true;
    },
    async close() {
      if (closed) return;
      closed = true;
      await rooms.close();
      persistence.close();
    },
  };
}
