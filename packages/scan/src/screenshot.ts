/**
 * Screenshot service — Playwright-backed screenshot capture.
 *
 * Contract:
 * - `ScreenshotService` is the interface consumers depend on.
 * - `StubScreenshotService` is the test double (no network, no Playwright needed).
 * - `PlaywrightScreenshotService` is the real impl; it dynamically imports
 *   Playwright at runtime so the package has no hard Playwright dependency
 *   and unit tests never touch the network.
 *
 * SPEC S7: "Playwright screenshot interface (define ScreenshotService
 * interface; stub impl for tests, real impl shells out or uses Playwright API)"
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ScreenshotOptions {
  /** Viewport width in CSS pixels. */
  width?: number;
  /** Viewport height in CSS pixels. */
  height?: number;
  /** Wait until `networkidle` before capturing (default: false — `load`). */
  waitForNetworkIdle?: boolean;
  /** Capture full scrollable page (default: false — viewport only). */
  fullPage?: boolean;
  /** Timeout in ms for navigation (default: 30_000). */
  timeoutMs?: number;
}

export interface ScreenshotResult {
  /** The URL that was captured. */
  url: string;
  /** Screenshot bytes (PNG). */
  buffer: Buffer;
  /** Absolute path where the file was written (if `outputPath` was given). */
  filePath?: string;
  /** Viewport used. */
  viewport: { width: number; height: number };
  /** When the capture was taken. */
  capturedAt: string;
}

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------

/**
 * Takes screenshots of live URLs via Playwright.
 *
 * Implementations MUST NOT be constructed with network access in unit tests.
 * Use `StubScreenshotService` there.
 */
export interface ScreenshotService {
  /**
   * Capture a screenshot of `url`.
   * @param url - absolute http(s) URL to capture.
   * @param opts - capture options.
   */
  capture(url: string, opts?: ScreenshotOptions): Promise<ScreenshotResult>;

  /**
   * Capture multiple URLs (convenience helper — sequential by default).
   */
  captureAll(urls: string[], opts?: ScreenshotOptions): Promise<ScreenshotResult[]>;
}

// ---------------------------------------------------------------------------
// Default options
// ---------------------------------------------------------------------------

export const DEFAULT_SCREENSHOT_OPTIONS: Required<ScreenshotOptions> = {
  width: 1280,
  height: 720,
  waitForNetworkIdle: false,
  fullPage: false,
  timeoutMs: 30_000,
};

// ---------------------------------------------------------------------------
// Stub — for unit tests
// ---------------------------------------------------------------------------

/**
 * Test double: returns a 1×1 transparent PNG without touching the network.
 * Pass `responses` to control per-URL results (for multi-URL scenarios).
 */
export class StubScreenshotService implements ScreenshotService {
  private readonly responses: Map<string, ScreenshotResult>;
  public readonly calls: Array<{ url: string; opts: Required<ScreenshotOptions> }> = [];

  constructor(responses?: Map<string, ScreenshotResult> | Record<string, ScreenshotResult>) {
    if (responses instanceof Map) {
      this.responses = responses;
    } else if (responses) {
      this.responses = new Map(Object.entries(responses));
    } else {
      this.responses = new Map();
    }
  }

  async capture(url: string, opts: ScreenshotOptions = {}): Promise<ScreenshotResult> {
    const merged: Required<ScreenshotOptions> = { ...DEFAULT_SCREENSHOT_OPTIONS, ...opts };
    this.calls.push({ url, opts: merged });

    const preset = this.responses.get(url);
    if (preset) return preset;

    return {
      url,
      buffer: tinyPng(),
      viewport: { width: merged.width, height: merged.height },
      capturedAt: new Date().toISOString(),
    };
  }

  async captureAll(urls: string[], opts: ScreenshotOptions = {}): Promise<ScreenshotResult[]> {
    const results: ScreenshotResult[] = [];
    for (const url of urls) {
      results.push(await this.capture(url, opts));
    }
    return results;
  }
}

// 1×1 transparent PNG bytes (68 bytes) — valid PNG, minimal, deterministic.
function tinyPng(): Buffer {
  // Base64 of a 1×1 transparent PNG.
  return Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=",
    "base64",
  );
}

// ---------------------------------------------------------------------------
// Real implementation — lazy-loaded Playwright
// ---------------------------------------------------------------------------

/**
 * Real Playwright implementation.
 *
 * - Imports `playwright` dynamically so the package does not require it at
 *   install time.
 * - Launches Chromium headless, navigates to `url`, screenshots, closes.
 * - If `outputPath` is set in opts (via extended opts), writes the file.
 *
 * Callers that cannot guarantee Playwright is installed should catch the
 * error and degrade gracefully (e.g. skip screenshots).
 */
export class PlaywrightScreenshotService implements ScreenshotService {
  async capture(url: string, opts: ScreenshotOptions = {}): Promise<ScreenshotResult> {
    const merged: Required<ScreenshotOptions> = { ...DEFAULT_SCREENSHOT_OPTIONS, ...opts };
    validateUrl(url);

    // Dynamic import — fails with a clear message if Playwright is not installed.
    let playwright: { chromium: { launch: (o: unknown) => Promise<BrowserLike> } };
    try {
      const pwSpec = "playwright";
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      playwright = (await import(/* @vite-ignore */ pwSpec)) as typeof playwright;
    } catch {
      throw new Error(
        "Playwright is not installed. Run: pnpm add -D playwright && npx playwright install chromium",
      );
    }

    const browser = await playwright.chromium.launch({ headless: true });
    try {
      const context = await browser.newContext({
        viewport: { width: merged.width, height: merged.height },
      });
      const page = await context.newPage();
      await page.goto(url, {
        waitUntil: merged.waitForNetworkIdle ? "networkidle" : "load",
        timeout: merged.timeoutMs,
      });
      const buffer = (await page.screenshot({ fullPage: merged.fullPage })) as Buffer;
      await context.close();

      return {
        url,
        buffer: Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer),
        viewport: { width: merged.width, height: merged.height },
        capturedAt: new Date().toISOString(),
      };
    } finally {
      await browser.close();
    }
  }

  async captureAll(urls: string[], opts: ScreenshotOptions = {}): Promise<ScreenshotResult[]> {
    const results: ScreenshotResult[] = [];
    for (const url of urls) {
      results.push(await this.capture(url, opts));
    }
    return results;
  }
}

// Minimal structural type for the browser handle — avoids importing Playwright types.
interface BrowserLike {
  newContext(opts: unknown): Promise<ContextLike>;
  close(): Promise<void>;
}

interface ContextLike {
  newPage(): Promise<PageLike>;
  close(): Promise<void>;
}

interface PageLike {
  goto(url: string, opts: unknown): Promise<unknown>;
  screenshot(opts: unknown): Promise<Buffer | Uint8Array>;
}

function validateUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Invalid URL for screenshot: ${url}`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`Screenshot URL must be http(s): ${url}`);
  }
}
