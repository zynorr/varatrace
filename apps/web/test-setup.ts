import "@testing-library/jest-dom/vitest";
import { beforeEach } from "vitest";

// ResizeObserver is required by ReactFlow but isn't available in jsdom.
class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}
window.ResizeObserver = ResizeObserverMock as any;

window.matchMedia ??= ((query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addEventListener: () => {},
  removeEventListener: () => {},
  addListener: () => {},
  removeListener: () => {},
  dispatchEvent: () => false,
})) as typeof window.matchMedia;

beforeEach(() => {
  window.history.replaceState({}, "", "/");
});
