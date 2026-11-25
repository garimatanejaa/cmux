/** An error answer from the relay (or from cmux through it). */
export class RelayRPCError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly data?: unknown,
  ) {
    super(message);
    this.name = "RelayRPCError";
  }

  /** True when this device's access level does not allow the call. */
  get isForbidden(): boolean {
    return this.code === "forbidden";
  }
}

/** The relay could not be reached, or the connection dropped. */
export class RelayConnectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RelayConnectionError";
  }
}

/** The relay answered an HTTP request with an error status. */
export class RelayHTTPError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: string,
    public readonly retryAfterSeconds?: number,
  ) {
    super(`relay answered HTTP ${status}`);
    this.name = "RelayHTTPError";
  }

  /** Too many wrong pairing codes from this phone's address. */
  get isLockedOut(): boolean {
    return this.status === 429;
  }

  /** Wrong, expired or already-used pairing code, or this device is not allowed. */
  get isRefused(): boolean {
    return this.status === 403;
  }

  /** The Mac cannot identify this phone through Tailscale (yet). */
  get isTailscaleUnavailable(): boolean {
    return this.status === 503;
  }
}
