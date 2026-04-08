export const PST_TIME_ZONE = "Etc/GMT+8";
export const PST_LABEL = "PST";

export function formatPstDateTime(
  value?: string | number | Date,
  options: Intl.DateTimeFormatOptions = { dateStyle: "medium", timeStyle: "short" },
) {
  if (!value) {
    return "Unavailable";
  }

  return `${new Intl.DateTimeFormat("en-US", {
    ...options,
    timeZone: PST_TIME_ZONE,
  }).format(new Date(value))} ${PST_LABEL}`;
}

export function formatPstDate(
  value?: string | number | Date,
  options: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", year: "numeric" },
) {
  if (!value) {
    return "Unavailable";
  }

  return new Intl.DateTimeFormat("en-US", {
    ...options,
    timeZone: PST_TIME_ZONE,
  }).format(new Date(value));
}
