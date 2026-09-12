import type { Server } from "socket.io";
import type { AiProvider, DiagnosticKind, RuntimeOptions, TopicProvider } from "../application/ports.ts";
import { SqlitePersistence } from "../repository/sqlite-persistence.ts";
import { RoomRegistry, type RoomLifecycleOptions } from "./room-registry.ts";
import { SessionService } from "./session.ts";
import { SocketGateway } from "./socket-gateway.ts";
import type { ClientToServerEvents, ServerToClientEvents } from "./socket-contracts.ts";
import { secureRandom, systemClock } from "./runtime-dependencies.ts";
import { AdmissionService } from "./admission-service.ts";
import type { SocketGatewayOptions } from "./socket-gateway.ts";

export interface ServerContextConfig {
  databasePath: string;
  sessionHmacKey: string | Buffer;
  runtime?: Partial<RuntimeOptions>;
  lifecycle?: Partial<RoomLifecycleOptions>;
  session?: { admissionTtlMs?: number; sessionTtlMs?: number; touchIntervalMs?: number; cleanupIntervalMs?: number };
  socket?: Partial<Omit<SocketGatewayOptions, "clock">>;
}

export function createServerContext(config: ServerContextConfig, providers: {
  topics: TopicProvider;
  ai: AiProvider;
  diagnose?: (event: { roomId: string; kind: DiagnosticKind }) => void;
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
  const sessions = new SessionService(persistence, config.sessionHmacKey, systemClock.now,
    config.session?.admissionTtlMs, config.session?.sessionTtlMs, config.session?.touchIntervalMs);
  const admissions = new AdmissionService(rooms, sessions);
  let registered = false;
  let initialized = false;
  let closed = false;
  let sessionCleanupHandle: unknown;
  const sessionCleanupIntervalMs = config.session?.cleanupIntervalMs ?? 60 * 60 * 1_000;
  if (!Number.isSafeInteger(sessionCleanupIntervalMs) || sessionCleanupIntervalMs <= 0) throw new Error("INVALID_SESSION_CLEANUP_INTERVAL");
  const scheduleSessionCleanup = () => {
    if (closed) return;
    sessionCleanupHandle = systemClock.setTimeout(() => {
      void sessions.cleanupExpired().catch(() => {
        providers.diagnose?.({ roomId: "*", kind: "session-cleanup-failed" });
      }).finally(scheduleSessionCleanup);
    }, sessionCleanupIntervalMs);
  };

  return {
    async initialize() {
      if (closed || initialized) throw new Error(closed ? "SERVER_CONTEXT_CLOSED" : "SERVER_CONTEXT_ALREADY_INITIALIZED");
      await rooms.initialize();
      await sessions.cleanupExpired();
      scheduleSessionCleanup();
      initialized = true;
    },
    register(io: Server<ClientToServerEvents, ServerToClientEvents>) {
      if (closed || registered || !initialized) throw new Error(closed ? "SERVER_CONTEXT_CLOSED" : registered
        ? "SOCKET_GATEWAY_ALREADY_REGISTERED" : "SERVER_CONTEXT_NOT_INITIALIZED");
      new SocketGateway(io, admissions, { clock: systemClock, ...config.socket }).register();
      registered = true;
    },
    check() {
      try { return !closed && initialized && persistence.check(); }
      catch { return false; }
    },
    backup(path: string) {
      if (closed || !initialized) return Promise.reject(new Error("SERVER_CONTEXT_NOT_READY"));
      return persistence.backup(path);
    },
    listRooms: () => rooms.list(),
    deleteRoom: (roomId: string, expectedVersion?: number) => rooms.delete(roomId, expectedVersion),
    revokeSession: (sessionId: string) => sessions.revoke(sessionId),
    async cleanup() {
      await rooms.cleanupExpired();
      return { sessionsDeleted: await sessions.cleanupExpired() };
    },
    async close() {
      if (closed) return;
      closed = true;
      if (sessionCleanupHandle !== undefined) systemClock.clearTimeout(sessionCleanupHandle);
      await rooms.close();
      persistence.close();
    },
  };
}
