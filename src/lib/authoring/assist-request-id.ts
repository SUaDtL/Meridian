export const requestIdPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-7[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;

export function assistRequestTimestamp(requestId: string): number | undefined {
  if (requestId.length !== 36 || !requestIdPattern.test(requestId)) return undefined;
  return Number.parseInt(requestId.slice(0, 8) + requestId.slice(9, 13), 16);
}
