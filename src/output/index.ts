import type { OutputStrategy } from "./strategy.js";
import { DatabaseStrategy } from "./db-strategy.js";
import { PdfStrategy } from "./pdf-strategy.js";

export type OutputMode = "database" | "pdf";

let activeStrategy: OutputStrategy | null = null;

export function setStrategy(strategy: OutputStrategy): void {
  activeStrategy = strategy;
}

export function getStrategy(): OutputStrategy {
  if (!activeStrategy) {
    // Default to database strategy if none was configured
    activeStrategy = new DatabaseStrategy();
  }
  return activeStrategy;
}

export function createStrategy(mode: OutputMode): OutputStrategy {
  switch (mode) {
    case "pdf":
      return new PdfStrategy();
    case "database":
    default:
      return new DatabaseStrategy();
  }
}

export { DatabaseStrategy, PdfStrategy };
export type { OutputStrategy };
