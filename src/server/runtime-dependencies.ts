import { randomInt } from "node:crypto";
import type { Clock, RandomSource } from "../application/ports.ts";

export const systemClock: Clock = {
  now: () => Date.now(),
  setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimeout: handle => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export const secureRandom: RandomSource = { integer: exclusiveMax => randomInt(exclusiveMax) };
