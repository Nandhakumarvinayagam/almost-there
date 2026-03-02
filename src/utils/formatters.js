export function timeAgo(timestamp, now) {
  if (!timestamp) return null;
  const seconds = Math.floor((now - timestamp) / 1000);
  if (seconds < 60) return "Just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min${minutes !== 1 ? "s" : ""} ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours} hr${hours !== 1 ? "s" : ""} ago`;
}
