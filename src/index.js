import { analyze, DEFAULTS } from './analyzer.js';
import { InteractionRecorder } from './recorder.js';
import { createTrap, TRAP_DEFAULTS } from './trap.js';

export { analyze, DEFAULTS, InteractionRecorder, createTrap, TRAP_DEFAULTS };

// Shortcut for the usual case: record on this page and analyze when needed.
//   const detector = createDetector().start();
//   detector.analyze();   // { verdict, score, signals, stats }
//   detector.export();    // events to analyze on the server
export function createDetector({ target, maxEvents, ...analyzerOptions } = {}) {
  const recorder = new InteractionRecorder({ target, maxEvents });
  return {
    recorder,
    start() { recorder.start(); return this; },
    stop() { recorder.stop(); return this; },
    reset() { recorder.clear(); return this; },
    analyze(options) { return analyze(recorder.events, { ...analyzerOptions, ...options }); },
    export() { return recorder.events.map(e => ({ ...e })); },
  };
}
