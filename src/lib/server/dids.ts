const didPattern = /^did:[a-z]+:[A-Za-z0-9._:%-]+$/;

export function isValidDid(value: string): boolean {
  return value.length <= 2048 && didPattern.test(value);
}
