export function toUtcDateInput(value: Date | string | number | undefined): string {
  if (!value) {
    return new Date().toISOString().slice(0, 10);
  }

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return new Date().toISOString().slice(0, 10);
  }

  return date.toISOString().slice(0, 10);
}

export function startOfUtcDay(value: Date | string | number | undefined): Date {
  const date = value instanceof Date ? value : new Date(value ?? Date.now());
  if (Number.isNaN(date.getTime())) {
    return new Date();
  }

  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

export function endOfUtcDay(value: Date | string | number | undefined): Date {
  const start = startOfUtcDay(value);
  start.setUTCDate(start.getUTCDate() + 1);
  start.setUTCMilliseconds(-1);
  return start;
}
