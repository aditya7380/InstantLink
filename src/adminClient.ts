/** Build fetch options for the admin API. Only send a JSON content-type when there is a body
 *  (Fastify rejects an empty body that claims to be JSON; that bug broke `revoke` once). */
export function adminRequestInit(method: string, key: string, body?: unknown): RequestInit {
  return {
    method,
    headers: body === undefined ? { 'x-admin-key': key } : { 'x-admin-key': key, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  };
}
