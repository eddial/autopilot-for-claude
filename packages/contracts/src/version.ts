/**
 * The API version. Bump it when the contract changes in a way an older client
 * cannot handle. A server serves its own version and the previous one, so the
 * apps and the server can be updated separately.
 */
export const API_VERSION = 1

export const isCompatible = (server: number, client: number): boolean =>
  client === server || client === server - 1
